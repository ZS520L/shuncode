import { readFile } from "node:fs/promises"
import * as vscode from "vscode"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { resolveWorkspacePath } from "@core/workspace"
import type { ShuncodeSayTool } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { BASH_WRAPPERS, DiffError, PATCH_MARKERS, type Patch, PatchActionType, type PatchChunk } from "@/shared/Patch"
import { preserveEscaping } from "@/shared/string"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { type FileOpsResult, FileProviderOperations } from "../utils/FileProviderOperations"
import { PatchParser } from "../utils/PatchParser"
import { PathResolver } from "../utils/PathResolver"
import { ToolResultUtils } from "../utils/ToolResultUtils"
import { getDiffSystem, DiffSystem } from "../../../diff-v2"

interface FileChange {
	type: PatchActionType
	oldContent?: string
	newContent?: string
	movePath?: string
	/** Starting line numbers (1-indexed) for each chunk in the patch */
	startLineNumbers?: number[]
	// Added: chunks for view zones
	chunks?: PatchChunk[]
}

interface Commit {
	changes: Record<string, FileChange>
}

export const PatchShuncodeSayMap = {
	[PatchActionType.ADD]: "newFileCreated",
	[PatchActionType.DELETE]: "fileDeleted",
	[PatchActionType.UPDATE]: "editedExistingFile",
}

export class ApplyPatchHandler implements IFullyManagedTool {
	readonly name = ShuncodeDefaultTool.APPLY_PATCH
	private config?: TaskConfig
	private pathResolver?: PathResolver
	private providerOps?: FileProviderOperations
	private diffSystem: DiffSystem | null = null

	constructor(private validator: ToolValidator) {
		// DiffSystem V2 - get from config.services or singleton
		try {
			this.diffSystem = getDiffSystem();
		} catch {
			this.diffSystem = null;
		}
	}

	private initializeHelpers(config: TaskConfig): void {
		if (!this.pathResolver || this.config !== config) {
			this.pathResolver = new PathResolver(config, this.validator)
		}
		if (!this.providerOps) {
			this.providerOps = new FileProviderOperations(config.services.diffViewProvider)
		}
		// Use DiffSystem from config if available
		if (config.services.diffSystem && !this.diffSystem) {
			this.diffSystem = config.services.diffSystem;
		}
	}

