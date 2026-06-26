import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import * as vscode from "vscode"
import { ApiHandler, ApiProviderInfo, buildApiHandler } from "@core/api"
import { ApiStream } from "@core/api/transform/stream"
import { AssistantMessageContent, parseAssistantMessageV2, ToolUse } from "@core/assistant-message"
import { ContextManager } from "@core/context/context-management/ContextManager"
import { checkContextWindowExceededError } from "@core/context/context-management/context-error-handling"
import { EnvironmentContextTracker } from "@core/context/context-tracking/EnvironmentContextTracker"
import { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import { ModelContextTracker } from "@core/context/context-tracking/ModelContextTracker"
import {
	getGlobalShuncodeRules,
	getLocalShuncodeRules,
	refreshShuncodeRulesToggles,
} from "@core/context/instructions/user-instructions/shuncode-rules"
import {
	getLocalAgentsRules,
	getLocalCursorRules,
	getLocalWindsurfRules,
	refreshExternalRulesToggles,
} from "@core/context/instructions/user-instructions/external-rules"
import { sendPartialMessageEvent } from "@core/controller/ui/subscribeToPartialMessage"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import { executePreCompactHookWithCleanup, HookCancellationError, HookExecution } from "@core/hooks/precompact-executor"
import { ShuncodeIgnoreController } from "@core/ignore/ShuncodeIgnoreController"
import { parseMentions } from "@core/mentions"
import { CommandPermissionController } from "@core/permissions"
import { summarizeTask } from "@core/prompts/contextManagement"
import { formatResponse } from "@core/prompts/responses"
import { parseSlashCommands } from "@core/slash-commands"
import {
	ensureRulesDirectoryExists,
	ensureTaskDirectoryExists,
	GlobalFileNames,
	getSavedApiConversationHistory,
	getSavedShuncodeMessages,
	getTaskEvaluation,
} from "@core/storage/disk"
import { releaseTaskLock } from "@core/task/TaskLockUtils"
import { isMultiRootEnabled } from "@core/workspace/multi-root-utils"
import { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
// [SHUNCODE] TEMPORARILY DISABLED — legacy Cline shadow-git checkpoint imports
// import { buildCheckpointManager, shouldUseMultiRoot } from "@integrations/checkpoints/factory"
// import { ensureCheckpointInitialized } from "@integrations/checkpoints/initializer"
// import { ICheckpointManager } from "@integrations/checkpoints/types"
import { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import { getDiffSystem } from "@core/diff-v2"
import { formatContentBlockToMarkdown } from "@integrations/misc/export-markdown"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { ITerminalManager } from "@integrations/terminal/types"
import { BrowserSession } from "@services/browser/BrowserSession"
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { featureFlagsService } from "@services/feature-flags"
import { AuthService } from "@services/auth/AuthService"
import { listFiles } from "@services/glob/list-files"
import { McpHub } from "@services/mcp/McpHub"
import { ApiConfiguration } from "@shared/api"
import { findLast, findLastIndex } from "@shared/array"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import { ShuncodeApiReqCancelReason, ShuncodeApiReqInfo, ShuncodeAsk, ShuncodeMessage, ShuncodeSay } from "@shared/ExtensionMessage"
import { HistoryItem } from "@shared/HistoryItem"
import { getLanguageKey, LanguageDisplay } from "@shared/Languages"
import { USER_CONTENT_TAGS } from "@shared/messages/constants"
import { convertShuncodeMessageToProto } from "@shared/proto-conversions/shuncode-message"
import { ShuncodeDefaultTool, READ_ONLY_TOOLS } from "@shared/tools"
import { ShuncodeAskResponse } from "@shared/WebviewMessage"
import { getApiSettingsMode, isReadOnlyMode } from "@shared/storage/types"
import { isClaude4PlusModelFamily, isGPT5ModelFamily, isLocalModel, isNextGenModelFamily, getModelCapabilityTier, getSessionLimitsForModel } from "@utils/model-utils"
import cloneDeep from "clone-deep"
import Mutex from "p-mutex"
import pWaitFor from "p-wait-for"
import { ApprovalGate } from "@core/session/ApprovalGate"
import type { Session } from "@core/session/Session"
import * as path from "path"
import osName from "os-name"
import { machineId } from "node-machine-id"
import { ulid } from "ulid"
import type { SystemPromptContext } from "@/core/prompts/system-prompt"
import { getSystemPrompt } from "@/core/prompts/system-prompt"
import { HostProvider } from "@/hosts/host-provider"
import { normalizeToolCustomizationSettings } from "@shared/ToolCustomizationSettings"
import { getActiveCustomSystemPromptTemplate } from "@shared/SystemPromptSettings"
import { FileEditProvider } from "@/integrations/editor/FileEditProvider"
import {
	CommandExecutor,
	CommandExecutorCallbacks,
	FullCommandExecutorConfig,
	StandaloneTerminalManager,
} from "@/integrations/terminal"
import { ShuncodeError, ShuncodeErrorType, ErrorService } from "@/services/error"
import { telemetryService } from "@/services/telemetry"
import {
	ShuncodeAssistantContent,
	ShuncodeContent,
	ShuncodeImageContentBlock,
	ShuncodeMessageModelInfo,
	ShuncodeStorageMessage,
	ShuncodeTextContentBlock,
	ShuncodeToolResponseContent,
	ShuncodeUserContent,
} from "@/shared/messages"
import { ShowMessageType } from "@/shared/proto/index.host"
import { Logger } from "@/shared/services/Logger"
import { isShuncodeCliInstalled, isCliSubagentContext } from "@/utils/cli-detector"
import { getGitStatusCompact } from "@/utils/git"
import { RuleContextBuilder } from "../context/instructions/user-instructions/RuleContextBuilder"
import { ensureLocalShuncodeDirExists } from "../context/instructions/user-instructions/rule-helpers"
import { discoverSkills, getAvailableSkills } from "../context/instructions/user-instructions/skills"
import { refreshWorkflowToggles } from "../context/instructions/user-instructions/workflows"
import { Controller } from "../controller"
import { executeHook } from "../hooks/hook-executor"
import { StateManager } from "../storage/StateManager"
import { FocusChainManager } from "./focus-chain"
import { MessageStateHandler } from "./message-state"
import { StreamResponseHandler } from "./StreamResponseHandler"
import { TaskState } from "./TaskState"
import { ToolExecutor } from "./ToolExecutor"
import { buildEnvironmentDetails } from "./environmentDetails"
import { extractProviderDomainFromUrl, updateApiReqMsg } from "./utils"
import { buildUserFeedbackContent } from "./utils/buildUserFeedbackContent"

export type ToolResponse = ShuncodeToolResponseContent

type TaskParams = {
	controller: Controller
	mcpHub: McpHub
	updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	postStateToWebview: () => Promise<void>
	reinitExistingTaskFromId: (taskId: string) => Promise<void>
	cancelTask: () => Promise<void>
	shellIntegrationTimeout: number
	terminalReuseEnabled: boolean
	terminalOutputLineLimit: number
	subagentTerminalOutputLineLimit: number
	defaultTerminalProfile: string
	vscodeTerminalExecutionMode: "vscodeTerminal" | "backgroundExec"
	cwd: string
	stateManager: StateManager
	workspaceManager?: WorkspaceRootManager
	task?: string
	images?: string[]
	files?: string[]
	historyItem?: HistoryItem
	taskId: string
	taskLockAcquired: boolean
}

export class Task {
	// Core task variables
	readonly taskId: string
	readonly ulid: string
	private taskIsFavorited?: boolean
	private cwd: string
	private taskInitializationStartTime: number

	taskState: TaskState

	/**
	 * ApprovalGate - Promise-based замена pWaitFor для ask/response.
	 * Каждый ask() создаёт Promise через approvalGate.waitForResponse(),
	 * handleWebviewAskResponse() резолвит через approvalGate.handleResponse().
	 */
	readonly approvalGate = new ApprovalGate()

	/**
	 * Обратная ссылка на Session (устанавливается из controller).
	 * Через неё Task обновляет Pipeline stage при смене стадий.
	 */
	private _session: Session | null = null

	get session(): Session | null {
		return this._session
	}

	setSession(session: Session | null): void {
		this._session = session
	}

	// ONE mutex for ALL state modifications to prevent race conditions
	private stateMutex = new Mutex()

	/**
	 * Execute function with exclusive lock on all task state
	 * Use this for ANY state modification to prevent races
	 */
	private async withStateLock<T>(fn: () => T | Promise<T>): Promise<T> {
		return await this.stateMutex.withLock(fn)
	}

	/**
	 * Atomically set active hook execution with mutex protection
	 * Prevents TOCTOU races when setting hook execution state
	 * PUBLIC: Exposed for ToolExecutor to use
	 */
	public async setActiveHookExecution(hookExecution: NonNullable<typeof this.taskState.activeHookExecution>): Promise<void> {
		await this.withStateLock(() => {
			this.taskState.activeHookExecution = hookExecution
		})
	}

	/**
	 * Atomically clear active hook execution with mutex protection
	 * Prevents TOCTOU races when clearing hook execution state
	 * PUBLIC: Exposed for ToolExecutor to use
	 */
	public async clearActiveHookExecution(): Promise<void> {
		await this.withStateLock(() => {
			this.taskState.activeHookExecution = undefined
		})
	}

	/**
	 * Atomically read active hook execution state with mutex protection
	 * Returns a snapshot of the current state to prevent TOCTOU races
	 * PUBLIC: Exposed for ToolExecutor to use
	 */
	public async getActiveHookExecution(): Promise<typeof this.taskState.activeHookExecution> {
		return await this.withStateLock(() => {
			return this.taskState.activeHookExecution
		})
	}

	// Core dependencies
	private controller: Controller
	private mcpHub: McpHub

	// Service handlers
	api: ApiHandler
	terminalManager: ITerminalManager
	private urlContentFetcher: UrlContentFetcher
	browserSession: BrowserSession
	contextManager: ContextManager
	private diffViewProvider: DiffViewProvider
	// [SHUNCODE] TEMPORARILY DISABLED — legacy Cline shadow-git checkpoint system
	// public checkpointManager?: ICheckpointManager
	// private initialCheckpointCommitPromise?: Promise<string | undefined>
	private shuncodeIgnoreController: ShuncodeIgnoreController
	private commandPermissionController: CommandPermissionController
	private toolExecutor: ToolExecutor
	/**
	 * Whether the task is using native tool calls.
	 * This is used to determine how we would format response.
	 * Example: We don't add noToolsUsed response when native tool call is used
	 * because of the expected format from the tool calls is different.
	 */
	private useNativeToolCalls: boolean = false
	private streamHandler: StreamResponseHandler

	private terminalExecutionMode: "vscodeTerminal" | "backgroundExec"

	// Metadata tracking
	private fileContextTracker: FileContextTracker
	private modelContextTracker: ModelContextTracker
	private environmentContextTracker: EnvironmentContextTracker

	// Focus Chain
	private FocusChainManager?: FocusChainManager

	// Callbacks
	private updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	private postStateToWebview: () => Promise<void>
	private reinitExistingTaskFromId: (taskId: string) => Promise<void>
	private cancelTask: () => Promise<void>

	// Cache service
	private stateManager: StateManager

	// Message and conversation state
	messageStateHandler: MessageStateHandler

	// Workspace manager
	workspaceManager?: WorkspaceRootManager

	// Task Locking (Sqlite)
	private taskLockAcquired: boolean

	// Command executor for running shell commands (extracted from executeCommandTool)
	private commandExecutor!: CommandExecutor

	constructor(params: TaskParams) {
		const {
			controller,
			mcpHub,
			updateTaskHistory,
			postStateToWebview,
			reinitExistingTaskFromId,
			cancelTask,
			shellIntegrationTimeout,
			terminalReuseEnabled,
			terminalOutputLineLimit,
			subagentTerminalOutputLineLimit,
			defaultTerminalProfile,
			vscodeTerminalExecutionMode,
			cwd,
			stateManager,
			workspaceManager,
			task,
			images,
			files,
			historyItem,
			taskId,
			taskLockAcquired,
		} = params

		this.taskInitializationStartTime = performance.now()
		this.taskState = new TaskState()
		this.controller = controller
		this.mcpHub = mcpHub
		this.updateTaskHistory = updateTaskHistory
		this.postStateToWebview = postStateToWebview
		this.reinitExistingTaskFromId = reinitExistingTaskFromId
		this.cancelTask = cancelTask
		this.shuncodeIgnoreController = new ShuncodeIgnoreController(cwd)
		this.commandPermissionController = new CommandPermissionController()
		this.taskLockAcquired = taskLockAcquired
		// Determine terminal execution mode and create appropriate terminal manager
		this.terminalExecutionMode = vscodeTerminalExecutionMode || "vscodeTerminal"

		// When backgroundExec mode is selected, use StandaloneTerminalManager for hidden execution
		// Otherwise, use the HostProvider's terminal manager (VSCode terminal in VSCode, standalone in CLI)
		if (this.terminalExecutionMode === "backgroundExec") {
			// Import StandaloneTerminalManager for background execution
			this.terminalManager = new StandaloneTerminalManager()
			Logger.info(`[Task ${taskId}] Using StandaloneTerminalManager for backgroundExec mode`)
		} else {
			// Use the host-provided terminal manager (VSCode terminal in VSCode environment)
			this.terminalManager = HostProvider.get().createTerminalManager()
			Logger.info(`[Task ${taskId}] Using HostProvider terminal manager for vscodeTerminal mode`)
		}
		this.terminalManager.setShellIntegrationTimeout(shellIntegrationTimeout)
		this.terminalManager.setTerminalReuseEnabled(terminalReuseEnabled ?? true)
		this.terminalManager.setTerminalOutputLineLimit(terminalOutputLineLimit)
		this.terminalManager.setSubagentTerminalOutputLineLimit(subagentTerminalOutputLineLimit)
		this.terminalManager.setDefaultTerminalProfile(defaultTerminalProfile)

		this.urlContentFetcher = new UrlContentFetcher(controller.context)
		this.browserSession = new BrowserSession(stateManager)
		this.contextManager = new ContextManager()
		this.streamHandler = new StreamResponseHandler()
		this.cwd = cwd
		this.stateManager = stateManager
		this.workspaceManager = workspaceManager

		// DiffViewProvider opens Diff Editor during edits while FileEditProvider performs
		// edits in the background without stealing user's editor's focus.
		const backgroundEditEnabled = this.stateManager.getGlobalSettingsKey("backgroundEditEnabled")
		this.diffViewProvider = backgroundEditEnabled ? new FileEditProvider() : HostProvider.get().createDiffViewProvider()

		// Set up MCP notification callback for real-time notifications
		this.mcpHub.setNotificationCallback(async (serverName: string, _level: string, message: string) => {
			// Display notification in chat immediately
			await this.say("mcp_notification", `[${serverName}] ${message}`)
		})

		this.taskId = taskId

		// Initialize taskId first
		if (historyItem) {
			this.ulid = historyItem.ulid ?? ulid()
			this.taskIsFavorited = historyItem.isFavorited
			this.taskState.conversationHistoryDeletedRange = historyItem.conversationHistoryDeletedRange
			if (historyItem.checkpointManagerErrorMessage) {
				this.taskState.checkpointManagerErrorMessage = historyItem.checkpointManagerErrorMessage
			}
		} else if (task || images || files) {
			this.ulid = ulid()
		} else {
			throw new Error("Either historyItem or task/images must be provided")
		}

		this.messageStateHandler = new MessageStateHandler({
			taskId: this.taskId,
			ulid: this.ulid,
			taskState: this.taskState,
			taskIsFavorited: this.taskIsFavorited,
			updateTaskHistory: this.updateTaskHistory,
		})
		this.taskState.evaluationTracker.start({ taskId: this.taskId, ulid: this.ulid })
		this.taskState.evaluationTracker.hydrate(historyItem?.evaluation)

		// Initialize context trackers
		this.fileContextTracker = new FileContextTracker(controller, this.taskId)
		this.modelContextTracker = new ModelContextTracker(this.taskId)
		this.environmentContextTracker = new EnvironmentContextTracker(this.taskId)

		// Initialize focus chain manager only if enabled
		const focusChainSettings = this.stateManager.getGlobalSettingsKey("focusChainSettings")
		if (focusChainSettings.enabled) {
			this.FocusChainManager = new FocusChainManager({
				taskId: this.taskId,
				taskState: this.taskState,
				mode: this.stateManager.getGlobalSettingsKey("mode"),
				stateManager: this.stateManager,
				postStateToWebview: this.postStateToWebview,
				say: this.say.bind(this),
				focusChainSettings: focusChainSettings,
			})
		}

		// [SHUNCODE] TEMPORARILY DISABLED — legacy Cline shadow-git checkpoint system.
		// Replaced by DiffSystem V2 (core/diff-v2). Will be removed after validation.
		// See: docs/architecture/CORE.md for details.
		// --- BEGIN DISABLED BLOCK ---
		// const isMultiRootWorkspace = this.workspaceManager && this.workspaceManager.getRoots().length > 1
		// const checkpointsEnabled = this.stateManager.getGlobalSettingsKey("enableCheckpointsSetting")
		// if (isMultiRootWorkspace && checkpointsEnabled) {
		// 	this.taskState.checkpointManagerErrorMessage = "Checkpoints are not currently supported in multi-root workspaces."
		// }
		// if (!isMultiRootWorkspace) {
		// 	try {
		// 		this.checkpointManager = buildCheckpointManager({ ... })
		// 	} catch (error) { ... }
		// }
		// --- END DISABLED BLOCK ---

		// Prepare effective API configuration
		const apiConfiguration = this.stateManager.getApiConfiguration()
		const effectiveApiConfiguration: ApiConfiguration = {
			...apiConfiguration,
			ulid: this.ulid,
			onRetryAttempt: async (attempt: number, maxRetries: number, delay: number, error: any) => {
				const shuncodeMessages = this.messageStateHandler.getShuncodeMessages()
				const lastApiReqStartedIndex = findLastIndex(shuncodeMessages, (m) => m.say === "api_req_started")
				if (lastApiReqStartedIndex !== -1) {
					try {
						const currentApiReqInfo: ShuncodeApiReqInfo = JSON.parse(shuncodeMessages[lastApiReqStartedIndex].text || "{}")
						currentApiReqInfo.retryStatus = {
							attempt: attempt, // attempt is already 1-indexed from retry.ts
							maxAttempts: maxRetries, // total attempts
							delaySec: Math.round(delay / 1000),
							errorSnippet: error?.message ? `${String(error.message).substring(0, 50)}...` : undefined,
						}
						// Clear previous cancelReason and streamingFailedMessage if we are retrying
						delete currentApiReqInfo.cancelReason
						delete currentApiReqInfo.streamingFailedMessage
						await this.messageStateHandler.updateShuncodeMessage(lastApiReqStartedIndex, {
							text: JSON.stringify(currentApiReqInfo),
						})

						// Post the updated state to the webview so the UI reflects the retry attempt
						await this.postStateToWebview().catch((e) =>
							Logger.error("Error posting state to webview in onRetryAttempt:", e),
						)
					} catch (e) {
						Logger.error(`[Task ${this.taskId}] Error updating api_req_started with retryStatus:`, e)
					}
				}
			},
		}
		const mode = this.stateManager.getGlobalSettingsKey("mode")
		const apiMode = getApiSettingsMode(mode)
		const currentProvider = apiMode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider

		const openaiReasoningEffort = this.stateManager.getGlobalSettingsKey("openaiReasoningEffort")
		if (currentProvider === "openai" || currentProvider === "openai-native" || currentProvider === "sapaicore") {
			if (apiMode === "plan") {
				effectiveApiConfiguration.planModeReasoningEffort = openaiReasoningEffort
			} else {
				effectiveApiConfiguration.actModeReasoningEffort = openaiReasoningEffort
			}
		}

		// Now that ulid is initialized, we can build the API handler
		this.api = buildApiHandler(effectiveApiConfiguration, mode)

		// Set ulid on browserSession for telemetry tracking
		this.browserSession.setUlid(this.ulid)

		// Note: Task initialization (startTask/resumeTaskFromHistory) is now called
		// from Controller.initTask() AFTER the task instance is fully assigned.
		// This prevents race conditions where hooks run before controller.task is ready.

		// Set up focus chain file watcher (async, runs in background) only if focus chain is enabled
		if (this.FocusChainManager) {
			this.FocusChainManager.setupFocusChainFileWatcher().catch((error) => {
				Logger.error(`[Task ${this.taskId}] Failed to setup focus chain file watcher:`, error)
			})
		}

		// initialize telemetry

		// Extract domain of the provider endpoint if using OpenAI Compatible provider
		let openAiCompatibleDomain: string | undefined
		if (currentProvider === "openai" && apiConfiguration.openAiBaseUrl) {
			openAiCompatibleDomain = extractProviderDomainFromUrl(apiConfiguration.openAiBaseUrl)
		}

		if (historyItem) {
			// Open task from history
			telemetryService.captureTaskRestarted(this.ulid, currentProvider, openAiCompatibleDomain)
		} else {
			// New task started
			telemetryService.captureTaskCreated(this.ulid, currentProvider, openAiCompatibleDomain)
		}

		// Initialize command executor with config and callbacks
		const commandExecutorConfig: FullCommandExecutorConfig = {
			cwd: this.cwd,
			terminalExecutionMode: this.terminalExecutionMode,
			terminalManager: this.terminalManager,
			taskId: this.taskId,
			ulid: this.ulid,
		}

		const commandExecutorCallbacks: CommandExecutorCallbacks = {
			say: this.say.bind(this) as CommandExecutorCallbacks["say"],
			ask: async (type: string, text?: string, partial?: boolean) => {
				const result = await this.ask(type as ShuncodeAsk, text, partial)
				return {
					response: result.response,
					text: result.text,
					images: result.images,
					files: result.files,
				}
			},
			updateBackgroundCommandState: (isRunning: boolean) =>
				this.controller.updateBackgroundCommandState(isRunning, this.taskId),
			updateShuncodeMessage: async (index: number, updates: { commandCompleted?: boolean; text?: string }) => {
				await this.messageStateHandler.updateShuncodeMessage(index, updates)
			},
			getShuncodeMessages: () => this.messageStateHandler.getShuncodeMessages() as Array<{ ask?: string; say?: string }>,
			addToUserMessageContent: (content: { type: string; text: string }) => {
				// Cast to ShuncodeTextContentBlock which is compatible with ShuncodeContent
				this.taskState.userMessageContent.push({ type: "text", text: content.text } as ShuncodeTextContentBlock)
			},
		}

		this.commandExecutor = new CommandExecutor(commandExecutorConfig, commandExecutorCallbacks)

		// Configure interactive responder for auto-responding to terminal Y/N prompts
		const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")
		const autoRespondEnabled = autoApprovalSettings.actions.autoRespondToPrompts ?? false
		if (autoRespondEnabled) {
			this.commandExecutor.setInteractiveResponderConfig({
				enabled: true,
				respondToDestructivePrompts: autoApprovalSettings.actions.executeAllCommands ?? false,
			})
		}

		this.toolExecutor = new ToolExecutor(
			this.controller.context,
			this.taskState,
			this.messageStateHandler,
			this.api,
			this.urlContentFetcher,
			this.browserSession,
			this.diffViewProvider,
			this.mcpHub,
			this.fileContextTracker,
			this.shuncodeIgnoreController,
			this.commandPermissionController,
			this.contextManager,
			this.stateManager,
			this.terminalManager,
			cwd,
			this.taskId,
			this.ulid,
			this.terminalExecutionMode,
			this.workspaceManager,
			isMultiRootEnabled(this.stateManager),
			this.say.bind(this),
			this.ask.bind(this),
			this.saveCheckpointCallback.bind(this),
			this.sayAndCreateMissingParamError.bind(this),
			this.removeLastPartialMessageIfExistsWithType.bind(this),
			this.executeCommandTool.bind(this),
			() => Promise.resolve(false), // [SHUNCODE] TEMPORARILY DISABLED — legacy Cline checkpoint doesLatestTaskCompletionHaveNewChanges
			this.FocusChainManager?.updateFCListFromToolResponse.bind(this.FocusChainManager) || (async () => { }),
			this.switchToActModeCallback.bind(this),
			this.cancelTask,
			// Atomic hook state helpers for ToolExecutor
			this.setActiveHookExecution.bind(this),
			this.clearActiveHookExecution.bind(this),
			this.getActiveHookExecution.bind(this),
			this.runUserPromptSubmitHook.bind(this),
		)
	}

	// Communicate with webview

	// partial has three valid states true (partial message), false (completion of partial message), undefined (individual complete message)
	async ask(
		type: ShuncodeAsk,
		text?: string,
		partial?: boolean,
	): Promise<{
		response: ShuncodeAskResponse
		text?: string
		images?: string[]
		files?: string[]
		askTs?: number
	}> {
		// Allow resume asks even when aborted to enable resume button after cancellation
		if (this.taskState.abort && type !== "resume_task" && type !== "resume_completed_task") {
			throw new Error("Shuncode instance aborted")
		}
		let askTs: number
		if (partial !== undefined) {
			const shuncodeMessages = this.messageStateHandler.getShuncodeMessages()
			const lastMessage = shuncodeMessages.at(-1)
			const lastMessageIndex = shuncodeMessages.length - 1

			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === "ask" && lastMessage.ask === type
			if (partial) {
				if (isUpdatingPreviousPartial) {
					// existing partial message, so update it
					await this.messageStateHandler.updateShuncodeMessage(lastMessageIndex, {
						text,
						partial,
					})
					// todo be more efficient about saving and posting only new data or one whole message at a time so ignore partial for saves, and only post parts of partial message instead of whole array in new listener
					// await this.saveShuncodeMessagesAndUpdateHistory()
					// await this.postStateToWebview()
					const protoMessage = convertShuncodeMessageToProto(lastMessage)
					await sendPartialMessageEvent(protoMessage)
					throw new Error("Current ask promise was ignored 1")
				} else {
					// this is a new partial message, so add it with partial state
					// this.askResponse = undefined
					// this.askResponseText = undefined
					// this.askResponseImages = undefined
					askTs = Date.now()
					this.taskState.lastMessageTs = askTs
					await this.messageStateHandler.addToShuncodeMessages({
						ts: askTs,
						type: "ask",
						ask: type,
						text,
						partial,
					})
					await this.postStateToWebview()
					throw new Error("Current ask promise was ignored 2")
				}
			} else {
				// partial=false means its a complete version of a previously partial message
				if (isUpdatingPreviousPartial) {
					// this is the complete version of a previously partial message

					/*
					Bug for the history books:
					In the webview we use the ts as the chatrow key for the virtuoso list. Since we would update this ts right at the end of streaming, it would cause the view to flicker. The key prop has to be stable otherwise react has trouble reconciling items between renders, causing unmounting and remounting of components (flickering).
					The lesson here is if you see flickering when rendering lists, it's likely because the key prop is not stable.
					So in this case we must make sure that the message ts is never altered after first setting it.
					*/
					askTs = lastMessage.ts
					this.taskState.lastMessageTs = askTs
					// lastMessage.ts = askTs
					await this.messageStateHandler.updateShuncodeMessage(lastMessageIndex, {
						text,
						partial: false,
					})
					// await this.postStateToWebview()
					const protoMessage = convertShuncodeMessageToProto(lastMessage)
					await sendPartialMessageEvent(protoMessage)
				} else {
					// this is a new partial=false message, so add it like normal
					askTs = Date.now()
					this.taskState.lastMessageTs = askTs
					await this.messageStateHandler.addToShuncodeMessages({
						ts: askTs,
						type: "ask",
						ask: type,
						text,
					})
					await this.postStateToWebview()
				}
			}
		} else {
			// this is a new non-partial message, so add it like normal
			askTs = Date.now()
			this.taskState.lastMessageTs = askTs
			await this.messageStateHandler.addToShuncodeMessages({
				ts: askTs,
				type: "ask",
				ask: type,
				text,
			})
			await this.postStateToWebview()
		}

		// --- APPROVAL GATE: Promise-based вместо pWaitFor поллинга ---
		// During task cancellation we reject pending approvals with "Task aborted".
		// Convert this expected cancellation into a normal "no" response to avoid
		// unhandled promise rejection noise in the extension host logs.
		try {
			const result = await this.approvalGate.waitForResponse(askTs, type)
			return result
		} catch (error) {
			if (error instanceof Error && error.message === "Task aborted") {
				return { response: "noButtonClicked" }
			}
			throw error
		}
	}

	async handleWebviewAskResponse(
		askResponse: ShuncodeAskResponse,
		text?: string,
		images?: string[],
		files?: string[],
		approvalId?: string,
	) {
		// --- APPROVAL GATE: резолвим pending Promise ---
		// approvalId позволяет маршрутизацию к конкретному pending ask.
		// Если не передан - резолвит последний pending (обратная совместимость).
		const askTs = approvalId ? Number(approvalId) : undefined
		const handled = this.approvalGate.handleResponse(askResponse, text, images, files, askTs)
		if (!handled) {
			console.warn("[Task] handleWebviewAskResponse: no pending ask found, response dropped")
		}
	}

	async say(
		type: ShuncodeSay,
		text?: string,
		images?: string[],
		files?: string[],
		partial?: boolean,
	): Promise<number | undefined> {
		// Allow hook messages even when aborted to enable proper cleanup
		if (this.taskState.abort && type !== "hook_status" && type !== "hook_output_stream") {
			throw new Error("Shuncode instance aborted")
		}

		const providerInfo = this.getCurrentProviderInfo()
		const modelInfo: ShuncodeMessageModelInfo = {
			providerId: providerInfo.providerId,
			modelId: providerInfo.model.id,
			mode: providerInfo.mode,
		}

		if (partial !== undefined) {
			const lastMessage = this.messageStateHandler.getShuncodeMessages().at(-1)
			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === "say" && lastMessage.say === type
			if (partial) {
				if (isUpdatingPreviousPartial) {
					// existing partial message, so update it
					lastMessage.text = text
					lastMessage.images = images
					lastMessage.files = files
					lastMessage.partial = partial
					const protoMessage = convertShuncodeMessageToProto(lastMessage)
					// [SHUNCODE-PERF] Fire-and-forget for partial text updates during streaming.
					// Awaiting IPC here holds the presentAssistantMessage lock, causing subsequent
					// text chunks to queue up and batch — producing choppy output instead of smooth streaming.
					// Non-text partials (e.g. reasoning) still await to preserve ordering guarantees.
					if (type === "text" || type === "completion_result") {
						void sendPartialMessageEvent(protoMessage).catch(() => { })
					} else {
						await sendPartialMessageEvent(protoMessage)
					}
					return undefined
				} else {
					// this is a new partial message, so add it with partial state
					const sayTs = Date.now()
					this.taskState.lastMessageTs = sayTs
					await this.messageStateHandler.addToShuncodeMessages({
						ts: sayTs,
						type: "say",
						say: type,
						text,
						images,
						files,
						partial,
						modelInfo,
					})
					await this.postStateToWebview()
					return sayTs
				}
			} else {
				// partial=false means its a complete version of a previously partial message
				if (isUpdatingPreviousPartial) {
					// this is the complete version of a previously partial message, so replace the partial with the complete version
					this.taskState.lastMessageTs = lastMessage.ts
					// lastMessage.ts = sayTs
					lastMessage.text = text
					lastMessage.images = images
					lastMessage.files = files // Ensure files is updated
					lastMessage.partial = false

					// instead of streaming partialMessage events, we do a save and post like normal to persist to disk
					await this.messageStateHandler.saveShuncodeMessagesAndUpdateHistory()
					// await this.postStateToWebview()
					const protoMessage = convertShuncodeMessageToProto(lastMessage)
					await sendPartialMessageEvent(protoMessage) // more performant than an entire postStateToWebview
					return undefined
				} else {
					// this is a new partial=false message, so add it like normal
					const sayTs = Date.now()
					this.taskState.lastMessageTs = sayTs
					await this.messageStateHandler.addToShuncodeMessages({
						ts: sayTs,
						type: "say",
						say: type,
						text,
						images,
						files,
						modelInfo,
					})
					await this.postStateToWebview()
					return sayTs
				}
			}
		} else {
			// this is a new non-partial message, so add it like normal
			const sayTs = Date.now()
			this.taskState.lastMessageTs = sayTs
			await this.messageStateHandler.addToShuncodeMessages({
				ts: sayTs,
				type: "say",
				say: type,
				text,
				images,
				files,
				modelInfo,
			})
			await this.postStateToWebview()
			return sayTs
		}
	}

	async sayAndCreateMissingParamError(toolName: ShuncodeDefaultTool, paramName: string, relPath?: string) {
		this.taskState.evaluationTracker.recordMissingParam(toolName, paramName)
		await this.say(
			"error",
			`Shuncode tried to use ${toolName}${relPath ? ` for '${relPath.toPosix()}'` : ""
			} without value for required parameter '${paramName}'. Retrying...`,
		)
		return formatResponse.toolError(formatResponse.missingToolParameterError(paramName))
	}

	async removeLastPartialMessageIfExistsWithType(type: "ask" | "say", askOrSay: ShuncodeAsk | ShuncodeSay) {
		const shuncodeMessages = this.messageStateHandler.getShuncodeMessages()
		const lastMessage = shuncodeMessages.at(-1)
		if (lastMessage?.partial && lastMessage.type === type && (lastMessage.ask === askOrSay || lastMessage.say === askOrSay)) {
			this.messageStateHandler.setShuncodeMessages(shuncodeMessages.slice(0, -1))
			await this.messageStateHandler.saveShuncodeMessagesAndUpdateHistory()
		}
	}

	// [SHUNCODE] TEMPORARILY DISABLED — legacy Cline shadow-git checkpoint system.
	// saveCheckpoint now no-ops since checkpointManager is never initialized.
	private async saveCheckpointCallback(_isAttemptCompletionMessage?: boolean, _completionMessageTs?: number): Promise<void> {
		// Legacy: return this.checkpointManager?.saveCheckpoint(isAttemptCompletionMessage, completionMessageTs) ?? Promise.resolve()
		return Promise.resolve()
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

	private async switchToActModeCallback(): Promise<boolean> {
		return await this.controller.toggleActModeForYoloMode()
	}

	/**
	 * Unified cancellation handler for hook-requested cancellations.
	 * Ensures state is always saved before aborting, regardless of whether
	 * the user clicked cancel or the hook returned {cancel: true}.
	 *
	 * @param hookName The name of the hook for logging
	 * @param wasCancelled Whether user clicked cancel (vs hook returning cancel: true)
	 */
	private async handleHookCancellation(hookName: string, wasCancelled: boolean): Promise<void> {
		// ALWAYS save state, regardless of cancellation source
		this.taskState.didFinishAbortingStream = true

		// Save conversation state to disk
		await this.messageStateHandler.saveShuncodeMessagesAndUpdateHistory()
		await this.messageStateHandler.overwriteApiConversationHistory(this.messageStateHandler.getApiConversationHistory())

		// Update UI
		await this.postStateToWebview()

		// Log for debugging/telemetry
		Logger.log(`[Task ${this.taskId}] ${hookName} hook cancelled (userInitiated: ${wasCancelled})`)
	}

	/**
	 * Calculate the new deleted range for PreCompact hook
	 * @param apiConversationHistory The full API conversation history
	 * @returns Tuple with start and end indices for the deleted range
	 */
	private calculatePreCompactDeletedRange(apiConversationHistory: ShuncodeStorageMessage[]): [number, number] {
		const newDeletedRange = this.contextManager.getNextTruncationRange(
			apiConversationHistory,
			this.taskState.conversationHistoryDeletedRange,
			"quarter", // Force aggressive truncation on error
		)

		return newDeletedRange || [0, 0]
	}

	private async runUserPromptSubmitHook(
		userContent: ShuncodeContent[],
		_context: "initial_task" | "resume" | "feedback",
	): Promise<{ cancel?: boolean; wasCancelled?: boolean; contextModification?: string; errorMessage?: string }> {
		const hooksEnabled = getHooksEnabledSafe()

		if (!hooksEnabled) {
			return {}
		}

		const { extractUserPromptFromContent } = await import("./utils/extractUserPromptFromContent")

		// Extract clean user prompt from content, stripping system wrappers and metadata
		const promptText = extractUserPromptFromContent(userContent)

		const userPromptResult = await executeHook({
			hookName: "UserPromptSubmit",
			hookInput: {
				userPromptSubmit: {
					prompt: promptText,
					attachments: [],
				},
			},
			isCancellable: true,
			say: this.say.bind(this),
			setActiveHookExecution: this.setActiveHookExecution.bind(this),
			clearActiveHookExecution: this.clearActiveHookExecution.bind(this),
			messageStateHandler: this.messageStateHandler,
			taskId: this.taskId,
			hooksEnabled,
		})

		// Handle cancellation from hook
		if (userPromptResult.cancel === true && userPromptResult.wasCancelled) {
			// Set flag to allow Controller.cancelTask() to proceed
			this.taskState.didFinishAbortingStream = true
			// Save BOTH files so Controller.cancelTask() can find the task
			await this.messageStateHandler.saveShuncodeMessagesAndUpdateHistory()
			await this.messageStateHandler.overwriteApiConversationHistory(this.messageStateHandler.getApiConversationHistory())
			await this.postStateToWebview()
		}

		return {
			cancel: userPromptResult.cancel,
			contextModification: userPromptResult.contextModification,
			errorMessage: userPromptResult.errorMessage,
		}
	}

	// Task lifecycle

	public async startTask(task?: string, images?: string[], files?: string[]): Promise<void> {
		try {
			await this.shuncodeIgnoreController.initialize()
		} catch (error) {
			Logger.error("Failed to initialize ShuncodeIgnoreController:", error)
			// Optionally, inform the user or handle the error appropriately
		}
		// conversationHistory (for API) and shuncodeMessages (for webview) need to be in sync
		// if the extension process were killed, then on restart the shuncodeMessages might not be empty, so we need to set it to [] when we create a new Shuncode client (otherwise webview would show stale messages from previous session)
		this.messageStateHandler.setShuncodeMessages([])
		this.messageStateHandler.setApiConversationHistory([])

		await this.postStateToWebview()

		const messageTs = await this.say("text", task, images, files)

		// Start checkpoint linked to this message for Retry/Delete functionality
		if (messageTs) {
			try {
				const diffSystem = getDiffSystem()
				await diffSystem.startCheckpoint(`Task: ${task?.substring(0, 50)}...`, messageTs)
			} catch (error) {
				Logger.error("Failed to start checkpoint:", error)
			}
		}

		this.taskState.isInitialized = true

		const imageBlocks: ShuncodeImageContentBlock[] = formatResponse.imageBlocks(images)

		const userContent: ShuncodeUserContent[] = [
			{
				type: "text",
				text: `<task>\n${task}\n</task>`,
			},
			...imageBlocks,
		]

		if (files && files.length > 0) {
			const fileContentString = await processFilesIntoText(files)
			if (fileContentString) {
				userContent.push({
					type: "text",
					text: fileContentString,
				})
			}
		}

		// Add TaskStart hook context to the conversation if provided
		const hooksEnabled = getHooksEnabledSafe()
		if (hooksEnabled) {
			const taskStartResult = await executeHook({
				hookName: "TaskStart",
				hookInput: {
					taskStart: {
						taskMetadata: {
							taskId: this.taskId,
							ulid: this.ulid,
							initialTask: task || "",
						},
					},
				},
				isCancellable: true,
				say: this.say.bind(this),
				setActiveHookExecution: this.setActiveHookExecution.bind(this),
				clearActiveHookExecution: this.clearActiveHookExecution.bind(this),
				messageStateHandler: this.messageStateHandler,
				taskId: this.taskId,
				hooksEnabled,
			})

			// Handle cancellation from hook
			if (taskStartResult.cancel === true) {
				// Always save state regardless of cancellation source
				await this.handleHookCancellation("TaskStart", taskStartResult.wasCancelled)

				// Let Controller handle the cancellation (it will call abortTask)
				await this.cancelTask()
				return
			}

			// Add context modification to the conversation if provided
			if (taskStartResult.contextModification) {
				const contextText = taskStartResult.contextModification.trim()
				if (contextText) {
					userContent.push({
						type: "text",
						text: `<hook_context source="TaskStart">\n${contextText}\n</hook_context>`,
					})
				}
			}
		}

		// Defensive check: Verify task wasn't aborted during hook execution before continuing
		// Must be OUTSIDE the hooksEnabled block to prevent UserPromptSubmit from running
		if (this.taskState.abort) {
			return
		}

		// Run UserPromptSubmit hook for initial task (after TaskStart for UI ordering)
		const userPromptHookResult = await this.runUserPromptSubmitHook(userContent, "initial_task")

		// Defensive check: Verify task wasn't aborted during hook execution (handles async cancellation)
		if (this.taskState.abort) {
			return
		}

		// Handle hook cancellation
		if (userPromptHookResult.cancel === true) {
			await this.handleHookCancellation("UserPromptSubmit", userPromptHookResult.wasCancelled ?? false)
			await this.cancelTask()
			return
		}

		// Add hook context if provided
		if (userPromptHookResult.contextModification) {
			userContent.push({
				type: "text",
				text: `<hook_context source="UserPromptSubmit">\n${userPromptHookResult.contextModification}\n</hook_context>`,
			})
		}

		// Record environment metadata for new task
		try {
			await this.environmentContextTracker.recordEnvironment()
		} catch (error) {
			Logger.error("Failed to record environment metadata:", error)
		}

		// Multi-step workflow: detect .yaml workflow and run orchestrator instead of plain loop
		const workflowDefinition = await this.detectMultiStepWorkflow(task)
		if (workflowDefinition) {
			const { WorkflowOrchestrator } = await import("@core/workflow")
			const orchestrator = new WorkflowOrchestrator(this.asWorkflowCapable(), workflowDefinition, task || "", "")
			this._session?.pipeline.start()
			await orchestrator.execute()
			this._session?.pipeline.complete()
			return
		}

		await this.initiateTaskLoop(userContent)
	}

	public async resumeTaskFromHistory() {
		try {
			await this.shuncodeIgnoreController.initialize()
		} catch (error) {
			Logger.error("Failed to initialize ShuncodeIgnoreController:", error)
			// Optionally, inform the user or handle the error appropriately
		}

		const savedShuncodeMessages = await getSavedShuncodeMessages(this.taskId)
		this.taskState.evaluationTracker.hydrate(await getTaskEvaluation(this.taskId))

		// Remove any resume messages that may have been added before

		const lastRelevantMessageIndex = findLastIndex(
			savedShuncodeMessages,
			(m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"),
		)
		if (lastRelevantMessageIndex !== -1) {
			savedShuncodeMessages.splice(lastRelevantMessageIndex + 1)
		}

		// since we don't use api_req_finished anymore, we need to check if the last api_req_started has a cost value, if it doesn't and no cancellation reason to present, then we remove it since it indicates an api request without any partial content streamed
		const lastApiReqStartedIndex = findLastIndex(savedShuncodeMessages, (m) => m.type === "say" && m.say === "api_req_started")
		if (lastApiReqStartedIndex !== -1) {
			const lastApiReqStarted = savedShuncodeMessages[lastApiReqStartedIndex]
			const { cost, cancelReason }: ShuncodeApiReqInfo = JSON.parse(lastApiReqStarted.text || "{}")
			if (cost === undefined && cancelReason === undefined) {
				savedShuncodeMessages.splice(lastApiReqStartedIndex, 1)
			}
		}

		await this.messageStateHandler.overwriteShuncodeMessages(savedShuncodeMessages)
		this.messageStateHandler.setShuncodeMessages(await getSavedShuncodeMessages(this.taskId))

		// Now present the shuncode messages to the user and ask if they want to resume (NOTE: we ran into a bug before where the apiconversationhistory wouldn't be initialized when opening a old task, and it was because we were waiting for resume)
		// This is important in case the user deletes messages without resuming the task first
		const savedApiConversationHistory = await getSavedApiConversationHistory(this.taskId)

		this.messageStateHandler.setApiConversationHistory(savedApiConversationHistory)

		// load the context history state
		await ensureTaskDirectoryExists(this.taskId)
		await this.contextManager.initializeContextHistory(await ensureTaskDirectoryExists(this.taskId))

		const lastShuncodeMessage = this.messageStateHandler
			.getShuncodeMessages()
			.slice()
			.reverse()
			.find((m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task")) // could be multiple resume tasks

		let askType: ShuncodeAsk
		if (lastShuncodeMessage?.ask === "completion_result") {
			askType = "resume_completed_task"
		} else {
			askType = "resume_task"
		}

		this.taskState.isInitialized = true
		this.taskState.abort = false // Reset abort flag when resuming task

		const { response, text, images, files } = await this.ask(askType) // calls poststatetowebview

		// Initialize newUserContent array for hook context
		const newUserContent: ShuncodeContent[] = []

		// Run TaskResume hook AFTER user clicks resume button
		const hooksEnabled = getHooksEnabledSafe()
		if (hooksEnabled) {
			const shuncodeMessages = this.messageStateHandler.getShuncodeMessages()
			const taskResumeResult = await executeHook({
				hookName: "TaskResume",
				hookInput: {
					taskResume: {
						taskMetadata: {
							taskId: this.taskId,
							ulid: this.ulid,
						},
						previousState: {
							lastMessageTs: lastShuncodeMessage?.ts?.toString() || "",
							messageCount: shuncodeMessages.length.toString(),
							conversationHistoryDeleted: (this.taskState.conversationHistoryDeletedRange !== undefined).toString(),
						},
					},
				},
				isCancellable: true,
				say: this.say.bind(this),
				setActiveHookExecution: this.setActiveHookExecution.bind(this),
				clearActiveHookExecution: this.clearActiveHookExecution.bind(this),
				messageStateHandler: this.messageStateHandler,
				taskId: this.taskId,
				hooksEnabled,
			})

			// Handle cancellation from hook
			if (taskResumeResult.cancel === true) {
				// UNIFIED: Always save state regardless of cancellation source
				await this.handleHookCancellation("TaskResume", taskResumeResult.wasCancelled)

				// Let Controller handle the cancellation (it will call abortTask)
				await this.cancelTask()
				return
			}

			// Add context if provided
			if (taskResumeResult.contextModification) {
				newUserContent.push({
					type: "text",
					text: `<hook_context source="TaskResume" type="general">\n${taskResumeResult.contextModification}\n</hook_context>`,
				})
			}
		}

		// Defensive check: Verify task wasn't aborted during hook execution before continuing
		// Must be OUTSIDE the hooksEnabled block to prevent UserPromptSubmit from running
		if (this.taskState.abort) {
			return
		}

		let responseText: string | undefined
		let responseImages: string[] | undefined
		let responseFiles: string[] | undefined
		if (response === "messageResponse" || text || (images && images.length > 0) || (files && files.length > 0)) {
			const feedbackTs = await this.say("user_feedback", text, images, files)
			// [SHUNCODE] TEMPORARILY DISABLED — legacy Cline shadow-git checkpoint
			// await this.checkpointManager?.saveCheckpoint()

			// Start a NEW checkpoint for this follow-up message.
			// This allows per-message rollback: deleting this message
			// only reverts changes made after it, not the entire task.
			console.log(`[Task] Feedback message sent, feedbackTs=${feedbackTs}, will start checkpoint`)
			if (feedbackTs) {
				try {
					const diffSystem = getDiffSystem()
					await diffSystem.startCheckpoint(`Feedback: ${text?.substring(0, 50)}...`, feedbackTs)
					console.log(`[Task] Checkpoint started for feedback ts=${feedbackTs}`)
				} catch (error) {
					Logger.error("Failed to start checkpoint for feedback:", error)
				}
			} else {
				console.warn(`[Task] feedbackTs is undefined, no checkpoint created`)
			}

			responseText = text
			responseImages = images
			responseFiles = files
		}

		// need to make sure that the api conversation history can be resumed by the api, even if it goes out of sync with shuncode messages

		// Use the already-loaded API conversation history from memory instead of reloading from disk
		// This prevents issues where the file might be empty or stale after hook execution
		const existingApiConversationHistory = this.messageStateHandler.getApiConversationHistory()

		// Remove the last user message so we can update it with the resume message
		let modifiedOldUserContent: ShuncodeContent[] // either the last message if its user message, or the user message before the last (assistant) message
		let modifiedApiConversationHistory: ShuncodeStorageMessage[] // need to remove the last user message to replace with new modified user message
		if (existingApiConversationHistory.length > 0) {
			const lastMessage = existingApiConversationHistory[existingApiConversationHistory.length - 1]
			if (lastMessage.role === "assistant") {
				modifiedApiConversationHistory = [...existingApiConversationHistory]
				modifiedOldUserContent = []
			} else if (lastMessage.role === "user") {
				const existingUserContent: ShuncodeContent[] = Array.isArray(lastMessage.content)
					? lastMessage.content
					: [{ type: "text", text: lastMessage.content }]
				modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
				modifiedOldUserContent = [...existingUserContent]
			} else {
				throw new Error("Unexpected: Last message is not a user or assistant message")
			}
		} else {
			// No API conversation history yet (e.g., cancelled during hook before first API request)
			// Start fresh with empty history and no previous content
			modifiedApiConversationHistory = []
			modifiedOldUserContent = []
		}

		// Add previous content to newUserContent array
		newUserContent.push(...modifiedOldUserContent)

		const agoText = (() => {
			const timestamp = lastShuncodeMessage?.ts ?? Date.now()
			const now = Date.now()
			const diff = now - timestamp
			const minutes = Math.floor(diff / 60000)
			const hours = Math.floor(minutes / 60)
			const days = Math.floor(hours / 24)

			if (days > 0) {
				return `${days} day${days > 1 ? "s" : ""} ago`
			}
			if (hours > 0) {
				return `${hours} hour${hours > 1 ? "s" : ""} ago`
			}
			if (minutes > 0) {
				return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
			}
			return "just now"
		})()

		const wasRecent = lastShuncodeMessage?.ts && Date.now() - lastShuncodeMessage.ts < 30_000

		// Check if there are pending file context warnings before calling taskResumption
		const pendingContextWarning = await this.fileContextTracker.retrieveAndClearPendingFileContextWarning()
		const hasPendingFileContextWarnings = pendingContextWarning && pendingContextWarning.length > 0

		const mode = this.stateManager.getGlobalSettingsKey("mode")
		const [taskResumptionMessage, userResponseMessage] = formatResponse.taskResumption(
			isReadOnlyMode(mode) ? "plan" : "act",
			agoText,
			this.cwd,
			wasRecent,
			responseText,
			hasPendingFileContextWarnings,
		)

		if (taskResumptionMessage !== "") {
			newUserContent.push({
				type: "text",
				text: taskResumptionMessage,
			})
		}

		if (userResponseMessage !== "") {
			newUserContent.push({
				type: "text",
				text: userResponseMessage,
			})
		}

		if (responseImages && responseImages.length > 0) {
			newUserContent.push(...formatResponse.imageBlocks(responseImages))
		}

		if (responseFiles && responseFiles.length > 0) {
			const fileContentString = await processFilesIntoText(responseFiles)
			if (fileContentString) {
				newUserContent.push({
					type: "text",
					text: fileContentString,
				})
			}
		}

		// Inject file context warning if there were pending warnings from message editing
		if (pendingContextWarning && pendingContextWarning.length > 0) {
			const fileContextWarning = formatResponse.fileContextWarning(pendingContextWarning)
			newUserContent.push({
				type: "text",
				text: fileContextWarning,
			})
		}

		// Run UserPromptSubmit hook for task resumption with ONLY the new user feedback
		// (not the entire conversation context that includes previous messages)
		const userFeedbackContent = await buildUserFeedbackContent(responseText, responseImages, responseFiles)

		const userPromptHookResult = await this.runUserPromptSubmitHook(userFeedbackContent, "resume")

		// Defensive check: Verify task wasn't aborted during hook execution (handles async cancellation)
		if (this.taskState.abort) {
			return
		}

		// Handle hook cancellation request
		if (userPromptHookResult.cancel === true) {
			// The hook already updated its status to "cancelled" internally and saved state
			await this.cancelTask()
			return
		}

		// Add hook context if provided (after all other content)
		if (userPromptHookResult.contextModification) {
			newUserContent.push({
				type: "text",
				text: `<hook_context source="UserPromptSubmit">\n${userPromptHookResult.contextModification}\n</hook_context>`,
			})
		}

		// Record environment metadata when resuming task (tracks cross-platform migrations)
		try {
			await this.environmentContextTracker.recordEnvironment()
		} catch (error) {
			Logger.error("Failed to record environment metadata on resume:", error)
		}

		await this.messageStateHandler.overwriteApiConversationHistory(modifiedApiConversationHistory)
		await this.initiateTaskLoop(newUserContent)
	}

	private async initiateTaskLoop(userContent: ShuncodeContent[]): Promise<void> {
		// Pipeline: начинаем run
		this._session?.pipeline.start()

		// Reset session budget counters for the new user turn
		this.taskState.turnToolCallCount = 0
		this.taskState.consecutiveReadOnlyToolCalls = 0
		this.taskState.sessionBudgetExhausted = false

		let nextUserContent = userContent
		let includeFileDetails = true
		while (!this.taskState.abort) {
			// Pipeline: новая итерация
			this._session?.pipeline.nextIteration()

			const didEndLoop = await this.recursivelyMakeShuncodeRequests(nextUserContent, includeFileDetails)
			includeFileDetails = false // we only need file details the first time

			//  The way this agentic loop works is that shuncode will be given a task that he then calls tools to complete. unless there's an attempt_completion call, we keep responding back to him with his tool's responses until he either attempt_completion or does not use anymore tools. If he does not use anymore tools, we ask him to consider if he's completed the task and then call attempt_completion, otherwise proceed with completing the task.

			//const totalCost = this.calculateApiCost(totalInputTokens, totalOutputTokens)
			if (didEndLoop) {
				// For now a task never 'completes'. This will only happen if the user hits max requests and denies resetting the count.
				//this.say("task_completed", `Task completed. Total API usage cost: ${totalCost}`)
				this._session?.pipeline.complete()
				break
			} else {
				// this.say(
				// 	"tool",
				// 	"Shuncode responded with only text blocks but has not called attempt_completion yet. Forcing him to continue with task..."
				// )
				nextUserContent = [
					{
						type: "text",
						text: formatResponse.noToolsUsed(this.useNativeToolCalls),
					},
				]
				this.taskState.consecutiveMistakeCount++
			}
		}
	}

	/**
	 * Run agent loop for a single workflow step.
	 * Similar to initiateTaskLoop but exits on stepCompleted flag (set by attempt_completion).
	 * Does not manage pipeline start/complete — the orchestrator handles that.
	 */
	public async initiateStepLoop(userContent: ShuncodeUserContent[]): Promise<void> {
		this.taskState.stepCompleted = false
		this.taskState.isWorkflowStep = true

		let nextUserContent: ShuncodeContent[] = userContent
		while (!this.taskState.abort && !this.taskState.stepCompleted) {
			this._session?.pipeline.nextIteration()

			const didEndLoop = await this.recursivelyMakeShuncodeRequests(nextUserContent, false)

			if (didEndLoop || this.taskState.stepCompleted) {
				break
			}

			// Workflow step: if agent responded with text only (no tools, no attempt_completion),
			// treat the step as complete. Don't loop — prevents infinite text-only cycles.
			break
		}

		this.taskState.isWorkflowStep = false
	}

	/**
	 * Detect if the task text contains a slash command that references a multi-step .yaml workflow.
	 */
	private async detectMultiStepWorkflow(task?: string): Promise<import("@core/workflow").WorkflowDefinition | null> {
		if (!task) {
			return null
		}

		const slashMatch = task.match(/(^|\s)\/([\p{L}\p{N}_.-]+)(?=\s|$)/u)
		if (!slashMatch) {
			return null
		}

		const commandName = slashMatch[2]
		const stateManager = StateManager.get()

		const globalToggles = stateManager.getGlobalSettingsKey("globalWorkflowToggles") || {}
		const localToggles = stateManager.getWorkspaceStateKey("workflowToggles") || {}

		const allPaths = [
			...Object.entries(localToggles).filter(([_, v]) => v),
			...Object.entries(globalToggles).filter(([_, v]) => v),
		]

		for (const [filePath] of allPaths) {
			const fileName = filePath.replace(/^.*[/\\]/, "")
			if (fileName === commandName || fileName === `${commandName}.yaml` || fileName === `${commandName}.yml`) {
				const { isMultiStepWorkflow, parseWorkflowFile } = await import("@core/workflow")
				if (isMultiStepWorkflow(filePath)) {
					try {
						return await parseWorkflowFile(filePath)
					} catch (error) {
						Logger.error(`Failed to parse multi-step workflow ${filePath}:`, error)
						return null
					}
				}
			}
		}

		return null
	}

	/**
	 * Adapter to expose Task as WorkflowCapableTask for the orchestrator.
	 */
	private asWorkflowCapable(): import("@core/workflow").WorkflowCapableTask {
		return {
			getUlid: () => this.ulid,
			isAborted: () => this.taskState.abort,
			initiateStepLoop: (userContent) => this.initiateStepLoop(userContent as ShuncodeUserContent[]),
			sayTaskProgress: (text) => this.sayTaskProgress(text),
			sayWorkflowStepStart: async (data) => {
				await this.say("workflow_step_start", JSON.stringify(data))
			},
			setSilentStep: (silent) => {
				this.taskState.isSilentStep = silent
			},
		}
	}

	private async sayTaskProgress(text: string): Promise<void> {
		await this.say("task_progress", text)
		this.taskState.currentFocusChainChecklist = text
		await this.postStateToWebview()
	}

	/**
	 * Determines if the TaskCancel hook should run.
	 * Only runs if there's actual active work happening or if work was started in this session.
	 * Does NOT run when just showing the resume button or completion button with no active work.
	 * @returns true if the hook should run, false otherwise
	 */
	private async shouldRunTaskCancelHook(): Promise<boolean> {
		// Atomically check for active hook execution (work happening now)
		const activeHook = await this.getActiveHookExecution()
		if (activeHook) {
			return true
		}

		// Run if the API is currently streaming (work happening now)
		if (this.taskState.isStreaming) {
			return true
		}

		// Run if we're waiting for the first chunk (work happening now)
		if (this.taskState.isWaitingForFirstChunk) {
			return true
		}

		// Run if there's active background command (work happening now)
		if (this.commandExecutor.hasActiveBackgroundCommand()) {
			return true
		}

		// Check if we're at a button-only state (no active work, just waiting for user action)
		const shuncodeMessages = this.messageStateHandler.getShuncodeMessages()
		const lastMessage = shuncodeMessages.at(-1)
		const isAtButtonOnlyState =
			lastMessage?.type === "ask" &&
			(lastMessage.ask === "resume_task" ||
				lastMessage.ask === "resume_completed_task" ||
				lastMessage.ask === "completion_result")

		if (isAtButtonOnlyState) {
			// At button-only state - DON'T run hook because we're just waiting for user input
			// These button states appear when:
			// 1. Opening from history (resume_task/resume_completed_task)
			// 2. After task completion (completion_result with "Start New Task" button)
			// 3. After cancelling during active work (but work already stopped)
			// In all cases, we shouldn't run TaskCancel hook
			return false
		}

		// Not at a button-only state - we're in the middle of work or just finished something
		// Run the hook since cancelling would interrupt actual work
		return true
	}

	async abortTask() {
		try {
			// PHASE 1: Check if TaskCancel should run BEFORE any cleanup
			// We must capture this state now because subsequent cleanup will
			// clear the active work indicators that shouldRunTaskCancelHook checks
			const shouldRunTaskCancelHook = await this.shouldRunTaskCancelHook()

			// PHASE 1.5: Reject all pending approval promises
			this.approvalGate.rejectAll("Task aborted")

			// PHASE 2: Set abort flag to prevent race conditions
			// This must happen before canceling hooks so that hook catch blocks
			// can properly detect the abort state
			this.taskState.abort = true

			// PHASE 3: Cancel any running hook execution
			const activeHook = await this.getActiveHookExecution()
			if (activeHook) {
				try {
					await this.cancelHookExecution()
					// Clear activeHookExecution after hook is signaled
					await this.clearActiveHookExecution()
				} catch (error) {
					Logger.error("Failed to cancel hook during task abort", error)
					// Still clear state even on error to prevent stuck state
					await this.clearActiveHookExecution()
				}
			}

			if (this.commandExecutor.hasActiveBackgroundCommand()) {
				try {
					await this.commandExecutor.cancelBackgroundCommand()
				} catch (error) {
					Logger.error("Failed to cancel background command during task abort", error)
				}
			}

			// PHASE 4: Run TaskCancel hook
			// This allows the hook UI to appear in the webview
			// Use the shouldRunTaskCancelHook value we captured in Phase 1
			const hooksEnabled = getHooksEnabledSafe()
			if (hooksEnabled && shouldRunTaskCancelHook) {
				try {
					await executeHook({
						hookName: "TaskCancel",
						hookInput: {
							taskCancel: {
								taskMetadata: {
									taskId: this.taskId,
									ulid: this.ulid,
									completionStatus: this.taskState.abandoned ? "abandoned" : "cancelled",
								},
							},
						},
						isCancellable: false, // TaskCancel is NOT cancellable
						say: this.say.bind(this),
						// No setActiveHookExecution or clearActiveHookExecution for non-cancellable hooks
						messageStateHandler: this.messageStateHandler,
						taskId: this.taskId,
						hooksEnabled,
					})

					// TaskCancel completed successfully
					// Present resume button after successful TaskCancel hook
					const lastShuncodeMessage = this.messageStateHandler
						.getShuncodeMessages()
						.slice()
						.reverse()
						.find((m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"))

					let askType: ShuncodeAsk
					if (lastShuncodeMessage?.ask === "completion_result") {
						askType = "resume_completed_task"
					} else {
						askType = "resume_task"
					}

					// Present the resume ask - this will show the resume button in the UI
					// We don't await this because we want to set the abort flag immediately
					// The ask will be waiting when the user decides to resume
					this.ask(askType).catch((error) => {
						// If ask fails (e.g., task was cleared), that's okay - just log it
						Logger.log("[TaskCancel] Resume ask failed (task may have been cleared):", error)
					})
				} catch (error) {
					// TaskCancel hook failed - non-fatal, just log
					Logger.error("[TaskCancel Hook] Failed (non-fatal):", error)
				}
			}

			// PHASE 5: Immediately update UI to reflect abort state
			try {
				await this.messageStateHandler.saveShuncodeMessagesAndUpdateHistory()
				await this.postStateToWebview()
			} catch (error) {
				Logger.error("Failed to post state after setting abort flag", error)
			}

			// PHASE 6: Check for incomplete progress
			if (this.FocusChainManager) {
				// Extract current model and provider for telemetry
				const apiConfig = this.stateManager.getApiConfiguration()
				const currentMode = this.stateManager.getGlobalSettingsKey("mode")
				const currentProvider = (
					currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
				) as string
				const currentModelId = this.api.getModel().id

				this.FocusChainManager.checkIncompleteProgressOnCompletion(currentModelId, currentProvider)
			}

			// PHASE 7: Clean up resources
			this.terminalManager.disposeAll()
			this.urlContentFetcher.closeBrowser()
			await this.browserSession.dispose()
			this.shuncodeIgnoreController.dispose()
			this.fileContextTracker.dispose()
			// need to await for when we want to make sure directories/files are reverted before
			// re-starting the task from a checkpoint
			await this.diffViewProvider.revertChanges()
			// Clear the notification callback when task is aborted
			this.mcpHub.clearNotificationCallback()
			if (this.FocusChainManager) {
				this.FocusChainManager.dispose()
			}
		} finally {
			// Release task folder lock
			if (this.taskLockAcquired) {
				try {
					await releaseTaskLock(this.taskId)
					this.taskLockAcquired = false
					Logger.info(`[Task ${this.taskId}] Task lock released`)
				} catch (error) {
					Logger.error(`[Task ${this.taskId}] Failed to release task lock:`, error)
				}
			}

			// Final state update to notify UI that abort is complete
			try {
				await this.postStateToWebview()
			} catch (error) {
				Logger.error("Failed to post final state after abort", error)
			}
		}
	}

	// Tools
	async executeCommandTool(command: string, timeoutSeconds: number | undefined): Promise<[boolean, ShuncodeToolResponseContent]> {
		return this.commandExecutor.execute(command, timeoutSeconds)
	}

	/**
	 * Cancel a background command that is running in the background
	 * @returns true if a command was cancelled, false if no command was running
	 */
	public async cancelBackgroundCommand(): Promise<boolean> {
		return this.commandExecutor.cancelBackgroundCommand()
	}

	/**
	 * Cancel a currently running hook execution
	 * @returns true if a hook was cancelled, false if no hook was running
	 */
	public async cancelHookExecution(): Promise<boolean> {
		const activeHook = await this.getActiveHookExecution()
		if (!activeHook) {
			return false
		}

		const { hookName, toolName, messageTs, abortController } = activeHook

		try {
			// Abort the hook process
			abortController.abort()

			// Update hook message status to "cancelled"
			const shuncodeMessages = this.messageStateHandler.getShuncodeMessages()
			const hookMessageIndex = shuncodeMessages.findIndex((m) => m.ts === messageTs)
			if (hookMessageIndex !== -1) {
				const cancelledMetadata = {
					hookName,
					toolName,
					status: "cancelled",
					exitCode: 130, // Standard SIGTERM exit code
				}
				await this.messageStateHandler.updateShuncodeMessage(hookMessageIndex, {
					text: JSON.stringify(cancelledMetadata),
				})
			}

			// Notify UI that hook was cancelled
			await this.say("hook_output_stream", "\nHook execution cancelled by user")

			// Return success - let caller (abortTask) handle next steps
			// DON'T call abortTask() here to avoid infinite recursion
			return true
		} catch (error) {
			Logger.error("Failed to cancel hook execution", error)
			return false
		}
	}

	private getCurrentProviderInfo(): ApiProviderInfo {
		const model = this.api.getModel()
		const apiConfig = this.stateManager.getApiConfiguration()
		const mode = this.stateManager.getGlobalSettingsKey("mode")
		const providerId = (getApiSettingsMode(mode) === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
		const customPrompt = this.stateManager.getGlobalSettingsKey("customPrompt")
		return { model, providerId, customPrompt, mode }
	}

	private getApiRequestIdSafe(): string | undefined {
		const apiLike = this.api as Partial<{
			getLastRequestId: () => string | undefined
			lastGenerationId?: string
		}>
		return apiLike.getLastRequestId?.() ?? apiLike.lastGenerationId
	}

	private async handleContextWindowExceededError(): Promise<void> {
		const apiConversationHistory = this.messageStateHandler.getApiConversationHistory()

		// Run PreCompact hook before truncation
		const hooksEnabled = getHooksEnabledSafe()
		if (hooksEnabled) {
			try {
				// Calculate what the new deleted range will be
				const deletedRange = this.calculatePreCompactDeletedRange(apiConversationHistory)

				// Execute hook - throws HookCancellationError if cancelled
				await executePreCompactHookWithCleanup({
					taskId: this.taskId,
					ulid: this.ulid,
					apiConversationHistory,
					conversationHistoryDeletedRange: this.taskState.conversationHistoryDeletedRange,
					contextManager: this.contextManager,
					shuncodeMessages: this.messageStateHandler.getShuncodeMessages(),
					messageStateHandler: this.messageStateHandler,
					compactionStrategy: "standard-truncation-lastquarter",
					deletedRange,
					say: this.say.bind(this),
					setActiveHookExecution: async (hookExecution: HookExecution | undefined) => {
						if (hookExecution) {
							await this.setActiveHookExecution(hookExecution)
						}
					},
					clearActiveHookExecution: this.clearActiveHookExecution.bind(this),
					postStateToWebview: this.postStateToWebview.bind(this),
					taskState: this.taskState,
					cancelTask: this.cancelTask.bind(this),
					hooksEnabled: true,
				})
			} catch (error) {
				// If hook was cancelled, re-throw to stop compaction
				if (error instanceof HookCancellationError) {
					throw error
				}

				// Graceful degradation: Log error but continue with truncation
				Logger.error("[PreCompact] Hook execution failed:", error)
			}
		}

		// Proceed with standard truncation
		const newDeletedRange = this.contextManager.getNextTruncationRange(
			apiConversationHistory,
			this.taskState.conversationHistoryDeletedRange,
			"quarter", // Force aggressive truncation
		)

		this.taskState.conversationHistoryDeletedRange = newDeletedRange

		await this.messageStateHandler.saveShuncodeMessagesAndUpdateHistory()
		await this.contextManager.triggerApplyStandardContextTruncationNoticeChange(
			Date.now(),
			await ensureTaskDirectoryExists(this.taskId),
			apiConversationHistory,
		)

		this.taskState.didAutomaticallyRetryFailedApiRequest = true
	}

	async *attemptApiRequest(previousApiReqIndex: number): ApiStream {
		// Wait for MCP servers to be connected before generating system prompt
		await pWaitFor(() => this.mcpHub.isConnecting !== true, {
			timeout: 10_000,
		}).catch(() => {
			Logger.error("MCP servers failed to connect in time")
		})

		const providerInfo = this.getCurrentProviderInfo()
		const browserSettings = this.stateManager.getGlobalSettingsKey("browserSettings")
		const disableBrowserTool = browserSettings.disableToolUse ?? false
		// shuncode browser tool uses image recognition for navigation (requires model image support).
		const modelSupportsBrowserUse = providerInfo.model.info.supportsImages ?? false

		const supportsBrowserUse = modelSupportsBrowserUse && !disableBrowserTool // only enable browser use if the model supports it and the user hasn't disabled it
		const preferredLanguageRaw = this.stateManager.getGlobalSettingsKey("preferredLanguage")
		const preferredLanguage = getLanguageKey(preferredLanguageRaw as LanguageDisplay)
		const alwaysThinkInPreferredLanguage = this.stateManager.getGlobalSettingsKey("alwaysThinkInPreferredLanguage")
		const preferredLanguageInstructions = preferredLanguage
			? `# Preferred Language\n\nSpeak in ${preferredLanguageRaw}.${alwaysThinkInPreferredLanguage
				? `\n\n重要：始终在 <thinking> 标签内用 ${preferredLanguageRaw} 思考。不要用其他语言。`
				: ""
			}`
			: ""

		// Check CLI installation status only if subagents are enabled
		const subagentsEnabled = this.stateManager.getGlobalSettingsKey("subagentsEnabled")

		// [SHUNCODE-PERF] Parallelize independent async operations to reduce TTFT.
		// These operations are independent of each other and can run concurrently.
		const [
			ide,
			isSubagentsEnabledAndCliInstalled,
			{ globalToggles, localToggles },
			{ windsurfLocalToggles, cursorLocalToggles, agentsLocalToggles },
			evaluationContext,
			globalShuncodeRulesFilePath,
			allSkills,
			openTabPaths,
			visibleTabPaths,
			gitStatusRaw,
			mcpSettingsPath,
			machineIdValue,
			authToken,
		] = await Promise.all([
			HostProvider.env.getHostVersion({}).then((v) => v.platform || "Unknown"),
			subagentsEnabled ? isShuncodeCliInstalled().then((installed) => subagentsEnabled && installed) : Promise.resolve(false),
			refreshShuncodeRulesToggles(this.controller, this.cwd),
			refreshExternalRulesToggles(this.controller, this.cwd),
			RuleContextBuilder.buildEvaluationContext({
				cwd: this.cwd,
				messageStateHandler: this.messageStateHandler,
				workspaceManager: this.workspaceManager,
			}),
			ensureRulesDirectoryExists(),
			(this.stateManager.getGlobalSettingsKey("skillsEnabled") ?? false) ? discoverSkills(this.cwd) : Promise.resolve([]),
			HostProvider.window.getOpenTabs({}).then((r) => r.paths || []),
			HostProvider.window.getVisibleTabs({}).then((r) => r.paths || []),
			getGitStatusCompact(this.cwd),
			this.mcpHub.getMcpSettingsFilePath(),
			machineId().catch(() => undefined),
			AuthService.getInstance().getAuthToken(),
		])

		// Phase 2: Operations that depend on phase 1 results (rules loading)
		const [
			globalRules,
			localRules,
			[localCursorRulesFileInstructions, localCursorRulesDirInstructions],
			localWindsurfRulesFileInstructions,
			localAgentsRulesFileInstructions,
		] = await Promise.all([
			getGlobalShuncodeRules(globalShuncodeRulesFilePath, globalToggles, { evaluationContext }),
			getLocalShuncodeRules(this.cwd, localToggles, { evaluationContext }),
			getLocalCursorRules(this.cwd, cursorLocalToggles),
			getLocalWindsurfRules(this.cwd, windsurfLocalToggles),
			getLocalAgentsRules(this.cwd, agentsLocalToggles),
		])

		const globalShuncodeRulesFileInstructions = globalRules.instructions
		const localShuncodeRulesFileInstructions = localRules.instructions

		const shuncodeIgnoreContent = this.shuncodeIgnoreController.shuncodeIgnoreContent
		let shuncodeIgnoreInstructions: string | undefined
		if (shuncodeIgnoreContent) {
			shuncodeIgnoreInstructions = formatResponse.shuncodeIgnoreInstructions(shuncodeIgnoreContent)
		}

		// Prepare multi-root workspace information if enabled
		let workspaceRoots: Array<{ path: string; name: string; vcs?: string }> | undefined
		const multiRootEnabled = isMultiRootEnabled(this.stateManager)
		if (multiRootEnabled && this.workspaceManager) {
			workspaceRoots = this.workspaceManager.getRoots().map((root) => ({
				path: root.path,
				name: root.name || path.basename(root.path), // Fallback to basename if name is undefined
				vcs: root.vcs as string | undefined, // Cast VcsType to string
			}))
		}

		// Detect if this is a CLI subagent to prevent nested subagent creation
		const isCliSubagent = isCliSubagentContext({
			yoloModeToggled: this.stateManager.getGlobalSettingsKey("yoloModeToggled"),
			maxConsecutiveMistakes: this.stateManager.getGlobalSettingsKey("maxConsecutiveMistakes"),
		})

		// Filter skills by toggle state (enabled by default)
		const resolvedSkills = getAvailableSkills(allSkills)
		const globalSkillsToggles = this.stateManager.getGlobalSettingsKey("globalSkillsToggles") ?? {}
		const localSkillsToggles = this.stateManager.getWorkspaceStateKey("localSkillsToggles") ?? {}
		const availableSkills = resolvedSkills.filter((skill) => {
			const toggles = skill.source === "global" ? globalSkillsToggles : localSkillsToggles
			// If toggle exists, use it; otherwise default to enabled (true)
			return toggles[skill.path] !== false
		})

		// Snapshot editor tabs so prompt tools can decide whether to include
		// filetype-specific instructions (e.g. notebooks) without adding bespoke flags.
		const cap = 50
		const editorTabs = {
			open: openTabPaths.slice(0, cap),
			visible: visibleTabPaths.slice(0, cap),
		}

		// Get compact git status for context
		const gitStatus = gitStatusRaw ? {
			branch: gitStatusRaw.branch,
			hasChanges: gitStatusRaw.hasChanges,
			summary: gitStatusRaw.summary,
		} : undefined

		const promptContext: SystemPromptContext = {
			cwd: this.cwd,
			ide,
			providerInfo,
			editorTabs,
			gitStatus,
			supportsBrowserUse,
			mcpHub: this.mcpHub,
			mcpSettingsPath,
			skills: availableSkills,
			focusChainSettings: this.stateManager.getGlobalSettingsKey("focusChainSettings"),
			globalShuncodeRulesFileInstructions,
			pinnedMemory: globalRules.content,
			localShuncodeRulesFileInstructions,
			localCursorRulesFileInstructions,
			localCursorRulesDirInstructions,
			localWindsurfRulesFileInstructions,
			localAgentsRulesFileInstructions,
			shuncodeIgnoreInstructions,
			preferredLanguageInstructions,
			osName: osName(),
			machineId: machineIdValue,
			preferredLanguage,
			alwaysThinkInPreferredLanguage,
			browserSettings: this.stateManager.getGlobalSettingsKey("browserSettings"),
			yoloModeToggled: this.stateManager.getGlobalSettingsKey("yoloModeToggled"),
			shuncodeWebToolsEnabled: this.stateManager.getGlobalSettingsKey("shuncodeWebToolsEnabled"),
			isAuthenticated: !!authToken,
			isMultiRootEnabled: multiRootEnabled,
			workspaceRoots,
			isSubagentsEnabledAndCliInstalled,
			isCliSubagent,
			enableNativeToolCalls: true,
			enableParallelToolCalling: this.stateManager.getGlobalSettingsKey("enableParallelToolCalling"),
			terminalExecutionMode: this.terminalExecutionMode,
			useSimplifiedEditTools: this.stateManager.getGlobalSettingsKey("lightweightMode") === true,
			lightweightMode: this.stateManager.getGlobalSettingsKey("lightweightMode"),
			mode: this.stateManager.getGlobalSettingsKey("mode") as "plan" | "act" | "ask" | "debug",
			toolCustomizationSettings: normalizeToolCustomizationSettings(
				this.stateManager.getGlobalSettingsKey("toolCustomizationSettings"),
			),
			customSystemPromptTemplate: getActiveCustomSystemPromptTemplate(
				this.stateManager.getGlobalSettingsKey("systemPromptSettings"),
			),
		}

		// Notify user if any conditional rules were applied for this request
		const activatedConditionalRules = [...globalRules.activatedConditionalRules, ...localRules.activatedConditionalRules]
		if (activatedConditionalRules.length > 0) {
			await this.say("conditional_rules_applied", JSON.stringify({ rules: activatedConditionalRules }))
		}

		const { systemPrompt, tools } = await getSystemPrompt(promptContext)
		this.useNativeToolCalls = !!tools?.length

		const contextManagementMetadata = await this.contextManager.getNewContextMessagesAndMetadata(
			this.messageStateHandler.getApiConversationHistory(),
			this.messageStateHandler.getShuncodeMessages(),
			this.api,
			this.taskState.conversationHistoryDeletedRange,
			previousApiReqIndex,
			await ensureTaskDirectoryExists(this.taskId),
			this.stateManager.getGlobalSettingsKey("useAutoCondense") && isNextGenModelFamily(this.api.getModel().id),
		)

		if (contextManagementMetadata.updatedConversationHistoryDeletedRange) {
			this.taskState.conversationHistoryDeletedRange = contextManagementMetadata.conversationHistoryDeletedRange
			await this.messageStateHandler.saveShuncodeMessagesAndUpdateHistory()
			// saves task history item which we use to keep track of conversation history deleted range
		}

		// Response API requires native tool calls to be enabled
		const stream = this.api.createMessage(systemPrompt, contextManagementMetadata.truncatedConversationHistory, tools)

		const iterator = stream[Symbol.asyncIterator]()

		try {
			// awaiting first chunk to see if it will throw an error
			this.taskState.isWaitingForFirstChunk = true
			const firstChunk = await iterator.next()
			if (firstChunk.done || firstChunk.value === undefined) {
				throw new Error("API returned empty response - no chunks received from the model")
			}
			yield firstChunk.value
			this.taskState.isWaitingForFirstChunk = false
		} catch (error) {
			const isContextWindowExceededError = checkContextWindowExceededError(error)
			const { model, providerId } = this.getCurrentProviderInfo()
			const shuncodeError = ErrorService.get().toShuncodeError(error, model.id, providerId)

			// Capture provider failure telemetry using shuncodeError
			ErrorService.get().logMessage(shuncodeError.message)

			if (isContextWindowExceededError && !this.taskState.didAutomaticallyRetryFailedApiRequest) {
				await this.handleContextWindowExceededError()
			} else {
				// request failed after retrying automatically once, ask user if they want to retry again
				// note that this api_req_failed ask is unique in that we only present this option if the api hasn't streamed any content yet (ie it fails on the first chunk due), as it would allow them to hit a retry button. However if the api failed mid-stream, it could be in any arbitrary state where some tools may have executed, so that error is handled differently and requires cancelling the task entirely.

				if (isContextWindowExceededError) {
					const truncatedConversationHistory = this.contextManager.getTruncatedMessages(
						this.messageStateHandler.getApiConversationHistory(),
						this.taskState.conversationHistoryDeletedRange,
					)

					// If the conversation has more than 3 messages, we can truncate again. If not, then the conversation is bricked.
					// ToDo: Allow the user to change their input if this is the case.
					if (truncatedConversationHistory.length > 3) {
						shuncodeError.message = "Context window exceeded. Click retry to truncate the conversation and try again."
						this.taskState.didAutomaticallyRetryFailedApiRequest = false
					}
				}

				const streamingFailedMessage = shuncodeError.serialize()

				// Update the 'api_req_started' message to reflect final failure before asking user to manually retry
				const lastApiReqStartedIndex = findLastIndex(
					this.messageStateHandler.getShuncodeMessages(),
					(m) => m.say === "api_req_started",
				)
				if (lastApiReqStartedIndex !== -1) {
					const shuncodeMessages = this.messageStateHandler.getShuncodeMessages()
					const currentApiReqInfo: ShuncodeApiReqInfo = JSON.parse(shuncodeMessages[lastApiReqStartedIndex].text || "{}")
					delete currentApiReqInfo.retryStatus

					await this.messageStateHandler.updateShuncodeMessage(lastApiReqStartedIndex, {
						text: JSON.stringify({
							...currentApiReqInfo, // Spread the modified info (with retryStatus removed)
							// cancelReason: "retries_exhausted", // Indicate that automatic retries failed
							streamingFailedMessage,
						} satisfies ShuncodeApiReqInfo),
					})
					// this.ask will trigger postStateToWebview, so this change should be picked up.
				}

				const isAuthError = shuncodeError.isErrorType(ShuncodeErrorType.Auth)

				// Check if this is a Shuncode provider insufficient credits error - don't auto-retry these
				const isShuncodeProviderInsufficientCredits = (() => {
					if (providerId !== "shuncode") {
						return false
					}
					try {
						const parsedError = ShuncodeError.transform(error, model.id, providerId)
						return parsedError.isErrorType(ShuncodeErrorType.Balance)
					} catch {
						return false
					}
				})()

				let response: ShuncodeAskResponse
				// Skip auto-retry for Shuncode provider insufficient credits or auth errors
				if (!isShuncodeProviderInsufficientCredits && !isAuthError && this.taskState.autoRetryAttempts < 3) {
					// Auto-retry enabled with max 3 attempts: automatically approve the retry
					this.taskState.autoRetryAttempts++

					// Calculate delay: 2s, 4s, 8s
					const delay = 2000 * 2 ** (this.taskState.autoRetryAttempts - 1)

					await updateApiReqMsg({
						messageStateHandler: this.messageStateHandler,
						lastApiReqIndex: lastApiReqStartedIndex,
						inputTokens: 0,
						outputTokens: 0,
						cacheWriteTokens: 0,
						cacheReadTokens: 0,
						totalCost: undefined,
						api: this.api,
						cancelReason: "streaming_failed",
						streamingFailedMessage,
					})
					await this.messageStateHandler.saveShuncodeMessagesAndUpdateHistory()
					await this.postStateToWebview()

					response = "yesButtonClicked"
					await this.say(
						"error_retry",
						JSON.stringify({
							attempt: this.taskState.autoRetryAttempts,
							maxAttempts: 3,
							delaySeconds: delay / 1000,
							errorMessage: streamingFailedMessage,
						}),
					)

					// Clear streamingFailedMessage now that error_retry contains it
					// This prevents showing the error in both ErrorRow and error_retry
					const autoRetryApiReqIndex = findLastIndex(
						this.messageStateHandler.getShuncodeMessages(),
						(m) => m.say === "api_req_started",
					)
					if (autoRetryApiReqIndex !== -1) {
						const shuncodeMessages = this.messageStateHandler.getShuncodeMessages()
						const currentApiReqInfo: ShuncodeApiReqInfo = JSON.parse(shuncodeMessages[autoRetryApiReqIndex].text || "{}")
						delete currentApiReqInfo.streamingFailedMessage
						await this.messageStateHandler.updateShuncodeMessage(autoRetryApiReqIndex, {
							text: JSON.stringify(currentApiReqInfo),
						})
					}

					await setTimeoutPromise(delay)
				} else {
					// Show error_retry with failed flag to indicate all retries exhausted (but not for insufficient credits)
					if (!isShuncodeProviderInsufficientCredits && !isAuthError) {
						await this.say(
							"error_retry",
							JSON.stringify({
								attempt: 3,
								maxAttempts: 3,
								delaySeconds: 0,
								failed: true, // Special flag to indicate retries exhausted
								errorMessage: streamingFailedMessage,
							}),
						)
					}
					const askResult = await this.ask("api_req_failed", streamingFailedMessage)
					response = askResult.response
					if (response === "yesButtonClicked") {
						this.taskState.autoRetryAttempts = 0
					}
				}

				if (response !== "yesButtonClicked") {
					// this will never happen since if noButtonClicked, we will clear current task, aborting this instance
					throw new Error("API request failed")
				}

				// Clear streamingFailedMessage when user manually retries
				const manualRetryApiReqIndex = findLastIndex(
					this.messageStateHandler.getShuncodeMessages(),
					(m) => m.say === "api_req_started",
				)
				if (manualRetryApiReqIndex !== -1) {
					const shuncodeMessages = this.messageStateHandler.getShuncodeMessages()
					const currentApiReqInfo: ShuncodeApiReqInfo = JSON.parse(shuncodeMessages[manualRetryApiReqIndex].text || "{}")
					delete currentApiReqInfo.streamingFailedMessage
					await this.messageStateHandler.updateShuncodeMessage(manualRetryApiReqIndex, {
						text: JSON.stringify(currentApiReqInfo),
					})
				}

				await this.say("api_req_retried")

				// Reset the automatic retry flag so the request can proceed
				this.taskState.didAutomaticallyRetryFailedApiRequest = false
			}
			// delegate generator output from the recursive call
			yield* this.attemptApiRequest(previousApiReqIndex)
			return
		}

		// no error, so we can continue to yield all remaining chunks
		// (needs to be placed outside of try/catch since it we want caller to handle errors not with api_req_failed as that is reserved for first chunk failures only)
		// this delegates to another generator or iterable object. In this case, it's saying "yield all remaining values from this iterator". This effectively passes along all subsequent chunks from the original stream.
		yield* iterator
	}

	async presentAssistantMessage() {
		if (this.taskState.abort) {
			throw new Error("Shuncode instance aborted")
		}

		// If we're locked, mark pending and return
		// Complete tool blocks can proceed to acquire the lock and execute
		if (this.taskState.presentAssistantMessageLocked) {
			this.taskState.presentAssistantMessageHasPendingUpdates = true
			return
		}

		this.taskState.presentAssistantMessageLocked = true
		this.taskState.presentAssistantMessageHasPendingUpdates = false

		if (this.taskState.currentStreamingContentIndex >= this.taskState.assistantMessageContent.length) {
			// this may happen if the last content block was completed before streaming could finish. if streaming is finished, and we're out of bounds then this means we already presented/executed the last content block and are ready to continue to next request
			if (this.taskState.didCompleteReadingStream) {
				this.taskState.userMessageContentReady = true
			}
			this.taskState.presentAssistantMessageLocked = false
			return
			//throw new Error("No more content blocks to stream! This shouldn't happen...") // remove and just return after testing
		}

		const block = cloneDeep(this.taskState.assistantMessageContent[this.taskState.currentStreamingContentIndex]) // need to create copy bc while stream is updating the array, it could be updating the reference block properties too
		switch (block.type) {
			case "text": {
				// Skip text rendering if tool was rejected, or if a tool was already used and parallel calling is disabled
				if (this.taskState.didRejectTool || (!this.isParallelToolCallingEnabled() && this.taskState.didAlreadyUseTool)) {
					break
				}
				let content = block.content
				if (content) {
					// (have to do this for partial and complete since sending content in thinking tags to markdown renderer will automatically be removed)
					// Remove end substrings of <thinking or </thinking (below xml parsing is only for opening tags)
					// (this is done with the xml parsing below now, but keeping here for reference)
					// content = content.replace(/<\/?t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?)?)?$/, "")
					// Remove all instances of <thinking> (with optional line break after) and </thinking> (with optional line break before)
					// - Needs to be separate since we dont want to remove the line break before the first tag
					// - Needs to happen before the xml parsing below
					content = content.replace(/<thinking>\s?/g, "")
					content = content.replace(/\s?<\/thinking>/g, "")

					// Remove all instances of <think> tags (alternative to <thinking>, some models are trained to use this tag instead)
					content = content.replace(/<think>\s?/g, "")
					content = content.replace(/\s?<\/think>/g, "")

					// New claude models tend to output <function_calls> tags which we don't want to show in the chat
					content = content.replace(/<function_calls>\s?/g, "")
					content = content.replace(/\s?<\/function_calls>/g, "")

					// Remove partial XML tag at the very end of the content (for tool use and thinking tags)
					// (prevents scrollview from jumping when tags are automatically removed)
					const lastOpenBracketIndex = content.lastIndexOf("<")
					if (lastOpenBracketIndex !== -1) {
						const possibleTag = content.slice(lastOpenBracketIndex)
						// Check if there's a '>' after the last '<' (i.e., if the tag is complete) (complete thinking and tool tags will have been removed by now)
						const hasCloseBracket = possibleTag.includes(">")
						if (!hasCloseBracket) {
							// Extract the potential tag name
							let tagContent: string
							if (possibleTag.startsWith("</")) {
								tagContent = possibleTag.slice(2).trim()
							} else {
								tagContent = possibleTag.slice(1).trim()
							}
							// Check if tagContent is likely an incomplete tag name (letters and underscores only)
							const isLikelyTagName = /^[a-zA-Z_]+$/.test(tagContent)
							// Preemptively remove < or </ to keep from these artifacts showing up in chat (also handles closing thinking tags)
							const isOpeningOrClosing = possibleTag === "<" || possibleTag === "</"
							// If the tag is incomplete and at the end, remove it from the content
							if (isOpeningOrClosing || isLikelyTagName) {
								content = content.slice(0, lastOpenBracketIndex).trim()
							}
						}
					}
				}

				if (!block.partial) {
					// Some models add code block artifacts (around the tool calls) which show up at the end of text content
					// matches ``` with at least one char after the last backtick, at the end of the string
					const match = content?.trimEnd().match(/```[a-zA-Z0-9_-]+$/)
					if (match) {
						const matchLength = match[0].length
						content = content.trimEnd().slice(0, -matchLength)
					}

					// Filter out meaningless placeholder text (e.g. "...", "…") that models output between tool calls
					const trimmed = content?.trim()
					if (trimmed && /^[.\u2026\s]+$/.test(trimmed)) {
						break
					}
				}

				await this.say("text", content, undefined, undefined, block.partial)
				break
			}
			case "tool_use":
				// [SHUNCODE] TEMPORARILY DISABLED — legacy Cline shadow-git checkpoint system
				// If we have a pending initial commit, we must block unsafe tools until it finishes.
				// Safe tools (read-only) can run in parallel.
				// if (this.initialCheckpointCommitPromise) {
				// 	if (!READ_ONLY_TOOLS.includes(block.name as any)) {
				// 		await this.initialCheckpointCommitPromise
				// 		this.initialCheckpointCommitPromise = undefined
				// 	}
				// }
				// Pipeline: tool_execution
				this._session?.pipeline.setStage("tool_execution", block.name)
				await this.toolExecutor.executeTool(block)
				break
		}

		/*
		Seeing out of bounds is fine, it means that the next tool call is being built up and ready to add to assistantMessageContent to present.
		When you see the UI inactive during this, it means that a tool is breaking without presenting any UI. For example the write_to_file tool was breaking when relpath was undefined, and for invalid relpath it never presented UI.
		*/
		this.taskState.presentAssistantMessageLocked = false // this needs to be placed here, if not then calling this.presentAssistantMessage below would fail (sometimes) since it's locked
		// NOTE: when tool is rejected, iterator stream is interrupted and it waits for userMessageContentReady to be true. Future calls to present will skip execution since didRejectTool and iterate until contentIndex is set to message length and it sets userMessageContentReady to true itself (instead of preemptively doing it in iterator)
		// Also advance when a tool was used and parallel calling is disabled
		if (
			!block.partial ||
			this.taskState.didRejectTool ||
			(!this.isParallelToolCallingEnabled() && this.taskState.didAlreadyUseTool)
		) {
			// block is finished streaming and executing
			if (this.taskState.currentStreamingContentIndex === this.taskState.assistantMessageContent.length - 1) {
				// its okay that we increment if !didCompleteReadingStream, it'll just return bc out of bounds and as streaming continues it will call presentAssistantMessage if a new block is ready. if streaming is finished then we set userMessageContentReady to true when out of bounds. This gracefully allows the stream to continue on and all potential content blocks be presented.
				// last block is complete and it is finished executing
				this.taskState.userMessageContentReady = true // will allow pwaitfor to continue
			}

			// call next block if it exists (if not then read stream will call it when its ready)
			this.taskState.currentStreamingContentIndex++ // need to increment regardless, so when read stream calls this function again it will be streaming the next block

			if (this.taskState.currentStreamingContentIndex < this.taskState.assistantMessageContent.length) {
				// there are already more content blocks to stream, so we'll call this function ourselves
				await this.presentAssistantMessage()
				return
			}
		}
		// block is partial, but the read stream may have finished
		if (this.taskState.presentAssistantMessageHasPendingUpdates) {
			await this.presentAssistantMessage()
		}
	}

	async recursivelyMakeShuncodeRequests(userContent: ShuncodeContent[], includeFileDetails: boolean = false): Promise<boolean> {
		// Check abort flag at the very start to prevent any execution after cancellation
		if (this.taskState.abort) {
			throw new Error("Task instance aborted")
		}

		// Session budget hard stop: if model ignored the exhaustion warning, end the loop
		if (this.taskState.sessionBudgetExhausted) {
			await this.say(
				"error",
				"Session budget exhausted — the model reached its tool call limit for this turn. The task will be paused. You can continue with a new message.",
			)
			return true
		}

		// Increment API request counter for focus chain list management
		this.taskState.apiRequestCount++
		this.taskState.apiRequestsSinceLastTodoUpdate++

		// Used to know what models were used in the task if user wants to export metadata for error reporting purposes
		const { model, providerId, customPrompt, mode } = this.getCurrentProviderInfo()
		if (providerId && model.id) {
			try {
				await this.modelContextTracker.recordModelUsage(providerId, model.id, mode)
			} catch { }
		}

		const modelInfo: ShuncodeMessageModelInfo = {
			modelId: model.id,
			providerId: providerId,
			mode: mode,
		}

		if (this.taskState.consecutiveMistakeCount >= this.stateManager.getGlobalSettingsKey("maxConsecutiveMistakes")) {
			// In yolo mode, don't wait for user input - fail the task
			if (this.stateManager.getGlobalSettingsKey("yoloModeToggled")) {
				const errorMessage =
					`[YOLO MODE] Task failed: Too many consecutive mistakes (${this.taskState.consecutiveMistakeCount}). ` +
					`The model may not be capable enough for this task. Consider using a more capable model.`
				await this.say("error", errorMessage)
				// End the task loop with failure
				return true // didEndLoop = true, signals task completion/failure
			}

			const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")
			if (autoApprovalSettings.enableNotifications) {
				showSystemNotification({
					subtitle: "Error",
					message: "Shuncode is having trouble. Would you like to continue the task?",
				})
			}
			const { response, text, images, files } = await this.ask(
				"mistake_limit_reached",
				`This model may be too weak for this task. Try a simpler request, or enable "Lightweight mode" in provider settings.`,
			)
			if (response === "messageResponse") {
				// Display the user's message in the chat UI
				await this.say("user_feedback", text, images, files)

				// This userContent is for the *next* API call.
				const feedbackUserContent: ShuncodeUserContent[] = []
				feedbackUserContent.push({
					type: "text",
					text: formatResponse.tooManyMistakes(text),
				})
				if (images && images.length > 0) {
					feedbackUserContent.push(...formatResponse.imageBlocks(images))
				}

				let fileContentString = ""
				if (files && files.length > 0) {
					fileContentString = await processFilesIntoText(files)
				}

				if (fileContentString) {
					feedbackUserContent.push({
						type: "text",
						text: fileContentString,
					})
				}

				userContent = feedbackUserContent
			}
			this.taskState.consecutiveMistakeCount = 0
			this.taskState.autoRetryAttempts = 0 // need to reset this if the user chooses to manually retry after the mistake limit is reached
		}

		// get previous api req's index to check token usage and determine if we need to truncate conversation history
		const previousApiReqIndex = findLastIndex(this.messageStateHandler.getShuncodeMessages(), (m) => m.say === "api_req_started")

		// Save checkpoint if this is the first API request
		const isFirstRequest = this.messageStateHandler.getShuncodeMessages().filter((m) => m.say === "api_req_started").length === 0

		// [SHUNCODE] TEMPORARILY DISABLED — legacy Cline shadow-git checkpoint system.
		// ensureCheckpointInitialized, checkpoint_created message, and initial commit are all disabled.
		// DiffSystem V2 handles checkpoints via startCheckpoint/finishCheckpoint.
		// --- BEGIN DISABLED BLOCK ---
		// if (isFirstRequest && this.checkpointManager && ...) {
		//   await ensureCheckpointInitialized({ checkpointManager: this.checkpointManager })
		//   await this.say("checkpoint_created")
		//   this.checkpointManager?.commit()
		// }
		// --- END DISABLED BLOCK ---

		// Determine if we should compact context window
		// Note: We delay context loading until we know if we're compacting (performance optimization)
		const useCompactPrompt = customPrompt === "compact" && isLocalModel(this.getCurrentProviderInfo())
		let shouldCompact = false
		const useAutoCondense = this.stateManager.getGlobalSettingsKey("useAutoCondense")

		if (useAutoCondense && isNextGenModelFamily(this.api.getModel().id)) {
			// When we initially trigger context cleanup, we increase the context window size, so we need state `currentlySummarizing`
			// to track if we've already started the context summarization flow. After summarizing, we increment
			// conversationHistoryDeletedRange to mask out the summarization-trigger user & assistant response messages
			if (this.taskState.currentlySummarizing) {
				this.taskState.currentlySummarizing = false

				if (this.taskState.conversationHistoryDeletedRange) {
					const [start, end] = this.taskState.conversationHistoryDeletedRange
					const apiHistory = this.messageStateHandler.getApiConversationHistory()

					// we want to increment the deleted range to remove the pre-summarization tool call output, with additional safety check
					const safeEnd = Math.min(end + 2, apiHistory.length - 1)
					if (end + 2 <= safeEnd) {
						this.taskState.conversationHistoryDeletedRange = [start, end + 2]
						await this.messageStateHandler.saveShuncodeMessagesAndUpdateHistory()
					}
				}
			} else {
				const autoCondenseThreshold = this.stateManager.getGlobalSettingsKey("autoCondenseThreshold") as
					| number
					| undefined
				shouldCompact = this.contextManager.shouldCompactContextWindow(
					this.messageStateHandler.getShuncodeMessages(),
					this.api,
					previousApiReqIndex,
					autoCondenseThreshold,
				)

				// Edge case: summarize_task tool call completes but user cancels next request before it finishes.
				// This results in currentlySummarizing being false, and we fail to update the context window token estimate.
				// Check active message count to avoid summarizing a summary (bad UX but doesn't break logic).
				if (shouldCompact && this.taskState.conversationHistoryDeletedRange) {
					const apiHistory = this.messageStateHandler.getApiConversationHistory()
					const activeMessageCount = apiHistory.length - this.taskState.conversationHistoryDeletedRange[1] - 1

					// IMPORTANT: We haven't appended the next user message yet, so the last message is an assistant message.
					// That's why we compare to even numbers (0, 2) rather than odd (1, 3).
					if (activeMessageCount <= 2) {
						shouldCompact = false
					}
				}

				// Determine whether we can save enough tokens from context rewriting to skip auto-compact
				if (shouldCompact) {
					shouldCompact = await this.contextManager.attemptFileReadOptimization(
						this.messageStateHandler.getApiConversationHistory(),
						this.taskState.conversationHistoryDeletedRange,
						this.messageStateHandler.getShuncodeMessages(),
						previousApiReqIndex,
						await ensureTaskDirectoryExists(this.taskId),
					)
				}
			}
		}

		// Step-based forced compaction for weak/medium models:
		// If the model has used many API requests, force context compaction even if
		// token-based threshold hasn't been reached (weak models degrade before filling context).
		if (!shouldCompact) {
			const currentProviderInfo = this.getCurrentProviderInfo()
			const modelTier = getModelCapabilityTier(currentProviderInfo.model.id, currentProviderInfo)
			if (modelTier !== "strong") {
				const limits = getSessionLimitsForModel(currentProviderInfo.model.id, currentProviderInfo)
				if (this.taskState.apiRequestCount > 0 && this.taskState.apiRequestCount % limits.forceCompactAfterSteps === 0) {
					shouldCompact = true
				}
			}
		}

		// NOW load context based on compaction decision
		// This optimization avoids expensive context loading when using summarize_task
		let parsedUserContent: ShuncodeContent[]
		let environmentDetails: string
		let shuncoderulesError: boolean

		if (shouldCompact) {
			// When compacting, skip full context loading (use summarize_task instead)
			parsedUserContent = userContent
			environmentDetails = ""
			shuncoderulesError = false
			this.taskState.lastAutoCompactTriggerIndex = previousApiReqIndex
		} else {
			// When NOT compacting, load full context with mentions parsing and slash commands
			;[parsedUserContent, environmentDetails, shuncoderulesError] = await this.loadContext(
				userContent,
				includeFileDetails,
				useCompactPrompt,
			)
		}

		// error handling if the user uses the /newrule command & their .shuncoderules is a file, for file read operations didnt work properly
		if (shuncoderulesError === true) {
			await this.say(
				"error",
				"Issue with processing the /newrule command. Double check that, if '.shuncoderules' already exists, it's a directory and not a file. Otherwise there was an issue referencing this file/directory.",
			)
		}

		// Replace userContent with parsed content that includes file details and command instructions.
		userContent = parsedUserContent

		// Environment details are no longer injected into user messages.
		// They duplicate information already present in the system prompt
		// and add unwanted tokens to custom API requests.

		if (shouldCompact) {
			userContent.push({
				type: "text",
				text: summarizeTask(
					this.stateManager.getGlobalSettingsKey("focusChainSettings"),
					this.cwd,
					isMultiRootEnabled(this.stateManager),
				),
			})
		}

		// getting verbose details is an expensive operation, it uses globby to top-down build file structure of project which for large projects can take a few seconds
		// for the best UX we show a placeholder api_req_started message with a loading spinner as this happens
		await this.say(
			"api_req_started",
			JSON.stringify({
				request: userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n") + "\n\nLoading...",
			}),
		)

		await this.messageStateHandler.addToApiConversationHistory({
			role: "user",
			content: userContent,
		})

		telemetryService.captureConversationTurnEvent(this.ulid, providerId, model.id, "user", modelInfo.mode)

		// Capture task initialization timing telemetry for the first API request
		if (isFirstRequest) {
			const durationMs = Math.round(performance.now() - this.taskInitializationStartTime)
			telemetryService.captureTaskInitialization(
				this.ulid,
				this.taskId,
				durationMs,
				this.stateManager.getGlobalSettingsKey("enableCheckpointsSetting"),
			)
		}

		// since we sent off a placeholder api_req_started message to update the webview while waiting to actually start the API request (to load potential details for example), we need to update the text of that message
		const lastApiReqIndex = findLastIndex(this.messageStateHandler.getShuncodeMessages(), (m) => m.say === "api_req_started")
		await this.messageStateHandler.updateShuncodeMessage(lastApiReqIndex, {
			text: JSON.stringify({
				request: userContent.map((block) => formatContentBlockToMarkdown(block)).join("\n\n"),
			} satisfies ShuncodeApiReqInfo),
		})
		await this.postStateToWebview()

		try {
			const taskMetrics: {
				cacheWriteTokens: number
				cacheReadTokens: number
				inputTokens: number
				outputTokens: number
				totalCost: number | undefined
			} = { cacheWriteTokens: 0, cacheReadTokens: 0, inputTokens: 0, outputTokens: 0, totalCost: undefined }

			const abortStream = async (cancelReason: ShuncodeApiReqCancelReason, streamingFailedMessage?: string) => {
				if (this.diffViewProvider.isEditing) {
					await this.diffViewProvider.revertChanges() // closes diff view
				}

				// if last message is a partial we need to update and save it
				const lastMessage = this.messageStateHandler.getShuncodeMessages().at(-1)
				if (lastMessage && lastMessage.partial) {
					// lastMessage.ts = Date.now() DO NOT update ts since it is used as a key for virtuoso list
					lastMessage.partial = false
					// instead of streaming partialMessage events, we do a save and post like normal to persist to disk
					Logger.log("updating partial message", lastMessage)
					// await this.saveShuncodeMessagesAndUpdateHistory()
				}
				// update api_req_started to have cancelled and cost, so that we can display the cost of the partial stream
				await updateApiReqMsg({
					messageStateHandler: this.messageStateHandler,
					lastApiReqIndex,
					inputTokens: taskMetrics.inputTokens,
					outputTokens: taskMetrics.outputTokens,
					cacheWriteTokens: taskMetrics.cacheWriteTokens,
					cacheReadTokens: taskMetrics.cacheReadTokens,
					totalCost: taskMetrics.totalCost,
					api: this.api,
					cancelReason,
					streamingFailedMessage,
				})
				await this.messageStateHandler.saveShuncodeMessagesAndUpdateHistory()

				// Let assistant know their response was interrupted for when task is resumed
				await this.messageStateHandler.addToApiConversationHistory({
					role: "assistant",
					content: [
						{
							type: "text",
							text:
								assistantMessage +
								`\n\n[${cancelReason === "streaming_failed"
									? "Response interrupted by API Error"
									: "Response interrupted by user"
								}]`,
						},
					],
					modelInfo,
					metrics: {
						tokens: {
							prompt: taskMetrics.inputTokens,
							completion: taskMetrics.outputTokens,
							cached: (taskMetrics.cacheWriteTokens ?? 0) + (taskMetrics.cacheReadTokens ?? 0),
						},
						cost: taskMetrics.totalCost,
					},
				})

				telemetryService.captureConversationTurnEvent(
					this.ulid,
					providerId,
					modelInfo.modelId,
					"assistant",
					modelInfo.mode,
					{
						tokensIn: taskMetrics.inputTokens,
						tokensOut: taskMetrics.outputTokens,
						cacheWriteTokens: taskMetrics.cacheWriteTokens,
						cacheReadTokens: taskMetrics.cacheReadTokens,
						totalCost: taskMetrics.totalCost,
					},
					this.useNativeToolCalls, // For assistant turn only.
				)

				// signals to provider that it can retrieve the saved messages from disk, as abortTask can not be awaited on in nature
				this.taskState.didFinishAbortingStream = true
			}

			// reset streaming state
			this.taskState.currentStreamingContentIndex = 0
			this.taskState.assistantMessageContent = []
			this.taskState.didCompleteReadingStream = false
			this.taskState.userMessageContent = []
			this.taskState.userMessageContentReady = false
			this.taskState.didRejectTool = false
			this.taskState.didAlreadyUseTool = false
			this.taskState.presentAssistantMessageLocked = false
			this.taskState.presentAssistantMessageHasPendingUpdates = false
			this.taskState.didAutomaticallyRetryFailedApiRequest = false
			await this.diffViewProvider.reset()
			this.streamHandler.reset()
			this.taskState.toolUseIdMap.clear()
			this.taskState.errorPushedForCallIds.clear()

			const { toolUseHandler, reasonsHandler } = this.streamHandler.getHandlers()

			// Pipeline: calling_api
			this._session?.pipeline.setStage("calling_api")
			const stream = this.attemptApiRequest(previousApiReqIndex) // yields only if the first chunk is successful, otherwise will allow the user to retry the request (most likely due to rate limit error, which gets thrown on the first chunk)

			let assistantMessageId = ""
			let assistantMessage = "" // For UI display (includes XML)
			let assistantTextOnly = "" // For API history (text only, no tool XML)
			let assistantTextSignature: string | undefined
			this.nativeTextFinalized = false // Reset per-request flag

			// Pipeline: streaming
			this._session?.pipeline.setStage("streaming")
			this.taskState.isStreaming = true
			let didReceiveUsageChunk = false

			// [SHUNCODE-PERF] Throttled text presentation — update UI at ~30fps instead of per-token.
			// This prevents overwhelming the renderer while keeping output visually smooth.
			let textPresentScheduled = false
			const scheduleTextPresent = () => {
				if (textPresentScheduled) return
				textPresentScheduled = true
				setTimeout(() => {
					textPresentScheduled = false
					void this.presentAssistantMessage().catch((error) => {
						if (error instanceof Error && error.message === "Shuncode instance aborted") return
						Logger.debug("[Task] Failed to present message (throttled text stream): " + error)
					})
				}, 33)
			}

			// [SHUNCODE] Thinking timeout: abort if reasoning exceeds 100s without producing text/tools
			let reasoningStartTime: number | undefined
			let reasoningFinalized = false
			const THINKING_TIMEOUT_MS = 100_000 // 100 seconds
			let thinkingTimeoutId: ReturnType<typeof setTimeout> | undefined

			const startThinkingTimeout = () => {
				if (thinkingTimeoutId) return
				reasoningStartTime = Date.now()
				thinkingTimeoutId = setTimeout(async () => {
					if (!reasoningFinalized) {
						reasoningFinalized = true
						Logger.info("[Task] Thinking timeout exceeded 100s, aborting and injecting chunked-write hint")
						// Finalize reasoning message so the timer stops in UI
						const thinkingBlock = reasonsHandler.getCurrentReasoning()
						if (thinkingBlock?.thinking) {
							await this.say("reasoning", thinkingBlock.thinking, undefined, undefined, false).catch(() => { })
						}
						// Set flag so post-stream logic can inject chunked-write guidance
						this.taskState.thinkingTimeoutTriggered = true
						this.api.abort?.()
					}
				}, THINKING_TIMEOUT_MS)
			}

			const clearThinkingTimeout = () => {
				if (thinkingTimeoutId) {
					clearTimeout(thinkingTimeoutId)
					thinkingTimeoutId = undefined
				}
				reasoningFinalized = true
			}

			try {
				for await (const chunk of stream) {
					switch (chunk.type) {
						case "usage":
							this.streamHandler.setRequestId(chunk.id)
							didReceiveUsageChunk = true
							taskMetrics.inputTokens += chunk.inputTokens
							taskMetrics.outputTokens += chunk.outputTokens
							taskMetrics.cacheWriteTokens += chunk.cacheWriteTokens ?? 0
							taskMetrics.cacheReadTokens += chunk.cacheReadTokens ?? 0
							taskMetrics.totalCost = chunk.totalCost ?? taskMetrics.totalCost
							break
						case "reasoning": {
							// Start thinking timeout on first reasoning chunk
							if (!reasoningStartTime) {
								startThinkingTimeout()
							}

							// Process the reasoning delta through the handler
							// Ensure details is always an array
							const details = chunk.details ? (Array.isArray(chunk.details) ? chunk.details : [chunk.details]) : []
							reasonsHandler.processReasoningDelta({
								id: chunk.id,
								reasoning: chunk.reasoning,
								signature: chunk.signature,
								details,
								redacted_data: chunk.redacted_data,
							})

							// fixes bug where cancelling task > aborts task > for loop may be in middle of streaming reasoning > say function throws error before we get a chance to properly clean up and cancel the task.
							if (!this.taskState.abort) {
								const thinkingBlock = reasonsHandler.getCurrentReasoning()
								if (thinkingBlock?.thinking && chunk.reasoning) {
									await this.say("reasoning", thinkingBlock.thinking, undefined, undefined, true)
								}
							}

							break
						}
						case "tool_calls": {
							// Finalize reasoning timer when tool output starts (don't count tool execution as thinking time)
							if (!reasoningFinalized) {
								clearThinkingTimeout()
								const currentReasoning = reasonsHandler.getCurrentReasoning()
								if (currentReasoning?.thinking) {
									await this.say("reasoning", currentReasoning.thinking, undefined, undefined, false)
								}
							}

							// Accumulate tool use blocks in proper Anthropic format
							toolUseHandler.processToolUseDelta(
								{
									id: chunk.tool_call.function?.id,
									type: "tool_use",
									name: chunk.tool_call.function?.name,
									input: chunk.tool_call.function?.arguments,
									signature: chunk?.signature,
								},
								chunk.tool_call.call_id,
							)
							// Extract and store tool_use_id for creating proper ToolResultBlockParam
							// Use call_id as key to support multiple calls to the same tool
							if (chunk.tool_call.function?.id && chunk.tool_call.call_id) {
								this.taskState.toolUseIdMap.set(chunk.tool_call.call_id, chunk.tool_call.function.id)
							}

							this.processNativeToolCalls(assistantTextOnly, toolUseHandler.getPartialToolUsesAsContent())
							await this.presentAssistantMessage()
							break
						}
						case "text": {
							// Finalize reasoning timer when text output starts
							if (!reasoningFinalized) {
								clearThinkingTimeout()
								const currentReasoning = reasonsHandler.getCurrentReasoning()
								if (currentReasoning?.thinking && assistantMessage.length === 0) {
									// Complete the reasoning message (only once)
									await this.say("reasoning", currentReasoning.thinking, undefined, undefined, false)
								}
							}
							if (chunk.signature) {
								assistantTextSignature = chunk.signature
							}
							if (chunk.id) {
								assistantMessageId = chunk.id
							}
							assistantMessage += chunk.text
							assistantTextOnly += chunk.text // Accumulate text separately
							// parse raw assistant message into content blocks
							const prevLength = this.taskState.assistantMessageContent.length

							this.taskState.assistantMessageContent = parseAssistantMessageV2(assistantMessage)

							if (this.taskState.assistantMessageContent.length > prevLength) {
								this.taskState.userMessageContentReady = false // new content we need to present, reset to false in case previous content set this to true
							}
							// [SHUNCODE-PERF] Present text content without blocking the stream consumer.
							// Using fire-and-forget ensures the next chunk can be consumed immediately,
							// producing smooth token-by-token streaming instead of chunky output.
							// First chunk presents immediately for fast TTFT; subsequent chunks throttle at ~30fps.
							if (!assistantTextSignature && assistantMessage.length === chunk.text.length) {
								// First text chunk — present immediately for perceived responsiveness
								void this.presentAssistantMessage().catch((error) => {
									if (error instanceof Error && error.message === "Shuncode instance aborted") return
									Logger.debug("[Task] Failed to present message (first text chunk): " + error)
								})
							} else {
								scheduleTextPresent()
							}
							break
						}
					}

					// [SHUNCODE-PERF] Only await presentAssistantMessage for non-text chunks
					// (tool_calls already awaits inside its case branch, reasoning uses say directly).
					// For text chunks, the fire-and-forget above is sufficient — awaiting here
					// would block the async iterator and cause chunks to batch up, resulting
					// in choppy "block-by-block" output instead of smooth streaming.
					if (chunk.type !== "text") {
						await this.presentAssistantMessage().catch((error) =>
							Logger.debug("[Task] Failed to present message: " + error),
						)
					}

					if (this.taskState.abort) {
						this.api.abort?.()
						if (!this.taskState.abandoned) {
							// only need to gracefully abort if this instance isn't abandoned (sometimes openrouter stream hangs, in which case this would affect future instances of shuncode)
							await abortStream("user_cancelled")
						}
						break // aborts the stream
					}

					// Soft interrupt - stop stream but continue task (for interruptAndSend)
					if (this.taskState.softInterrupt) {
						this.api.abort?.()
						assistantMessage += "\n\n[Response interrupted by user]"
						this.taskState.userMessageContentReady = true // unblock pWaitFor
						break // exits stream loop but doesn't throw error
					}

					if (this.taskState.didRejectTool) {
						// userContent has a tool rejection, so interrupt the assistant's response to present the user's feedback
						assistantMessage += "\n\n[Response interrupted by user feedback]"
						// this.userMessageContentReady = true // instead of setting this preemptively, we allow the present iterator to finish and set userMessageContentReady when its ready
						break
					}

					// Interrupt stream if a tool was used and parallel calling is disabled
					// PREV: we need to let the request finish for openrouter to get generation details
					// UPDATE: it's better UX to interrupt the request at the cost of the api cost not being retrieved
					if (!this.isParallelToolCallingEnabled() && this.taskState.didAlreadyUseTool) {
						assistantMessage +=
							"\n\n[Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message.]"
						break
					}
				}
			} catch (error) {
				// If this was a soft interrupt (from interruptAndSend), don't treat as error
				if (this.taskState.softInterrupt || this.taskState.pendingUserMessage) {
					// Just continue - the stream was intentionally interrupted
					this.taskState.isStreaming = false
					return false // will continue the task loop
				}
				// Thinking timeout: retry with chunked-write guidance instead of failing
				if (this.taskState.thinkingTimeoutTriggered) {
					this.taskState.isStreaming = false
					this.taskState.thinkingTimeoutTriggered = false
					// Only retry once for thinking timeout — prevent infinite retry loops
					if (this.taskState.autoRetryAttempts >= 1) {
						await this.say("error", "Thinking timeout (>100s). Already retried — please try a simpler request or reduce thinking effort.").catch(() => { })
						this.abortTask()
						return true
					}
					this.taskState.autoRetryAttempts++
					await this.say("error", "Thinking timeout (>100s). Retrying with chunked writing strategy...").catch(() => { })
					// Inject guidance as user message and recurse
					const chunkHint: ShuncodeContent[] = [{
						type: "text",
						text: "<task>\n[SYSTEM] Your previous attempt timed out because you spent too long in reasoning (>100 seconds). " +
							"For large content writing tasks, you MUST use the append_to_file tool to write content in chunks (50-100 lines per call). " +
							"Do NOT try to generate all content in one response. " +
							"Split the content into multiple sequential append_to_file calls. Start writing immediately without excessive planning. " +
							"First call creates the file, subsequent calls append more content.\n</task>",
					}]
					await this.messageStateHandler.addToApiConversationHistory({
						role: "assistant",
						content: [{ type: "text", text: "[Response timed out during reasoning — retrying with chunked writing approach]" }],
					})
					return await this.recursivelyMakeShuncodeRequests(chunkHint)
				}
				// abandoned happens when extension is no longer waiting for the shuncode instance to finish aborting (error is thrown here when any function in the for loop throws due to this.abort)
				if (!this.taskState.abandoned) {
					const shuncodeError = ErrorService.get().toShuncodeError(error, this.api.getModel().id)
					const errorMessage = shuncodeError.serialize()
					// Auto-retry for streaming failures (always enabled)
					if (this.taskState.autoRetryAttempts < 3) {
						this.taskState.autoRetryAttempts++

						// Calculate exponential backoff for streaming failures: 2s, 4s, 8s
						const delay = 2000 * 2 ** (this.taskState.autoRetryAttempts - 1)

						// API Request component is updated to show error message, we then display retry information underneath that...
						await this.say(
							"error_retry",
							JSON.stringify({
								attempt: this.taskState.autoRetryAttempts,
								maxAttempts: 3,
								delaySeconds: delay / 1000,
								errorMessage,
							}),
						)

						// Wait with exponential backoff before auto-resuming
						setTimeoutPromise(delay).then(async () => {
							// Programmatically click the resume button on the new task instance
							if (this.controller.task) {
								// Pass retry state to the new task instance
								this.controller.task.taskState.autoRetryAttempts = this.taskState.autoRetryAttempts
								await this.controller.task.handleWebviewAskResponse("yesButtonClicked", "", [])
							}
						})
					} else if (this.taskState.autoRetryAttempts >= 3) {
						// Show error_retry with failed flag to indicate all retries exhausted
						await this.say(
							"error_retry",
							JSON.stringify({
								attempt: 3,
								maxAttempts: 3,
								delaySeconds: 0,
								failed: true, // Special flag to indicate retries exhausted
								errorMessage,
							}),
						)
					}

					// needs to happen after the say, otherwise the say would fail
					this.abortTask() // if the stream failed, there's various states the task could be in (i.e. could have streamed some tools the user may have executed), so we just resort to replicating a cancel task

					await abortStream("streaming_failed", errorMessage)
					await this.reinitExistingTaskFromId(this.taskId)
				}
			} finally {
				this.taskState.isStreaming = false
				clearThinkingTimeout() // Ensure timeout is always cleaned up
			}

			// Finalize any remaining tool calls at the end of the stream

			// OpenRouter/Shuncode may not return token usage as part of the stream (since it may abort early), so we fetch after the stream is finished
			// (updateApiReq below will update the api_req_started message with the usage details. we do this async so it updates the api_req_started message in the background)
			if (!didReceiveUsageChunk) {
				this.api.getApiStreamUsage?.().then(async (apiStreamUsage) => {
					if (apiStreamUsage) {
						taskMetrics.inputTokens += apiStreamUsage.inputTokens
						taskMetrics.outputTokens += apiStreamUsage.outputTokens
						taskMetrics.cacheWriteTokens += apiStreamUsage.cacheWriteTokens ?? 0
						taskMetrics.cacheReadTokens += apiStreamUsage.cacheReadTokens ?? 0
						taskMetrics.totalCost = apiStreamUsage.totalCost ?? taskMetrics.totalCost
					}
				})
			}

			// Update the api_req_started message with final usage and cost details
			await updateApiReqMsg({
				messageStateHandler: this.messageStateHandler,
				lastApiReqIndex,
				inputTokens: taskMetrics.inputTokens,
				outputTokens: taskMetrics.outputTokens,
				cacheWriteTokens: taskMetrics.cacheWriteTokens,
				cacheReadTokens: taskMetrics.cacheReadTokens,
				api: this.api,
				totalCost: taskMetrics.totalCost,
			})
			await this.messageStateHandler.saveShuncodeMessagesAndUpdateHistory()
			await this.postStateToWebview()

			// need to call here in case the stream was aborted
			if (this.taskState.abort) {
				throw new Error("Shuncode instance aborted")
			}

			// Thinking timeout: stream ended gracefully but timeout was triggered
			if (this.taskState.thinkingTimeoutTriggered) {
				this.taskState.thinkingTimeoutTriggered = false
				// Only retry once for thinking timeout — prevent infinite retry loops
				if (this.taskState.autoRetryAttempts >= 1) {
					await this.say("error", "Thinking timeout (>100s). Already retried — please try a simpler request or reduce thinking effort.").catch(() => { })
					this.abortTask()
					return true
				}
				this.taskState.autoRetryAttempts++
				await this.say("error", "Thinking timeout (>100s). Retrying with chunked writing strategy...").catch(() => { })
				const chunkHint: ShuncodeContent[] = [{
					type: "text",
					text: "<task>\n[SYSTEM] Your previous attempt timed out because you spent too long in reasoning (>100 seconds). " +
						"For large content writing tasks, you MUST use the append_to_file tool to write content in chunks (50-100 lines per call). " +
						"Do NOT try to generate all content in one response. " +
						"Split the content into multiple sequential append_to_file calls. Start writing immediately without excessive planning. " +
						"First call creates the file, subsequent calls append more content.\n</task>",
				}]
				await this.messageStateHandler.addToApiConversationHistory({
					role: "assistant",
					content: [{ type: "text", text: "[Response timed out during reasoning — retrying with chunked writing approach]" }],
				})
				return await this.recursivelyMakeShuncodeRequests(chunkHint)
			}

			// Stored the assistant API response immediately after the stream finishes in the same turn
			// NOTE: useNativeToolCalls alone does not guarantee content — we must also check if
			// actual tool call blocks were received from the stream. Otherwise an empty API response
			// would enter this branch and hang forever on pWaitFor(userMessageContentReady).
			const hasNativeToolContent = this.useNativeToolCalls && toolUseHandler.getAllFinalizedToolUses().length > 0
			const assistantHasContent = assistantMessage.length > 0 || hasNativeToolContent
			if (assistantHasContent) {
				telemetryService.captureConversationTurnEvent(
					this.ulid,
					providerId,
					model.id,
					"assistant",
					modelInfo.mode,
					{
						tokensIn: taskMetrics.inputTokens,
						tokensOut: taskMetrics.outputTokens,
						cacheWriteTokens: taskMetrics.cacheWriteTokens,
						cacheReadTokens: taskMetrics.cacheReadTokens,
						totalCost: taskMetrics.totalCost,
					},
					this.useNativeToolCalls,
				)

				const { reasonsHandler } = this.streamHandler.getHandlers()
				const redactedThinkingContent = reasonsHandler.getRedactedThinking()

				const requestId = this.streamHandler.requestId

				// Build content array with thinking blocks, text (if any), and tool use blocks
				const assistantContent: Array<ShuncodeAssistantContent> = [
					// This is critical for maintaining the model's reasoning flow and conversation integrity.
					// "When providing thinking blocks, the entire sequence of consecutive thinking blocks must match the outputs generated by the model during the original request; you cannot rearrange or modify the sequence of these blocks." The signature_delta is used to verify that the thinking was generated by Claude, and the thinking blocks will be ignored if it's incorrect or missing.
					// https://docs.claude.com/en/docs/build-with-claude/extended-thinking#preserving-thinking-blocks
					...redactedThinkingContent,
				]
				// Add thinking block from the reasoning handler if available
				const thinkingBlock = reasonsHandler.getCurrentReasoning()
				if (thinkingBlock) {
					assistantContent.push({ ...thinkingBlock })
				}

				// Only add text block if there's actual text (not just tool XML)
				const hasAssistantText = assistantTextOnly.trim().length > 0
				if (hasAssistantText) {
					assistantContent.push({
						type: "text",
						text: assistantTextOnly,
						// reasoning_details only exists for shuncode/openrouter providers
						reasoning_details: thinkingBlock?.summary as any[],
						signature: assistantTextSignature,
						call_id: assistantMessageId,
					})
				}

				// Get finalized tool use blocks from the handler
				const toolUseBlocks = toolUseHandler.getAllFinalizedToolUses(
					// NOTE: If there is no assistant text but there is a thinking block, we attach the summary to the tool use blocks
					// for providers that required reasoning traces included with assistant content.
					hasAssistantText ? undefined : thinkingBlock?.summary,
				)
				// Append tool use blocks if any exist
				if (toolUseBlocks.length > 0) {
					assistantContent.push(...toolUseBlocks)
				}

				// Append the assistant's content to the API conversation history only if there's content
				if (assistantContent.length > 0) {
					await this.messageStateHandler.addToApiConversationHistory({
						role: "assistant",
						content: assistantContent,
						modelInfo,
						id: requestId,
						metrics: {
							tokens: {
								prompt: taskMetrics.inputTokens,
								completion: taskMetrics.outputTokens,
								cached: (taskMetrics.cacheWriteTokens ?? 0) + (taskMetrics.cacheReadTokens ?? 0),
							},
							cost: taskMetrics.totalCost,
						},
					})
				}
			}

			this.taskState.didCompleteReadingStream = true

			// set any blocks to be complete to allow presentAssistantMessage to finish and set userMessageContentReady to true
			// (could be a text block that had no subsequent tool uses, or a text block at the very end, or an invalid tool use, etc. whatever the case, presentAssistantMessage relies on these blocks either to be completed or the user to reject a block in order to proceed and eventually set userMessageContentReady to true)
			const partialBlocks = this.taskState.assistantMessageContent.filter((block) => block.partial)
			partialBlocks.forEach((block) => {
				block.partial = false
			})
			// in case there are native tool calls pending
			const partialToolBlocks = toolUseHandler.getPartialToolUsesAsContent()?.map((block) => ({ ...block, partial: false }))
			this.processNativeToolCalls(assistantTextOnly, partialToolBlocks)

			if (partialBlocks.length > 0) {
				await this.presentAssistantMessage() // if there is content to update then it will complete and update this.userMessageContentReady to true, which we pwaitfor before making the next request. all this is really doing is presenting the last partial message that we just set to complete
			}

			// Safety net: if after finalization there's still no content to present (e.g. native tool calls
			// mode with only a text response and no tool blocks), ensure we don't hang on pWaitFor.
			// presentAssistantMessage would set this via the out-of-bounds check, but only if it's called.
			if (this.taskState.assistantMessageContent.length === 0 && this.taskState.didCompleteReadingStream) {
				this.taskState.userMessageContentReady = true
			}

			// now add to apiconversationhistory
			// need to save assistant responses to file before proceeding to tool use since user can exit at any moment and we wouldn't be able to save the assistant's response
			let didEndLoop = false
			if (assistantHasContent) {
				// NOTE: this comment is here for future reference - this was a workaround for userMessageContent not getting set to true. It was due to it not recursively calling for partial blocks when didRejectTool, so it would get stuck waiting for a partial block to complete before it could continue.
				// in case the content blocks finished
				// it may be the api stream finished after the last parsed content block was executed, so  we are able to detect out of bounds and set userMessageContentReady to true (note you should not call presentAssistantMessage since if the last block is completed it will be presented again)
				// const completeBlocks = this.assistantMessageContent.filter((block) => !block.partial) // if there are any partial blocks after the stream ended we can consider them invalid
				// if (this.currentStreamingContentIndex >= completeBlocks.length) {
				// 	this.userMessageContentReady = true
				// }

				await pWaitFor(() => this.taskState.userMessageContentReady)

				// [SHUNCODE] TEMPORARILY DISABLED — legacy Cline shadow-git checkpoint
				// await this.checkpointManager?.saveCheckpoint()

				// if the model did not tool use, then we need to tell it to either use a tool or attempt_completion
				const didToolUse = this.taskState.assistantMessageContent.some((block) => block.type === "tool_use")

				if (!didToolUse) {
					if (assistantTextOnly.trim().length > 0 && !this.taskState.pendingUserMessage) {
						const { text, images, files } = await this.ask("completion_result", "", false)
						const hasContent = (text && text.trim()) || (images && images.length > 0) || (files && files.length > 0)

						if (!hasContent) {
							return true
						}

						this.taskState.pendingUserMessage = { text: text ?? "", images, files }
					}

					// Workflow step: text-only response means step is complete — exit immediately
					if (this.taskState.isWorkflowStep) {
						this.taskState.stepCompleted = true
						return true
					}

					if (!this.taskState.pendingUserMessage) {
						// normal request where tool use is required
						this.taskState.userMessageContent.push({
							type: "text",
							text: formatResponse.noToolsUsed(this.useNativeToolCalls),
						})
						this.taskState.consecutiveMistakeCount++
					}
				}

				// Reset auto-retry counter for each new API request
				this.taskState.autoRetryAttempts = 0

				// Check for pending user message from interruptAndSend
				let nextUserContent = this.taskState.userMessageContent
				if (this.taskState.pendingUserMessage) {
					const pending = this.taskState.pendingUserMessage
					this.taskState.pendingUserMessage = undefined

					// Show user message in UI
					await this.say("user_feedback", pending.text, pending.images, pending.files)

					// Use pending message instead
					nextUserContent = [{ type: "text", text: `<task>\n${pending.text}\n</task>` }]
					this.taskState.consecutiveMistakeCount = 0
				}

				// Workflow step completed (e.g. via attempt_completion) — stop recursion
				if (this.taskState.isWorkflowStep && this.taskState.stepCompleted) {
					didEndLoop = true
				} else {
					const recDidEndLoop = await this.recursivelyMakeShuncodeRequests(nextUserContent)
					didEndLoop = recDidEndLoop
				}
			} else {
				// if there's no assistant_responses, that means we got no text or tool_use content blocks from API which we should assume is an error
				const { model, providerId } = this.getCurrentProviderInfo()
				const reqId = this.getApiRequestIdSafe()

				// Minimal diagnostics: structured log and telemetry
				telemetryService.captureProviderApiError({
					ulid: this.ulid,
					model: model.id,
					provider: providerId,
					errorMessage: "empty_assistant_message",
					requestId: reqId,
					isNativeToolCall: this.useNativeToolCalls,
				})

				const baseErrorMessage =
					"Invalid API Response: The provider returned an empty or unparsable response. This is a provider-side issue where the model failed to generate valid output or returned tool calls that Shuncode cannot process. Retrying the request may help resolve this issue."
				const errorText = reqId ? `${baseErrorMessage} (Request ID: ${reqId})` : baseErrorMessage

				await this.say("error", errorText)
				await this.messageStateHandler.addToApiConversationHistory({
					role: "assistant",
					content: [
						{
							type: "text",
							text: "Failure: I did not provide a response.",
						},
					],
					modelInfo,
					id: this.streamHandler.requestId,
					metrics: {
						tokens: {
							prompt: taskMetrics.inputTokens,
							completion: taskMetrics.outputTokens,
							cached: (taskMetrics.cacheWriteTokens ?? 0) + (taskMetrics.cacheReadTokens ?? 0),
						},
						cost: taskMetrics.totalCost,
					},
				})

				let response: ShuncodeAskResponse

				const noResponseErrorMessage = "No assistant message was received. Would you like to retry the request?"

				if (this.taskState.autoRetryAttempts < 3) {
					// Auto-retry enabled with max 3 attempts: automatically approve the retry
					this.taskState.autoRetryAttempts++

					// Calculate delay: 2s, 4s, 8s
					const delay = 2000 * 2 ** (this.taskState.autoRetryAttempts - 1)
					response = "yesButtonClicked"
					await this.say(
						"error_retry",
						JSON.stringify({
							attempt: this.taskState.autoRetryAttempts,
							maxAttempts: 3,
							delaySeconds: delay / 1000,
							errorMessage: noResponseErrorMessage,
						}),
					)
					await setTimeoutPromise(delay)
				} else {
					// Max retries exhausted (>= 3 attempts), ask user
					await this.say(
						"error_retry",
						JSON.stringify({
							attempt: 3,
							maxAttempts: 3,
							delaySeconds: 0,
							failed: true, // Special flag to indicate retries exhausted
							errorMessage: noResponseErrorMessage,
						}),
					)
					const askResult = await this.ask("api_req_failed", noResponseErrorMessage)
					response = askResult.response
					// Reset retry counter if user chooses to manually retry
					if (response === "yesButtonClicked") {
						this.taskState.autoRetryAttempts = 0
					}
				}

				if (response === "yesButtonClicked") {
					// Signal the loop to continue (i.e., do not end), so it will attempt again
					return false
				}

				// Returns early to avoid retry since user dismissed
				return true
			}

			return didEndLoop // will always be false for now
		} catch (_error) {
			// this should never happen since the only thing that can throw an error is the attemptApiRequest, which is wrapped in a try catch that sends an ask where if noButtonClicked, will clear current task and destroy this instance. However to avoid unhandled promise rejection, we will end this loop which will end execution of this instance (see startTask)
			return true // needs to be true so parent loop knows to end task
		}
	}

	async loadContext(
		userContent: ShuncodeContent[],
		includeFileDetails: boolean = false,
		useCompactPrompt = false,
	): Promise<[ShuncodeContent[], string, boolean]> {
		let needsShuncoderulesFileCheck = false

		// Pre-fetch necessary data to avoid redundant calls within loops
		const ulid = this.ulid
		const focusChainSettings = this.stateManager.getGlobalSettingsKey("focusChainSettings")
		const useNativeToolCalls = this.stateManager.getGlobalStateKey("nativeToolCallEnabled")
		const providerInfo = this.getCurrentProviderInfo()
		const cwd = this.cwd
		const { localWorkflowToggles, globalWorkflowToggles } = await refreshWorkflowToggles(this.controller, cwd)

		const hasUserContentTag = (text: string): boolean => {
			return USER_CONTENT_TAGS.some((tag) => text.includes(tag))
		}

		const parseTextBlock = async (text: string): Promise<string> => {
			const parsedText = await parseMentions(
				text,
				cwd,
				this.urlContentFetcher,
				this.fileContextTracker,
				this.workspaceManager,
			)

			const { processedText, needsShuncoderulesFileCheck: needsCheck } = await parseSlashCommands(
				parsedText,
				localWorkflowToggles,
				globalWorkflowToggles,
				ulid,
				focusChainSettings,
				useNativeToolCalls,
				providerInfo,
			)

			if (needsCheck) {
				needsShuncoderulesFileCheck = true
			}

			return processedText
		}

		const processTextContent = async (block: ShuncodeTextContentBlock): Promise<ShuncodeTextContentBlock> => {
			if (block.type !== "text" || !hasUserContentTag(block.text)) {
				return block
			}

			const processedText = await parseTextBlock(block.text)
			return { ...block, text: processedText }
		}

		const processContentBlock = async (block: ShuncodeContent): Promise<ShuncodeContent> => {
			if (block.type === "text") {
				return processTextContent(block)
			}

			if (block.type === "tool_result") {
				if (!block.content) {
					return block
				}

				// Handle string content
				if (typeof block.content === "string") {
					const processed = await processTextContent({ type: "text", text: block.content })
					// Creates NEW object and turns the string content as array
					return { ...block, content: [processed] }
				}

				// Handle array content
				if (Array.isArray(block.content)) {
					const processedContent = await Promise.all(
						block.content.map(async (contentBlock) => {
							return contentBlock.type === "text" ? processTextContent(contentBlock) : contentBlock
						}),
					)

					return { ...block, content: processedContent }
				}
			}

			return block
		}

		// Process all content and environment details in parallel
		// NOTE: (Ara) This is a temporary solution to dynamically load context mentions from tool results. It checks for the presence of tags that indicate that the tool was rejected and feedback was provided (see formatToolDeniedFeedback, attemptCompletion, executeCommand, and consecutiveMistakeCount >= 3) or "<answer>" (see askFollowupQuestion), we place all user generated content in these tags so they can effectively be used as markers for when we should parse mentions). However if we allow multiple tools responses in the future, we will need to parse mentions specifically within the user content tags.
		// (Note: this caused the @/ import alias bug where file contents were being parsed as well, since v2 converted tool results to text blocks)
		const [processedUserContent, environmentDetails] = await Promise.all([
			Promise.all(userContent.map(processContentBlock)),
			this.getEnvironmentDetails(includeFileDetails),
		])

		// Check shuncoderulesData if needed
		const shuncoderulesError = needsShuncoderulesFileCheck
			? await ensureLocalShuncodeDirExists(this.cwd, GlobalFileNames.shuncodeRules)
			: false

		// Add focus chain instructions if needed
		if (!useCompactPrompt && this.FocusChainManager?.shouldIncludeFocusChainInstructions()) {
			const focusChainInstructions = this.FocusChainManager.generateFocusChainInstructions()
			if (focusChainInstructions.trim()) {
				processedUserContent.push({
					type: "text",
					text: focusChainInstructions,
				})

				this.taskState.apiRequestsSinceLastTodoUpdate = 0
				this.taskState.todoListWasUpdatedByUser = false
			}
		}

		return [processedUserContent, environmentDetails, shuncoderulesError]
	}

	private nativeTextFinalized = false

	processNativeToolCalls(assistantTextOnly: string, toolBlocks: ToolUse[]) {
		if (!toolBlocks?.length) {
			return
		}

		// Get finalized tool uses and mark them as complete
		const textContent = assistantTextOnly.trim()
		const textBlocks: AssistantMessageContent[] = textContent ? [{ type: "text", content: textContent, partial: false }] : []

		this.taskState.assistantMessageContent = [...textBlocks, ...toolBlocks]

		// Only set the index on the FIRST tool_calls chunk.
		// After that, presentAssistantMessage manages index advancement naturally.
		if (!this.nativeTextFinalized) {
			this.nativeTextFinalized = true
			// Skip text block — go directly to tool blocks so streaming isn't blocked
			// by text finalization IO (saveShuncodeMessages). Text was already streamed
			// via scheduleTextPresent; finalize it asynchronously.
			this.taskState.currentStreamingContentIndex = textBlocks.length
			this.taskState.userMessageContentReady = false
			// Finalize text message in background (non-blocking)
			if (textContent) {
				void this.say("text", textContent, undefined, undefined, false).catch(() => { })
			}
		}
	}

	async getEnvironmentDetails(includeFileDetails: boolean = false) {
		return buildEnvironmentDetails(
			{
				cwd: this.cwd,
				taskId: this.taskId,
				taskState: this.taskState,
				stateManager: this.stateManager,
				terminalManager: this.terminalManager,
				shuncodeIgnoreController: this.shuncodeIgnoreController,
				fileContextTracker: this.fileContextTracker,
				workspaceManager: this.workspaceManager,
				messageStateHandler: this.messageStateHandler,
				api: this.api,
			},
			includeFileDetails,
		)
	}
}
