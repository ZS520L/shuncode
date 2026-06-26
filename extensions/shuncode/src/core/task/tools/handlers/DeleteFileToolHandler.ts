import path from "node:path"
import * as vscode from "vscode"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { resolveWorkspacePath } from "@core/workspace"
import { ShuncodeSayTool } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import { getReadablePath } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class DeleteFileToolHandler implements IFullyManagedTool {
	readonly name = ShuncodeDefaultTool.FILE_DELETE

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path || block.params.absolutePath}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path || block.params.absolutePath
		const config = uiHelpers.getConfig()

		const sharedMessageProps: ShuncodeSayTool = {
			tool: "fileDeleted",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath)),
		}

		const partialMessage = JSON.stringify(sharedMessageProps)
		await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const rawRelPath = block.params.path || block.params.absolutePath

		// Extract provider for telemetry
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		// Validate required params
		if (!rawRelPath) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(
				block.name,
				block.params.absolutePath ? "absolutePath" : "path",
			)
		}

		// Check shuncodeignore
		const accessValidation = this.validator.checkShuncodeIgnorePath(rawRelPath)
		if (!accessValidation.ok) {
			await config.callbacks.say("shuncodeignore_error", rawRelPath)
			return formatResponse.toolError(formatResponse.shuncodeIgnoreError(rawRelPath))
		}

		config.taskState.consecutiveMistakeCount = 0

		// Resolve path
		const pathResult = resolveWorkspacePath(config, rawRelPath, "DeleteFileToolHandler.execute")
		const { absolutePath, displayPath } =
			typeof pathResult === "string" ? { absolutePath: pathResult, displayPath: rawRelPath } : pathResult
		const readablePath = getReadablePath(config.cwd, displayPath)

		// Check if file exists
		const fileExists = await fileExistsAtPath(absolutePath)
		if (!fileExists) {
			const errorMsg = `File does not exist at path: ${readablePath}`

			const toolMessage: ShuncodeSayTool = {
				tool: "fileDeleted",
				path: readablePath,
				content: errorMsg,
			}

			await config.callbacks.say("tool", JSON.stringify(toolMessage))
			return formatResponse.toolError(errorMsg)
		}

		// [SHUNCODE] Approval logic for file deletion
		// Check autoApprover settings (deleteFiles permission)
		const autoApproveResult = config.autoApprover
			? config.autoApprover.shouldAutoApproveTool(ShuncodeDefaultTool.FILE_DELETE)
			: false
		const didAutoApprove = autoApproveResult === true || (Array.isArray(autoApproveResult) && autoApproveResult[0])

		const toolMessage: ShuncodeSayTool = {
			tool: "fileDeleted",
			path: readablePath,
			content: `Delete file: ${readablePath}`,
		}
		const completeMessage = JSON.stringify(toolMessage)

		if (didAutoApprove) {
			// Auto-approved: show as info (no ask)
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
		} else {
			// Manual approval: ask user
			showNotificationForApproval(
				`Shuncode wants to delete: ${readablePath}`,
				config.autoApprovalSettings.enableNotifications,
			)
			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")
			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)
			if (!didApprove) {
				telemetryService.captureToolUsage(
					config.ulid,
					block.name,
					config.api.getModel().id,
					provider,
					false,
					false,
					undefined,
					block.isNativeToolCall,
				)
				return formatResponse.toolDenied()
			}
		}

		// Actually delete the file
		try {
			const uri = vscode.Uri.file(absolutePath)
			await vscode.workspace.fs.delete(uri)

			// Track telemetry
			telemetryService.captureToolUsage(
				config.ulid,
				block.name,
				config.api.getModel().id,
				provider,
				didAutoApprove,
				true,
				undefined,
				block.isNativeToolCall,
			)

			return `File successfully deleted: ${readablePath}`
		} catch (error) {
			const errorMsg = `Failed to delete file: ${error instanceof Error ? error.message : String(error)}`
			return formatResponse.toolError(errorMsg)
		}
	}
}
