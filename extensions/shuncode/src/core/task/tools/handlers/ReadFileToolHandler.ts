import * as fs from "fs/promises"
import path from "node:path"
import { truncateToolOutput } from "../utils/ToolConstants"
import * as vscode from "vscode"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { resolveWorkspacePath } from "@core/workspace"
import { extractFileContent } from "@integrations/misc/extract-file-content"
import { arePathsEqual, getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { ShuncodeSayTool } from "@/shared/ExtensionMessage"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class ReadFileToolHandler implements IFullyManagedTool {
	readonly name = ShuncodeDefaultTool.FILE_READ
	readonly isConcurrencySafe = true

	/**
	 * Tracks recent file reads within a task turn: path → { range, timestamp }
	 * Used to detect duplicate reads and return condensed output.
	 */
	private static recentReads = new Map<string, { range: string; ts: number }>()

	/** Clear recent reads cache (call at turn boundaries) */
	static clearRecentReads(): void {
		ReadFileToolHandler.recentReads.clear()
	}

	constructor(private validator: ToolValidator) { }

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path

		const config = uiHelpers.getConfig()

		// Create and show partial UI message
		const sharedMessageProps = {
			tool: "readFile",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath)),
			content: undefined,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		}

		const partialMessage = JSON.stringify(sharedMessageProps)

		// [SHUNCODE-SHUNCODE] Cursor-style: always auto-execute, show as info (no ask)
		await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const relPath: string | undefined = block.params.path
		const startLineRaw: string | undefined = block.params.start_line
		const endLineRaw: string | undefined = block.params.end_line
		const hashlineMode: boolean = block.params.hashline === "true"

		// Extract provider information for telemetry
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		// Validate required parameters
		const pathValidation = this.validator.assertRequiredParams(block, "path")
		if (!pathValidation.ok) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "path")
		}

		// Check shuncodeignore access
		const accessValidation = this.validator.checkShuncodeIgnorePath(relPath!)
		if (!accessValidation.ok) {
			await config.callbacks.say("shuncodeignore_error", relPath)
			return formatResponse.toolError(formatResponse.shuncodeIgnoreError(relPath!))
		}

		config.taskState.consecutiveMistakeCount = 0

		// Resolve the absolute path based on multi-workspace configuration
		const pathResult = resolveWorkspacePath(config, relPath!, "ReadFileToolHandler.execute")
		const { absolutePath, displayPath } =
			typeof pathResult === "string" ? { absolutePath: pathResult, displayPath: relPath! } : pathResult

		// Determine workspace context for telemetry
		const fallbackAbsolutePath = path.resolve(config.cwd, relPath ?? "")
		const workspaceContext = {
			isMultiRootEnabled: config.isMultiRootEnabled || false,
			usedWorkspaceHint: typeof pathResult !== "string", // multi-root path result indicates hint usage
			resolvedToNonPrimary: !arePathsEqual(absolutePath, fallbackAbsolutePath),
			resolutionMethod: (typeof pathResult !== "string" ? "hint" : "primary_fallback") as "hint" | "primary_fallback",
		}

		// Handle approval flow
		const readablePath = getReadablePath(config.cwd, displayPath)
		const isInWorkspace = await isLocatedInWorkspace(relPath!)

		const sharedMessageProps = {
			tool: "readFile",
			path: readablePath,
			content: absolutePath,
			operationIsLocatedInWorkspace: isInWorkspace,
		} satisfies ShuncodeSayTool

		// [SHUNCODE-SHUNCODE] Cursor-style: always auto-execute (no ask)
		// Send as partial — will be replaced with final message including lineRange after read
		await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await config.callbacks.say("tool", JSON.stringify(sharedMessageProps), undefined, undefined, true)

		telemetryService.captureToolUsage(
			config.ulid,
			block.name,
			config.api.getModel().id,
			provider,
			true,
			true,
			workspaceContext,
			block.isNativeToolCall,
		)

		// Run PreToolUse hook after approval but before execution
		try {
			const { ToolHookUtils } = await import("../utils/ToolHookUtils")
			await ToolHookUtils.runPreToolUseIfEnabled(config, block)
		} catch (error) {
			const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
			if (error instanceof PreToolUseHookCancellationError) {
				return formatResponse.toolDenied()
			}
			throw error
		}

		// Guard: reject directory paths early
		try {
			const stat = await fs.stat(absolutePath)
			if (stat.isDirectory()) {
				config.taskState.consecutiveMistakeCount++
				return formatResponse.toolError(
					`The path "${displayPath}" is a directory, not a file. Use list_files to explore directory contents, or provide a specific file path.`,
				)
			}
		} catch {
			// stat failed — let downstream handle missing file errors
		}

		// Try reading from editor buffer first (includes unsaved changes).
		// textDocuments only contains text files — binary (PDF, DOCX, images) won't be here.
		const openDoc = vscode.workspace.textDocuments.find(
			(d) => d.uri.fsPath.toLowerCase() === absolutePath.toLowerCase(),
		)
		if (openDoc) {
			await config.services.fileContextTracker.trackFileContext(relPath!, "read_tool")
			const text = openDoc.getText()
			const totalLineCount = text.split("\n").length

			// Apply line range if specified
			const { slicedText, actualStart, actualEnd } = applyLineRange(text, startLineRaw, endLineRaw)
			const displayRange = `${actualStart}-${actualEnd}`

			// Send final UI message with line range
			await this.sendFinalMessage(config, readablePath, absolutePath, isInWorkspace, displayRange)

			// Duplicate read detection — return condensed reference if same file+range was read recently
			const readKey = `${absolutePath}:${actualStart}-${actualEnd}`
			const recentRead = ReadFileToolHandler.recentReads.get(readKey)
			if (recentRead && (Date.now() - recentRead.ts) < 120_000) {
				// Same file+range read within 2 minutes — return condensed reference
				return `<file path="${relPath}" lines="${totalLineCount}" showing="${actualStart}-${actualEnd}" status="already_read">
[This file was already read in this session. Content unchanged. Use the previously returned content.]
</file>`
			}
			ReadFileToolHandler.recentReads.set(readKey, { range: displayRange, ts: Date.now() })

			// Hashline mode: annotate with content hashes instead of plain line numbers
			if (hashlineMode) {
				const { hashlineRead } = await import("@/services/hashline")
				const { annotated } = hashlineRead(slicedText)
				const result = formatStructuredFileOutput(relPath!, totalLineCount, actualStart, actualEnd, annotated, "hashline")
				return truncateToolOutput(result)
			}

			const numberedContent = addLineNumbers(slicedText, actualStart)
			const result = formatStructuredFileOutput(relPath!, totalLineCount, actualStart, actualEnd, numberedContent)
			return truncateToolOutput(result)
		}

		// Fall back to full disk pipeline (binary formats, encoding detection, etc.)
		const supportsImages = config.api.getModel().info.supportsImages ?? false
		const fileContent = await extractFileContent(absolutePath, supportsImages)

		// Track file read operation
		await config.services.fileContextTracker.trackFileContext(relPath!, "read_tool")

		// Handle image blocks separately - they need to be pushed to userMessageContent
		if (fileContent.imageBlock) {
			config.taskState.userMessageContent.push(fileContent.imageBlock)
		}

		// Send final UI message with line range
		if (fileContent.text) {
			const totalLineCount = fileContent.text.split("\n").length
			const { slicedText, actualStart, actualEnd } = applyLineRange(fileContent.text, startLineRaw, endLineRaw)
			const displayRange = `${actualStart}-${actualEnd}`
			await this.sendFinalMessage(config, readablePath, absolutePath, isInWorkspace, displayRange)

			// Duplicate read detection
			const readKey = `${absolutePath}:${actualStart}-${actualEnd}`
			const recentRead = ReadFileToolHandler.recentReads.get(readKey)
			if (recentRead && (Date.now() - recentRead.ts) < 120_000) {
				return `<file path="${relPath}" lines="${totalLineCount}" showing="${actualStart}-${actualEnd}" status="already_read">
[This file was already read in this session. Content unchanged. Use the previously returned content.]
</file>`
			}
			ReadFileToolHandler.recentReads.set(readKey, { range: displayRange, ts: Date.now() })

			// Hashline mode
			if (hashlineMode) {
				const { hashlineRead } = await import("@/services/hashline")
				const { annotated } = hashlineRead(slicedText)
				const result = formatStructuredFileOutput(relPath!, totalLineCount, actualStart, actualEnd, annotated, "hashline")
				return truncateToolOutput(result)
			}

			const numberedContent = addLineNumbers(slicedText, actualStart)
			const result = formatStructuredFileOutput(relPath!, totalLineCount, actualStart, actualEnd, numberedContent)
			return truncateToolOutput(result)
		}

		await this.sendFinalMessage(config, readablePath, absolutePath, isInWorkspace, undefined)
		return truncateToolOutput(formatStructuredFileOutput(relPath!, 0, 1, 0, addLineNumbers(fileContent.text)))
	}

	/**
	 * Send the final non-partial UI message with line range info.
	 */
	private async sendFinalMessage(config: TaskConfig, readablePath: string, absolutePath: string, isInWorkspace: boolean, lineRange?: string): Promise<void> {
		const finalProps: ShuncodeSayTool = {
			tool: "readFile",
			path: readablePath,
			content: absolutePath,
			lineRange,
			operationIsLocatedInWorkspace: isInWorkspace,
		}
		await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")
		await config.callbacks.say("tool", JSON.stringify(finalProps), undefined, undefined, false)
	}
}

