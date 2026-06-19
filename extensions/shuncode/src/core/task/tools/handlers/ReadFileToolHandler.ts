import path from "node:path"
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

		// Try reading from editor buffer first (includes unsaved changes).
		// textDocuments only contains text files — binary (PDF, DOCX, images) won't be here.
		const openDoc = vscode.workspace.textDocuments.find(
			(d) => d.uri.fsPath.toLowerCase() === absolutePath.toLowerCase(),
		)
		if (openDoc) {
			await config.services.fileContextTracker.trackFileContext(relPath!, "read_tool")
			const text = openDoc.getText()
			const lineCount = text.split("\n").length
			// Send final UI message with line range
			await this.sendFinalMessage(config, readablePath, absolutePath, isInWorkspace, `1-${lineCount}`)
			return addLineNumbers(text)
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
		const lineRange = fileContent.text ? `1-${fileContent.text.split("\n").length}` : undefined
		await this.sendFinalMessage(config, readablePath, absolutePath, isInWorkspace, lineRange)

		return addLineNumbers(fileContent.text)
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
 * Adds right-aligned line numbers to text content.
 * Format: "     1|line content" (6-char padded number + pipe + content)
 * Skips numbering for non-text content (images, binary).
 */
function addLineNumbers(text: string): string {
	if (!text || text.length === 0) {
		return text
	}
	const lines = text.split("\n")
	const padding = Math.max(6, String(lines.length).length)
	return lines.map((line, i) => `${String(i + 1).padStart(padding)}|${line}`).join("\n")
}
