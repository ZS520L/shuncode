import type { Anthropic } from "@anthropic-ai/sdk"
import { applyOpenAiReasoningEffort, buildApiHandler } from "@core/api"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import { tryAcquireTaskLockWithRetry } from "@core/task/TaskLockUtils"
import { detectWorkspaceRoots } from "@core/workspace/detection"
import { setupWorkspaceManager } from "@core/workspace/setup"
import type { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { ShuncodeAccountService } from "@services/account/ShuncodeAccountService"
import { McpHub } from "@services/mcp/McpHub"
import type { ApiProvider, ModelInfo } from "@shared/api"
import type { ChatContent } from "@shared/ChatContent"
import type { ExtensionState, Platform, PendingChangeInfo } from "@shared/ExtensionMessage"
import { getPendingChangesStorage } from "@core/diff-v2/storage/PendingChangesStorage"
import { getDiffSystem } from "@core/diff-v2"
import { getBackendLocaleForPreferredLanguage, setBackendLocale, t } from "../../i18n/backend-i18n"
import type { HistoryItem } from "@shared/HistoryItem"
import type { McpMarketplaceCatalog, McpMarketplaceItem } from "@shared/mcp"
import type { Settings } from "@shared/storage/state-keys"
import { getApiSettingsMode, type Mode } from "@shared/storage/types"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import type { UserInfo } from "@shared/UserInfo"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import open from "open"
import pWaitFor from "p-wait-for"
import * as path from "path"
import type { FolderLockWithRetryResult } from "src/core/locks/types"
import * as vscode from "vscode"
import { ShuncodeEnv } from "@/config"
import { HostProvider } from "@/hosts/host-provider"
import { WebviewProvider } from "@core/webview/WebviewProvider"
import { ExtensionRegistryInfo } from "@/registry"
import { AuthService } from "@/services/auth/AuthService"
import { OcaAuthService } from "@/services/auth/oca/OcaAuthService"
import { LogoutReason } from "@/services/auth/types"
import { BannerService } from "@/services/banner/BannerService"
import { featureFlagsService } from "@/services/feature-flags"
import { getDistinctId } from "@/services/logging/distinctId"
import { telemetryService } from "@/services/telemetry"
import { BannerCardData } from "@/shared/shuncode/banner"
import { DEFAULT_FAST_CONTEXT_CONFIG, type FastContextConfig } from "@/shared/FastContextTypes"
import { getAxiosSettings } from "@/shared/net"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { getLatestAnnouncementId } from "@/utils/announcements"
import { sendAccountButtonClickedEvent } from "./ui/subscribeToAccountButtonClicked"
import { getCwd, getDesktopDir } from "@/utils/path"
import { PromptRegistry } from "../prompts/system-prompt"
import { getModelCapabilityTier, getSessionLimitsForModel } from "@utils/model-utils"
import {
	ensureCacheDirectoryExists,
	ensureMcpServersDirectoryExists,
	ensureSettingsDirectoryExists,
	GlobalFileNames,
	writeMcpMarketplaceCatalogToCache,
} from "../storage/disk"
import { fetchRemoteConfig } from "../storage/remote-config/fetch"
import { clearRemoteConfig } from "../storage/remote-config/utils"
import { type PersistenceErrorEvent, StateManager } from "../storage/StateManager"
import { Task } from "../task"
import { SessionManager } from "../session"
import { sendMcpMarketplaceCatalogEvent } from "./mcp/subscribeToMcpMarketplaceCatalog"
import { getShuncodeOnboardingModels } from "./models/getShuncodeOnboardingModels"
import { appendShuncodeStealthModels } from "./models/refreshOpenRouterModels"
import { checkCliInstallation } from "./state/checkCliInstallation"
import { sendStateUpdate } from "./state/subscribeToState"
import { sendChatButtonClickedEvent } from "./ui/subscribeToChatButtonClicked"

/*
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts

https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
*/

export class Controller {
	task?: Task

	/**
	 * SessionManager - управление сессиями (замена controller.task в будущем).
	 * Шаг 1: работает параллельно с this.task для обратной совместимости.
	 * Каждый initTask/clearTask синхронизирует текущую сессию с Task.
	 */
	readonly sessionManager = new SessionManager()

	mcpHub: McpHub
	accountService: ShuncodeAccountService
	authService: AuthService
	ocaAuthService: OcaAuthService
	readonly stateManager: StateManager

	// NEW: Add workspace manager (optional initially)
	private workspaceManager?: WorkspaceRootManager
	private backgroundCommandRunning = false
	private backgroundCommandTaskId?: string

	// Flag to prevent duplicate cancellations from spam clicking
	private cancelInProgress = false

	// Timer for periodic remote config fetching
	private remoteConfigTimer?: NodeJS.Timeout

	// Public getter for workspace manager with lazy initialization - To get workspaces when task isn't initialized (Used by file mentions)
	async ensureWorkspaceManager(): Promise<WorkspaceRootManager | undefined> {
		if (!this.workspaceManager) {
			try {
				this.workspaceManager = await setupWorkspaceManager({
					stateManager: this.stateManager,
					detectRoots: detectWorkspaceRoots,
				})
			} catch (error) {
				Logger.error("[Controller] Failed to initialize workspace manager:", error)
			}
		}
		return this.workspaceManager
	}

	// Synchronous getter for workspace manager
	getWorkspaceManager(): WorkspaceRootManager | undefined {
		return this.workspaceManager
	}

	async ensureNewChatSession(): Promise<void> {
		if (this.sessionManager.size === 0) {
			const session = this.sessionManager.create()
			this.sessionManager.switchTo(session.id)
		} else if (!this.sessionManager.activeSessionId) {
			const session = this.sessionManager.getAll().at(0)
			if (session) {
				this.sessionManager.switchTo(session.id)
			}
		}

		await this.postStateToWebview()
	}

	/**
	 * Starts the periodic remote config fetching timer
	 * Fetches immediately and then every hour
	 */
	private startRemoteConfigTimer() {
		// Initial fetch
		fetchRemoteConfig(this)
		// Set up 1-hour interval
		this.remoteConfigTimer = setInterval(() => fetchRemoteConfig(this), 3600000) // 1 hour
	}

	constructor(readonly context: vscode.ExtensionContext) {
		PromptRegistry.getInstance() // Ensure prompts and tools are registered
		HostProvider.get().logToChannel("ShuncodeProvider instantiated")
		this.stateManager = StateManager.get()
		StateManager.get().registerCallbacks({
			onPersistenceError: async ({ error }: PersistenceErrorEvent) => {
				// Just log - don't call reInitialize() (that sets isInitialized=false which
				// breaks running tasks) and don't show a warning (data is safe in memory
				// and will be retried automatically on the next debounced persistence).
				Logger.error("[Controller] Storage persistence failed (will retry):", error)
			},
			onSyncExternalChange: async () => {
				await this.postStateToWebview()
			},
		})
		this.authService = AuthService.getInstance(this)
		this.ocaAuthService = OcaAuthService.initialize(this)
		this.accountService = ShuncodeAccountService.getInstance()

		// Migrate away from deprecated "shuncode" provider on startup
		const initConfig = this.stateManager.getApiConfiguration()
		if (initConfig.planModeApiProvider === "shuncode" || initConfig.actModeApiProvider === "shuncode") {
			const migrated = { ...initConfig }
			if (migrated.planModeApiProvider === "shuncode") migrated.planModeApiProvider = "openrouter" as ApiProvider
			if (migrated.actModeApiProvider === "shuncode") migrated.actModeApiProvider = "openrouter" as ApiProvider
			this.stateManager.setApiConfiguration(migrated)
		}

		this.authService.restoreRefreshTokenAndRetrieveAuthInfo().then(() => {
			this.startRemoteConfigTimer()
		})

		this.mcpHub = new McpHub(
			() => ensureMcpServersDirectoryExists(),
			() => ensureSettingsDirectoryExists(),
			ExtensionRegistryInfo.version,
			telemetryService,
		)

		// Check CLI installation status once on startup
		checkCliInstallation(this)
	}

	/*
	VSCode extensions use the disposable pattern to clean up resources when the sidebar/editor tab is closed by the user or system. This applies to event listening, commands, interacting with the UI, etc.
	- https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/
	- https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
	*/
	async dispose() {
		// Clear the remote config timer
		if (this.remoteConfigTimer) {
			clearInterval(this.remoteConfigTimer)
			this.remoteConfigTimer = undefined
		}

		// Dispose all sessions (multi-tab cleanup)
		this.sessionManager.dispose()
		await this.clearTask()
		this.mcpHub.dispose()

		Logger.error("Controller disposed")
	}

	// Auth methods
	async handleSignOut() {
		try {
			// AuthService now handles its own storage cleanup in handleDeauth()
			this.stateManager.setGlobalState("userInfo", undefined)
			clearRemoteConfig()

			// Update API providers through cache service
			const apiConfiguration = this.stateManager.getApiConfiguration()
			const updatedConfig = {
				...apiConfiguration,
				planModeApiProvider: "openrouter" as ApiProvider,
				actModeApiProvider: "openrouter" as ApiProvider,
			}
			this.stateManager.setApiConfiguration(updatedConfig)

			await this.postStateToWebview()
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: t("auth.logoutSuccess"),
			})
		} catch (_error) {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: t("auth.logoutFailed"),
			})
		}
	}

	// Oca Auth methods
	async handleOcaSignOut() {
		try {
			await this.ocaAuthService.handleDeauth(LogoutReason.USER_INITIATED)
			await this.postStateToWebview()
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: t("auth.oca.logoutSuccess"),
			})
		} catch (_error) {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: t("auth.oca.logoutFailed"),
			})
		}
	}

	async setUserInfo(info?: UserInfo) {
		this.stateManager.setGlobalState("userInfo", info)
	}

	// Number of messages a user can send without authentication before being asked to sign in
	static readonly FREE_REQUEST_LIMIT = 20

	/**
	 * Checks if the user has exceeded the free request limit.
	 * If not authenticated and limit reached — navigates to Account view.
	 * If not authenticated and under limit — increments counter.
	 * @returns true if the request is allowed, false if blocked (limit reached)
	 */
	async checkFreeRequestGate(): Promise<boolean> {
		const apiConfiguration = this.stateManager.getApiConfiguration()
		const mode = this.stateManager.getGlobalSettingsKey("mode")
		const isPlan = getApiSettingsMode(mode) === "plan"
		const providerId = isPlan ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider

		// Only ShunCode's hosted/free provider requires account gating.
		// BYOK/custom providers must work without signing in to a ShunCode account.
		if (providerId !== "shuncode") {
			return true
		}

		const authService = AuthService.getInstance()
		const isAuthenticated = authService["_authenticated"]

		if (isAuthenticated) {
			return true
		}

		const freeCount = this.stateManager.getGlobalStateKey("freeRequestCount") ?? 0
		if (freeCount >= Controller.FREE_REQUEST_LIMIT) {
			Logger.log(`[FreeGate] Free request limit reached (${freeCount}/${Controller.FREE_REQUEST_LIMIT}), auth required`)
			// Show notification and navigate to Account view
			vscode.window.showInformationMessage(t("auth.freeLimit", { limit: String(Controller.FREE_REQUEST_LIMIT) }))
			try {
				await sendAccountButtonClickedEvent()
			} catch (e) {
				Logger.error("[FreeGate] Failed to navigate to account view:", e)
			}
			return false
		}

		// Increment counter
		this.stateManager.setGlobalState("freeRequestCount", freeCount + 1)
		Logger.log(`[FreeGate] Free request ${freeCount + 1}/${Controller.FREE_REQUEST_LIMIT}`)
		return true
	}

	async initTask(
		task?: string,
		images?: string[],
		files?: string[],
		historyItem?: HistoryItem,
		taskSettings?: Partial<Settings>,
	) {
		// === Free-trial gate: require auth after N messages ===
		if (!historyItem) {
			const allowed = await this.checkFreeRequestGate()
			if (!allowed) {
				return undefined
			}
		}

		// Fire-and-forget: We intentionally don't await fetchRemoteConfig here.
		// Remote config is already fetched in startRemoteConfigTimer() which runs in the constructor,
		// so enterprise policies (yoloModeAllowed, allowedMCPServers, etc.) are already applied.
		// This call just ensures we have the latest state, but we shouldn't block the UI for it.
		// getGlobalSettingsKey() reads from remoteConfigCache on each call, so any updates
		// will apply as soon as this fetch completes. The function also calls postStateToWebview()
		// when done and catches all errors internally.
		fetchRemoteConfig(this)

		// Multi-tab: suspend existing task instead of destroying it
		await this.suspendCurrentTask()

		const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")
		const shellIntegrationTimeout = this.stateManager.getGlobalSettingsKey("shellIntegrationTimeout")
		const terminalReuseEnabled = this.stateManager.getGlobalStateKey("terminalReuseEnabled")
		const vscodeTerminalExecutionMode = this.stateManager.getGlobalStateKey("vscodeTerminalExecutionMode")
		const terminalOutputLineLimit = this.stateManager.getGlobalSettingsKey("terminalOutputLineLimit")
		const subagentTerminalOutputLineLimit = this.stateManager.getGlobalSettingsKey("subagentTerminalOutputLineLimit")
		const defaultTerminalProfile = this.stateManager.getGlobalSettingsKey("defaultTerminalProfile")
		const isNewUser = this.stateManager.getGlobalStateKey("isNewUser")
		const taskHistory = this.stateManager.getGlobalStateKey("taskHistory")

		const NEW_USER_TASK_COUNT_THRESHOLD = 10

		// Check if the user has completed enough tasks to no longer be considered a "new user"
		if (isNewUser && !historyItem && taskHistory && taskHistory.length >= NEW_USER_TASK_COUNT_THRESHOLD) {
			this.stateManager.setGlobalState("isNewUser", false)
			await this.postStateToWebview()
		}

		if (autoApprovalSettings) {
			const updatedAutoApprovalSettings = {
				...autoApprovalSettings,
				version: (autoApprovalSettings.version ?? 1) + 1,
			}
			this.stateManager.setGlobalState("autoApprovalSettings", updatedAutoApprovalSettings)
		}

		// Initialize and persist the workspace manager (multi-root or single-root) with telemetry + fallback
		this.workspaceManager = await setupWorkspaceManager({
			stateManager: this.stateManager,
			detectRoots: detectWorkspaceRoots,
		})

		const cwd = this.workspaceManager?.getPrimaryRoot()?.path || (await getCwd(getDesktopDir()))

		const taskId = historyItem?.id || Date.now().toString()

		// Acquire task lock
		let taskLockAcquired = false
		const lockResult: FolderLockWithRetryResult = await tryAcquireTaskLockWithRetry(taskId)

		if (!lockResult.acquired && !lockResult.skipped) {
			const errorMessage = lockResult.conflictingLock
				? `Task locked by instance (${lockResult.conflictingLock.held_by})`
				: "Failed to acquire task lock"
			throw new Error(errorMessage) // Prevents task initialization
		}

		taskLockAcquired = lockResult.acquired
		if (lockResult.acquired) {
			Logger.debug(`[Task ${taskId}] Task lock acquired`)
		} else {
			Logger.debug(`[Task ${taskId}] Task lock skipped (VS Code)`)
		}

		await this.stateManager.loadTaskSettings(taskId)
		if (taskSettings) {
			this.stateManager.setTaskSettingsBatch(taskId, taskSettings)
		}

		this.task = new Task({
			controller: this,
			mcpHub: this.mcpHub,
			updateTaskHistory: (historyItem) => this.updateTaskHistory(historyItem),
			postStateToWebview: () => this.postStateToWebview(),
			reinitExistingTaskFromId: (taskId) => this.reinitExistingTaskFromId(taskId),
			cancelTask: () => this.cancelTask(),
			shellIntegrationTimeout,
			terminalReuseEnabled: terminalReuseEnabled ?? true,
			terminalOutputLineLimit: terminalOutputLineLimit ?? 500,
			subagentTerminalOutputLineLimit: subagentTerminalOutputLineLimit ?? 2000,
			defaultTerminalProfile: defaultTerminalProfile ?? "default",
			vscodeTerminalExecutionMode,
			cwd,
			stateManager: this.stateManager,
			workspaceManager: this.workspaceManager,
			task,
			images,
			files,
			historyItem,
			taskId,
			taskLockAcquired,
		})

		// --- SESSION SYNC: привязываем Task <-> Session двусторонне ---
		// If the active session is empty (no task bound), remove it first to avoid orphan tabs.
		// This happens when user creates a new tab via "+" then sends a message.
		const activeSession = this.sessionManager.currentSession
		if (activeSession && !activeSession.task) {
			this.sessionManager.remove(activeSession.id)
		}

		const session = this.sessionManager.create(taskId)
		this.sessionManager.switchTo(session.id)
		session.setTask(this.task)
		this.task.setSession(session)

		// v4: привязываем DiffSystem к текущей задаче для scoped rollback
		try {
			const diffSystem = getDiffSystem()
			diffSystem.setCurrentTaskId(taskId)
		} catch {
			// DiffSystem may not be initialized yet
		}

		if (historyItem) {
			this.task.resumeTaskFromHistory()
		} else if (task || images || files) {
			this.task.startTask(task, images, files)
		}

		return this.task.taskId
	}

	async reinitExistingTaskFromId(taskId: string) {
		const history = await this.getTaskWithId(taskId)
		if (history) {
			await this.initTask(undefined, undefined, undefined, history.historyItem)
		}
	}

	async updateTelemetrySetting(telemetrySetting: TelemetrySetting) {
		this.stateManager.setGlobalState("telemetrySetting", telemetrySetting)
		const isOptedIn = telemetrySetting !== "disabled"
		telemetryService.updateTelemetryState(isOptedIn)
		await this.postStateToWebview()
	}

	rebuildTaskApiHandler(mode: Mode = this.stateManager.getGlobalSettingsKey("mode")): void {
		if (!this.task) {
			return
		}

		const apiConfiguration = applyOpenAiReasoningEffort(
			this.stateManager.getApiConfiguration(),
			mode,
			this.stateManager.getGlobalSettingsKey("openaiReasoningEffort"),
		)

		this.task.api = buildApiHandler({ ...apiConfiguration, ulid: this.task.ulid }, mode)
	}

	async toggleActModeForYoloMode(): Promise<boolean> {
		const modeToSwitchTo: Mode = "act"

		// Switch to act mode
		this.stateManager.setGlobalState("mode", modeToSwitchTo)

		// Update API handler with new mode (buildApiHandler now selects provider based on mode)
		if (this.task) {
			this.rebuildTaskApiHandler(modeToSwitchTo)
		}

		await this.postStateToWebview()

		// Additional safety
		if (this.task) {
			return true
		}
		return false
	}

	async togglePlanActMode(modeToSwitchTo: Mode, chatContent?: ChatContent): Promise<boolean> {
		// Both "act" and "debug" modes have full tool access, so switching to either
		// should auto-approve a pending plan response
		const didSwitchToWriteMode = modeToSwitchTo === "act" || modeToSwitchTo === "debug"

		// Store mode to global state
		this.stateManager.setGlobalState("mode", modeToSwitchTo)

		// Capture mode switch telemetry | Capture regardless of if we know the taskId
		telemetryService.captureModeSwitch(this.task?.ulid ?? "0", modeToSwitchTo)

		// Update API handler with new mode (buildApiHandler now selects provider based on mode)
		if (this.task) {
			this.rebuildTaskApiHandler(modeToSwitchTo)
		}

		await this.postStateToWebview()

		if (this.task) {
			if (this.task.taskState.isAwaitingPlanResponse && didSwitchToWriteMode) {
				this.task.taskState.didRespondToPlanAskBySwitchingMode = true
				// Use chatContent if provided, otherwise use default message
				await this.task.handleWebviewAskResponse(
					"messageResponse",
					chatContent?.message || "PLAN_MODE_TOGGLE_RESPONSE",
					chatContent?.images || [],
					chatContent?.files || [],
				)

				return true
			} else {
				this.cancelTask()
				return false
			}
		}

		return false
	}

	async cancelTask() {
		// Prevent duplicate cancellations from spam clicking
		if (this.cancelInProgress) {
			Logger.log(`[Controller.cancelTask] Cancellation already in progress, ignoring duplicate request`)
			return
		}

		if (!this.task) {
			return
		}

		// Set flag to prevent concurrent cancellations
		this.cancelInProgress = true

		try {
			this.updateBackgroundCommandState(false)

			try {
				await this.task.abortTask()
			} catch (error) {
				Logger.error("Failed to abort task", error)
			}

			await pWaitFor(
				() =>
					this.task === undefined ||
					this.task.taskState.isStreaming === false ||
					this.task.taskState.didFinishAbortingStream ||
					this.task.taskState.isWaitingForFirstChunk, // if only first chunk is processed, then there's no need to wait for graceful abort (closes edits, browser, etc)
				{
					timeout: 3_000,
				},
			).catch(() => {
				Logger.error("Failed to abort task")
			})

			if (this.task) {
				// 'abandoned' will prevent this shuncode instance from affecting future shuncode instance gui. this may happen if its hanging on a streaming request
				this.task.taskState.abandoned = true
			}

			// Small delay to ensure state manager has persisted the history update
			//await new Promise((resolve) => setTimeout(resolve, 100))

			// NOW try to get history after abort has finished (hook may have saved messages)
			let historyItem: HistoryItem | undefined
			try {
				const result = await this.getTaskWithId(this.task.taskId)
				historyItem = result.historyItem
			} catch (error) {
				// Task not in history yet (new task with no messages); catch the
				// error to enable the agent to continue making progress.
				Logger.log(`[Controller.cancelTask] Task not found in history: ${error}`)
			}

			// Only re-initialize if we found a history item, otherwise just clear
			if (historyItem) {
				// Re-initialize task to keep it visible in UI with resume button
				await this.initTask(undefined, undefined, undefined, historyItem, undefined)
			} else {
				await this.clearTask()
			}

			await this.postStateToWebview()
		} finally {
			// Always clear the flag, even if cancellation fails
			this.cancelInProgress = false
		}
	}

	updateBackgroundCommandState(running: boolean, taskId?: string) {
		const nextTaskId = running ? taskId : undefined
		if (this.backgroundCommandRunning === running && this.backgroundCommandTaskId === nextTaskId) {
			return
		}
		this.backgroundCommandRunning = running
		this.backgroundCommandTaskId = nextTaskId
		void this.postStateToWebview()
	}

	async cancelBackgroundCommand(): Promise<void> {
		const didCancel = await this.task?.cancelBackgroundCommand()
		if (!didCancel) {
			this.updateBackgroundCommandState(false)
		}
	}

	async handleAuthCallback(customToken: string, provider: string | null = null) {
		try {
			await this.authService.handleAuthCallback(customToken, provider ? provider : "google")

			// Mark welcome view as completed since user has successfully logged in
			this.stateManager.setGlobalState("welcomeViewCompleted", true)

			// Migrate away from "shuncode" provider (not available yet)
			const currentApiConfiguration = this.stateManager.getApiConfiguration()
			if (
				currentApiConfiguration.planModeApiProvider === "shuncode" ||
				currentApiConfiguration.actModeApiProvider === "shuncode"
			) {
				const updatedConfig = { ...currentApiConfiguration }
				if (updatedConfig.planModeApiProvider === "shuncode")
					updatedConfig.planModeApiProvider = "openrouter" as ApiProvider
				if (updatedConfig.actModeApiProvider === "shuncode")
					updatedConfig.actModeApiProvider = "openrouter" as ApiProvider
				this.stateManager.setApiConfiguration(updatedConfig)
			}

			await fetchRemoteConfig(this)

			if (this.task) {
				const currentMode = this.stateManager.getGlobalSettingsKey("mode")
				this.rebuildTaskApiHandler(currentMode)
			}

			await this.postStateToWebview()
		} catch (error) {
			Logger.error("Failed to handle auth callback:", error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: t("auth.loginFailed"),
			})
			// Even on login failure, we preserve any existing tokens
			// Only clear tokens on explicit logout
		}
	}

	async handleOcaAuthCallback(code: string, state: string) {
		try {
			await this.ocaAuthService.handleAuthCallback(code, state)

			const ocaProvider: ApiProvider = "oca"

			// Get current settings to determine how to update providers
			const planActSeparateModelsSetting = this.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")

			const currentMode = this.stateManager.getGlobalSettingsKey("mode")

			// Get current API configuration from cache
			const currentApiConfiguration = this.stateManager.getApiConfiguration()

			const updatedConfig = { ...currentApiConfiguration }

			if (planActSeparateModelsSetting) {
				// Only update the current mode's provider
				if (currentMode === "plan") {
					updatedConfig.planModeApiProvider = ocaProvider
				} else {
					updatedConfig.actModeApiProvider = ocaProvider
				}
			} else {
				// Update both modes to keep them in sync
				updatedConfig.planModeApiProvider = ocaProvider
				updatedConfig.actModeApiProvider = ocaProvider
			}

			// Update the API configuration through cache service
			this.stateManager.setApiConfiguration(updatedConfig)

			// Mark welcome view as completed since user has successfully logged in
			this.stateManager.setGlobalState("welcomeViewCompleted", true)

			if (this.task) {
				this.rebuildTaskApiHandler(currentMode)
			}

			await this.postStateToWebview()
		} catch (error) {
			Logger.error("Failed to handle auth callback:", error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: t("auth.oca.loginFailed"),
			})
			// Even on login failure, we preserve any existing tokens
			// Only clear tokens on explicit logout
		}
	}

	async handleMcpOAuthCallback(serverHash: string, code: string, state: string | null) {
		try {
			await this.mcpHub.completeOAuth(serverHash, code, state)
			await this.postStateToWebview()
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: t("mcp.authSuccess"),
			})
		} catch (error) {
			Logger.error("Failed to complete MCP OAuth:", error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: t("mcp.authFailed"),
			})
		}
	}

	async handleTaskCreation(prompt: string) {
		await sendChatButtonClickedEvent()
		await this.initTask(prompt)
	}

	// MCP Marketplace
	private async fetchMcpMarketplaceFromApi(): Promise<McpMarketplaceCatalog> {
		let rawItems: McpMarketplaceItem[]

		try {
			// Try API first
			const response = await axios.get(`${ShuncodeEnv.config().mcpBaseUrl}/marketplace`, {
				headers: {
					"Content-Type": "application/json",
					"User-Agent": "shuncode-vscode-extension",
				},
				timeout: 5000,
				...getAxiosSettings(),
			})
			rawItems = response.data || []
		} catch {
			// Fallback: static bundled catalog (TODO: remove when own API is ready)
			Logger.log("[MCP Marketplace] API unavailable, loading static catalog")
			const catalogPath = path.join(__dirname, "assets", "mcp-marketplace-catalog.json")
			const catalogData = await fs.readFile(catalogPath, "utf-8")
			rawItems = JSON.parse(catalogData)
		}

		if (!Array.isArray(rawItems)) {
			throw new Error("Invalid MCP marketplace catalog data")
		}

		// Get allowlist from remote config
		const allowedMCPServers = this.stateManager.getRemoteConfigSettings().allowedMCPServers

		let items: McpMarketplaceItem[] = rawItems.map((item: McpMarketplaceItem) => ({
			...item,
			githubStars: item.githubStars ?? 0,
			downloadCount: item.downloadCount ?? 0,
			tags: item.tags ?? [],
		}))

		// Filter by allowlist if configured
		if (allowedMCPServers) {
			const allowedIds = new Set(allowedMCPServers.map((server) => server.id))
			items = items.filter((item: McpMarketplaceItem) => allowedIds.has(item.mcpId))
		}

		const catalog: McpMarketplaceCatalog = { items }

		// Store in cache file
		await writeMcpMarketplaceCatalogToCache(catalog)
		return catalog
	}

	async refreshMcpMarketplace(sendCatalogEvent: boolean): Promise<McpMarketplaceCatalog | undefined> {
		try {
			const catalog = await this.fetchMcpMarketplaceFromApi()
			if (catalog && sendCatalogEvent) {
				await sendMcpMarketplaceCatalogEvent(catalog)
			}
			return catalog
		} catch (error) {
			Logger.error("Failed to refresh MCP marketplace:", error)
			return undefined
		}
	}

	// OpenRouter

	async handleOpenRouterCallback(code: string) {
		let apiKey: string
		try {
			const response = await axios.post("https://openrouter.ai/api/v1/auth/keys", { code }, getAxiosSettings())
			if (response.data && response.data.key) {
				apiKey = response.data.key
			} else {
				throw new Error("Invalid response from OpenRouter API")
			}
		} catch (error) {
			Logger.error("Error exchanging code for API key:", error)
			throw error
		}

		const openrouter: ApiProvider = "openrouter"
		const currentMode = this.stateManager.getGlobalSettingsKey("mode")

		// Update API configuration through cache service
		const currentApiConfiguration = this.stateManager.getApiConfiguration()
		const updatedConfig = {
			...currentApiConfiguration,
			planModeApiProvider: openrouter,
			actModeApiProvider: openrouter,
			openRouterApiKey: apiKey,
		}
		this.stateManager.setApiConfiguration(updatedConfig)

		await this.postStateToWebview()
		if (this.task) {
			this.rebuildTaskApiHandler(currentMode)
		}
		// Dont send settingsButtonClicked because its bad ux if user is on welcome
	}

	// Requesty

	async handleRequestyCallback(code: string) {
		const requesty: ApiProvider = "requesty"
		const currentMode = this.stateManager.getGlobalSettingsKey("mode")
		const currentApiConfiguration = this.stateManager.getApiConfiguration()
		const updatedConfig = {
			...currentApiConfiguration,
			planModeApiProvider: requesty,
			actModeApiProvider: requesty,
			requestyApiKey: code,
		}
		this.stateManager.setApiConfiguration(updatedConfig)
		await this.postStateToWebview()
		if (this.task) {
			this.rebuildTaskApiHandler(currentMode)
		}
	}

	// Read OpenRouter models from disk cache
	async readOpenRouterModels(): Promise<Record<string, ModelInfo> | undefined> {
		const openRouterModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.openRouterModels)
		try {
			if (await fileExistsAtPath(openRouterModelsFilePath)) {
				const fileContents = await fs.readFile(openRouterModelsFilePath, "utf8")
				const models = JSON.parse(fileContents)
				// Append stealth models
				return appendShuncodeStealthModels(models)
			}
		} catch (error) {
			Logger.error("Error reading cached OpenRouter models:", error)
		}
		return undefined
	}

	// Task history

	async getTaskWithId(id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		contextHistoryFilePath: string
		taskMetadataFilePath: string
		apiConversationHistory: Anthropic.MessageParam[]
	}> {
		const history = this.stateManager.getGlobalStateKey("taskHistory")
		const historyItem = history.find((item) => item.id === id)
		if (historyItem) {
			const taskDirPath = path.join(HostProvider.get().globalStorageFsPath, "tasks", id)
			const apiConversationHistoryFilePath = path.join(taskDirPath, GlobalFileNames.apiConversationHistory)
			const uiMessagesFilePath = path.join(taskDirPath, GlobalFileNames.uiMessages)
			const contextHistoryFilePath = path.join(taskDirPath, GlobalFileNames.contextHistory)
			const taskMetadataFilePath = path.join(taskDirPath, GlobalFileNames.taskMetadata)
			const fileExists = await fileExistsAtPath(apiConversationHistoryFilePath)
			if (fileExists) {
				const apiConversationHistory = JSON.parse(await fs.readFile(apiConversationHistoryFilePath, "utf8"))
				return {
					historyItem,
					taskDirPath,
					apiConversationHistoryFilePath,
					uiMessagesFilePath,
					contextHistoryFilePath,
					taskMetadataFilePath,
					apiConversationHistory,
				}
			}
		}
		// if we tried to get a task that doesn't exist, remove it from state
		// FIXME: this seems to happen sometimes when the json file doesn't save to disk for some reason
		await this.deleteTaskFromState(id)
		throw new Error("Task not found")
	}

	async exportTaskWithId(id: string) {
		const { taskDirPath } = await this.getTaskWithId(id)
		Logger.log(`[EXPORT] Opening task directory: ${taskDirPath}`)
		await open(taskDirPath)
	}

	async deleteTaskFromState(id: string) {
		// Remove the task from history
		const taskHistory = this.stateManager.getGlobalStateKey("taskHistory")
		const updatedTaskHistory = taskHistory.filter((task) => task.id !== id)
		this.stateManager.setGlobalState("taskHistory", updatedTaskHistory)

		// Notify the webview that the task has been deleted
		await this.postStateToWebview()

		return updatedTaskHistory
	}

	// [SHUNCODE-PERF] Throttle postStateToWebview to prevent extension host overload.
	// Multiple callers (indexing, task updates, settings changes) can trigger this
	// dozens of times per second. We coalesce into at most one call per 300ms.
	private _postStateThrottleTimer: ReturnType<typeof setTimeout> | null = null
	private _postStatePending = false
	private _postStatePromiseResolvers: Array<() => void> = []

	async postStateToWebview() {
		// If a throttled call is already pending, just mark that we need another update
		if (this._postStateThrottleTimer) {
			this._postStatePending = true
			return new Promise<void>((resolve) => {
				this._postStatePromiseResolvers.push(resolve)
			})
		}

		// Execute immediately
		await this._doPostStateToWebview()

		// Set up throttle window — any calls during this window will be coalesced
		this._postStateThrottleTimer = setTimeout(async () => {
			this._postStateThrottleTimer = null
			if (this._postStatePending) {
				this._postStatePending = false
				const resolvers = this._postStatePromiseResolvers
				this._postStatePromiseResolvers = []
				await this._doPostStateToWebview()
				resolvers.forEach((r) => r())
			}
		}, 300)
	}

	private async _doPostStateToWebview() {
		const state = await this.getStateToPostToWebview()
		await sendStateUpdate(state)

		// Update native title bar session tabs
		try {
			const tabs = this.getSessionTabsInfo()
			const currentId = this.sessionManager.activeSessionId ?? undefined
			WebviewProvider.getInstance().updateSessionTabs(tabs, currentId)
		} catch {
			// Ignore if provider not ready
		}
	}

	// [SHUNCODE-PERF] Cache OpenAI Codex auth status (refreshed at most every 30s)
	private _codexAuthCache: { authenticated: boolean; checkedAt: number } | null = null

	private async _getCodexAuthStatus(): Promise<boolean> {
		if (this._codexAuthCache && Date.now() - this._codexAuthCache.checkedAt < 30_000) {
			return this._codexAuthCache.authenticated
		}
		try {
			const { openAiCodexOAuthManager } = await import("@/integrations/openai-codex/oauth")
			const authenticated = await openAiCodexOAuthManager.isAuthenticated()
			this._codexAuthCache = { authenticated, checkedAt: Date.now() }
			return authenticated
		} catch {
			return this._codexAuthCache?.authenticated ?? false
		}
	}

	async getStateToPostToWebview(): Promise<ExtensionState> {
		// [SHUNCODE-SHUNCODE] Capture indexing progress IMMEDIATELY before any awaits.
		// getStateToPostToWebview has multiple awaits (getBanners, openAiCodex, etc.)
		// that yield to the event loop. During those yields, Fast Context continues and
		// progress advances. If we read progress after the awaits, we miss intermediate states.

		// Get API configuration from cache for immediate access
		const onboardingModels = getShuncodeOnboardingModels()
		const apiConfiguration = this.stateManager.getApiConfiguration()
		const lastShownAnnouncementId = this.stateManager.getGlobalStateKey("lastShownAnnouncementId")
		const taskHistory = this.stateManager.getGlobalStateKey("taskHistory")
		const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")
		const browserSettings = this.stateManager.getGlobalSettingsKey("browserSettings")
		const focusChainSettings = this.stateManager.getGlobalSettingsKey("focusChainSettings")
		const preferredLanguage = this.stateManager.getGlobalSettingsKey("preferredLanguage")
		// Sync backend i18n locale on every state push (covers startup + runtime changes)
		if (preferredLanguage) {
			setBackendLocale(getBackendLocaleForPreferredLanguage(preferredLanguage))
		}
		const alwaysThinkInPreferredLanguage = this.stateManager.getGlobalSettingsKey("alwaysThinkInPreferredLanguage")
		const openaiReasoningEffort = this.stateManager.getGlobalSettingsKey("openaiReasoningEffort")
		const mode = this.stateManager.getGlobalSettingsKey("mode")
		const strictPlanModeEnabled = this.stateManager.getGlobalSettingsKey("strictPlanModeEnabled")
		const yoloModeToggled = this.stateManager.getGlobalSettingsKey("yoloModeToggled")
		const useAutoCondense = this.stateManager.getGlobalSettingsKey("useAutoCondense")
		const userInfo = this.stateManager.getGlobalStateKey("userInfo")
		const mcpMarketplaceEnabled = this.stateManager.getGlobalStateKey("mcpMarketplaceEnabled")
		const mcpDisplayMode = this.stateManager.getGlobalStateKey("mcpDisplayMode")
		const telemetrySetting = this.stateManager.getGlobalSettingsKey("telemetrySetting")
		const planActSeparateModelsSetting = this.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
		const enableCheckpointsSetting = this.stateManager.getGlobalSettingsKey("enableCheckpointsSetting")
		const globalShuncodeRulesToggles = this.stateManager.getGlobalSettingsKey("globalShuncodeRulesToggles")
		const globalWorkflowToggles = this.stateManager.getGlobalSettingsKey("globalWorkflowToggles")
		const globalSkillsToggles = this.stateManager.getGlobalSettingsKey("globalSkillsToggles")
		const localSkillsToggles = this.stateManager.getWorkspaceStateKey("localSkillsToggles")
		const remoteRulesToggles = this.stateManager.getGlobalStateKey("remoteRulesToggles")
		const remoteWorkflowToggles = this.stateManager.getGlobalStateKey("remoteWorkflowToggles")
		const shellIntegrationTimeout = this.stateManager.getGlobalSettingsKey("shellIntegrationTimeout")
		const terminalReuseEnabled = this.stateManager.getGlobalStateKey("terminalReuseEnabled")
		const vscodeTerminalExecutionMode = this.stateManager.getGlobalStateKey("vscodeTerminalExecutionMode")
		const defaultTerminalProfile = this.stateManager.getGlobalSettingsKey("defaultTerminalProfile")
		const isNewUser = this.stateManager.getGlobalStateKey("isNewUser")
		// Can be undefined but is set to either true or false by the migration that runs on extension launch in extension.ts
		const welcomeViewCompleted = true // !!this.stateManager.getGlobalStateKey("welcomeViewCompleted")

		const customPrompt = this.stateManager.getGlobalSettingsKey("customPrompt")
		const systemPromptSettings = this.stateManager.getGlobalSettingsKey("systemPromptSettings")
		const toolCustomizationSettings = this.stateManager.getGlobalSettingsKey("toolCustomizationSettings")
		const mcpResponsesCollapsed = this.stateManager.getGlobalStateKey("mcpResponsesCollapsed")
		const terminalOutputLineLimit = this.stateManager.getGlobalSettingsKey("terminalOutputLineLimit")
		const maxConsecutiveMistakes = this.stateManager.getGlobalSettingsKey("maxConsecutiveMistakes")
		const subagentTerminalOutputLineLimit = this.stateManager.getGlobalSettingsKey("subagentTerminalOutputLineLimit")
		const favoritedModelIds = this.stateManager.getGlobalStateKey("favoritedModelIds")
		const lastDismissedInfoBannerVersion = this.stateManager.getGlobalStateKey("lastDismissedInfoBannerVersion") || 0
		const lastDismissedModelBannerVersion = this.stateManager.getGlobalStateKey("lastDismissedModelBannerVersion") || 0
		const lastDismissedCliBannerVersion = this.stateManager.getGlobalStateKey("lastDismissedCliBannerVersion") || 0
		const subagentsEnabled = this.stateManager.getGlobalSettingsKey("subagentsEnabled")
		const skillsEnabled = this.stateManager.getGlobalSettingsKey("skillsEnabled")

		const localShuncodeRulesToggles = this.stateManager.getWorkspaceStateKey("localShuncodeRulesToggles")
		const localWindsurfRulesToggles = this.stateManager.getWorkspaceStateKey("localWindsurfRulesToggles")
		const localCursorRulesToggles = this.stateManager.getWorkspaceStateKey("localCursorRulesToggles")
		const localAgentsRulesToggles = this.stateManager.getWorkspaceStateKey("localAgentsRulesToggles")
		const workflowToggles = this.stateManager.getWorkspaceStateKey("workflowToggles")
		const autoCondenseThreshold = this.stateManager.getGlobalSettingsKey("autoCondenseThreshold")

		const currentTaskItem = this.task?.taskId ? (taskHistory || []).find((item) => item.id === this.task?.taskId) : undefined
		const shuncodeMessages = this.task?.messageStateHandler.getShuncodeMessages() || []
		const currentSessionId = this.sessionManager.activeSessionId ?? undefined
		const sessionTabs = this.getSessionTabsInfo()
		if (sessionTabs.length > 0) {
			Logger.info(
				`[postState] sessionTabs: ${JSON.stringify(sessionTabs.map((t) => ({ id: t.id.slice(0, 8), title: t.title, state: t.state })))}`,
			)
		}
		const checkpointManagerErrorMessage = undefined

		const processedTaskHistory = (taskHistory || [])
			.filter((item) => item.ts && item.task)
			.sort((a, b) => b.ts - a.ts)
			.slice(0, 100) // for now we're only getting the latest 100 tasks, but a better solution here is to only pass in 3 for recent task history, and then get the full task history on demand when going to the task history view (maybe with pagination?)

		const latestAnnouncementId = getLatestAnnouncementId()
		const shouldShowAnnouncement = lastShownAnnouncementId !== latestAnnouncementId
		const platform = process.platform as Platform
		const distinctId = getDistinctId()
		const version = ExtensionRegistryInfo.version
		const environment = ShuncodeEnv.config().environment
		const banners: BannerCardData[] = []

		// [SHUNCODE-PERF] Use cached auth status instead of dynamic import + async check on every call
		const openAiCodexIsAuthenticated = await this._getCodexAuthStatus()

		return {
			version,
			apiConfiguration,
			currentTaskItem,
			currentSessionId,
			sessionTabs: sessionTabs.length > 0 ? sessionTabs : undefined,
			shuncodeMessages,
			currentFocusChainChecklist: this.task?.taskState.currentFocusChainChecklist || null,
			checkpointManagerErrorMessage,
			autoApprovalSettings,
			browserSettings,
			focusChainSettings,
			preferredLanguage,
			alwaysThinkInPreferredLanguage,
			openaiReasoningEffort,
			mode,
			strictPlanModeEnabled,
			yoloModeToggled,
			useAutoCondense,
			userInfo,
			mcpMarketplaceEnabled,
			mcpDisplayMode,
			telemetrySetting,
			planActSeparateModelsSetting,
			enableCheckpointsSetting: enableCheckpointsSetting ?? true,
			platform,
			environment,
			distinctId,
			globalShuncodeRulesToggles: globalShuncodeRulesToggles || {},
			localShuncodeRulesToggles: localShuncodeRulesToggles || {},
			localWindsurfRulesToggles: localWindsurfRulesToggles || {},
			localCursorRulesToggles: localCursorRulesToggles || {},
			localAgentsRulesToggles: localAgentsRulesToggles || {},
			localWorkflowToggles: workflowToggles || {},
			globalWorkflowToggles: globalWorkflowToggles || {},
			globalSkillsToggles: globalSkillsToggles || {},
			localSkillsToggles: localSkillsToggles || {},
			remoteRulesToggles: remoteRulesToggles,
			remoteWorkflowToggles: remoteWorkflowToggles,
			shellIntegrationTimeout,
			terminalReuseEnabled,
			vscodeTerminalExecutionMode: vscodeTerminalExecutionMode,
			defaultTerminalProfile,
			isNewUser,
			welcomeViewCompleted,
			onboardingModels,
			mcpResponsesCollapsed,
			terminalOutputLineLimit,
			maxConsecutiveMistakes,
			subagentTerminalOutputLineLimit,
			customPrompt,
			systemPromptSettings,
			toolCustomizationSettings,
			taskHistory: processedTaskHistory,
			shouldShowAnnouncement,
			favoritedModelIds,
			autoCondenseThreshold,
			backgroundCommandRunning: this.backgroundCommandRunning,
			backgroundCommandTaskId: this.backgroundCommandTaskId,
			// NEW: Add workspace information
			workspaceRoots: this.workspaceManager?.getRoots() ?? [],
			primaryRootIndex: this.workspaceManager?.getPrimaryIndex() ?? 0,
			isMultiRootWorkspace: (this.workspaceManager?.getRoots().length ?? 0) > 1,
			multiRootSetting: {
				user: this.stateManager.getGlobalStateKey("multiRootEnabled"),
				featureFlag: true, // Multi-root workspace is now always enabled
			},
			shuncodeWebToolsEnabled: {
				user: this.stateManager.getGlobalSettingsKey("shuncodeWebToolsEnabled"),
				featureFlag: true, // Web tools are always available, gated by authentication
			},
			worktreesEnabled: {
				user: this.stateManager.getGlobalSettingsKey("worktreesEnabled"),
				featureFlag: featureFlagsService.getWorktreesEnabled(),
			},
			hooksEnabled: getHooksEnabledSafe(),
			lastDismissedInfoBannerVersion,
			lastDismissedModelBannerVersion,
			remoteConfigSettings: this.stateManager.getRemoteConfigSettings(),
			lastDismissedCliBannerVersion,
			subagentsEnabled,
			nativeToolCallSetting: this.stateManager.getGlobalStateKey("nativeToolCallEnabled"),
			enableParallelToolCalling: this.stateManager.getGlobalSettingsKey("enableParallelToolCalling"),
			backgroundEditEnabled: this.stateManager.getGlobalSettingsKey("backgroundEditEnabled"),
			imageGenerationBaseUrl: this.stateManager.getGlobalSettingsKey("imageGenerationBaseUrl"),
			imageGenerationApiKey: this.stateManager.getGlobalSettingsKey("imageGenerationApiKey"),
			imageGenerationModelId: this.stateManager.getGlobalSettingsKey("imageGenerationModelId"),
			skillsEnabled,
			optOutOfRemoteConfig: this.stateManager.getGlobalSettingsKey("optOutOfRemoteConfig"),
			// Shuncode AI: Lightweight mode for weak models
			lightweightMode: this.stateManager.getGlobalSettingsKey("lightweightMode"),
			// Shuncode AI: Active prompt profile (variant + tier + limits)
			promptProfile: (() => {
				try {
					const apiConfig = this.stateManager.getApiConfiguration()
					const mode = this.stateManager.getGlobalSettingsKey("mode")
					const isPlan = getApiSettingsMode(mode) === "plan"
					const providerId = (isPlan ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string
					const modeKey = isPlan ? "planMode" : "actMode"
					const providerModelSuffix: Record<string, string> = {
						openrouter: "OpenRouterModelId",
						shuncode: "OpenRouterModelId",
						openai: "OpenAiModelId",
						ollama: "OllamaModelId",
						lmstudio: "LmStudioModelId",
						litellm: "LiteLlmModelId",
						requesty: "RequestyModelId",
						together: "TogetherModelId",
						fireworks: "FireworksModelId",
						groq: "GroqModelId",
						baseten: "BasetenModelId",
						huggingface: "HuggingFaceModelId",
						sapaicore: "SapAiCoreModelId",
						"huawei-cloud-maas": "HuaweiCloudMaasModelId",
						oca: "OcaModelId",
						aihubmix: "AihubmixModelId",
						hicap: "HicapModelId",
						nousResearch: "NousResearchModelId",
						"vercel-ai-gateway": "VercelAiGatewayModelId",
					}
					const configModelId = (apiConfig as Record<string, unknown>)[
						`${modeKey}${providerModelSuffix[providerId] ?? "ApiModelId"}`
					] as string | undefined
					const modelId = this.task?.api?.getModel()?.id ?? configModelId ?? "unknown"
					const providerInfo = { model: { id: modelId, info: {} as ModelInfo }, providerId, mode }
					const tier = getModelCapabilityTier(modelId, providerInfo)
					const limits = getSessionLimitsForModel(modelId, providerInfo)
					const registry = PromptRegistry.getInstance()
					const variant = registry.getModelFamily({
						providerInfo,
						lightweightMode: this.stateManager.getGlobalSettingsKey("lightweightMode") === true,
					} as any)
					return {
						variant,
						tier,
						maxToolCalls: limits.maxToolCallsPerTurn,
						maxReadOnly: limits.maxConsecutiveReadOnlyTools,
						compactEvery: limits.forceCompactAfterSteps,
					}
				} catch {
					return undefined
				}
			})(),
			// Shuncode AI: Edit tools settings (driven by lightweightMode)
			useSimplifiedEditTools: this.stateManager.getGlobalSettingsKey("lightweightMode") === true,
			validateSyntaxBeforeApply: vscode.workspace
				.getConfiguration("shuncode")
				.get<boolean>("validateSyntaxBeforeApply", false),
			blockOnSyntaxErrors: vscode.workspace.getConfiguration("shuncode").get<boolean>("blockOnSyntaxErrors", false),
			// Shuncode AI: Fast Context sub-agent config
			fastContextConfig: (() => {
				const cfg = vscode.workspace.getConfiguration("shuncode.fastContext")
				return {
					enabled: cfg.get("enabled", DEFAULT_FAST_CONTEXT_CONFIG.enabled),
					apiUrl: cfg.get("apiUrl", DEFAULT_FAST_CONTEXT_CONFIG.apiUrl),
					apiKey: cfg.get("apiKey", DEFAULT_FAST_CONTEXT_CONFIG.apiKey),
					modelId: cfg.get("modelId", DEFAULT_FAST_CONTEXT_CONFIG.modelId),
					maxTurns: cfg.get("maxTurns", DEFAULT_FAST_CONTEXT_CONFIG.maxTurns),
					maxParallelCalls: cfg.get("maxParallelCalls", DEFAULT_FAST_CONTEXT_CONFIG.maxParallelCalls),
					timeoutSeconds: cfg.get("timeoutSeconds", DEFAULT_FAST_CONTEXT_CONFIG.timeoutSeconds),
					systemPrompt: cfg.get("systemPrompt", DEFAULT_FAST_CONTEXT_CONFIG.systemPrompt),
					excludePatterns: cfg.get("excludePatterns", DEFAULT_FAST_CONTEXT_CONFIG.excludePatterns),
					maxReadFileSize: cfg.get("maxReadFileSize", DEFAULT_FAST_CONTEXT_CONFIG.maxReadFileSize),
					showProgress: cfg.get("showProgress", DEFAULT_FAST_CONTEXT_CONFIG.showProgress),
				} satisfies FastContextConfig
			})(),
			// Shuncode AI: Pending changes for inline diffs
			pendingChanges: this.getPendingChangesInfo(),
			banners,
			openAiCodexIsAuthenticated,
			// Free-trial gate
			freeRequestCount: this.stateManager.getGlobalStateKey("freeRequestCount") ?? 0,
			freeRequestLimit: Controller.FREE_REQUEST_LIMIT,
		}
	}

	/**
	 * Get pending changes info for webview display
	 */
	private getPendingChangesInfo(): PendingChangeInfo[] {
		try {
			const storage = getPendingChangesStorage()
			const fileStats = storage.getFileStats()
			return fileStats.map((stats) => ({
				id: stats.fsPath, // Use fsPath as id for grouping
				fileName: stats.fileName,
				fsPath: stats.fsPath,
				addedCount: stats.addedCount,
				removedCount: stats.removedCount,
			}))
		} catch {
			return []
		}
	}

	async clearTask() {
		if (this.task) {
			// Clear task settings cache when task ends
			await this.stateManager.clearTaskSettings()
		}
		await this.task?.abortTask()
		this.task = undefined // removes reference to it, so once promises end it will be garbage collected

		// v4: завершаем текущий checkpoint при переключении задач
		try {
			const diffSystem = getDiffSystem()
			await diffSystem.finishCheckpoint()
		} catch {
			// DiffSystem may not be initialized
		}

		// --- SESSION SYNC: очищаем текущую сессию ---
		this.sessionManager.clearCurrent()
	}

	/**
	 * Detach the current task from the controller without stopping it.
	 * The session remains in SessionManager and continues running in the background.
	 * Used for multi-tab: all sessions stay active simultaneously.
	 */
	async suspendCurrentTask() {
		if (!this.task) {
			return
		}

		// Finish the current DiffSystem checkpoint
		try {
			const diffSystem = getDiffSystem()
			await diffSystem.finishCheckpoint()
		} catch {
			// DiffSystem may not be initialized
		}

		// Clear task settings cache for the outgoing task
		await this.stateManager.clearTaskSettings()

		// Detach from controller (session+task keep running in background)
		this.task = undefined
	}

	/**
	 * Switch to an existing session by ID (multi-tab support).
	 * All sessions keep running; this just switches which one the controller displays.
	 */
	async switchToSession(sessionId: string): Promise<boolean> {
		const targetSession = this.sessionManager.get(sessionId)
		if (!targetSession) {
			Logger.error(`[Controller.switchToSession] Session ${sessionId} not found`)
			return false
		}

		// If already active, nothing to do
		if (this.sessionManager.activeSessionId === sessionId) {
			return true
		}

		// Detach current task from controller (it keeps running in its session)
		await this.suspendCurrentTask()

		// Switch active session pointer
		this.sessionManager.switchTo(sessionId)

		// Attach the target session's task to controller for display
		const targetTask = targetSession.task
		if (targetTask) {
			this.task = targetTask

			// Re-load task settings for the displayed task
			await this.stateManager.loadTaskSettings(targetTask.taskId)

			// Restore DiffSystem context
			try {
				const diffSystem = getDiffSystem()
				diffSystem.setCurrentTaskId(targetTask.taskId)
			} catch {
				// DiffSystem may not be initialized
			}
		}

		await this.postStateToWebview()
		return true
	}

	/**
	 * Close a session tab by ID. Destroys the session and its task.
	 * If closing the active session, switches to another available session.
	 */
	async closeSession(sessionId: string): Promise<void> {
		const session = this.sessionManager.get(sessionId)
		if (!session) {
			return
		}

		const isActive = this.sessionManager.activeSessionId === sessionId

		// Abort the session's task if it has one
		const sessionTask = session.task
		if (sessionTask) {
			await sessionTask.abortTask()
			if (isActive) {
				this.task = undefined
			}
		}

		// Remove from session manager (handles switching active if needed)
		this.sessionManager.remove(sessionId)

		// If we closed the active session, restore the new active session's task
		if (isActive) {
			const newActive = this.sessionManager.currentSession
			if (newActive?.task) {
				this.task = newActive.task
				await this.stateManager.loadTaskSettings(newActive.task.taskId)
				try {
					const diffSystem = getDiffSystem()
					diffSystem.setCurrentTaskId(newActive.task.taskId)
				} catch {
					// DiffSystem may not be initialized
				}
				newActive.resume()
			}
		}

		await this.postStateToWebview()

		if (this.sessionManager.size === 0) {
			await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar")
		}
	}

	/**
	 * Get summary info for all active sessions (for tab bar rendering).
	 * State is derived from the task's actual runtime state, not session's cached state.
	 */
	getSessionTabsInfo(): Array<{ id: string; title: string; state: "idle" | "running" | "paused" | "done" | "error" }> {
		return this.sessionManager.getAll().map((session) => {
			let title = "ShunCode"

			// First try: get the first user message from the task's messages
			const taskMessages = session.task?.messageStateHandler?.getShuncodeMessages()
			if (taskMessages?.length) {
				const firstUserMsg = taskMessages.find((m) => m.type === "say" && m.say === "user_feedback")
				if (firstUserMsg?.text) {
					title = firstUserMsg.text.substring(0, 50)
				}
			}

			// Fallback: check task history
			if (title === "ShunCode") {
				const taskHistory = this.stateManager.getGlobalStateKey("taskHistory")
				const historyItem = taskHistory?.find((item) => item.id === session.id)
				if (historyItem?.task) {
					title = historyItem.task.substring(0, 50)
				}
			}

			// Derive state from actual task runtime, not cached session.state
			const state = this.deriveSessionState(session)

			return {
				id: session.id,
				title,
				state,
			}
		})
	}

	/**
	 * Derive the real state of a session by inspecting its task's runtime flags.
	 * This is a polling-safe check — works even if task crashed without callback.
	 */
	private deriveSessionState(session: { task: Task | null; state: string }): "idle" | "running" | "paused" | "done" | "error" {
		const task = session.task
		if (!task) {
			return "idle"
		}

		const ts = task.taskState

		// Task was aborted or abandoned
		if (ts.abandoned || (ts.abort && ts.didFinishAbortingStream)) {
			return "done"
		}

		// Task is actively streaming or waiting for API response
		if (ts.isStreaming || ts.isWaitingForFirstChunk) {
			return "running"
		}

		// Task is waiting for user input (has a pending ask)
		if (ts.lastMessageTs !== undefined) {
			return "paused"
		}

		// Task initialized but not streaming — either done or idle between turns
		if (ts.isInitialized && !ts.isStreaming) {
			return "done"
		}

		return "idle"
	}

	// Caching mechanism to keep track of webview messages + API conversation history per provider instance

	/*
	Now that we use retainContextWhenHidden, we don't have to store a cache of shuncode messages in the user's state, but we could to reduce memory footprint in long conversations.

	- We have to be careful of what state is shared between ShuncodeProvider instances since there could be multiple instances of the extension running at once. For example when we cached shuncode messages using the same key, two instances of the extension could end up using the same key and overwriting each other's messages.
	- Some state does need to be shared between the instances, i.e. the API key--however there doesn't seem to be a good way to notify the other instances that the API key has changed.

	We need to use a unique identifier for each ShuncodeProvider instance's message cache since we could be running several instances of the extension outside of just the sidebar i.e. in editor panels.

	// conversation history to send in API requests

	/*
	It seems that some API messages do not comply with vscode state requirements. Either the Anthropic library is manipulating these values somehow in the backend in a way that's creating cyclic references, or the API returns a function or a Symbol as part of the message content.
	// allow-any-unicode-next-line
	VSCode docs about state: "The value must be JSON-stringifyable ... value — A value. MUST not contain cyclic references."
	For now we'll store the conversation history in memory, and if we need to store in state directly we'd need to do a manual conversion to ensure proper json stringification.
	*/

	async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
		const history = this.stateManager.getGlobalStateKey("taskHistory")
		const existingItemIndex = history.findIndex((h) => h.id === item.id)
		if (existingItemIndex !== -1) {
			history[existingItemIndex] = item
		} else {
			history.push(item)
		}
		this.stateManager.setGlobalState("taskHistory", history)
		return history
	}

	async getBanners(): Promise<BannerCardData[]> {
		try {
			return BannerService.get().getActiveBanners()
		} catch (err) {
			Logger.log(err)
			return []
		}
	}
}
