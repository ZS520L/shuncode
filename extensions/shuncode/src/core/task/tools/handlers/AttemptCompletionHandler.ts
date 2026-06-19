import type Anthropic from "@anthropic-ai/sdk"
import type { ToolUse } from "@core/assistant-message"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import { formatResponse } from "@core/prompts/responses"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { telemetryService } from "@services/telemetry"
import { findLastIndex } from "@shared/array"
import { COMPLETION_RESULT_CHANGES_FLAG } from "@shared/ExtensionMessage"
import { ShuncodeDefaultTool } from "@shared/tools"
import { Logger } from "@/shared/services/Logger"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class AttemptCompletionHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ShuncodeDefaultTool.ATTEMPT

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	/**
	 * Handle partial block streaming for attempt_completion
	 * Matches the original conditional logic structure for command vs no-command cases
	 */
	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const result = block.params.result
		const command = block.params.command

		if (!command) {
			// no command, still outputting partial result
			await uiHelpers.say(
				"completion_result",
				uiHelpers.removeClosingTag(block, "result", result),
				undefined,
				undefined,
				block.partial,
			)
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const result: string | undefined = block.params.result
		const command: string | undefined = block.params.command

		// Validate required parameters
		if (!result) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "result")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Run PreToolUse hook before execution
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

		// Show notification if enabled
		if (config.autoApprovalSettings.enableNotifications) {
			showSystemNotification({
				subtitle: "Task Completed",
				message: result.replace(/\n/g, " "),
			})
		}

		const addNewChangesFlagToLastCompletionResultMessage = async () => {
			// Add newchanges flag if there are new changes to the workspace
			const hasNewChanges = await config.callbacks.doesLatestTaskCompletionHaveNewChanges()
			const shuncodeMessages = config.messageState.getShuncodeMessages()

			const lastCompletionResultMessageIndex = findLastIndex(shuncodeMessages, (m: any) => m.say === "completion_result")
			const lastCompletionResultMessage =
				lastCompletionResultMessageIndex !== -1 ? shuncodeMessages[lastCompletionResultMessageIndex] : undefined
			if (
				lastCompletionResultMessage &&
				lastCompletionResultMessageIndex !== -1 &&
				hasNewChanges &&
				!lastCompletionResultMessage.text?.endsWith(COMPLETION_RESULT_CHANGES_FLAG)
			) {
				await config.messageState.updateShuncodeMessage(lastCompletionResultMessageIndex, {
					text: lastCompletionResultMessage.text + COMPLETION_RESULT_CHANGES_FLAG,
				})
			}
		}

		let commandResult: any
		const lastMessage = config.messageState.getShuncodeMessages().at(-1)

		if (command) {
			if (lastMessage && lastMessage.ask !== "command") {
				// haven't sent a command message yet so first send completion_result then command
				const completionMessageTs = await config.callbacks.say("completion_result", result, undefined, undefined, false)
				await config.callbacks.saveCheckpoint(true, completionMessageTs)
				await addNewChangesFlagToLastCompletionResultMessage()
				telemetryService.captureTaskCompleted(config.ulid)
			} else {
				// we already sent a command message, meaning the complete completion message has also been sent
				await config.callbacks.saveCheckpoint(true)
			}

			// Attempt completion is a special tool where we want to update the focus chain list before the user provides response
			if (!block.partial && config.focusChainSettings.enabled) {
				await config.callbacks.updateFCListFromToolResponse(block.params.task_progress)
			}

			// [SHUNCODE-SHUNCODE] Cursor-style: auto-execute completion command (no ask)
			// Only execute "live demo" commands (servers, URLs, GUI apps).
			// Skip if the command was already executed in this session to prevent duplicates.
			const trimmedCmd = command.trim().toLowerCase()
			const isServerLaunchCommand = /^(start\s|npm\s+run\s+(dev|start|serve)|npx\s+serve|python\s+-m\s+http\.server|live-server|open\s+https?:)/.test(trimmedCmd)

			// Dedup: check both say="command" and ask="command" messages
			const commandAlreadyRan = config.messageState.getShuncodeMessages().some(
				(m) => {
					const msgText = m.text?.trim().toLowerCase()
					return (m.say === "command" || m.ask === "command") && msgText === trimmedCmd
				},
			)

			if (commandAlreadyRan) {
				Logger.log(`[AttemptCompletion] Skipping duplicate command: "${command}"`)
			} else if (isServerLaunchCommand) {
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "command")
				await config.callbacks.say("command", command, undefined, undefined, false)

				const [userRejected, execCommandResult] = await config.callbacks.executeCommandTool(command!, undefined)
				if (userRejected) {
					config.taskState.didRejectTool = true
					return execCommandResult
				}
				commandResult = execCommandResult
			} else {
				Logger.log(`[AttemptCompletion] Skipping non-server command: "${command}"`)
			}
		} else {
			// Send the complete completion_result message (partial was already removed above)
			const completionMessageTs = await config.callbacks.say("completion_result", result, undefined, undefined, false)
			await config.callbacks.saveCheckpoint(true, completionMessageTs)
			await addNewChangesFlagToLastCompletionResultMessage()
			telemetryService.captureTaskCompleted(config.ulid)
		}

		// we already sent completion_result says, an empty string asks relinquishes control over button and field
		if (config.messageState.getShuncodeMessages().at(-1)?.ask === "command_output") {
			await config.callbacks.say("command_output", "")
		}

		if (!block.partial && config.focusChainSettings.enabled) {
			await config.callbacks.updateFCListFromToolResponse(block.params.task_progress)
		}

		// Run TaskComplete hook after task completion
		await this.runTaskCompleteHook(config, block)

		// Multi-step workflow: signal step completion and return immediately
		// without waiting for user input — the orchestrator will start the next step.
		if (config.taskState.isWorkflowStep) {
			config.taskState.stepCompleted = true
			return "[attempt_completion] Result: Done"
		}

		// [SHUNCODE-SHUNCODE] Cursor-style: show completion as info, wait for user's next message
		// ask("completion_result") still used to pause the loop and wait for user input,
		// but now it returns immediately if user types new message (no approval button needed)
		const { response, text, images, files: completionFiles } = await config.callbacks.ask("completion_result", "", false)
		const prefix = "[attempt_completion] Result: Done"

		// Check if user provided any content to continue
		const hasContent = (text && text.trim()) || (images && images.length > 0) || (completionFiles && completionFiles.length > 0)

		if (!hasContent) {
			return prefix
		}

		const feedbackTs = await config.callbacks.say("user_feedback", text ?? "", images, completionFiles)

		// Start a NEW checkpoint for this follow-up message.
		// Each user message = own ResponseGroup = own snapshot for per-message rollback.
		if (feedbackTs) {
			try {
				const { getDiffSystem } = await import("@/core/diff-v2")
				const diffSystem = getDiffSystem()
				await diffSystem.startCheckpoint(`Feedback: ${text?.substring(0, 50)}...`, feedbackTs)
				console.log(`[AttemptCompletion] Checkpoint started for feedback ts=${feedbackTs}`)
			} catch (error) {
				Logger.error("[AttemptCompletion] Failed to start checkpoint for feedback:", error)
			}
		}

		const toolResults: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []
		if (commandResult) {
			if (typeof commandResult === "string") {
				toolResults.push({ type: "text", text: commandResult })
			} else if (Array.isArray(commandResult)) {
				toolResults.push(...commandResult)
			}
		}

		if (text) {
			toolResults.push(
				{
					type: "text",
					text: "The user has provided feedback on the results. Consider their input to continue the task, and then attempt completion again.",
				},
				{
					type: "text",
					text: `<feedback>\n${text}\n</feedback>`,
				},
			)
		}

		if (completionFiles?.length) {
			const fileContentString = await processFilesIntoText(completionFiles)
			if (fileContentString) {
				toolResults.push({ type: "text" as const, text: fileContentString })
			}
		}

		if (images && images.length > 0) {
			toolResults.push(...formatResponse.imageBlocks(images))
		}

		return [
			{ type: "text" as const, text: prefix },
			...toolResults,
		]
	}

	/**
	 * Runs the TaskComplete hook after user confirms task completion.
	 * This is a non-cancellable, observation-only hook similar to TaskCancel.
	 * Errors are logged but do not affect task completion.
	 */
	private async runTaskCompleteHook(config: TaskConfig, block: ToolUse): Promise<void> {
		const hooksEnabled = getHooksEnabledSafe()
		if (!hooksEnabled) {
			return
		}

		try {
			const { executeHook } = await import("@core/hooks/hook-executor")

			await executeHook({
				hookName: "TaskComplete",
				hookInput: {
					taskComplete: {
						taskMetadata: {
							taskId: config.taskId,
							ulid: config.ulid,
							result: block.params.result || "",
							command: block.params.command || "",
						},
					},
				},
				isCancellable: false, // Non-cancellable - task is already complete
				say: config.callbacks.say,
				setActiveHookExecution: undefined, // Explicitly undefined for non-cancellable hooks
				clearActiveHookExecution: undefined, // Explicitly undefined for non-cancellable hooks
				messageStateHandler: config.messageState,
				taskId: config.taskId,
				hooksEnabled,
			})
		} catch (error) {
			// TaskComplete hook failed - non-fatal, just log
			Logger.error("[TaskComplete Hook] Failed (non-fatal):", error)
		}
	}
}
