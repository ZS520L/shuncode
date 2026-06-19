import { ApiHandler } from "@core/api"
import { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import { ShuncodeIgnoreController } from "@core/ignore/ShuncodeIgnoreController"
import { CommandPermissionController } from "@core/permissions"
import { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import { BrowserSession } from "@services/browser/BrowserSession"
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { McpHub } from "@services/mcp/McpHub"
import { ShuncodeAsk, ShuncodeSay } from "@shared/ExtensionMessage"
import { ShuncodeContent } from "@shared/messages/content"
import { ShuncodeDefaultTool } from "@shared/tools"
import { ShuncodeAskResponse } from "@shared/WebviewMessage"
import * as vscode from "vscode"
import { isGPT5ModelFamily, modelDoesntSupportWebp, getModelCapabilityTier, getSessionLimitsForModel } from "@/utils/model-utils"
import { getApiSettingsMode } from "@shared/storage/types"
import type { ApiProviderInfo } from "@core/api"
import { EXPLORATION_ONLY_TOOLS } from "@shared/tools"
import { ToolUse } from "../assistant-message"
import { ContextManager } from "../context/context-management/ContextManager"
import { formatResponse } from "../prompts/responses"
import { StateManager } from "../storage/StateManager"
import { WorkspaceRootManager } from "../workspace"
import { ToolResponse } from "."
import { MessageStateHandler } from "./message-state"
import { TaskState } from "./TaskState"
import { AutoApprove } from "./tools/autoApprove"
import { AccessMcpResourceHandler } from "./tools/handlers/AccessMcpResourceHandler"
import { ActModeRespondHandler } from "./tools/handlers/ActModeRespondHandler"
import { ApplyPatchHandler } from "./tools/handlers/ApplyPatchHandler"
import { AskFollowupQuestionToolHandler } from "./tools/handlers/AskFollowupQuestionToolHandler"
import { AttemptCompletionHandler } from "./tools/handlers/AttemptCompletionHandler"
import { BrowserToolHandler } from "./tools/handlers/BrowserToolHandler"
import { FastContextToolHandler } from "./tools/handlers/CodebaseSearchToolHandler"
import { CondenseHandler } from "./tools/handlers/CondenseHandler"
import { ExecuteCommandToolHandler } from "./tools/handlers/ExecuteCommandToolHandler"
import { GenerateExplanationToolHandler } from "./tools/handlers/GenerateExplanationToolHandler"
import { GenerateImageToolHandler } from "./tools/handlers/GenerateImageToolHandler"
import { GlobToolHandler } from "./tools/handlers/GlobToolHandler"
import { ListCodeDefinitionNamesToolHandler } from "./tools/handlers/ListCodeDefinitionNamesToolHandler"
import { LspNavigationToolHandler } from "./tools/handlers/LspNavigationToolHandler"
import { ListFilesToolHandler } from "./tools/handlers/ListFilesToolHandler"
import { LoadMcpDocumentationHandler } from "./tools/handlers/LoadMcpDocumentationHandler"
import { MemoryToolHandler } from "./tools/handlers/MemoryToolHandler"
import { NewTaskHandler } from "./tools/handlers/NewTaskHandler"
import { PlanModeRespondHandler } from "./tools/handlers/PlanModeRespondHandler"
import { ReadFileToolHandler } from "./tools/handlers/ReadFileToolHandler"
import { ReportBugHandler } from "./tools/handlers/ReportBugHandler"
import { SearchFilesToolHandler } from "./tools/handlers/SearchFilesToolHandler"
import { SummarizeTaskHandler } from "./tools/handlers/SummarizeTaskHandler"
import { UseMcpToolHandler } from "./tools/handlers/UseMcpToolHandler"
import { UseSkillToolHandler } from "./tools/handlers/UseSkillToolHandler"
import { WebFetchToolHandler } from "./tools/handlers/WebFetchToolHandler"
import { WebSearchToolHandler } from "./tools/handlers/WebSearchToolHandler"
import { WriteToFileToolHandler } from "./tools/handlers/WriteToFileToolHandler"
import { AppendToFileToolHandler } from "./tools/handlers/AppendToFileToolHandler"
import { EditNotebookToolHandler } from "./tools/handlers/EditNotebookToolHandler"
import { ReadDiagnosticsToolHandler } from "./tools/handlers/ReadDiagnosticsToolHandler"
import { getDiffSystem, DiffSystem } from "@/core/diff-v2"

import { IPartialBlockHandler, SharedToolHandler, ToolExecutorCoordinator } from "./tools/ToolExecutorCoordinator"
import { ToolValidator } from "./tools/ToolValidator"
import { TaskConfig, validateTaskConfig } from "./tools/types/TaskConfig"
import { createUIHelpers } from "./tools/types/UIHelpers"
import { ToolDisplayUtils } from "./tools/utils/ToolDisplayUtils"
import { ToolResultUtils } from "./tools/utils/ToolResultUtils"

export class ToolExecutor {
	private autoApprover: AutoApprove
	private coordinator: ToolExecutorCoordinator
	private diffSystem: DiffSystem | null

	// Auto-approval methods using the AutoApprove class
	private shouldAutoApproveTool(toolName: ShuncodeDefaultTool): boolean | [boolean, boolean] {
		return this.autoApprover.shouldAutoApproveTool(toolName)
	}

	private async shouldAutoApproveToolWithPath(
		blockname: ShuncodeDefaultTool,
		autoApproveActionpath: string | undefined,
	): Promise<boolean> {
		return this.autoApprover.shouldAutoApproveToolWithPath(blockname, autoApproveActionpath)
	}

	constructor(
		// Core Services & Managers
		private context: vscode.ExtensionContext,
		private taskState: TaskState,
		private messageStateHandler: MessageStateHandler,
		private api: ApiHandler,
		private urlContentFetcher: UrlContentFetcher,
		private browserSession: BrowserSession,
		private diffViewProvider: DiffViewProvider,
		private mcpHub: McpHub,
		private fileContextTracker: FileContextTracker,
		private shuncodeIgnoreController: ShuncodeIgnoreController,
		private commandPermissionController: CommandPermissionController,
		private contextManager: ContextManager,
		private stateManager: StateManager,

		// Configuration & Settings

		private cwd: string,
		private taskId: string,
		private ulid: string,
		private vscodeTerminalExecutionMode: "vscodeTerminal" | "backgroundExec",

		// Workspace Management
		private workspaceManager: WorkspaceRootManager | undefined,
		private isMultiRootEnabled: boolean,

		// Callbacks to the Task (Entity)
		private say: (
			type: ShuncodeSay,
			text?: string,
			images?: string[],
			files?: string[],
			partial?: boolean,
		) => Promise<number | undefined>,
		private ask: (
			type: ShuncodeAsk,
			text?: string,
			partial?: boolean,
		) => Promise<{
			response: ShuncodeAskResponse
			text?: string
			images?: string[]
			files?: string[]
		}>,
		private saveCheckpoint: (isAttemptCompletionMessage?: boolean, completionMessageTs?: number) => Promise<void>,
		private sayAndCreateMissingParamError: (toolName: ShuncodeDefaultTool, paramName: string, relPath?: string) => Promise<any>,
		private removeLastPartialMessageIfExistsWithType: (type: "ask" | "say", askOrSay: ShuncodeAsk | ShuncodeSay) => Promise<void>,
		private executeCommandTool: (command: string, timeoutSeconds: number | undefined) => Promise<[boolean, any]>,
		private doesLatestTaskCompletionHaveNewChanges: () => Promise<boolean>,
		private updateFCListFromToolResponse: (taskProgress: string | undefined) => Promise<void>,
		private switchToActMode: () => Promise<boolean>,
		private cancelTask: () => Promise<void>,

		// Atomic hook state helpers from Task
		private setActiveHookExecution: (hookExecution: NonNullable<typeof taskState.activeHookExecution>) => Promise<void>,
		private clearActiveHookExecution: () => Promise<void>,
		private getActiveHookExecution: () => Promise<typeof taskState.activeHookExecution>,
		private runUserPromptSubmitHook: (
			userContent: ShuncodeContent[],
			context: "initial_task" | "resume" | "feedback",
		) => Promise<{ cancel?: boolean; wasCancelled?: boolean; contextModification?: string; errorMessage?: string }>,
	) {
		this.autoApprover = new AutoApprove(this.stateManager)
		try {
			this.diffSystem = getDiffSystem();
		} catch {
			this.diffSystem = null;
		}

		// Initialize the coordinator and register all tool handlers
		this.coordinator = new ToolExecutorCoordinator()
		this.registerToolHandlers()
	}

	// Create a properly typed TaskConfig object for handlers
	// NOTE: modifying this object in the tool handlers is okay since these are all references to the singular ToolExecutor instance's variables. However, be careful modifying this object assuming it will update the ToolExecutor instance, e.g. config.browserSession = ... will not update the ToolExecutor.browserSession instance variable. Use applyLatestBrowserSettings() instead.
	private asToolConfig(): TaskConfig {
		const config: TaskConfig = {
			taskId: this.taskId,
			ulid: this.ulid,
			context: this.context,
			mode: this.stateManager.getGlobalSettingsKey("mode"),
			strictPlanModeEnabled: this.stateManager.getGlobalSettingsKey("strictPlanModeEnabled"),
			yoloModeToggled: this.stateManager.getGlobalSettingsKey("yoloModeToggled"),
			vscodeTerminalExecutionMode: this.vscodeTerminalExecutionMode,
			enableParallelToolCalling: this.isParallelToolCallingEnabled(),
			cwd: this.cwd,
			workspaceManager: this.workspaceManager,
			isMultiRootEnabled: this.isMultiRootEnabled,
			taskState: this.taskState,
			messageState: this.messageStateHandler,
			api: this.api,
			autoApprovalSettings: this.stateManager.getGlobalSettingsKey("autoApprovalSettings"),
			autoApprover: this.autoApprover,
			browserSettings: this.stateManager.getGlobalSettingsKey("browserSettings"),
			focusChainSettings: this.stateManager.getGlobalSettingsKey("focusChainSettings"),
			services: {
				mcpHub: this.mcpHub,
				browserSession: this.browserSession,
				urlContentFetcher: this.urlContentFetcher,
				diffViewProvider: this.diffViewProvider,
				fileContextTracker: this.fileContextTracker,
				shuncodeIgnoreController: this.shuncodeIgnoreController,
				commandPermissionController: this.commandPermissionController,
				contextManager: this.contextManager,
				stateManager: this.stateManager,
				diffSystem: this.diffSystem,
			},
			callbacks: {
				say: this.say,
				ask: this.ask,
				saveCheckpoint: this.saveCheckpoint,
				postStateToWebview: async () => { },
				reinitExistingTaskFromId: async () => { },
				cancelTask: this.cancelTask,
				updateTaskHistory: async (_: any) => [],
				executeCommandTool: this.executeCommandTool,
				doesLatestTaskCompletionHaveNewChanges: this.doesLatestTaskCompletionHaveNewChanges,
				updateFCListFromToolResponse: this.updateFCListFromToolResponse,
				sayAndCreateMissingParamError: this.sayAndCreateMissingParamError,
				removeLastPartialMessageIfExistsWithType: this.removeLastPartialMessageIfExistsWithType,
				shouldAutoApproveTool: this.shouldAutoApproveTool.bind(this),
				shouldAutoApproveToolWithPath: this.shouldAutoApproveToolWithPath.bind(this),
				applyLatestBrowserSettings: this.applyLatestBrowserSettings.bind(this),
				switchToActMode: this.switchToActMode,
				setActiveHookExecution: this.setActiveHookExecution,
				clearActiveHookExecution: this.clearActiveHookExecution,
				getActiveHookExecution: this.getActiveHookExecution,
				runUserPromptSubmitHook: this.runUserPromptSubmitHook,
			},
			coordinator: this.coordinator,
		}

		// Validate the config at runtime to catch any missing properties
		validateTaskConfig(config)
		return config
	}

	/**
	 * Register all tool handlers with the coordinator
	 */
	private registerToolHandlers(): void {
		const validator = new ToolValidator(this.shuncodeIgnoreController)

		// Register all tool handlers
		this.coordinator.register(new ListFilesToolHandler(validator))
		this.coordinator.register(new ReadFileToolHandler(validator))
		this.coordinator.register(new BrowserToolHandler())
		this.coordinator.register(new AskFollowupQuestionToolHandler())
		this.coordinator.register(new FastContextToolHandler())
		this.coordinator.register(new WebFetchToolHandler())
		this.coordinator.register(new WebSearchToolHandler())

		// Register WriteToFileToolHandler for all file editing tools with proper typing
		const writeHandler = new WriteToFileToolHandler(validator)
		this.coordinator.register(writeHandler) // registers as "write_to_file" (ShuncodeDefaultTool.FILE_NEW)
		this.coordinator.register(new SharedToolHandler(ShuncodeDefaultTool.FILE_EDIT, writeHandler))
		this.coordinator.register(new SharedToolHandler(ShuncodeDefaultTool.NEW_RULE, writeHandler))
		// Simplified edit tools (for weaker models)
		this.coordinator.register(new SharedToolHandler(ShuncodeDefaultTool.DELETE_BLOCK, writeHandler))
		this.coordinator.register(new SharedToolHandler(ShuncodeDefaultTool.REPLACE_TEXT, writeHandler))

		// Append to file tool
		this.coordinator.register(new AppendToFileToolHandler(validator))

		this.coordinator.register(new EditNotebookToolHandler(validator))

		this.coordinator.register(new ListCodeDefinitionNamesToolHandler(validator))
		this.coordinator.register(new LspNavigationToolHandler(ShuncodeDefaultTool.GO_TO_DEFINITION, validator))
		this.coordinator.register(new LspNavigationToolHandler(ShuncodeDefaultTool.FIND_REFERENCES, validator))
		this.coordinator.register(new LspNavigationToolHandler(ShuncodeDefaultTool.GET_HOVER, validator))
		this.coordinator.register(new SearchFilesToolHandler(validator))
		this.coordinator.register(new ExecuteCommandToolHandler(validator))
		this.coordinator.register(new UseMcpToolHandler())
		this.coordinator.register(new AccessMcpResourceHandler())
		this.coordinator.register(new LoadMcpDocumentationHandler())
		this.coordinator.register(new MemoryToolHandler())
		this.coordinator.register(new UseSkillToolHandler())
		this.coordinator.register(new PlanModeRespondHandler())
		this.coordinator.register(new ActModeRespondHandler())
		this.coordinator.register(new NewTaskHandler())
		this.coordinator.register(new AttemptCompletionHandler())
		this.coordinator.register(new CondenseHandler())
		this.coordinator.register(new SummarizeTaskHandler(validator))
		this.coordinator.register(new ReportBugHandler())
		this.coordinator.register(new ApplyPatchHandler(validator))
		this.coordinator.register(new GenerateExplanationToolHandler())
		this.coordinator.register(new GenerateImageToolHandler())
		this.coordinator.register(new ReadDiagnosticsToolHandler())
		this.coordinator.register(new GlobToolHandler(validator))
	}

	/**
	 * Main entry point for tool execution - called by Task class
	 */
	public async executeTool(block: ToolUse): Promise<void> {
		await this.execute(block)
	}

	/**
	 * Updates the browser settings
	 */
	public async applyLatestBrowserSettings() {
		await this.browserSession.dispose()
		const apiHandlerModel = this.api.getModel()
		const useWebp = this.api ? !modelDoesntSupportWebp(apiHandlerModel) : true
		this.browserSession = new BrowserSession(this.stateManager, useWebp)
		return this.browserSession
	}

	/**
	 * Handles errors during tool execution.
	 *
	 * Logs the error, displays it to the user via the UI, and adds an error
	 * result to the conversation context so the AI can see what went wrong.
	 *
	 * @param action Description of what was being attempted (e.g., "executing read_file")
	 * @param error The error that occurred
	 * @param block The tool use block that caused the error
	 */
	private async handleError(action: string, error: Error, block: ToolUse): Promise<void> {
		// Ignore "Shuncode instance aborted" errors - task was cancelled
		if (error.message === "Shuncode instance aborted") {
			console.log(`[ToolExecutor] handleError: task aborted during ${action}, ignoring`)
			return
		}

		const errorString = `Error ${action}: ${error.message}`

		// Try to say the error, but don't fail if task was aborted in the meantime
		try {
			await this.say("error", errorString)
		} catch (sayError) {
			if (sayError instanceof Error && sayError.message === "Shuncode instance aborted") {
				console.log(`[ToolExecutor] handleError: task aborted while reporting error, ignoring`)
				return
			}
			throw sayError
		}

		// Create error response for the tool
		const errorResponse = formatResponse.toolError(errorString)
		this.pushToolResult(errorResponse, block)
	}

	/**
	 * Pushes a tool result to the user message content.
	 *
	 * This is a critical method that:
	 * - Formats the tool result appropriately for the API
	 * - Adds it to the conversation context
	 * - Marks that a tool has been used in this turn
	 *
	 * @param content The tool response content to add
	 * @param block The tool use block that generated this result
	 */
	private pushToolResult = (content: ToolResponse, block: ToolUse) => {
		// Use the ToolResultUtils to properly format and push the tool result
		ToolResultUtils.pushToolResult(
			content,
			block,
			this.taskState.userMessageContent,
			(block: ToolUse) => ToolDisplayUtils.getToolDescription(block),
			this.coordinator,
			this.taskState.toolUseIdMap,
		)
		// Mark that a tool has been used (only matters when parallel tool calling is disabled)
		if (!this.isParallelToolCallingEnabled()) {
			this.taskState.didAlreadyUseTool = true
		}
	}

	/**
	 * Check if parallel tool calling is enabled.
	 * Parallel tool calling is enabled if:
	 * 1. User has enabled it in settings, OR
	 * 2. The current model is GPT-5 (which handles parallel tools well)
	 */
	private isParallelToolCallingEnabled(): boolean {
		const modelId = this.api.getModel().id
		return this.stateManager.getGlobalSettingsKey("enableParallelToolCalling") || isGPT5ModelFamily(modelId)
	}

	/**
	 * Tools that are restricted in plan mode and can only be used in act mode
	 */
	private static readonly PLAN_MODE_RESTRICTED_TOOLS: ShuncodeDefaultTool[] = [
		ShuncodeDefaultTool.FILE_NEW,
		ShuncodeDefaultTool.FILE_EDIT,
		ShuncodeDefaultTool.NEW_RULE,
		ShuncodeDefaultTool.APPLY_PATCH,
		ShuncodeDefaultTool.EDIT_NOTEBOOK,
	]

	/**
	 * Tools that are restricted in ask mode (read-only mode).
	 * Ask mode blocks everything that modifies state:
	 * file writes, commands, browser actions, MCP side-effects.
	 */
	private static readonly ASK_MODE_RESTRICTED_TOOLS: ShuncodeDefaultTool[] = [
		ShuncodeDefaultTool.FILE_NEW,
		ShuncodeDefaultTool.FILE_EDIT,
		ShuncodeDefaultTool.NEW_RULE,
		ShuncodeDefaultTool.APPLY_PATCH,
		ShuncodeDefaultTool.EDIT_NOTEBOOK,
		ShuncodeDefaultTool.BASH,
		ShuncodeDefaultTool.BROWSER,
		ShuncodeDefaultTool.MCP_USE,
	]

	/**
	 * Tools that are restricted in chat mode (same as ask — read-only).
	 * Chat mode uses the same restrictions as ask mode: no writes, no commands, no browser, no MCP.
	 */
	private static readonly CHAT_MODE_RESTRICTED_TOOLS: ShuncodeDefaultTool[] = [
		ShuncodeDefaultTool.FILE_NEW,
		ShuncodeDefaultTool.FILE_EDIT,
		ShuncodeDefaultTool.NEW_RULE,
		ShuncodeDefaultTool.APPLY_PATCH,
		ShuncodeDefaultTool.EDIT_NOTEBOOK,
		ShuncodeDefaultTool.BASH,
		ShuncodeDefaultTool.BROWSER,
		ShuncodeDefaultTool.MCP_USE,
	]

	/**
	 * Tools that are blocked in lightweight mode (weak models).
	 * These tools are too dangerous or complex for small models:
	 * - BASH: model can bypass DiffSystem via shell writes (echo > file)
	 * - FILE_EDIT: replace_in_file requires precise SEARCH/REPLACE blocks
	 * - APPLY_PATCH: unified diff format is error-prone for weak models
	 * - FILE_DELETE: destructive, weak models may delete wrong files
	 *
	 * Weak models should use DELETE_BLOCK / REPLACE_TEXT instead of FILE_EDIT,
	 * and FILE_NEW for creating new files only.
	 */
	private static readonly LIGHTWEIGHT_MODE_RESTRICTED_TOOLS: ShuncodeDefaultTool[] = [
		ShuncodeDefaultTool.BASH,
		ShuncodeDefaultTool.FILE_EDIT,
		ShuncodeDefaultTool.APPLY_PATCH,
		ShuncodeDefaultTool.FILE_DELETE,
	]

	/**
	 * Execute a tool through the coordinator if it's registered.
	 *
	 * This is the main entry point for tool execution, called by the Task class.
	 * It handles:
	 * - Checking if the tool is registered with the coordinator
	 * - Validating tool execution is allowed (not rejected, not already used, etc.)
	 * - Enforcing plan mode restrictions on file modification tools
	 * - Delegating to partial or complete block handlers
	 * - Error handling and checkpointing
	 *
	 * @param block The tool use block to execute
	 * @returns true if the tool was handled (even if execution failed), false if not registered
	 */
	private async execute(block: ToolUse): Promise<boolean> {
		// Note: MCP tool name transformation happens earlier in ToolUseHandler.getPartialToolUsesAsContent()
		// The toolUseIdMap is updated at the point of transformation in index.ts

		if (!this.coordinator.has(block.name)) {
			return false // Tool not handled by coordinator
		}

		const config = this.asToolConfig()

		try {
			// Check if user rejected a previous tool
			if (this.taskState.didRejectTool) {
				const reason = block.partial
					? "Tool was interrupted and not executed due to user rejecting a previous tool."
					: "Skipping tool due to user rejecting a previous tool."
				this.createToolRejectionMessage(block, reason)
				return true
			}

			// Check if a tool has already been used in this message (only enforced when parallel tool calling is disabled)
			if (!this.isParallelToolCallingEnabled() && this.taskState.didAlreadyUseTool) {
				this.taskState.userMessageContent.push({
					type: "text",
					text: formatResponse.toolAlreadyUsed(block.name),
				})
				return true
			}

			// Logic for ask-mode tool call restrictions (always enforced, no strict flag needed)
			const currentMode = this.stateManager.getGlobalSettingsKey("mode")
			if (
				currentMode === "ask" &&
				block.name &&
				ToolExecutor.ASK_MODE_RESTRICTED_TOOLS.includes(block.name)
			) {
				this.taskState.consecutiveMistakeCount++
				// allow-any-unicode-next-line
				const errorMessage = `Инструмент '${block.name}' недоступен в режиме Ask. Этот режим предназначен только для чтения. Переключитесь в режим Act для выполнения действий.`
				await this.removeLastPartialMessageIfExistsWithType("say", "error")
				await this.say("error", errorMessage)
				if (!block.partial) {
					this.pushToolResult(formatResponse.toolError(errorMessage), block)
				}
				return true
			}

			// Logic for chat-mode tool call restrictions (same as ask — read-only)
			if (
				currentMode === "chat" &&
				block.name &&
				ToolExecutor.CHAT_MODE_RESTRICTED_TOOLS.includes(block.name)
			) {
				this.taskState.consecutiveMistakeCount++
				// allow-any-unicode-next-line
				const errorMessage = `Инструмент '${block.name}' недоступен в режиме Чат. Этот режим предназначен для общения. Переключитесь в режим Act для выполнения действий.`
				await this.removeLastPartialMessageIfExistsWithType("say", "error")
				await this.say("error", errorMessage)
				if (!block.partial) {
					this.pushToolResult(formatResponse.toolError(errorMessage), block)
				}
				return true
			}

			// Logic for lightweight-mode tool call restrictions (safety net for weak models)
			if (
				this.stateManager.getGlobalSettingsKey("lightweightMode") &&
				block.name &&
				ToolExecutor.LIGHTWEIGHT_MODE_RESTRICTED_TOOLS.includes(block.name)
			) {
				this.taskState.consecutiveMistakeCount++
				const errorMessage = `Tool '${block.name}' is not available in lightweight mode. Use delete_block, replace_text for edits, and write_to_file for new files.`
				await this.removeLastPartialMessageIfExistsWithType("say", "error")
				await this.say("error", errorMessage)
				if (!block.partial) {
					this.pushToolResult(formatResponse.toolError(errorMessage), block)
				}
				return true
			}

			// Logic for plan-mode tool call restrictions
			if (
				this.stateManager.getGlobalSettingsKey("strictPlanModeEnabled") &&
				currentMode === "plan" &&
				block.name &&
				this.isPlanModeToolRestricted(block.name)
			) {
				const errorMessage = `Tool '${block.name}' is not available in PLAN MODE. This tool is restricted to ACT MODE for file modifications. Only use tools available for PLAN MODE when in that mode.`
				await this.removeLastPartialMessageIfExistsWithType("say", "error")
				await this.say("error", errorMessage)
				// Only push the final error message when the streaming is done.
				if (!block.partial) {
					this.pushToolResult(formatResponse.toolError(errorMessage), block)
				}
				return true
			}

			// Close browser for non-browser tools
			if (block.name !== "browser_action") {
				await this.browserSession.closeBrowser()
			}

			// Handle partial blocks
			if (block.partial) {
				await this.handlePartialBlock(block, config)
				return true
			}

			// Handle complete blocks
			await this.handleCompleteBlock(block, config)

			// Session budget & anti-loop tracking for weak/medium models
			this.trackToolCallForSessionBudget(block)

			return true
		} catch (error) {
			await this.handleError(`executing ${block.name}`, error as Error, block)
			return true
		}
	}

	private getProviderInfo(): ApiProviderInfo {
		const model = this.api.getModel()
		const apiConfig = this.stateManager.getApiConfiguration()
		const mode = this.stateManager.getGlobalSettingsKey("mode")
		const providerId = (getApiSettingsMode(mode) === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
		return { model, providerId, mode }
	}

	/**
	 * Tracks tool calls for session budget and anti-loop detection.
	 * For weak/medium models, injects warnings when approaching limits
	 * or when stuck in exploration loops.
	 */
	private trackToolCallForSessionBudget(block: ToolUse): void {
		const providerInfo = this.getProviderInfo()
		const modelId = providerInfo.model.id
		const tier = getModelCapabilityTier(modelId, providerInfo)

		if (tier === "strong") {
			return
		}

		const limits = getSessionLimitsForModel(modelId, providerInfo)

		this.taskState.turnToolCallCount++

		// Anti-loop: track consecutive exploration-only tools
		if (block.name && EXPLORATION_ONLY_TOOLS.includes(block.name)) {
			this.taskState.consecutiveReadOnlyToolCalls++
		} else {
			this.taskState.consecutiveReadOnlyToolCalls = 0
		}

		// Inject anti-loop nudge when too many read-only tools in a row
		if (this.taskState.consecutiveReadOnlyToolCalls >= limits.maxConsecutiveReadOnlyTools) {
			this.taskState.userMessageContent.push({
				type: "text",
				text: `[SESSION GUARD] You have used ${this.taskState.consecutiveReadOnlyToolCalls} exploration tools in a row without making any changes. Stop investigating and take action: either edit a file, run a command, or call attempt_completion. If you are stuck, call ask_followup_question.`,
			})
			this.taskState.consecutiveReadOnlyToolCalls = 0
		}

		// Session budget warning at 80% of limit
		const budgetWarningThreshold = Math.floor(limits.maxToolCallsPerTurn * 0.8)
		if (this.taskState.turnToolCallCount === budgetWarningThreshold) {
			const remaining = limits.maxToolCallsPerTurn - this.taskState.turnToolCallCount
			this.taskState.userMessageContent.push({
				type: "text",
				text: `[SESSION BUDGET] Warning: You have ${remaining} tool calls remaining in this session. Wrap up your current task and call attempt_completion soon.`,
			})
		}

		// Hard limit: force completion
		if (this.taskState.turnToolCallCount >= limits.maxToolCallsPerTurn) {
			this.taskState.sessionBudgetExhausted = true
			this.taskState.userMessageContent.push({
				type: "text",
				text: `[SESSION BUDGET EXHAUSTED] You have reached the maximum number of tool calls (${limits.maxToolCallsPerTurn}) for this session. You MUST call attempt_completion now with whatever progress you have made. Do NOT call any other tool.`,
			})
		}
	}

	/**
	 * Check if a tool is restricted in plan mode.
	 *
	 * In strict plan mode, file modification tools (write_to_file, editedExistingFile, etc.)
	 * are blocked. The AI must switch to Act mode to use these tools.
	 *
	 * @param toolName The name of the tool to check
	 * @returns true if the tool is restricted in plan mode, false otherwise
	 */
	private isPlanModeToolRestricted(toolName: ShuncodeDefaultTool): boolean {
		return ToolExecutor.PLAN_MODE_RESTRICTED_TOOLS.includes(toolName)
	}

	/**
	 * Create a tool rejection message and add it to user message content.
	 *
	 * Used when a tool cannot be executed (e.g., user rejected a previous tool,
	 * tool was interrupted, etc.). Adds a text message to the conversation explaining
	 * why the tool was not executed.
	 *
	 * @param block The tool use block that was rejected
	 * @param reason Human-readable explanation of why the tool was rejected
	 */
	private createToolRejectionMessage(block: ToolUse, reason: string): void {
		this.taskState.userMessageContent.push({
			type: "text",
			text: `${reason} ${ToolDisplayUtils.getToolDescription(block, this.coordinator)}`,
		})
	}

	/**
	 * Adds hook context modification to the conversation if provided.
	 * Parses the context to extract type prefix and formats as XML.
	 *
	 * @param contextModification The context string from the hook output
	 * @param source The hook source name ("PreToolUse" or "PostToolUse")
	 */
	private addHookContextToConversation(contextModification: string | undefined, source: string): void {
		if (!contextModification) {
			return
		}

		const contextText = contextModification.trim()
		if (!contextText) {
			return
		}

		// Extract context type from first line if specified (e.g., "WORKSPACE_RULES: ...")
		const lines = contextText.split("\n")
		const firstLine = lines[0]
		let contextType = "general"
		let content = contextText

		// Check if first line specifies a type: "TYPE: content"
		const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
		const typeMatch = typeMatchRegex.exec(firstLine)
		if (typeMatch) {
			contextType = typeMatch[1].toLowerCase()
			const remainingLines = lines.slice(1).filter((l: string) => l.trim())
			content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
		}

		const hookContextBlock = {
			type: "text" as const,
			text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
		}

		this.taskState.userMessageContent.push(hookContextBlock)
	}

	/**
	 * Runs the PostToolUse hook after tool execution.
	 * This is extracted from handleCompleteBlock to eliminate code duplication
	 * between success and error paths.
	 *
	 * @param block The tool use block that was executed
	 * @param toolResult The result from the tool execution
	 * @param executionSuccess Whether the tool executed successfully
	 * @param executionStartTime The timestamp when tool execution started
	 * @returns true if hook requested cancellation, false otherwise
	 */
	private async runPostToolUseHook(
		block: ToolUse,
		toolResult: any,
		executionSuccess: boolean,
		executionStartTime: number,
	): Promise<boolean> {
		const { executeHook } = await import("../hooks/hook-executor")

		const executionTimeMs = Date.now() - executionStartTime

		const postToolResult = await executeHook({
			hookName: "PostToolUse",
			hookInput: {
				postToolUse: {
					toolName: block.name,
					parameters: block.params,
					result: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
					success: executionSuccess,
					executionTimeMs,
				},
			},
			isCancellable: true,
			say: this.say,
			setActiveHookExecution: this.setActiveHookExecution,
			clearActiveHookExecution: this.clearActiveHookExecution,
			messageStateHandler: this.messageStateHandler,
			taskId: this.taskId,
			hooksEnabled: true, // Already checked by caller
			toolName: block.name,
		})

		// Handle cancellation request
		if (postToolResult.cancel === true) {
			const errorMessage = postToolResult.errorMessage || "Hook requested task cancellation"
			await this.say("error", errorMessage)
			return true
		}

		// Add context modification to the conversation if provided
		if (postToolResult.contextModification) {
			this.addHookContextToConversation(postToolResult.contextModification, "PostToolUse")
		}

		return false
	}

	/**
	 * Handle partial block streaming UI updates.
	 *
	 * During streaming API responses, the AI sends partial tool use blocks as they're
	 * generated. This method updates the UI to show the tool being constructed in real-time.
	 *
	 * NOTE: This is ONLY for UI updates. No tool results are pushed to the conversation
	 * during partial block handling. The complete block handler will add the final result.
	 *
	 * @param block The partial tool use block with incomplete parameters
	 * @param config The task configuration containing all necessary context
	 */
	private async handlePartialBlock(block: ToolUse, config: TaskConfig): Promise<void> {
		// NOTE: We don't push tool results in partial blocks because this is only for UI streaming.
		// The ToolExecutor will handle pushToolResult() when the complete block is processed.
		// This maintains separation of concerns: partial = UI updates, complete = final state changes.
		const handler = this.coordinator.getHandler(block.name)

		// Check if handler supports partial blocks with proper typing
		if (handler && "handlePartialBlock" in handler) {
			const uiHelpers = createUIHelpers(config)
			const partialHandler = handler as IPartialBlockHandler
			await partialHandler.handlePartialBlock(block, uiHelpers)
		}
	}

	/**
	 * Handle complete block execution.
	 *
	 * This is the main execution flow for a tool:
	 * 1. Execute the actual tool (tool handlers now run PreToolUse hooks post-approval)
	 * 2. Run PostToolUse hooks (if enabled) - cannot block, only observe
	 * 3. Add hook context modifications to the conversation
	 * 4. Update focus chain tracking
	 *
	 * Note: PreToolUse hooks are now executed by individual tool handlers after approval
	 * and before the actual tool operation. This provides better UX as approval dialogs
	 * appear immediately without hook execution delay.
	 *
	 * PostToolUse hooks are for observation/logging only and cannot block.
	 *
	 * @param block The complete tool use block with all parameters
	 * @param config The task configuration containing all necessary context
	 */
	private async handleCompleteBlock(block: ToolUse, config: any): Promise<void> {
		// Check abort flag at the very start to prevent execution after cancellation
		if (this.taskState.abort) {
			return
		}

		const hooksEnabled = getHooksEnabledSafe()

		// Track if we need to cancel after hooks complete
		let shouldCancelAfterHook = false

		let executionSuccess = true
		let toolResult: any = null
		let toolWasExecuted = false
		const executionStartTime = Date.now()

		try {
			// Final abort check immediately before tool execution
			if (this.taskState.abort) {
				return
			}

			// Execute the actual tool
			toolResult = await this.coordinator.execute(config, block)
			toolWasExecuted = true
			this.pushToolResult(toolResult, block)

			// Track the last executed tool for consecutive call detection (used by act_mode_respond)
			this.taskState.lastToolName = block.name

			// Check abort before running PostToolUse hook (success path)
			if (this.taskState.abort) {
				return
			}

			// Run PostToolUse hook for successful tool execution
			// Skip for attempt_completion since it marks task completion, not actual work
			if (hooksEnabled && block.name !== "attempt_completion") {
				const hookRequestedCancel = await this.runPostToolUseHook(block, toolResult, executionSuccess, executionStartTime)
				if (hookRequestedCancel) {
					await config.callbacks.cancelTask()
					shouldCancelAfterHook = true
				}
			}
		} catch (error) {
			executionSuccess = false
			toolResult = formatResponse.toolError(`Tool execution failed: ${error}`)

			// Check abort before running PostToolUse hook (error path)
			if (this.taskState.abort) {
				throw error
			}

			// Run PostToolUse hook for failed tool execution
			// Skip for attempt_completion since it marks task completion, not actual work
			if (toolWasExecuted && hooksEnabled && block.name !== "attempt_completion") {
				const hookRequestedCancel = await this.runPostToolUseHook(block, toolResult, executionSuccess, executionStartTime)
				if (hookRequestedCancel) {
					await config.callbacks.cancelTask()
					shouldCancelAfterHook = true
				}
			}

			// Re-throw the error after PostToolUse completes
			throw error
		}

		// Early return if hook requested cancellation
		if (shouldCancelAfterHook) {
			return
		}

		// Handle focus chain updates
		if (!block.partial && this.stateManager.getGlobalSettingsKey("focusChainSettings").enabled) {
			await this.updateFCListFromToolResponse(block.params.task_progress)
		}
	}
}
