import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { resolveWorkspacePath } from "@core/workspace"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { ShuncodeSayTool } from "@/shared/ExtensionMessage"
import { ShuncodeDefaultTool } from "@/shared/tools"
import { applyHashlineEdits, HashlineEdit } from "@/services/hashline"
import { getDiffSystem } from "@/core/diff-v2"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class HashlineEditToolHandler implements IFullyManagedTool {
	readonly name = ShuncodeDefaultTool.HASHLINE_EDIT

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path
		const config = uiHelpers.getConfig()

		const sharedMessageProps = {
			tool: "hashlineEdit",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath)),
			content: "",
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		}

		const partialMessage = JSON.stringify(sharedMessageProps)
		await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const relPath: string | undefined = block.params.path
		const editsRaw: string | undefined = block.params.edits

		// Extract provider info for telemetry
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		// Validate required parameters
		if (!relPath) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "path")
		}

		if (!editsRaw) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "edits")
		}

		// Parse edits JSON
		let edits: HashlineEdit[]
		try {
			edits = JSON.parse(editsRaw)
			if (!Array.isArray(edits)) {
				throw new Error("edits must be a JSON array")
			}
		} catch (parseError) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(
				`Invalid edits JSON: ${(parseError as Error).message}\n` +
				`Expected a JSON array like: [{"operation":"replace","anchor":"5:VR","content":"new content"}]`,
			)
		}

		// Validate each edit has required fields
		for (const edit of edits) {
			if (!edit.operation || !edit.anchor) {
				config.taskState.consecutiveMistakeCount++
				return formatResponse.toolError(
					`Each edit must have "operation" and "anchor" fields. Got: ${JSON.stringify(edit)}`,
				)
			}
			if (!["replace", "insert_after", "insert_before", "delete"].includes(edit.operation)) {
				config.taskState.consecutiveMistakeCount++
				return formatResponse.toolError(
					`Invalid operation "${edit.operation}". Must be one of: replace, insert_after, insert_before, delete.`,
				)
			}
		}

		config.taskState.consecutiveMistakeCount = 0

		// Resolve file path
		const pathResult = resolveWorkspacePath(config, relPath, "HashlineEditToolHandler.execute")
		const { absolutePath, displayPath } =
			typeof pathResult === "string" ? { absolutePath: pathResult, displayPath: relPath } : pathResult

		// Read current file content
		let originalContent: string
		try {
			// Check editor buffer first
			const openDoc = vscode.workspace.textDocuments.find(
				(d) => d.uri.fsPath.toLowerCase() === absolutePath.toLowerCase(),
			)
			if (openDoc) {
				originalContent = openDoc.getText()
			} else {
				originalContent = await fs.readFile(absolutePath, "utf8")
			}
		} catch (readError) {
			return formatResponse.toolError(
				`Cannot read file "${displayPath}": ${(readError as Error).message}`,
			)
		}

		// Apply hashline edits (atomic: all validated before any applied)
		const result = applyHashlineEdits(originalContent, edits)

		if (!result.success) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(
				`Hashline edit failed: ${result.error}\n\n` +
				`This usually means the file changed since your last hashline read. ` +
				`Re-read the file with hashline=true to get fresh anchors.`,
			)
		}

		// Write the new content via DiffSystem
		const newContent = result.newContent!
		try {
			const diffSystem = getDiffSystem()
			if (diffSystem) {
				await diffSystem.writeFileContent(absolutePath, newContent)
			} else {
				await vscode.workspace.fs.writeFile(
					vscode.Uri.file(absolutePath),
					Buffer.from(newContent),
				)
			}
		} catch (writeError) {
			return formatResponse.toolError(
				`File write failed: ${(writeError as Error).message}`,
			)
		}

		// Track file context
		await config.services.fileContextTracker.trackFileContext(relPath, "edit_tool")

		// Send UI message
		const readablePath = getReadablePath(config.cwd, displayPath)
		const sharedMessageProps: ShuncodeSayTool = {
			tool: "hashlineEdit",
			path: readablePath,
			content: `Applied ${edits.length} hashline edit(s)`,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		}
		await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await config.callbacks.say("tool", JSON.stringify(sharedMessageProps), undefined, undefined, false)

		// Telemetry
		telemetryService.captureToolUsage(
			config.ulid,
			block.name,
			config.api.getModel().id,
			provider,
			true,
			true,
			undefined,
			block.isNativeToolCall,
		)

		// Return updated anchors so model can chain edits without re-reading
		const editSummary = edits.map((e) => `  ${e.operation} ${e.anchor}`).join("\n")
		return (
			`Hashline edit applied successfully (${edits.length} operation(s)):\n${editSummary}\n\n` +
			`--- Updated anchors (use these for subsequent edits) ---\n` +
			`${result.updatedAnchors}`
		)
	}
}