/**
 * Formats file content into a structured XML-like output that is easy for LLMs to parse
 * and efficient for the FileReadOptimizer to deduplicate.
 */
function formatStructuredFileOutput(
	relPath: string,
	totalLines: number,
	startLine: number,
	endLine: number,
	content: string,
	mode?: "hashline",
): string {
	const modeAttr = mode ? ` mode="${mode}"` : ""
	const continueHint = endLine < totalLines ? `\n[Use start_line=${endLine + 1} to read the next section.]` : ""
	return `<file path="${relPath}" lines="${totalLines}" showing="${startLine}-${endLine}"${modeAttr}>\n${content}\n</file>${continueHint}`
}

/**
 * Adds right-aligned line numbers to text content.
 * Format: "     1|line content" (6-char padded number + pipe + content)
 * Skips numbering for non-text content (images, binary).
 * @param startLine - 1-indexed starting line number (default: 1)
 */
function addLineNumbers(text: string, startLine: number = 1): string {
	if (!text || text.length === 0) {
		return text
	}
	const lines = text.split("\n")
	const maxLineNum = startLine + lines.length - 1
	const padding = Math.max(6, String(maxLineNum).length)
	return lines.map((line, i) => `${String(startLine + i).padStart(padding)}|${line}`).join("\n")
}

/**
 * Applies optional line range slicing to text content.
 * Both start_line and end_line are 1-indexed, inclusive.
 * Returns the sliced text and actual bounds used.
 */
function applyLineRange(
	text: string,
	startLineRaw: string | undefined,
	endLineRaw: string | undefined,
): { slicedText: string; actualStart: number; actualEnd: number } {
	const lines = text.split("\n")
	const totalLines = lines.length

	let start = 1
	let end = totalLines

	if (startLineRaw) {
		const parsed = parseInt(startLineRaw, 10)
		if (!isNaN(parsed) && parsed > 0) {
			start = Math.min(parsed, totalLines)
		}
	}

	if (endLineRaw) {
		const parsed = parseInt(endLineRaw, 10)
		if (!isNaN(parsed) && parsed > 0) {
			end = Math.min(parsed, totalLines)
		}
	}

	// Ensure start <= end
	if (start > end) {
		[start, end] = [end, start]
	}

	// Slice: convert 1-indexed inclusive to 0-indexed slice
	const slicedLines = lines.slice(start - 1, end)
	return {
		slicedText: slicedLines.join("\n"),
		actualStart: start,
		actualEnd: end,
	}
}