	getDescription(_block: ToolUse): string {
		return `[${this.name} for patch application]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// [SHUNCODE-SHUNCODE] Streaming preview logic simplified for Native View Zones.
		// We could implement "live typing" effect later, but for now we just wait for the full block
		// to avoid ViewZone flickering.
		return;
	}

	// [SHUNCODE-SHUNCODE] Removed previewPatchStream as we apply changes directly with ViewZones

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		// [SHUNCODE-SHUNCODE] We ignore the old provider reset logic as we use NativeDiffManager
		const rawInput = block.params.input

		if (!rawInput) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "input")
		}

		config.taskState.consecutiveMistakeCount = 0
		this.initializeHelpers(config)

		try {
			const lines = this.preprocessLines(rawInput)

			// Identify files needed
			const filesToLoad = this.extractFilesForOperations(rawInput, [PATCH_MARKERS.UPDATE, PATCH_MARKERS.DELETE])
			const currentFiles = await this.loadFiles(config, filesToLoad)

			// Parse patch
			const parser = new PatchParser(lines, currentFiles)
			const { patch, fuzz } = parser.parse()

			// Convert to commit
			const commit = await this.patchToCommit(patch, currentFiles)

			this.config = config

			// Run PreToolUse hook before applying changes
			try {
				const { ToolHookUtils } = await import("../utils/ToolHookUtils")
				await ToolHookUtils.runPreToolUseIfEnabled(config, block)
			} catch (error) {
				const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
				if (error instanceof PreToolUseHookCancellationError) {
					return "The user denied this patch operation."
				}
				throw error
			}

			// Generate summary
			const changedFiles = Object.keys(commit.changes)
			const messages = await this.generateChangeSummary(commit.changes)

			const finalResponses = []
			const applyResults: Record<string, FileOpsResult> = {}

			// Create a mapping from message path to original commit change key
			const pathToChangeKey = new Map<string, string>()
			for (const [originalPath, change] of Object.entries(commit.changes)) {
				if (change.type === PatchActionType.UPDATE && change.movePath) {
					pathToChangeKey.set(change.movePath, originalPath)
				} else {
					pathToChangeKey.set(originalPath, originalPath)
				}
			}

			// For each file: prepare, get approval, then save
			for (const message of messages) {
				const messagePath = message.path
				if (!messagePath) {
					continue
				}

				const originalPath = pathToChangeKey.get(messagePath)
				if (!originalPath) {
					continue
				}

				const change = commit.changes[originalPath]
				if (!change) {
					continue
				}

				const operationPath = change.type === PatchActionType.UPDATE && change.movePath ? change.movePath : originalPath

				// [SHUNCODE] For DELETE operations, check deleteFiles auto-approval setting
				if (change.type === PatchActionType.DELETE) {
					const autoApproveResult = config.autoApprover
						? config.autoApprover.shouldAutoApproveTool(ShuncodeDefaultTool.FILE_DELETE)
						: false
					const didAutoApprove = autoApproveResult === true || (Array.isArray(autoApproveResult) && autoApproveResult[0])

					if (!didAutoApprove) {
						const deleteMessage = JSON.stringify({
							tool: "fileDeleted",
							path: getReadablePath(config.cwd, operationPath),
							content: `Delete file: ${getReadablePath(config.cwd, operationPath)}`,
						} satisfies ShuncodeSayTool)

						showNotificationForApproval(
							`Shuncode wants to delete: ${getReadablePath(config.cwd, operationPath)}`,
							config.autoApprovalSettings.enableNotifications,
						)

						const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("tool", deleteMessage, config)
						if (!didApprove) {
							// Skip this file deletion, continue with other changes
							continue
						}
					}
				}

				// [SHUNCODE-SHUNCODE] Apply changes + show inline diffs (Cursor-style)
				await this.prepareFileChangeWithNativeDiff(change, operationPath)
				await this.handleApproval(config, block, message, rawInput)
				// Changes stay pending — user accepts/rejects via inline buttons

				// Track result
				applyResults[originalPath] = {
					finalContent: change.newContent,
					autoFormattingEdits: "" // simplified for now
				};

				// Handle file moves
				if (change.type === PatchActionType.UPDATE && change.movePath) {
					await this.providerOps!.deleteFile(originalPath)
					applyResults[originalPath] = { deleted: true }
				}

				finalResponses.push(messagePath)
			}

			// Track all changed files once after all operations are complete
			for (const changedFilePath of changedFiles) {
				const change = commit.changes[changedFilePath]
				// For move operations, track the new path instead
				const pathToTrack = change.type === PatchActionType.UPDATE && change.movePath ? change.movePath : changedFilePath
				config.services.fileContextTracker.markFileAsEditedByShuncode(pathToTrack)
				await config.services.fileContextTracker.trackFileContext(pathToTrack, "shuncode_edited")
			}

			this.config = undefined

			// Build response
			const responseLines = ["Successfully applied patch to the following files:"]

			for (const [path, result] of Object.entries(applyResults)) {
				if (result.deleted) {
					config.taskState.didEditFile = true
					responseLines.push(`\n${path}: [deleted]`)
				} else {
					if (result.finalContent) {
						responseLines.push(`\n<final_file_content path="${path}">`)
						responseLines.push(result.finalContent)
						responseLines.push(`</final_file_content>`)
					}
				}
			}

			if (fuzz > 0) {
				responseLines.push(`\nNote: Patch applied with fuzz factor ${fuzz}`)
			}

			return responseLines.join("\n")
		} catch (error) {
			// [SHUNCODE-SHUNCODE] Global revert if something crashes
			// TODO: Better revert logic
			throw error
		} finally {
			// Cleanup
		}
	}

	// [SHUNCODE-SHUNCODE] New methods for Native Diff System

	/**
	 * v4: Applies changes through DiffSystem (single path of writing).
	 *
	 * For UPDATE operations: each chunk goes through DiffSystem.replaceLines/deleteLines/addLines
	 * which handles pre-save, snapshot, overlap detection, and atomic writes via HunkApplier.
	 *
	 * For ADD/DELETE file operations: direct file system operations (not chunk-level diffs).
	 */
	private async prepareFileChangeWithNativeDiff(change: FileChange, path: string): Promise<void> {
		const uri = vscode.Uri.file(path);

		switch (change.type) {
			case PatchActionType.DELETE:
				await vscode.workspace.fs.delete(uri);
				return;
			case PatchActionType.ADD:
				if (!change.newContent) throw new DiffError(`Cannot create ${path} with no content`);
				await vscode.workspace.fs.writeFile(uri, Buffer.from(change.newContent));
				return;
			case PatchActionType.UPDATE:
				if (!change.newContent) throw new DiffError(`UPDATE change for ${path} has no new content`);
				if (change.movePath) {
					// Move = create new file + delete old. New file gets full content.
					await vscode.workspace.fs.writeFile(vscode.Uri.file(change.movePath), Buffer.from(change.newContent));
					await vscode.workspace.fs.delete(uri);
					return;
				}
				break;
		}

		// v5: Validate syntax before applying (Tree-sitter)
		if (change.type === PatchActionType.UPDATE && change.oldContent && change.newContent && this.diffSystem) {
			const syntaxError = await this.diffSystem.validateSyntax(path, change.oldContent, change.newContent);
			if (syntaxError) {
				throw new DiffError(syntaxError);
			}
		}

		// v4: Apply each chunk through DiffSystem (no direct file write)
		if (change.type === PatchActionType.UPDATE && change.chunks && change.chunks.length > 0 && this.diffSystem) {
			const targetPath = change.movePath || path;
			let cumulativeOffset = 0;

			this.diffSystem.suspendRendering();
			this.diffSystem.beginBatch();
			try {
				for (const chunk of change.chunks) {
					if (chunk.delLines.length === 0 && chunk.insLines.length === 0) continue;

					// origIndex is 0-indexed, DiffSystem expects 1-indexed
					const startLine = chunk.origIndex + 1 + cumulativeOffset;

					if (chunk.delLines.length > 0 && chunk.insLines.length > 0) {
						await this.diffSystem.replaceLines(
							targetPath,
							startLine,
							chunk.delLines,
							chunk.insLines,
						);
					} else if (chunk.delLines.length > 0) {
						await this.diffSystem.deleteLines(targetPath, startLine, chunk.delLines.length);
					} else if (chunk.insLines.length > 0) {
						await this.diffSystem.addLines(targetPath, startLine - 1, chunk.insLines);
					}

					cumulativeOffset += chunk.insLines.length - chunk.delLines.length;
				}
			} finally {
				await this.diffSystem.endBatch();
				await this.diffSystem.resumeRendering();
			}
		} else if (change.type === PatchActionType.UPDATE && change.newContent) {
			// Fallback: DiffSystem unavailable or no chunks — write directly
			await vscode.workspace.fs.writeFile(uri, Buffer.from(change.newContent));
		}
	}

	// revertFileChange removed — DiffSystem v3 handles revert via rejectAllForFile/rejectChange

	private preprocessLines(text: string): string[] {
		let lines = text.split("\n").map((line) => line.replace(/\r$/, ""))
		lines = this.stripBashWrapper(lines)

		const hasBegin = lines.length > 0 && lines[0].startsWith(PATCH_MARKERS.BEGIN)
		const hasEnd = lines.length > 0 && lines[lines.length - 1] === PATCH_MARKERS.END

		if (!hasBegin && !hasEnd) {
			return [PATCH_MARKERS.BEGIN, ...lines, PATCH_MARKERS.END]
		}
		if (hasBegin && hasEnd) {
			return lines
		}
		// Missing one of the sentinels: BEGIN or END PATCH
		throw new DiffError("Invalid patch text - incomplete sentinels. Try breaking it into smaller patches.")
	}

	private stripBashWrapper(lines: string[]): string[] {
		const result: string[] = []
		let insidePatch = false
		let foundBegin = false
		let foundContent = false

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			if (!insidePatch && BASH_WRAPPERS.some((wrapper) => line.startsWith(wrapper))) {
				continue
			}

			if (line.startsWith(PATCH_MARKERS.BEGIN)) {
				insidePatch = true
				foundBegin = true
				result.push(line)
				continue
			}

			if (line === PATCH_MARKERS.END) {
				insidePatch = false
				result.push(line)
				continue
			}

			const isPatchContent = this.isPatchLine(line)
			if (isPatchContent && i !== lines.length - 1) {
				foundContent = true
			}

			if (insidePatch || (!foundBegin && isPatchContent) || (line === "" && foundContent)) {
				result.push(line)
			}
		}

		while (result.length > 0 && result[result.length - 1] === "") {
			result.pop()
		}

		return !foundBegin && !foundContent ? lines : result
	}

	private isPatchLine(line: string): boolean {
		return (
			line.startsWith(PATCH_MARKERS.ADD) ||
			line.startsWith(PATCH_MARKERS.UPDATE) ||
			line.startsWith(PATCH_MARKERS.DELETE) ||
			line.startsWith(PATCH_MARKERS.MOVE) ||
			line.startsWith(PATCH_MARKERS.SECTION) ||
			line.startsWith("+") ||
			line.startsWith("-") ||
			line.startsWith(" ") ||
			line === "***"
		)
	}

	private extractFilesForOperations(text: string, markers: readonly string[]): string[] {
		const lines = this.stripBashWrapper(text.split("\n"))
		const files: string[] = []

		for (const line of lines) {
			for (const marker of markers) {
				if (line.startsWith(marker)) {
					const file = line.substring(marker.length).trim()
					if (text.trim().endsWith(file)) {
						// Ignore if the file path is at the very end of the text (likely incomplete)
						continue
					}
					files.push(file)
					break
				}
			}
		}

		return files
	}

	private extractAllFiles(text: string): string[] {
		return this.extractFilesForOperations(text, [PATCH_MARKERS.ADD, PATCH_MARKERS.UPDATE, PATCH_MARKERS.DELETE])
	}

	private async loadFiles(config: TaskConfig, filePaths: string[]): Promise<Record<string, string>> {
		const files: Record<string, string> = {}

		for (const filePath of filePaths) {
			const pathResult = resolveWorkspacePath(config, filePath, "ApplyPatchHandler.loadFiles")
			const absolutePath = typeof pathResult === "string" ? pathResult : pathResult.absolutePath
			const resolvedPath = typeof pathResult === "string" ? filePath : pathResult.resolvedPath

			const accessValidation = this.validator.checkShuncodeIgnorePath(resolvedPath)
			if (!accessValidation.ok) {
				await config.callbacks.say("shuncodeignore_error", resolvedPath)
				throw new DiffError(`Access denied: ${resolvedPath}`)
			}

			if (!(await fileExistsAtPath(absolutePath))) {
				throw new DiffError(`File not found: ${filePath}`)
			}
			const fileContent = await readFile(absolutePath, "utf8")
			const normalizedContent = fileContent.replace(/\r\n/g, "\n")
			files[filePath] = normalizedContent
		}

		return files
	}

	private async patchToCommit(patch: Patch, originalFiles: Record<string, string>): Promise<Commit> {
		const changes: Record<string, FileChange> = {}

		for (const [path, action] of Object.entries(patch.actions)) {
			const targetResolution = await this.pathResolver!.resolveAndValidate(path, "ApplyPatchHandler.previewPatch")
			if (!targetResolution) {
				continue
			}
			const absPath = targetResolution.absolutePath

			// Resolve movePath to absolute as well
			let resolvedMovePath: string | undefined
			if (action.movePath) {
				const moveResolution = await this.pathResolver!.resolveAndValidate(action.movePath, "ApplyPatchHandler.previewPatch.move")
				resolvedMovePath = moveResolution?.absolutePath || action.movePath
			}

			switch (action.type) {
				case PatchActionType.DELETE:
					changes[absPath] = { type: PatchActionType.DELETE, oldContent: originalFiles[path] }
					break
				case PatchActionType.ADD:
					if (!action.newFile) {
						throw new DiffError("ADD action without file content")
					}
					changes[absPath] = { type: PatchActionType.ADD, newContent: action.newFile }
					break
				case PatchActionType.UPDATE:
					// Extract starting line numbers from chunks (convert from 0-indexed to 1-indexed)
					const startLineNumbers = action.chunks.map((chunk) => chunk.origIndex + 1)
					changes[absPath] = {
						type: PatchActionType.UPDATE,
						oldContent: originalFiles[path],
						newContent: this.applyChunks(originalFiles[path]!, action.chunks, path),
						movePath: resolvedMovePath,
						startLineNumbers,
						// Pass chunks for Native Diff logic
						chunks: action.chunks
					}
					break
			}
		}

		return { changes }
	}

	/**
	 * Applies patch chunks to the given content.
	 * @param content The original file content.
	 * @param chunks The patch chunks to apply.
	 * @param path The file path (for error messages).
	 * NOTE: Remove tryPreserveEscaping and related logic once we can confirm this is not an issue across providers.
	 * @param tryPreserveEscaping Whether to attempt preserving escaping style in cases where the provider has escaped the shared content during the API call.
	 * @returns The modified content after applying the chunks.
	 */
	private applyChunks(content: string, chunks: PatchChunk[], path: string, tryPreserveEscaping = false): string {
		if (chunks.length === 0) {
			return content
		}

		const lines = content.split("\n")
		const result: string[] = []
		let currentIndex = 0

		for (const chunk of chunks) {
			if (chunk.origIndex > lines.length) {
				throw new DiffError(`${path}: chunk.origIndex ${chunk.origIndex} > lines.length ${lines.length}`)
			}
			if (currentIndex > chunk.origIndex) {
				throw new DiffError(`${path}: currentIndex ${currentIndex} > chunk.origIndex ${chunk.origIndex}`)
			}

			// Copy lines before the chunk
			result.push(...lines.slice(currentIndex, chunk.origIndex))

			// Get the original lines being replaced to detect escaping style
			const originalLines = lines.slice(chunk.origIndex, chunk.origIndex + chunk.delLines.length)
			const originalText = originalLines.join("\n")

			// Add inserted lines, preserving escaping style from original
			const insertedLines = chunk.insLines.map((line) => {
				// Only preserve escaping if we have original text to compare against
				if (tryPreserveEscaping && originalText) {
					return preserveEscaping(originalText, line)
				}
				return line
			})
			result.push(...insertedLines)

			// Skip deleted lines
			currentIndex = chunk.origIndex + chunk.delLines.length
		}

		// Copy remaining lines
		result.push(...lines.slice(currentIndex))

		return result.join("\n")
	}

	private async generateChangeSummary(changes: Record<string, FileChange>): Promise<ShuncodeSayTool[]> {
		const summaries = await Promise.all(
			Object.entries(changes).map(async ([file, change]) => {
				const operationIsLocatedInWorkspace = await isLocatedInWorkspace(file)
				switch (change.type) {
					case PatchActionType.ADD:
						return {
							tool: "newFileCreated",
							path: file,
							content: change.newContent,
							operationIsLocatedInWorkspace,
						} as ShuncodeSayTool
					case PatchActionType.UPDATE:
						return {
							tool: change.movePath ? "newFileCreated" : "editedExistingFile",
							path: change.movePath || file,
							content: change.movePath ? change.oldContent : change.newContent,
							operationIsLocatedInWorkspace,
							startLineNumbers: change.startLineNumbers,
						} as ShuncodeSayTool
					case PatchActionType.DELETE:
						return {
							tool: "fileDeleted",
							path: file,
							content: change.newContent,
							operationIsLocatedInWorkspace,
						} as ShuncodeSayTool
				}
			}),
		)

		return summaries
	}

	private async handleApproval(config: TaskConfig, block: ToolUse, message: ShuncodeSayTool, rawInput: string): Promise<boolean> {
		const patch = { ...message, content: rawInput }
		const completeMessage = JSON.stringify(patch)

		// Extract provider using the proven pattern from ReportBugHandler
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const providerId = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
		const modelId = config.api.getModel().id

		// [SHUNCODE-SHUNCODE] Cursor-style: always auto-approve patches (no ask)
		// Post-factum control via diff Accept/Reject in editor
		await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
		telemetryService.captureToolUsage(
			config.ulid,
			this.name,
			modelId,
			providerId,
			true,
			true,
			undefined,
			block.isNativeToolCall,
		)
		return true
	}
}
