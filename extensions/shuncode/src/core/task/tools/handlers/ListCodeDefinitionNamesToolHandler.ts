import type { ToolUse } from "@core/assistant-message"
import { resolveWorkspacePath } from "@core/workspace"
import { parseSourceCodeForDefinitionsTopLevel, parseSourceCodeForDefinitionsSingleFile } from "@services/tree-sitter"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { formatResponse } from "@/core/prompts/responses"
import { telemetryService } from "@/services/telemetry"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import * as fs from "fs/promises"

export class ListCodeDefinitionNamesToolHandler implements IFullyManagedTool {
	readonly name = ShuncodeDefaultTool.LIST_CODE_DEF

	constructor(private validator: ToolValidator) { }

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path

		const config = uiHelpers.getConfig()

		// Create and show partial UI message
		const sharedMessageProps = {
			tool: "listCodeDefinitionNames",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath)),
			content: "",
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		}

		const partialMessage = JSON.stringify(sharedMessageProps)

		// [SHUNCODE-SHUNCODE] Cursor-style: always auto-execute, show as info (no ask)
		await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const relDirPath: string | undefined = block.params.path

		// Extract provider using the proven pattern from ReportBugHandler
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		// Validate required parameters
		const pathValidation = this.validator.assertRequiredParams(block, "path")
		if (!pathValidation.ok) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "path")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Resolve the absolute path based on multi-workspace configuration
		const pathResult = resolveWorkspacePath(config, relDirPath!, "ListCodeDefinitionNamesToolHandler.execute")
		const { absolutePath, displayPath } =
			typeof pathResult === "string" ? { absolutePath: pathResult, displayPath: relDirPath! } : pathResult

		// Execute the actual parse source code operation
		// Auto-detect: if path is a file, parse single file; if directory, parse all top-level files
		let result: string
		try {
			const stat = await fs.stat(absolutePath)
			if (stat.isFile()) {
				result = await parseSourceCodeForDefinitionsSingleFile(absolutePath, config.services.shuncodeIgnoreController)
			} else {
				result = await parseSourceCodeForDefinitionsTopLevel(absolutePath, config.services.shuncodeIgnoreController)
			}
		} catch {
			result = await parseSourceCodeForDefinitionsTopLevel(absolutePath, config.services.shuncodeIgnoreController)
		}

		// Handle approval flow
		const sharedMessageProps = {
			tool: "listCodeDefinitionNames",
			path: getReadablePath(config.cwd, displayPath),
			content: result,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relDirPath!),
		}

		const completeMessage = JSON.stringify(sharedMessageProps)

		// [SHUNCODE-SHUNCODE] Cursor-style: always auto-execute (no ask)
		await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await config.callbacks.say("tool", completeMessage, undefined, undefined, false)

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

		return result
	}
}
