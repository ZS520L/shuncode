import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { WorkspacePathAdapter } from "@core/workspace/WorkspacePathAdapter"
import { showSystemNotification } from "@integrations/notifications"
import { arePathsEqual } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { ShuncodeDefaultTool } from "@/shared/tools"
import { CommandSafetyClassifier } from "@core/permissions/CommandSafetyClassifier"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { applyModelContentFixes } from "../utils/ModelContentProcessor"
import { showNotificationForApproval } from "../../utils"
import { ToolResultUtils } from "../utils/ToolResultUtils"

// Default timeout for commands in yolo mode and background exec mode
const DEFAULT_COMMAND_TIMEOUT_SECONDS = 30

export class ExecuteCommandToolHandler implements IFullyManagedTool {
	readonly name = ShuncodeDefaultTool.BASH

	constructor(_validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.command}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// [SHUNCODE-SHUNCODE] Cursor-style: no partial preview for commands (auto-execute)
		return
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		let command: string | undefined = block.params.command
		const requiresApprovalRaw: string | undefined = block.params.requires_approval
		const timeoutParam: string | undefined = block.params.timeout
		let timeoutSeconds: number | undefined

		// Extract provider using the proven pattern from ReportBugHandler
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		// Validate required parameters
		if (!command) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "command")
		}

		if (!requiresApprovalRaw) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "requires_approval")
		}

		config.taskState.consecutiveMistakeCount = 0

        // [SHUNCODE-SHUNCODE] Hard Block for redundant 'open' commands
        // We move this to the very top to prevent ANY confirmation or terminal spam.
        const openCommands = ["code ", "code-insiders ", "cursor ", "open ", "xdg-open ", "notepad "];
        const trimmedCommand = command.trim();
        if (openCommands.some(cmd => trimmedCommand.startsWith(cmd))) {
             await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "command");
             await config.callbacks.say("command", command, undefined, undefined, false);
             return "Command executed (simulated). File should be open in the editor.";
        }

		// Handling of timeout while in yolo mode or background exec mode
		if (config.yoloModeToggled || config.vscodeTerminalExecutionMode === "backgroundExec") {
			const parsed = timeoutParam ? parseInt(timeoutParam, 10) : NaN
			timeoutSeconds = parsed > 0 ? parsed : DEFAULT_COMMAND_TIMEOUT_SECONDS
		}

		// Pre-process command for certain models
		if (config.api.getModel().id.includes("gemini")) {
			command = applyModelContentFixes(command)
		}

		// Handle multi-workspace command execution
		let executionDir: string = config.cwd
		let actualCommand: string = command

		let workspaceHintUsed = false
		let workspaceHint: string | undefined

		if (config.isMultiRootEnabled && config.workspaceManager) {
			const commandMatch = command.match(/^@(\w+):(.+)$/)
			if (commandMatch) {
				workspaceHintUsed = true
				workspaceHint = commandMatch[1]
				actualCommand = commandMatch[2].trim()
				const adapter = new WorkspacePathAdapter({
					cwd: config.cwd,
					isMultiRootEnabled: true,
					workspaceManager: config.workspaceManager,
				})
				executionDir = adapter.resolvePath(".", workspaceHint)
				command = actualCommand
			}
		}

		// Check command permission validation (SHUNCODE_COMMAND_PERMISSIONS env var)
        // [SHUNCODE-SHUNCODE] Security check stays active!
		const permissionResult = config.services.commandPermissionController.validateCommand(actualCommand)
		if (!permissionResult.allowed) {
			let errorMessage: string
			if (permissionResult.failedSegment) {
				errorMessage =
					`Command "${actualCommand}" was denied by SHUNCODE_COMMAND_PERMISSIONS. ` +
					`Segment "${permissionResult.failedSegment}" ${permissionResult.reason}.`
			} else {
				const matchedPattern = permissionResult.matchedPattern
					? ` (matched pattern: ${permissionResult.matchedPattern})`
					: ""
				errorMessage =
					`Command "${actualCommand}" was denied by SHUNCODE_COMMAND_PERMISSIONS. ` +
					`Reason: ${permissionResult.reason}${matchedPattern}`
			}
			await config.callbacks.say("command_permission_denied", errorMessage)
			return formatResponse.toolError(formatResponse.permissionDeniedError(errorMessage))
		}

		// Check shuncodeignore validation for command
		const ignoredFileAttemptedToAccess = config.services.shuncodeIgnoreController.validateCommand(actualCommand)
		if (ignoredFileAttemptedToAccess) {
			await config.callbacks.say("shuncodeignore_error", ignoredFileAttemptedToAccess)
			return formatResponse.toolError(formatResponse.shuncodeIgnoreError(ignoredFileAttemptedToAccess))
		}

		// [SHUNCODE] Command approval logic
		// Determine if this command can be auto-approved based on user settings:
		//   - YOLO mode: always auto-approve (handled by autoApprover)
		//   - executeSafeCommands enabled: auto-approve only safe (read-only) commands
		//   - executeAllCommands enabled: auto-approve all commands
		//   - Neither enabled: always ask for approval
		let didAutoApprove = false

		const autoApproveResult = config.autoApprover
			? config.autoApprover.shouldAutoApproveTool(ShuncodeDefaultTool.BASH)
			: false

		// autoApproveResult for BASH is [executeSafeCommands, executeAllCommands]
		const [executeSafeCommands, executeAllCommands] = Array.isArray(autoApproveResult)
			? autoApproveResult
			: [false, false]

		if (executeAllCommands) {
			// User opted in to auto-approve ALL commands
			didAutoApprove = true
		} else if (executeSafeCommands) {
			// Check if the command is safe (read-only)
			const classifier = new CommandSafetyClassifier()
			const safety = classifier.classify(actualCommand)
			didAutoApprove = safety.safety === "safe"
		}

		// Determine workspace context for telemetry
		const resolvedToNonPrimary = !arePathsEqual(executionDir, config.cwd)
		const workspaceContext = {
			isMultiRootEnabled: config.isMultiRootEnabled || false,
			usedWorkspaceHint: workspaceHintUsed,
			resolvedToNonPrimary,
			resolutionMethod: (workspaceHintUsed ? "hint" : "primary_fallback") as "hint" | "primary_fallback",
		}

		if (didAutoApprove) {
			// Auto-approve: show as info message (no ask)
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "command")
			await config.callbacks.say("command", actualCommand, undefined, undefined, false)
		} else {
			// Manual approval: ask user
			showNotificationForApproval(
				`Shuncode wants to execute: ${actualCommand}`,
				config.autoApprovalSettings.enableNotifications,
			)
			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "command")
			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("command", actualCommand, config)
			if (!didApprove) {
				return formatResponse.toolDenied()
			}
		}

		telemetryService.captureToolUsage(
			config.ulid,
			block.name,
			config.api.getModel().id,
			provider,
			didAutoApprove,
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

		// Setup timeout notification
		let timeoutId: NodeJS.Timeout | undefined
		if (didAutoApprove && config.autoApprovalSettings.enableNotifications) {
			timeoutId = setTimeout(() => {
				showSystemNotification({
					subtitle: "Command is still running",
					message: "An auto-approved command has been running for 30s, and may need your attention.",
				})
			}, 30_000)
		}

		// Execute the command
		let finalCommand: string = actualCommand
		if (executionDir !== config.cwd) {
			finalCommand = `cd "${executionDir}" && ${actualCommand}`
		}

		const [userRejected, result] = await config.callbacks.executeCommandTool(finalCommand, timeoutSeconds)

		if (timeoutId) {
			clearTimeout(timeoutId)
		}

		if (userRejected) {
			config.taskState.didRejectTool = true
		}

		return result
	}
}
