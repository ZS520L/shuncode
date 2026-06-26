import path from "node:path"
import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import * as vscode from "vscode"
import * as diff from "diff"
import type { ToolUse } from "@core/assistant-message"
import { constructNewFileContent, getLineNumberFromCharIndex } from "@core/assistant-message/diff"
import { formatResponse } from "@core/prompts/responses"
import { getWorkspaceBasename, resolveWorkspacePath } from "@core/workspace"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { ShuncodeSayTool } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import { arePathsEqual, getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { applyModelContentFixes } from "../utils/ModelContentProcessor"
import { ToolDisplayUtils } from "../utils/ToolDisplayUtils"
import { ToolResultUtils } from "../utils/ToolResultUtils"
import { getDiffSystem } from "@/core/diff-v2"

/** A single diff block produced by writeFileAndVisualizeDiff */
interface WriteDiffBlock {
	type: 'deletion' | 'addition' | 'replacement';
	lineInOldFile: number;
	lineInNewFile: number;
	removedLines: string[];
	addedLines: string[];
	hunkId?: string;
}

export class WriteToFileToolHandler implements IFullyManagedTool {
	readonly name = ShuncodeDefaultTool.FILE_NEW // This handler supports write_to_file, replace_in_file, and new_rule

	constructor(private validator: ToolValidator) { }

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path || block.params.absolutePath}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path || block.params.absolutePath
		if (!relPath) return

		const config = uiHelpers.getConfig()
		const readablePath = getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath))
		const isInWorkspace = await isLocatedInWorkspace(relPath)

		const isWrite = block.name === "write_to_file" || block.name === "new_rule"
		const raw = isWrite ? block.params.content : block.params.diff
		if (!raw) return

		// Очистить незакрытые теги в partial-блоке, чтобы текст был валидным
		const cleaned = uiHelpers.removeClosingTag(block, isWrite ? "content" : "diff", raw)

		// Показываем реальное содержимое, но ограничиваем длину превью
		const lines = cleaned.split('\n')
		const maxLines = 800
		const previewLines = lines.slice(0, maxLines)
		const previewContent = previewLines.join('\n')

		const toolType = isWrite ? "newFileCreated" : "editedExistingFile"

		const msg: ShuncodeSayTool = {
			tool: toolType,
			path: readablePath,
			content: previewContent,
			operationIsLocatedInWorkspace: isInWorkspace,
		}

		// say(partial=true) обновляет последнее partial-сообщение in-place, без removeLastPartial
		// (removeLastPartial вызывал удаление + пересоздание → мигание)
		await uiHelpers.say("tool", JSON.stringify(msg), undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const rawRelPath = block.params.path || block.params.absolutePath
		const rawContent = block.params.content // for write_to_file
		const rawDiff = block.params.diff // for replace_in_file
		const rawQuery = block.params.query // for delete_block, replace_text
		const rawReplace = block.params.replace // for replace_text

		// Extract provider information for telemetry
		const { providerId, modelId } = this.getModelInfo(config)

		// Validate required parameters based on tool type
		if (!rawRelPath) {
			config.taskState.consecutiveMistakeCount++
			await config.services.diffViewProvider.reset()
			return await config.callbacks.sayAndCreateMissingParamError(
				block.name,
				block.params.absolutePath ? "absolutePath" : "path",
			)
		}

		if (block.name === "replace_in_file" && !rawDiff) {
			config.taskState.consecutiveMistakeCount++
			await config.services.diffViewProvider.reset()
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "diff")
		}

		if (block.name === "write_to_file" && !rawContent) {
			config.taskState.consecutiveMistakeCount++
			await config.services.diffViewProvider.reset()
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "content")
		}

		if (block.name === "new_rule" && !rawContent) {
			config.taskState.consecutiveMistakeCount++
			await config.services.diffViewProvider.reset()
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "content")
		}

		// Validate delete_block parameters
		if (block.name === "delete_block" && !rawQuery) {
			config.taskState.consecutiveMistakeCount++
			await config.services.diffViewProvider.reset()
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "query")
		}

		// Validate replace_text parameters
		if (block.name === "replace_text" && !rawQuery) {
			config.taskState.consecutiveMistakeCount++
			await config.services.diffViewProvider.reset()
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "query")
		}

		if (block.name === "replace_text" && rawReplace === undefined) {
			config.taskState.consecutiveMistakeCount++
			await config.services.diffViewProvider.reset()
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "replace")
		}

		config.taskState.consecutiveMistakeCount = 0

		try {
			// [SHUNCODE-SHUNCODE] Use DiffSystem V2 (inline diffs)
			return await this.executeNativeDiff(config, block, rawRelPath, rawDiff, rawContent, rawQuery, rawReplace);
		} catch (error) {
			// Ignore "Shuncode instance aborted" errors - task was cancelled, don't propagate
			if (error instanceof Error && error.message === "Shuncode instance aborted") {
				console.log('[WriteToFileToolHandler] Task aborted, ignoring error');
				return formatResponse.toolResult("Operation cancelled");
			}
			console.error('[WriteToFileToolHandler] DiffSystem error:', error);
			throw error;
		}
	}

	// [SHUNCODE-SHUNCODE] New Native Diff Execution Logic
	private async executeNativeDiff(config: TaskConfig, block: ToolUse, rawRelPath: string, rawDiff?: string, rawContent?: string, rawQuery?: string, rawReplace?: string): Promise<ToolResponse> {
		// 1. Prepare: Read original file, calculate new content
		const pathResult = resolveWorkspacePath(config, rawRelPath, "WriteToFileToolHandler.executeNativeDiff");
		const { absolutePath, resolvedPath } = typeof pathResult === "string"
			? { absolutePath: pathResult, resolvedPath: rawRelPath }
			: { absolutePath: pathResult.absolutePath, resolvedPath: pathResult.resolvedPath };

		const fileExists = await fileExistsAtPath(absolutePath);
		let originalContent = "";
		let readBeforeEditWarning = "";
		let preEditDiagnostics: { errors: string[]; warnings: string[] } | undefined;
		if (fileExists) {
			// P0: Read-before-edit enforcement — check if AI read this file before editing
			if (block.name === "replace_in_file") {
				const hasBeenRead = await config.services.fileContextTracker.hasFileBeenReadInSession(rawRelPath);
				if (!hasBeenRead) {
					readBeforeEditWarning = `\n\n[WARNING: You are editing "${resolvedPath}" without having read it first in this conversation. Your SEARCH content may not match the actual file. Always use read_file before replace_in_file to ensure accurate edits.]`;
				}
			}

			// Capture pre-edit diagnostics for comparison
			const { getFileDiagnostics } = await import("../utils/PostEditDiagnostics")
			preEditDiagnostics = getFileDiagnostics(absolutePath)

			// Read from editor buffer (includes unsaved changes) rather than disk
			const doc = await vscode.workspace.openTextDocument(absolutePath);
			originalContent = doc.getText();
		}

		let newContent = "";
		let matchIndices: number[] = [];
		let replacements: Array<{ start: number; end: number; originalContent: string; content: string }> | undefined = [];
		let diffContent = rawDiff;
		let content = rawContent;

		if (block.name === "replace_in_file" && diffContent) {
			diffContent = applyModelContentFixes(diffContent, config.api.getModel().id, resolvedPath);
			try {
				const result = await constructNewFileContent(diffContent, originalContent, !block.partial);
				newContent = result.newContent;
				matchIndices = result.matchIndices;
				replacements = result.replacements;
			} catch (error) {
				// Handle diff error similar to original
				const errorResponse = formatResponse.toolError(`${(error as Error)?.message}\n\n` + formatResponse.diffError(resolvedPath, originalContent));
				// Push error response... (simplified for brevity, should match original)
				throw error;
			}
		} else if (content) {
			newContent = content;
			if (newContent.startsWith("```")) newContent = newContent.split("\n").slice(1).join("\n").trim();
			if (newContent.endsWith("```")) newContent = newContent.split("\n").slice(0, -1).join("\n").trim();
			newContent = applyModelContentFixes(newContent, config.api.getModel().id, resolvedPath);
		}

		// 2. [DIFF-V2] Используем DiffSystem для Cursor-like диффов
		// DiffSystem сам управляет записью файла, View Zones и позиционированием
		let appliedBlocks: WriteDiffBlock[] = [];
		let isNewFileCreation = !fileExists;

		try {
			const diffSystem = getDiffSystem();

			// Detect "file was created by AI and consists entirely of pending additions".
			// Only merge into a single hunk when the original file content is empty —
			// i.e. the file was just created by AI and not yet accepted.
			// For existing files with a few pending addition hunks (e.g. import lines),
			// always go through writeFileAndVisualizeDiff to produce granular hunks.
			const pendingHunks = diffSystem.getStore().getPendingHunksByFile(absolutePath);
			const isFullPendingCreation = fileExists
				&& pendingHunks.length > 0
				&& pendingHunks.every(h => h.type === 'addition' && h.removedLines.length === 0)
				&& originalContent.trim().length === 0;

			if (isFullPendingCreation && newContent && newContent !== originalContent) {
				// File is entirely pending additions (not yet accepted). Update in-place
				// so the user sees a single green diff with the final content.
				isNewFileCreation = true;
				const allLines = newContent.split('\n');

				// Keep only the first hunk; silently accept extras so they leave pending state
				const [creationHunk, ...extraHunks] = pendingHunks;
				for (const extra of extraHunks) {
					console.log(`[WriteToFile] Accepting extra pending hunk ${extra.id} to merge into primary`);
					diffSystem.getStore().updateHunkStatus(extra.id, 'accepted');
				}

				// Extract only the added portion (from currentStartLine to end of file).
				// Lines before currentStartLine are the original file content, not part of the hunk.
				const addedLines = allLines.slice(creationHunk.currentStartLine - 1);
				const addedCount = addedLines.length;

				console.log(`[WriteToFile] Updating pending creation hunk ${creationHunk.id}: total=${allLines.length} added=${addedCount} startLine=${creationHunk.currentStartLine}`);

				await diffSystem.writeFileContent(absolutePath, newContent);

				diffSystem.getStore().updateHunk(creationHunk.id, {
					currentStartLine: creationHunk.currentStartLine,
					currentEndLine: creationHunk.currentStartLine + addedCount,
					removedLines: [],
					addedLines: addedLines,
					type: 'addition',
				});

				appliedBlocks = [{
					type: 'addition',
					lineInOldFile: creationHunk.currentStartLine,
					lineInNewFile: creationHunk.currentStartLine,
					removedLines: [],
					addedLines: addedLines,
				}];
			} else if (block.name === "replace_in_file" && diffContent && replacements && replacements.length > 0) {
				// replace_in_file: newContent already computed by constructNewFileContent.
				// Write file ONCE and visualize all diffs (fixes multi-replacement position corruption).
				if (originalContent !== newContent) {
					appliedBlocks = await this.writeFileAndVisualizeDiff(diffSystem, absolutePath, originalContent, newContent);
				}
			} else if (block.name === "delete_block" && rawQuery) {
				// delete_block: найти блок по query и удалить его
				const result = await this.executeDeleteBlock(config, absolutePath, originalContent, rawQuery, block.params.startLine);
				if (result.error) {
					return formatResponse.toolError(result.error);
				}
				newContent = result.newContent || originalContent;
			} else if (block.name === "replace_text" && rawQuery) {
				// replace_text: найти текст по query и заменить
				const result = await this.executeReplaceText(config, absolutePath, originalContent, rawQuery, rawReplace || '', block.params.startLine);
				if (result.error) {
					return formatResponse.toolError(result.error);
				}
				newContent = result.newContent || originalContent;
			} else if (content) {
				// write_to_file logic
				if (!fileExists) {
					// New file — create empty, then addLines for full green diff
					isNewFileCreation = true;
					const dir = path.dirname(absolutePath);
					await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
					await vscode.workspace.fs.writeFile(vscode.Uri.file(absolutePath), Buffer.from(""));

					const newLines = newContent.split('\n');
					await diffSystem.addLines(absolutePath, 0, newLines);

					// addLines registers the FileChange as 'modified'; mark it as a true
					// creation so rollback DELETES the file instead of leaving it empty.
					diffSystem.markFileAsCreated(absolutePath);

					appliedBlocks = [{

						type: 'addition',
						lineInOldFile: 1,
						lineInNewFile: 1,
						removedLines: [],
						addedLines: newLines,
					}];
				} else if (originalContent !== newContent) {
					// Existing file — normal diff
					appliedBlocks = await this.writeFileAndVisualizeDiff(diffSystem, absolutePath, originalContent, newContent);
				} else {
					console.log('[WriteToFile] No changes detected');
				}
			}

			// Load document into memory (for WorkspaceEdit) but don't show it.
			// User opens the file by clicking the diff card in chat (Cursor-like behavior).
			await vscode.workspace.openTextDocument(absolutePath);

		} catch (diffError) {
			const errorMessage = diffError instanceof Error ? diffError.message : String(diffError);

			// v4: Return ALL errors to model (no more silent fallback to direct file write).
			// This ensures the model gets feedback about syntax errors, size limits, etc.
			if (errorMessage.includes('Syntax validation failed')) {
				return formatResponse.toolError(
					`Syntax Error: The proposed change would break the code syntax.\n\n${errorMessage}\n\nPlease fix the syntax error and try again.`
				);
			}

			if (errorMessage.includes('Too many changes')) {
				console.warn('[WriteToFileToolHandler] Change too large:', errorMessage);
				return formatResponse.toolError(errorMessage);
			}

			// Other DiffSystem errors — log and return to model
			console.error('[WriteToFileToolHandler] DiffSystem error:', diffError);
			return formatResponse.toolError(
				`Failed to apply changes: ${errorMessage}\n\nPlease try a smaller, more targeted change.`
			);
		}

		// 3.5. No-op detection: if file didn't actually change, tell the model
		if (fileExists && appliedBlocks.length === 0) {
			const postEditDoc = await vscode.workspace.openTextDocument(absolutePath);
			const postEditContent = postEditDoc.getText();
			if (postEditContent === originalContent) {
				console.log(`[WriteToFile] No-op detected: file unchanged after ${block.name}`);
				config.taskState.consecutiveMistakeCount++;
				return formatResponse.toolError(
					`No changes were made to the file. The replacement content is identical to the original. ` +
					`Make sure your changes actually modify the content. Current consecutive mistakes: ${config.taskState.consecutiveMistakeCount}`
				);
			}
		}

		// 4. Handle chat messages — always show diff preview in EditCards
		const readablePath = getReadablePath(config.cwd, resolvedPath);
		const isInWorkspace = await isLocatedInWorkspace(resolvedPath);

		await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool");

		// If no appliedBlocks yet, compute diff preview
		if (appliedBlocks.length === 0 && fileExists && originalContent) {
			// Re-read the file to get the ACTUAL current content (after DiffSystem edits)
			const currentDoc = await vscode.workspace.openTextDocument(absolutePath);
			const currentContent = currentDoc.getText();
			if (currentContent !== originalContent) {
				appliedBlocks = this.computeDiffBlocks(originalContent, currentContent);
			}

			// If file didn't change (overlap auto-reject + re-apply = same content),
			// get preview from the latest pending hunk for this file
			if (appliedBlocks.length === 0) {
				const diffSystem = getDiffSystem();
				const store = diffSystem.getStore();
				const pendingHunks = store.getPendingHunksByFile(absolutePath)
					.sort((a, b) => b.createdAt - a.createdAt);
				if (pendingHunks.length > 0) {
					const latest = pendingHunks[0];
					appliedBlocks = [{
						type: latest.type === 'deletion' ? 'deletion' : latest.type === 'addition' ? 'addition' : 'replacement',
						lineInOldFile: latest.originalStartLine,
						lineInNewFile: latest.currentStartLine,
						removedLines: latest.removedLines,
						addedLines: latest.addedLines,
						hunkId: latest.id,
					}];
				}
			}
		}

		if (appliedBlocks.length > 0) {
			// One EditCard per tool invocation — avoids flooding chat when DiffSystem
			// splits into many hunks (e.g. 30× one-line width tweaks).
			const combinedContent = this.buildCombinedChatPreview(appliedBlocks);
			const msg: ShuncodeSayTool = {
				tool: isNewFileCreation ? "newFileCreated" : "editedExistingFile",
				path: readablePath,
				content: combinedContent,
				operationIsLocatedInWorkspace: isInWorkspace,
				startLineNumbers: appliedBlocks.map((b) => b.lineInNewFile),
				...(appliedBlocks.length === 1 && appliedBlocks[0].hunkId
					? { hunkId: appliedBlocks[0].hunkId }
					: {}),
			};
			await config.callbacks.say("tool", JSON.stringify(msg), undefined, undefined, false);
		} else {
			// No diff blocks — file unchanged or edge case
			const sharedMessageProps: ShuncodeSayTool = {
				tool: isNewFileCreation ? "newFileCreated" : "editedExistingFile",
				path: readablePath,
				content: diffContent || content,
				operationIsLocatedInWorkspace: isInWorkspace,
				startLineNumbers: matchIndices?.map((idx) => getLineNumberFromCharIndex(originalContent, idx)),
			};
			await config.callbacks.say("tool", JSON.stringify(sharedMessageProps), undefined, undefined, false);
		}

		config.taskState.didEditFile = true;
		config.services.fileContextTracker.markFileAsEditedByShuncode(resolvedPath);
		await config.services.fileContextTracker.trackFileContext(resolvedPath, "shuncode_edited");

		// Post-edit diagnostics: check if the edit introduced new errors
		let diagnosticWarning = "";
		if (preEditDiagnostics) {
			const { getFileDiagnostics, computeDiagnosticDelta, formatDiagnosticWarning, waitForDiagnosticsUpdate } = await import("../utils/PostEditDiagnostics")
			await waitForDiagnosticsUpdate(400) // wait for language server to reprocess
			const postEditDiagnostics = getFileDiagnostics(absolutePath)
			const delta = computeDiagnosticDelta(preEditDiagnostics, postEditDiagnostics)
			diagnosticWarning = formatDiagnosticWarning(delta)
		}

		const baseResponse = formatResponse.fileEditWithoutUserChanges(resolvedPath, "", newContent, "");
		return readBeforeEditWarning
			? baseResponse + readBeforeEditWarning + diagnosticWarning
			: baseResponse + diagnosticWarning;
	}

	/**
	 * v4: Compute diff blocks and apply each through DiffSystem (single path of writing).
	 *
	 * DiffSystem handles: pre-save, snapshot, overlap detection, HunkApplier (atomic write),
	 * PositionTracker, InlineDiffRenderer (reactive View Zones).
	 *
	 * No direct file writes here — everything goes through DiffSystem.replaceLines/deleteLines/addLines.
	 */
	private async writeFileAndVisualizeDiff(
		diffSystem: ReturnType<typeof getDiffSystem>,
		absolutePath: string,
		originalContent: string,
		newContent: string,
	): Promise<WriteDiffBlock[]> {
		// 0. Pre-reject existing pending hunks to avoid position corruption.
		// When applying multiple diff blocks, overlap-rejecting old hunks mid-loop
		// shifts line numbers without updating cumulativeOffset, corrupting the file.
		const restoredContent = await diffSystem.preRejectForNewEdit(absolutePath);
		if (restoredContent !== undefined) {
			originalContent = restoredContent;
		}

		// 1. Compute line-level diff BEFORE any writes
		// Normalize CRLF→LF: AI sends \n, but Windows files have \r\n.
		// Without this, diff.diffLines treats EVERY line as changed.
		const normalizedOriginal = originalContent.replace(/\r\n/g, '\n');
		const normalizedNew = newContent.replace(/\r\n/g, '\n');
		const changes = diff.diffLines(normalizedOriginal, normalizedNew);

		// 2. Build diff blocks with positions in the ORIGINAL file
		const diffBlocks: WriteDiffBlock[] = [];
		let lineInOld = 1;
		let lineInNew = 1;

		for (let i = 0; i < changes.length; i++) {
			const change = changes[i];
			const lines = change.value.split('\n');
			if (lines.at(-1) === '') lines.pop();

			if (change.removed) {
				const nextChange = changes[i + 1];
				if (nextChange && nextChange.added) {
					const nextLines = nextChange.value.split('\n');
					if (nextLines.at(-1) === '') nextLines.pop();

					diffBlocks.push({
						type: 'replacement',
						lineInOldFile: lineInOld,
						lineInNewFile: lineInNew,
						removedLines: lines,
						addedLines: nextLines,
					});

					lineInOld += lines.length;
					lineInNew += nextLines.length;
					i++; // Skip the next (added) change
				} else {
					diffBlocks.push({
						type: 'deletion',
						lineInOldFile: lineInOld,
						lineInNewFile: lineInNew,
						removedLines: lines,
						addedLines: [],
					});
					lineInOld += lines.length;
				}
			} else if (change.added) {
				diffBlocks.push({
					type: 'addition',
					lineInOldFile: lineInOld,
					lineInNewFile: lineInNew,
					removedLines: [],
					addedLines: lines,
				});
				lineInNew += lines.length;
			} else {
				lineInOld += lines.length;
				lineInNew += lines.length;
			}
		}

		console.log('[WriteToFile] Computed', diffBlocks.length, 'diff blocks');
		if (diffBlocks.length === 0) return [];

		// 3. v4: Validate change size (only for write_to_file with existing files)
		let totalChangedLines = 0;
		for (const block of diffBlocks) {
			totalChangedLines += Math.max(block.removedLines.length, block.addedLines.length);
		}
		const sizeError = diffSystem.validateChangeSize(originalContent, totalChangedLines);
		if (sizeError) {
			throw new Error(sizeError);
		}

		// 4. v4: Apply each block TOP-TO-BOTTOM through DiffSystem.
		//    Rendering is suspended during the loop and flushed once at the end
		//    so the user sees all diff zones appear simultaneously.
		let cumulativeOffset = 0;

		diffSystem.suspendRendering();
		diffSystem.beginBatch();
		try {
			for (const block of diffBlocks) {
				const adjustedLine = block.lineInOldFile + cumulativeOffset;
				let hunkId: string | undefined;

				if (block.type === 'replacement') {
					hunkId = await diffSystem.replaceLines(
						absolutePath,
						adjustedLine,
						block.removedLines,
						block.addedLines,
					);
					cumulativeOffset += block.addedLines.length - block.removedLines.length;
				} else if (block.type === 'deletion') {
					hunkId = await diffSystem.deleteLines(absolutePath, adjustedLine, block.removedLines.length);
					cumulativeOffset -= block.removedLines.length;
				} else if (block.type === 'addition') {
					hunkId = await diffSystem.addLines(absolutePath, adjustedLine - 1, block.addedLines);
					cumulativeOffset += block.addedLines.length;
				}

				block.hunkId = hunkId;

				console.log('[WriteToFile] Applied block via DiffSystem:', block.type,
					'origLine:', block.lineInOldFile, 'adjustedLine:', adjustedLine,
					'removed:', block.removedLines.length, 'added:', block.addedLines.length,
					'offset:', cumulativeOffset, 'hunkId:', hunkId?.slice(0, 8));
			}
		} finally {
			await diffSystem.endBatch();
			await diffSystem.resumeRendering();
		}

		return diffBlocks;
	}

	/**
	 * Compute diff blocks from original and new content (for delete_block/replace_text preview).
	 * Same logic as writeFileAndVisualizeDiff but only computes blocks, no file writes.
	 */
	private computeDiffBlocks(originalContent: string, newContent: string): WriteDiffBlock[] {
		const normalizedOriginal = originalContent.replace(/\r\n/g, '\n');
		const normalizedNew = newContent.replace(/\r\n/g, '\n');
		const changes = diff.diffLines(normalizedOriginal, normalizedNew);

		const diffBlocks: WriteDiffBlock[] = [];
		let lineInOld = 1;
		let lineInNew = 1;

		for (let i = 0; i < changes.length; i++) {
			const change = changes[i];
			const lines = change.value.split('\n');
			if (lines.at(-1) === '') lines.pop();

			if (change.removed) {
				const nextChange = changes[i + 1];
				if (nextChange && nextChange.added) {
					const nextLines = nextChange.value.split('\n');
					if (nextLines.at(-1) === '') nextLines.pop();
					diffBlocks.push({ type: 'replacement', lineInOldFile: lineInOld, lineInNewFile: lineInNew, removedLines: lines, addedLines: nextLines });
					lineInOld += lines.length;
					lineInNew += nextLines.length;
					i++;
				} else {
					diffBlocks.push({ type: 'deletion', lineInOldFile: lineInOld, lineInNewFile: lineInNew, removedLines: lines, addedLines: [] });
					lineInOld += lines.length;
				}
			} else if (change.added) {
				diffBlocks.push({ type: 'addition', lineInOldFile: lineInOld, lineInNewFile: lineInNew, removedLines: [], addedLines: lines });
				lineInNew += lines.length;
			} else {
				lineInOld += lines.length;
				lineInNew += lines.length;
			}
		}
		return diffBlocks;
	}

	/** Build a short diff preview string for a single block (for EditCard in chat) */
	private formatBlockPreview(block: WriteDiffBlock): string {
		const lines: string[] = [];
		for (const line of block.removedLines) {
			lines.push(`-${line.replace(/\r$/, '')}`);
		}
		for (const line of block.addedLines) {
			lines.push(`+${line.replace(/\r$/, '')}`);
		}
		return lines.join('\n');
	}

	/**
	 * Single chat card: join block previews with a separator; cap body size so the
	 * webview message stays reasonable (full detail remains in the editor inline diff).
	 */
	private static readonly CHAT_PREVIEW_MAX_BLOCKS = 15;

	private buildCombinedChatPreview(blocks: WriteDiffBlock[]): string {
		const max = WriteToFileToolHandler.CHAT_PREVIEW_MAX_BLOCKS;
		const head = blocks.slice(0, max);
		const parts = head.map((b) => {
			const lineHint = b.lineInNewFile > 0 ? `@@ line ${b.lineInNewFile} @@\n` : '';
			return lineHint + this.formatBlockPreview(b);
		});
		let out = parts.join('\n---\n');
		const omitted = blocks.length - head.length;
		if (omitted > 0) {
			out += `\n\n… +${omitted} more change region${omitted === 1 ? '' : 's'} (see inline diff in editor)`;
		}
		return out;
	}

	/**
	 * Shared validation and preparation logic used by both handlePartialBlock and execute methods.
	 * This validates file access permissions, checks if the file exists, and constructs the new content
	 * from either direct content or diff patches. It handles both creation of new files and modifications
	 * to existing ones.
	 *
	 * @param config The task configuration containing services and state
	 * @param block The tool use block containing the operation parameters
	 * @param relPath The relative path to the target file
	 * @param diff Optional diff content for replace operations
	 * @param content Optional direct content for write operations
	 * @param provider Optional provider string for telemetry (used when capturing diff edit failures)
	 * @returns Object containing validated path, file existence status, diff/content, and constructed new content,
	 *          or undefined if validation fails
	 */
	async validateAndPrepareFileOperation(config: TaskConfig, block: ToolUse, relPath: string, diff?: string, content?: string) {
		// Parse workspace hint and resolve path for multi-workspace support
		const pathResult = resolveWorkspacePath(config, relPath, "WriteToFileToolHandler.validateAndPrepareFileOperation")
		const { absolutePath, resolvedPath } =
			typeof pathResult === "string"
				? { absolutePath: pathResult, resolvedPath: relPath }
				: { absolutePath: pathResult.absolutePath, resolvedPath: pathResult.resolvedPath }

		// Determine workspace context for telemetry
		const fallbackAbsolutePath = path.resolve(config.cwd, relPath)
		const workspaceContext = {
			isMultiRootEnabled: config.isMultiRootEnabled || false,
			usedWorkspaceHint: typeof pathResult !== "string", // multi-root path result indicates hint usage
			resolvedToNonPrimary: !arePathsEqual(absolutePath, fallbackAbsolutePath),
			resolutionMethod: (typeof pathResult !== "string" ? "hint" : "primary_fallback") as "hint" | "primary_fallback",
		}

		// Check shuncodeignore access first
		const accessValidation = this.validator.checkShuncodeIgnorePath(resolvedPath)
		if (!accessValidation.ok) {
			// Show error and return early (full original behavior)
			await config.callbacks.say("shuncodeignore_error", resolvedPath)

			// Push tool result and save checkpoint using existing utilities
			const errorResponse = formatResponse.toolError(formatResponse.shuncodeIgnoreError(resolvedPath))
			ToolResultUtils.pushToolResult(
				errorResponse,
				block,
				config.taskState.userMessageContent,
				ToolDisplayUtils.getToolDescription,
				config.coordinator,
				config.taskState.toolUseIdMap,
			)
			if (!config.enableParallelToolCalling) {
				config.taskState.didAlreadyUseTool = true
			}

			return
		}

		// Check if file exists to determine the correct UI message
		let fileExists: boolean
		if (config.services.diffViewProvider.editType !== undefined) {
			fileExists = config.services.diffViewProvider.editType === "modify"
		} else {
			fileExists = await fileExistsAtPath(absolutePath)
			config.services.diffViewProvider.editType = fileExists ? "modify" : "create"
		}

		// Construct newContent from diff
		let newContent: string
		let matchIndices: number[] = []
		newContent = "" // default to original content if not editing

		if (diff) {
			// Handle replace_in_file with diff construction
			// Apply model-specific fixes (deepseek models tend to use unescaped html entities in diffs)
			diff = applyModelContentFixes(diff, config.api.getModel().id, resolvedPath)

			// open the editor if not done already.  This is to fix diff error when model provides correct search-replace text but Shuncode throws error
			// because file is not open.
			if (!config.services.diffViewProvider.isEditing) {
				await config.services.diffViewProvider.open(absolutePath, { displayPath: relPath })
			}

			try {
				const result = await constructNewFileContent(
					diff,
					config.services.diffViewProvider.originalContent || "",
					!block.partial, // Pass the partial flag correctly
				)
				newContent = result.newContent
				matchIndices = result.matchIndices
			} catch (error) {
				// Check if we've already pushed an error for this specific tool call (prevents duplicates during streaming)
				const callId = block.call_id || ""
				if (callId && config.taskState.errorPushedForCallIds.has(callId)) {
					return
				}

				// Full original behavior - comprehensive error handling even for partial blocks
				// Removes any existing diff_error messages to avoid duplicates.
				await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "diff_error")
				await config.callbacks.say("diff_error", relPath, undefined, undefined, true)

				// Extract provider information for telemetry
				const { providerId, modelId } = this.getModelInfo(config)

				// Extract error type from error message if possible
				const errorType =
					error instanceof Error && error.message.includes("does not match anything")
						? "search_not_found"
						: "other_diff_error"

				// Add telemetry for diff edit failure
				const isNativeToolCall = block.isNativeToolCall === true
				telemetryService.captureDiffEditFailure(config.ulid, modelId, providerId, errorType, isNativeToolCall)

				// Push tool result with detailed error using existing utilities
				const errorResponse = formatResponse.toolError(
					`${(error as Error)?.message}\n\n` +
					formatResponse.diffError(relPath, config.services.diffViewProvider.getOriginalContentForLLM()),
				)
				ToolResultUtils.pushToolResult(
					errorResponse,
					block,
					config.taskState.userMessageContent,
					ToolDisplayUtils.getToolDescription,
					config.coordinator,
					config.taskState.toolUseIdMap,
				)

				// Mark this call as having had its error pushed (prevents duplicates during streaming)
				if (callId) {
					config.taskState.errorPushedForCallIds.add(callId)
				}
				if (!config.enableParallelToolCalling) {
					config.taskState.didAlreadyUseTool = true
				}

				// Revert changes and reset diff view
				await config.services.diffViewProvider.revertChanges()
				await config.services.diffViewProvider.reset()

				return
			}
		} else if (content) {
			// Handle write_to_file with direct content
			newContent = content

			// pre-processing newContent for cases where weaker models might add artifacts like markdown codeblock markers (deepseek/llama) or extra escape characters (gemini)
			if (newContent.startsWith("```")) {
				// this handles cases where it includes language specifiers like ```python ```js
				newContent = newContent.split("\n").slice(1).join("\n").trim()
			}
			if (newContent.endsWith("```")) {
				newContent = newContent.split("\n").slice(0, -1).join("\n").trim()
			}

			// Apply model-specific fixes (llama, gemini, and other models may add escape characters)
			newContent = applyModelContentFixes(newContent, config.api.getModel().id, resolvedPath)
		} else {
			// can't happen, since we already checked for content/diff above. but need to do this for type error
			return
		}

		return { relPath, absolutePath, fileExists, diff, content, newContent, workspaceContext, matchIndices }
	}

	/**
	 * Execute delete_block: Find a block by query and delete it
	 * Uses indentation-based block detection for reliable deletion
	 */
	private async executeDeleteBlock(
		config: TaskConfig,
		absolutePath: string,
		originalContent: string,
		query: string,
		startLineHint?: string
	): Promise<{ newContent?: string; error?: string }> {
		const lines = originalContent.split('\n');
		const normalizedQuery = this.normalizeForSearch(query);

		// Find the line that matches the query
		let anchorLine = -1;
		const startHint = startLineHint ? parseInt(startLineHint, 10) - 1 : -1;

		for (let i = 0; i < lines.length; i++) {
			const normalizedLine = this.normalizeForSearch(lines[i]);
			if (normalizedLine.includes(normalizedQuery)) {
				if (startHint >= 0 && Math.abs(i - startHint) > 5) {
					continue; // Skip if too far from hint
				}
				anchorLine = i;
				break;
			}
		}

		if (anchorLine === -1) {
			return {
				error: `Text not found in file: "${query.substring(0, 50)}..."\n\nTry using a more specific or unique text fragment.`
			};
		}

		// Find block boundaries using indentation
		const { startLine, endLine } = this.findBlockByIndent(lines, anchorLine);

		// Get the lines to delete
		const deletedLines = lines.slice(startLine, endLine + 1);
		const newLines = [...lines.slice(0, startLine), ...lines.slice(endLine + 1)];
		const newContent = newLines.join('\n');

		// Use DiffSystem to show deletion with View Zone
		try {
			const diffSystem = getDiffSystem();
			await diffSystem.deleteLines(absolutePath, startLine + 1, deletedLines.length);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (errorMessage.includes('Syntax validation failed')) {
				return { error: `Syntax Error: Deleting this block would break the code.\n\n${errorMessage}` };
			}
			// Fallback: write directly
			await vscode.workspace.fs.writeFile(vscode.Uri.file(absolutePath), Buffer.from(newContent));
		}

		return { newContent };
	}

	/**
	 * Execute replace_text: Find text by query and replace it
	 * Supports whitespace normalization and line number removal from copy-paste
	 */
	private async executeReplaceText(
		config: TaskConfig,
		absolutePath: string,
		originalContent: string,
		query: string,
		replace: string,
		startLineHint?: string
	): Promise<{ newContent?: string; error?: string }> {
		const lines = originalContent.split('\n');

		// Remove line numbers from query if present (e.g. "45 | const x = 1")
		let cleanQuery = query.replace(/^\s*\d+\s*\|\s?/gm, '');
		let cleanReplace = replace.replace(/^\s*\d+\s*\|\s?/gm, '');

		// Normalize line endings
		const useCrLf = originalContent.includes('\r\n');
		cleanQuery = cleanQuery.replace(/\r?\n/g, useCrLf ? '\r\n' : '\n');
		cleanReplace = cleanReplace.replace(/\r?\n/g, useCrLf ? '\r\n' : '\n');

		// Find the query in content
		let matchIndex = originalContent.indexOf(cleanQuery);

		// If not found, try with whitespace normalization
		if (matchIndex === -1) {
			const normalizedQuery = this.normalizeForSearch(cleanQuery);
			for (let i = 0; i < lines.length; i++) {
				const normalizedLine = this.normalizeForSearch(lines[i]);
				if (normalizedLine.includes(normalizedQuery)) {
					// Found with normalization - use actual line content
					cleanQuery = lines[i];
					matchIndex = originalContent.indexOf(cleanQuery);
					break;
				}
			}
		}

		if (matchIndex === -1) {
			// Try to find similar lines for helpful error
			const queryFirstLine = cleanQuery.split('\n')[0].trim();
			const similarLines = lines
				.map((line, idx) => ({ line: line.trim(), idx: idx + 1 }))
				.filter(({ line }) => {
					const q = queryFirstLine.toLowerCase();
					const l = line.toLowerCase();
					return l.includes(q) || q.includes(l.substring(0, Math.min(20, l.length)));
				})
				.slice(0, 3);

			let errorMsg = `Text not found in file.\nSearched for: "${queryFirstLine.substring(0, 50)}..."\n\n`;
			if (similarLines.length > 0) {
				errorMsg += `Similar lines found:\n`;
				for (const sl of similarLines) {
					errorMsg += `  Line ${sl.idx}: "${sl.line.substring(0, 50)}..."\n`;
				}
			}
			errorMsg += `\nMake sure query is copied exactly from the file.`;
			return { error: errorMsg };
		}

		// Check for multiple matches
		const matchCount = originalContent.split(cleanQuery).length - 1;
		if (matchCount > 1 && !startLineHint) {
			return {
				error: `Found ${matchCount} matches for query. Add more context to make it unique, or specify startLine parameter.`
			};
		}

		// Calculate start line for DiffSystem
		const startLine = originalContent.substring(0, matchIndex).split('\n').length;
		const queryLines = cleanQuery.split('\n');
		const replaceLines = cleanReplace ? cleanReplace.split('\n') : [];

		// Remove trailing empty strings
		while (queryLines.length > 0 && queryLines[queryLines.length - 1] === '') {
			queryLines.pop();
		}
		while (replaceLines.length > 0 && replaceLines[replaceLines.length - 1] === '') {
			replaceLines.pop();
		}

		// Create new content
		const newContent = originalContent.substring(0, matchIndex) + cleanReplace + originalContent.substring(matchIndex + cleanQuery.length);

		// Use DiffSystem
		try {
			const diffSystem = getDiffSystem();

			// Strip trailing \r before passing to DiffSystem (it works with LF-normalized content)
			const cleanQueryLines = queryLines.map(l => l.replace(/\r$/, ''));
			const cleanReplaceLines = replaceLines.map(l => l.replace(/\r$/, ''));

			if (cleanReplaceLines.length === 0) {
				// Deletion
				await diffSystem.deleteLines(absolutePath, startLine, cleanQueryLines.length);
			} else {
				// Replacement
				await diffSystem.replaceLines(absolutePath, startLine, cleanQueryLines, cleanReplaceLines);
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (errorMessage.includes('Syntax validation failed')) {
				return { error: `Syntax Error: This change would break the code.\n\n${errorMessage}` };
			}
			// Fallback: write directly
			await vscode.workspace.fs.writeFile(vscode.Uri.file(absolutePath), Buffer.from(newContent));
		}

		return { newContent };
	}

	/**
	 * Normalize text for fuzzy searching (remove extra whitespace)
	 */
	private normalizeForSearch(text: string): string {
		return text.trim().toLowerCase().replace(/\s+/g, ' ');
	}

	/**
	 * Find block boundaries using indentation
	 * Returns inclusive start and end line indices
	 */
	private findBlockByIndent(lines: string[], anchorLine: number): { startLine: number; endLine: number } {
		const getIndent = (line: string): number => {
			const match = line.match(/^(\s*)/);
			return match ? match[1].length : 0;
		};

		const anchorIndent = getIndent(lines[anchorLine]);
		let startLine = anchorLine;
		let endLine = anchorLine;

		// Find end of block (lines with greater indent, or same indent if continuation)
		for (let i = anchorLine + 1; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();

			// Skip empty lines
			if (!trimmed) {
				continue;
			}

			const indent = getIndent(line);

			// If indent is less or equal to anchor, block ended
			if (indent <= anchorIndent) {
				// Check if it's a closing bracket/tag at same level
				if (indent === anchorIndent && (trimmed.startsWith('}') || trimmed.startsWith('</'))) {
					endLine = i;
				}
				break;
			}

			endLine = i;
		}

		return { startLine, endLine };
	}

	private getModelInfo(config: TaskConfig) {
		// Extract provider information for telemetry
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const providerId = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
		const modelId = config.api.getModel().id
		return { providerId, modelId }
	}
}
