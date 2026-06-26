import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { findLastIndex } from "@shared/array"
import { DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { DEFAULT_PLATFORM, type ExtensionState } from "@shared/ExtensionMessage"
import { DEFAULT_FOCUS_CHAIN_SETTINGS } from "@shared/FocusChainSettings"
import { DEFAULT_MCP_DISPLAY_MODE } from "@shared/McpDisplayMode"
import type { UserInfo } from "@shared/proto/shuncode/account"
import { EmptyRequest } from "@shared/proto/shuncode/common"
import type { OpenRouterCompatibleModelInfo } from "@shared/proto/shuncode/models"
import { OnboardingModelGroup, type TerminalProfile } from "@shared/proto/shuncode/state"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { fromProtobufModels } from "@shared/proto-conversions/models/typeConversion"
import { convertProtoToShuncodeMessage } from "@shared/proto-conversions/shuncode-message"
import type React from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useNavigation } from "./useNavigation"
import { Environment } from "../../../src/config"
import {
	basetenDefaultModelId,
	basetenModels,
	groqDefaultModelId,
	groqModels,
	type ModelInfo,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
} from "../../../src/shared/api"
import type { McpMarketplaceCatalog, McpServer, McpViewTab } from "../../../src/shared/mcp"
import { McpServiceClient, ModelsServiceClient, StateServiceClient, UiServiceClient } from "../services/grpc-client"

export interface ExtensionStateContextType extends ExtensionState {
	didHydrateState: boolean
	showWelcome: boolean
	onboardingModels: OnboardingModelGroup | undefined
	openRouterModels: Record<string, ModelInfo>
	vercelAiGatewayModels: Record<string, ModelInfo>
	hicapModels: Record<string, ModelInfo>
	liteLlmModels: Record<string, ModelInfo>
	openAiModels: string[]
	requestyModels: Record<string, ModelInfo>
	groqModels: Record<string, ModelInfo>
	basetenModels: Record<string, ModelInfo>
	huggingFaceModels: Record<string, ModelInfo>
	mcpServers: McpServer[]
	mcpMarketplaceCatalog: McpMarketplaceCatalog
	totalTasksSize: number | null
	lastDismissedCliBannerVersion: number

	availableTerminalProfiles: TerminalProfile[]

	// View state
	showMcp: boolean
	mcpTab?: McpViewTab
	showSettings: boolean
	settingsTargetSection?: string
	showHistory: boolean
	showAccount: boolean
	showWorktrees: boolean
	showAnnouncement: boolean
	showChatModelSelector: boolean
	expandTaskHeader: boolean

	// Setters
	setShowAnnouncement: (value: boolean) => void
	setShowChatModelSelector: (value: boolean) => void
	setShouldShowAnnouncement: (value: boolean) => void
	setMcpServers: (value: McpServer[]) => void
	setRequestyModels: (value: Record<string, ModelInfo>) => void
	setGroqModels: (value: Record<string, ModelInfo>) => void
	setBasetenModels: (value: Record<string, ModelInfo>) => void
	setHuggingFaceModels: (value: Record<string, ModelInfo>) => void
	setGlobalShuncodeRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalShuncodeRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalCursorRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalWindsurfRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalAgentsRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalWorkflowToggles: (toggles: Record<string, boolean>) => void
	setGlobalWorkflowToggles: (toggles: Record<string, boolean>) => void
	setGlobalSkillsToggles: (toggles: Record<string, boolean>) => void
	setLocalSkillsToggles: (toggles: Record<string, boolean>) => void
	setRemoteRulesToggles: (toggles: Record<string, boolean>) => void
	setRemoteWorkflowToggles: (toggles: Record<string, boolean>) => void
	setMcpMarketplaceCatalog: (value: McpMarketplaceCatalog) => void
	setTotalTasksSize: (value: number | null) => void
	setExpandTaskHeader: (value: boolean) => void
	setShowWelcome: (value: boolean) => void
	setOnboardingModels: (value: OnboardingModelGroup | undefined) => void

	// Refresh functions
	refreshOpenRouterModels: () => void
	refreshVercelAiGatewayModels: () => void
	refreshHicapModels: () => void
	refreshLiteLlmModels: () => void
	setUserInfo: (userInfo?: UserInfo) => void

	// Navigation state setters
	setShowMcp: (value: boolean) => void
	setMcpTab: (tab?: McpViewTab) => void

	// Navigation functions
	navigateToMcp: (tab?: McpViewTab) => void
	navigateToSettings: (targetSection?: string) => void
	navigateToHistory: () => void
	navigateToAccount: () => void
	navigateToWorktrees: () => void
	navigateToChat: () => void

	// Hide functions
	hideSettings: () => void
	hideHistory: () => void
	hideAccount: () => void
	hideWorktrees: () => void
	hideAnnouncement: () => void
	hideChatModelSelector: () => void
	closeMcpView: () => void

	// Event callbacks
	onRelinquishControl: (callback: () => void) => () => void
}

export const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined)

export const ExtensionStateContextProvider: React.FC<{
	children: React.ReactNode
}> = ({ children }) => {
	const {
		showMcp,
		mcpTab,
		showSettings,
		settingsTargetSection,
		showHistory,
		showAccount,
		showWorktrees,
		showAnnouncement,
		showChatModelSelector,
		setShowMcp,
		setMcpTab,
		closeMcpView,
		hideSettings,
		hideHistory,
		hideAccount,
		hideWorktrees,
		hideAnnouncement,
		hideChatModelSelector,
		navigateToMcp,
		navigateToSettings,
		navigateToHistory,
		navigateToAccount,
		navigateToWorktrees,
		navigateToChat,
		setShowAnnouncement,
		setShowChatModelSelector,
	} = useNavigation()

	const [state, setState] = useState<ExtensionState>({
		version: "",
		shuncodeMessages: [],
		taskHistory: [],
		shouldShowAnnouncement: false,
		autoApprovalSettings: DEFAULT_AUTO_APPROVAL_SETTINGS,
		browserSettings: DEFAULT_BROWSER_SETTINGS,
		focusChainSettings: DEFAULT_FOCUS_CHAIN_SETTINGS,
		preferredLanguage: "English",
		openaiReasoningEffort: "xhigh",
		mode: "act",
		platform: DEFAULT_PLATFORM,
		environment: Environment.production,
		telemetrySetting: "unset",
		distinctId: "",
		planActSeparateModelsSetting: true,
		enableCheckpointsSetting: true,
		mcpDisplayMode: DEFAULT_MCP_DISPLAY_MODE,
		globalShuncodeRulesToggles: {},
		localShuncodeRulesToggles: {},
		localCursorRulesToggles: {},
		localWindsurfRulesToggles: {},
		localAgentsRulesToggles: {},
		localWorkflowToggles: {},
		globalWorkflowToggles: {},
		shellIntegrationTimeout: 4000,
		terminalReuseEnabled: true,
		vscodeTerminalExecutionMode: "vscodeTerminal",
		terminalOutputLineLimit: 500,
		maxConsecutiveMistakes: 3,
		subagentTerminalOutputLineLimit: 2000,
		defaultTerminalProfile: "default",
		isNewUser: false,
		welcomeViewCompleted: false,
		onboardingModels: undefined,
		mcpResponsesCollapsed: false, // Default value (expanded), will be overwritten by extension state
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		customPrompt: undefined,
		useAutoCondense: false,
		shuncodeWebToolsEnabled: { user: true, featureFlag: true },
		worktreesEnabled: { user: true, featureFlag: false },
		autoCondenseThreshold: undefined,
		favoritedModelIds: [],
		lastDismissedInfoBannerVersion: 0,
		lastDismissedModelBannerVersion: 0,
		optOutOfRemoteConfig: false,
		remoteConfigSettings: {},
		backgroundCommandRunning: false,
		backgroundCommandTaskId: undefined,
		lastDismissedCliBannerVersion: 0,
		subagentsEnabled: false,
		backgroundEditEnabled: false,
		imageGenerationBaseUrl: undefined,
		imageGenerationApiKey: undefined,
		imageGenerationModelId: undefined,
		pendingChanges: [],
		skillsEnabled: false,
		globalSkillsToggles: {},
		localSkillsToggles: {},

		// NEW: Add workspace information with defaults
		workspaceRoots: [],
		primaryRootIndex: 0,
		isMultiRootWorkspace: false,
		multiRootSetting: { user: false, featureFlag: false },
		hooksEnabled: false,
		nativeToolCallSetting: false,
		enableParallelToolCalling: false,
		// Shuncode AI: Fast Context sub-agent
		fastContextConfig: undefined,
		// Shuncode AI: Lightweight mode for weak models
		lightweightMode: false,
		promptProfile: undefined,
		// Shuncode AI: Edit tools settings
		useSimplifiedEditTools: true,
		validateSyntaxBeforeApply: false,
		blockOnSyntaxErrors: false,
	})
	const [expandTaskHeader, setExpandTaskHeader] = useState(false)
	const [didHydrateState, setDidHydrateState] = useState(false)

	const [showWelcome, setShowWelcome] = useState(false)
	const [onboardingModels, setOnboardingModels] = useState<OnboardingModelGroup | undefined>(undefined)

	const [openRouterModels, setOpenRouterModels] = useState<Record<string, ModelInfo>>({
		[openRouterDefaultModelId]: openRouterDefaultModelInfo,
	})
	const [vercelAiGatewayModels, setVercelAiGatewayModels] = useState<Record<string, ModelInfo>>({})
	const [hicapModels, setHicapModels] = useState<Record<string, ModelInfo>>({})
	const [liteLlmModels, setLiteLlmModels] = useState<Record<string, ModelInfo>>({})
	const [totalTasksSize, setTotalTasksSize] = useState<number | null>(null)
	const [availableTerminalProfiles, setAvailableTerminalProfiles] = useState<TerminalProfile[]>([])

	const [openAiModels, _setOpenAiModels] = useState<string[]>([])
	const [requestyModels, setRequestyModels] = useState<Record<string, ModelInfo>>({
		[requestyDefaultModelId]: requestyDefaultModelInfo,
	})
	const [groqModelsState, setGroqModels] = useState<Record<string, ModelInfo>>({
		[groqDefaultModelId]: groqModels[groqDefaultModelId],
	})
	const [basetenModelsState, setBasetenModels] = useState<Record<string, ModelInfo>>({
		...basetenModels,
		[basetenDefaultModelId]: basetenModels[basetenDefaultModelId],
	})
	const [huggingFaceModels, setHuggingFaceModels] = useState<Record<string, ModelInfo>>({})
	const [mcpServers, setMcpServers] = useState<McpServer[]>([])
	const [mcpMarketplaceCatalog, setMcpMarketplaceCatalog] = useState<McpMarketplaceCatalog>({ items: [] })

	// References to store subscription cancellation functions
	const stateSubscriptionRef = useRef<(() => void) | null>(null)

	const mcpButtonUnsubscribeRef = useRef<(() => void) | null>(null)
	const historyButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const chatButtonUnsubscribeRef = useRef<(() => void) | null>(null)
	const accountButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const settingsButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const worktreesButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const partialMessageUnsubscribeRef = useRef<(() => void) | null>(null)
	const mcpMarketplaceUnsubscribeRef = useRef<(() => void) | null>(null)
	const openRouterModelsUnsubscribeRef = useRef<(() => void) | null>(null)
	const liteLlmModelsUnsubscribeRef = useRef<(() => void) | null>(null)
	const workspaceUpdatesUnsubscribeRef = useRef<(() => void) | null>(null)
	const relinquishControlUnsubscribeRef = useRef<(() => void) | null>(null)

	// Add ref for callbacks
	const relinquishControlCallbacks = useRef<Set<() => void>>(new Set())

	// Create hook function
	const onRelinquishControl = useCallback((callback: () => void) => {
		relinquishControlCallbacks.current.add(callback)
		return () => {
			relinquishControlCallbacks.current.delete(callback)
		}
	}, [])
	const mcpServersSubscriptionRef = useRef<(() => void) | null>(null)

	// [SHUNCODE-SHUNCODE] Listen for lightweight direct messages from extension (bypasses gRPC for fast updates)
	// Subscribe to state updates and UI events using the gRPC streaming API
	useEffect(() => {
		// Set up state subscription
		stateSubscriptionRef.current = StateServiceClient.subscribeToState(EmptyRequest.create({}), {
			onResponse: (response) => {
				if (response.stateJson) {
					try {
						const stateData = JSON.parse(response.stateJson) as ExtensionState
						setState((prevState) => {
							// Versioning logic for autoApprovalSettings
							const incomingVersion = stateData.autoApprovalSettings?.version ?? 1
							const currentVersion = prevState.autoApprovalSettings?.version ?? 1
							const shouldUpdateAutoApproval = incomingVersion > currentVersion
							// HACK: Preserve shuncodeMessages if currentTaskItem is the same
							if (stateData.currentTaskItem?.id === prevState.currentTaskItem?.id) {
								stateData.shuncodeMessages = stateData.shuncodeMessages?.length
									? stateData.shuncodeMessages
									: prevState.shuncodeMessages
							}

							const newState = {
								...stateData,
								autoApprovalSettings: shouldUpdateAutoApproval
									? stateData.autoApprovalSettings
									: prevState.autoApprovalSettings,
							}

							setShowWelcome(false)
							setOnboardingModels(undefined)

							setDidHydrateState(true)

							return newState
						})
					} catch (error) {
						console.error("Error parsing state JSON:", error)
					}
				}
				// [SHUNCODE-PERF] Removed noisy per-state-update log that was spamming console
			},
			onError: (error) => {
				console.error("Error in state subscription:", error)
			},
			onComplete: () => {},
		})

		// Subscribe to MCP button clicked events with webview type
		mcpButtonUnsubscribeRef.current = UiServiceClient.subscribeToMcpButtonClicked(
			{},
			{
				onResponse: () => {
				navigateToMcp()
				},
				onError: (error) => {
					console.error("Error in mcpButtonClicked subscription:", error)
				},
			onComplete: () => {},
			},
		)

		// Set up history button clicked subscription with webview type
		historyButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToHistoryButtonClicked(
			{},
			{
				onResponse: () => {
					// When history button is clicked, navigate to history view
				navigateToHistory()
				},
				onError: (error) => {
					console.error("Error in history button clicked subscription:", error)
				},
			onComplete: () => {},
			},
		)

		// Subscribe to chat button clicked events with webview type
		chatButtonUnsubscribeRef.current = UiServiceClient.subscribeToChatButtonClicked(
			{},
			{
				onResponse: () => {
					// When chat button is clicked, navigate to chat
				navigateToChat()
				},
				onError: (error) => {
					console.error("Error in chat button subscription:", error)
				},
				onComplete: () => {},
			},
		)

		// Subscribe to MCP servers updates
		mcpServersSubscriptionRef.current = McpServiceClient.subscribeToMcpServers(EmptyRequest.create(), {
			onResponse: (response) => {
			if (response.mcpServers) {
					setMcpServers(convertProtoMcpServersToMcpServers(response.mcpServers))
				}
			},
			onError: (error) => {
				console.error("Error in MCP servers subscription:", error)
			},
			onComplete: () => {},
		})

		// Set up settings button clicked subscription
		settingsButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToSettingsButtonClicked(EmptyRequest.create({}), {
			onResponse: () => {
				// When settings button is clicked, navigate to settings
				navigateToSettings()
			},
			onError: (error) => {
				console.error("Error in settings button clicked subscription:", error)
			},
			onComplete: () => {},
		})

		// Set up worktrees button clicked subscription
		worktreesButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToWorktreesButtonClicked(
			EmptyRequest.create({}),
			{
				onResponse: () => {
					// When worktrees button is clicked, navigate to worktrees
					navigateToWorktrees()
				},
				onError: (error) => {
					console.error("Error in worktrees button clicked subscription:", error)
				},
			onComplete: () => {},
			},
		)

		// Subscribe to partial message events
		partialMessageUnsubscribeRef.current = UiServiceClient.subscribeToPartialMessage(EmptyRequest.create({}), {
			onResponse: (protoMessage) => {
				try {
					// Validate critical fields
					if (!protoMessage.ts || protoMessage.ts <= 0) {
						console.error("Invalid timestamp in partial message:", protoMessage)
						return
					}

					const partialMessage = convertProtoToShuncodeMessage(protoMessage)
					setState((prevState) => {
						// worth noting it will never be possible for a more up-to-date message to be sent here or in normal messages post since the presentAssistantContent function uses lock
						const lastIndex = findLastIndex(prevState.shuncodeMessages, (msg) => msg.ts === partialMessage.ts)
						if (lastIndex !== -1) {
							const newShuncodeMessages = [...prevState.shuncodeMessages]
							newShuncodeMessages[lastIndex] = partialMessage
							return { ...prevState, shuncodeMessages: newShuncodeMessages }
						}
						return prevState
					})
				} catch (error) {
					console.error("Failed to process partial message:", error, protoMessage)
				}
			},
			onError: (error) => {
				console.error("Error in partialMessage subscription:", error)
			},
			onComplete: () => {},
		})

		// Subscribe to MCP marketplace catalog updates
		mcpMarketplaceUnsubscribeRef.current = McpServiceClient.subscribeToMcpMarketplaceCatalog(EmptyRequest.create({}), {
			onResponse: (catalog) => {
			setMcpMarketplaceCatalog(catalog)
			},
			onError: (error) => {
				console.error("Error in MCP marketplace catalog subscription:", error)
			},
			onComplete: () => {},
		})

		// Subscribe to OpenRouter models updates
		openRouterModelsUnsubscribeRef.current = ModelsServiceClient.subscribeToOpenRouterModels(EmptyRequest.create({}), {
			onResponse: (response: OpenRouterCompatibleModelInfo) => {
				const models = fromProtobufModels(response.models)
				setOpenRouterModels({
					[openRouterDefaultModelId]: openRouterDefaultModelInfo, // in case the extension sent a model list without the default model
					...models,
				})
			},
			onError: (error) => {
				console.error("Error in OpenRouter models subscription:", error)
			},
			onComplete: () => {},
		})

		// Subscribe to LiteLLM models updates
		liteLlmModelsUnsubscribeRef.current = ModelsServiceClient.subscribeToLiteLlmModels(EmptyRequest.create({}), {
			onResponse: (response: OpenRouterCompatibleModelInfo) => {
				const models = fromProtobufModels(response.models)
				setLiteLlmModels(models)
			},
			onError: (error) => {
				console.error("Error in LiteLLM models subscription:", error)
			},
			onComplete: () => {},
		})

		// Initialize webview using gRPC
		UiServiceClient.initializeWebview(EmptyRequest.create({}))
			.then(() => {})
			.catch((error) => {
				console.error("Failed to initialize webview via gRPC:", error)
			})

		// Set up account button clicked subscription
		accountButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToAccountButtonClicked(EmptyRequest.create(), {
			onResponse: () => {
				// When account button is clicked, navigate to account view
				navigateToAccount()
			},
			onError: (error) => {
				console.error("Error in account button clicked subscription:", error)
			},
			onComplete: () => {},
		})

		// Fetch available terminal profiles on launch
		StateServiceClient.getAvailableTerminalProfiles(EmptyRequest.create({}))
			.then((response) => {
				setAvailableTerminalProfiles(response.profiles)
			})
			.catch((error) => {
				console.error("Failed to fetch available terminal profiles:", error)
			})

		// Subscribe to relinquish control events
		relinquishControlUnsubscribeRef.current = UiServiceClient.subscribeToRelinquishControl(EmptyRequest.create({}), {
			onResponse: () => {
				// Call all registered callbacks
				relinquishControlCallbacks.current.forEach((callback) => {
					callback()
				})
			},
			onError: (error) => {
				console.error("Error in relinquishControl subscription:", error)
			},
			onComplete: () => {},
		})

		// Clean up subscriptions when component unmounts
		return () => {
			if (stateSubscriptionRef.current) {
				stateSubscriptionRef.current()
				stateSubscriptionRef.current = null
			}
			if (mcpButtonUnsubscribeRef.current) {
				mcpButtonUnsubscribeRef.current()
				mcpButtonUnsubscribeRef.current = null
			}
			if (historyButtonClickedSubscriptionRef.current) {
				historyButtonClickedSubscriptionRef.current()
				historyButtonClickedSubscriptionRef.current = null
			}
			if (chatButtonUnsubscribeRef.current) {
				chatButtonUnsubscribeRef.current()
				chatButtonUnsubscribeRef.current = null
			}
			if (accountButtonClickedSubscriptionRef.current) {
				accountButtonClickedSubscriptionRef.current()
				accountButtonClickedSubscriptionRef.current = null
			}
			if (settingsButtonClickedSubscriptionRef.current) {
				settingsButtonClickedSubscriptionRef.current()
				settingsButtonClickedSubscriptionRef.current = null
			}
			if (worktreesButtonClickedSubscriptionRef.current) {
				worktreesButtonClickedSubscriptionRef.current()
				worktreesButtonClickedSubscriptionRef.current = null
			}
			if (partialMessageUnsubscribeRef.current) {
				partialMessageUnsubscribeRef.current()
				partialMessageUnsubscribeRef.current = null
			}
			if (mcpMarketplaceUnsubscribeRef.current) {
				mcpMarketplaceUnsubscribeRef.current()
				mcpMarketplaceUnsubscribeRef.current = null
			}
			if (openRouterModelsUnsubscribeRef.current) {
				openRouterModelsUnsubscribeRef.current()
				openRouterModelsUnsubscribeRef.current = null
			}
			if (liteLlmModelsUnsubscribeRef.current) {
				liteLlmModelsUnsubscribeRef.current()
				liteLlmModelsUnsubscribeRef.current = null
			}
			if (workspaceUpdatesUnsubscribeRef.current) {
				workspaceUpdatesUnsubscribeRef.current()
				workspaceUpdatesUnsubscribeRef.current = null
			}
			if (relinquishControlUnsubscribeRef.current) {
				relinquishControlUnsubscribeRef.current()
				relinquishControlUnsubscribeRef.current = null
			}
			if (mcpServersSubscriptionRef.current) {
				mcpServersSubscriptionRef.current()
				mcpServersSubscriptionRef.current = null
			}
		}
	}, [])

	const refreshOpenRouterModels = useCallback(() => {
		ModelsServiceClient.refreshOpenRouterModelsRpc(EmptyRequest.create({}))
			.then((response: OpenRouterCompatibleModelInfo) => {
				const models = fromProtobufModels(response.models)
				setOpenRouterModels({
					[openRouterDefaultModelId]: openRouterDefaultModelInfo, // in case the extension sent a model list without the default model
					...models,
				})
			})
			.catch((error: Error) => console.error("Failed to refresh OpenRouter models:", error))
	}, [])

	const refreshHicapModels = useCallback(() => {
		ModelsServiceClient.refreshHicapModels(EmptyRequest.create({}))
			.then((response: OpenRouterCompatibleModelInfo) => {
				const models = response.models
				setHicapModels({
					...models,
				})
			})
			.catch((error: Error) => console.error("Failed to refresh Hicap models:", error))
	}, [])

	const refreshLiteLlmModels = useCallback(() => {
		ModelsServiceClient.refreshLiteLlmModelsRpc(EmptyRequest.create({}))
			.then((response: OpenRouterCompatibleModelInfo) => {
				const models = fromProtobufModels(response.models)
				setLiteLlmModels(models)
			})
			.catch((error: Error) => console.error("Failed to refresh LiteLLM models:", error))
	}, [])

	const refreshBasetenModels = useCallback(() => {
		ModelsServiceClient.refreshBasetenModelsRpc(EmptyRequest.create({}))
			.then((response) => {
				setBasetenModels({
					[basetenDefaultModelId]: basetenModels[basetenDefaultModelId],
					...fromProtobufModels(response.models),
				})
			})
			.catch((err) => console.error("Failed to refresh Baseten models:", err))
	}, [])

	const refreshVercelAiGatewayModels = useCallback(() => {
		ModelsServiceClient.refreshVercelAiGatewayModelsRpc(EmptyRequest.create({}))
			.then((response: OpenRouterCompatibleModelInfo) => {
				const models = fromProtobufModels(response.models)
				setVercelAiGatewayModels(models)
			})
			.catch((error: Error) => console.error("Failed to refresh Vercel AI Gateway models:", error))
	}, [])

	// Auto-refresh model lists on API key availability
	useEffect(() => {
		if (!openRouterModels || Object.keys(openRouterModels).length <= 1) {
			refreshOpenRouterModels()
		}
		if (!vercelAiGatewayModels || Object.keys(vercelAiGatewayModels).length === 0) {
			refreshVercelAiGatewayModels()
		}
		if (state.apiConfiguration?.basetenApiKey) {
			refreshBasetenModels()
		}
		if (state.apiConfiguration?.liteLlmApiKey) {
			refreshLiteLlmModels()
		}
	}, [
		refreshOpenRouterModels,
		refreshVercelAiGatewayModels,
		state?.apiConfiguration?.basetenApiKey,
		refreshBasetenModels,
		state?.apiConfiguration?.liteLlmApiKey,
		refreshLiteLlmModels,
	])

	const stableSetters = useRef({
		setShouldShowAnnouncement: (value: boolean) =>
			setState((prev) => ({ ...prev, shouldShowAnnouncement: value })),
		setGlobalShuncodeRulesToggles: (toggles: Record<string, boolean>) =>
			setState((prev) => ({ ...prev, globalShuncodeRulesToggles: toggles })),
		setLocalShuncodeRulesToggles: (toggles: Record<string, boolean>) =>
			setState((prev) => ({ ...prev, localShuncodeRulesToggles: toggles })),
		setLocalCursorRulesToggles: (toggles: Record<string, boolean>) =>
			setState((prev) => ({ ...prev, localCursorRulesToggles: toggles })),
		setLocalWindsurfRulesToggles: (toggles: Record<string, boolean>) =>
			setState((prev) => ({ ...prev, localWindsurfRulesToggles: toggles })),
		setLocalAgentsRulesToggles: (toggles: Record<string, boolean>) =>
			setState((prev) => ({ ...prev, localAgentsRulesToggles: toggles })),
		setLocalWorkflowToggles: (toggles: Record<string, boolean>) =>
			setState((prev) => ({ ...prev, localWorkflowToggles: toggles })),
		setGlobalWorkflowToggles: (toggles: Record<string, boolean>) =>
			setState((prev) => ({ ...prev, globalWorkflowToggles: toggles })),
		setGlobalSkillsToggles: (toggles: Record<string, boolean>) =>
			setState((prev) => ({ ...prev, globalSkillsToggles: toggles })),
		setLocalSkillsToggles: (toggles: Record<string, boolean>) =>
			setState((prev) => ({ ...prev, localSkillsToggles: toggles })),
		setRemoteRulesToggles: (toggles: Record<string, boolean>) =>
			setState((prev) => ({ ...prev, remoteRulesToggles: toggles })),
		setRemoteWorkflowToggles: (toggles: Record<string, boolean>) =>
			setState((prev) => ({ ...prev, remoteWorkflowToggles: toggles })),
		setUserInfo: (userInfo?: UserInfo) =>
			setState((prev) => ({ ...prev, userInfo })),
	}).current

	const contextValue = useMemo<ExtensionStateContextType>(() => ({
		...state,
		didHydrateState,
		showWelcome,
		onboardingModels,
		openRouterModels,
		vercelAiGatewayModels,
		hicapModels,
		liteLlmModels,
		openAiModels,
		requestyModels,
		groqModels: groqModelsState,
		basetenModels: basetenModelsState,
		huggingFaceModels,
		mcpServers,
		mcpMarketplaceCatalog,
		totalTasksSize,
		availableTerminalProfiles,
		showMcp,
		mcpTab,
		showSettings,
		settingsTargetSection,
		showHistory,
		showAccount,
		showWorktrees,
		showAnnouncement,
		showChatModelSelector,
		globalShuncodeRulesToggles: state.globalShuncodeRulesToggles || {},
		localShuncodeRulesToggles: state.localShuncodeRulesToggles || {},
		localCursorRulesToggles: state.localCursorRulesToggles || {},
		localWindsurfRulesToggles: state.localWindsurfRulesToggles || {},
		localAgentsRulesToggles: state.localAgentsRulesToggles || {},
		localWorkflowToggles: state.localWorkflowToggles || {},
		globalWorkflowToggles: state.globalWorkflowToggles || {},
		remoteRulesToggles: state.remoteRulesToggles || {},
		remoteWorkflowToggles: state.remoteWorkflowToggles || {},
		enableCheckpointsSetting: state.enableCheckpointsSetting,
		currentFocusChainChecklist: state.currentFocusChainChecklist,

		// Navigation functions
		navigateToMcp,
		navigateToSettings,
		navigateToHistory,
		navigateToAccount,
		navigateToWorktrees,
		navigateToChat,

		// Hide functions
		hideSettings,
		hideHistory,
		hideAccount,
		hideWorktrees,
		hideAnnouncement,
		setShowAnnouncement,
		hideChatModelSelector,
		setShowWelcome,
		setOnboardingModels,
		setShowChatModelSelector,
		setMcpServers,
		setRequestyModels,
		setGroqModels,
		setBasetenModels,
		setHuggingFaceModels,
		setMcpMarketplaceCatalog,
		setShowMcp,
		closeMcpView,
		setMcpTab,
		setTotalTasksSize,
		setExpandTaskHeader,
		refreshOpenRouterModels,
		refreshVercelAiGatewayModels,
		refreshHicapModels,
		refreshLiteLlmModels,
		onRelinquishControl,
		expandTaskHeader,
		...stableSetters,
	}), [
		state, didHydrateState, showWelcome, onboardingModels,
		openRouterModels, vercelAiGatewayModels, hicapModels, liteLlmModels,
		openAiModels, requestyModels, groqModelsState, basetenModelsState,
		huggingFaceModels, mcpServers, mcpMarketplaceCatalog, totalTasksSize,
		availableTerminalProfiles, showMcp, mcpTab, showSettings,
		settingsTargetSection, showHistory, showAccount, showWorktrees,
		showAnnouncement, showChatModelSelector, expandTaskHeader,
		navigateToMcp, navigateToSettings, navigateToHistory,
		navigateToAccount, navigateToWorktrees, navigateToChat,
		hideSettings, hideHistory, hideAccount, hideWorktrees,
		hideAnnouncement, hideChatModelSelector, closeMcpView,
		setShowAnnouncement, setShowChatModelSelector,
		refreshOpenRouterModels, refreshVercelAiGatewayModels,
		refreshHicapModels, refreshLiteLlmModels, onRelinquishControl,
	])

	return <ExtensionStateContext.Provider value={contextValue}>{children}</ExtensionStateContext.Provider>
}

export const useExtensionState = () => {
	const context = useContext(ExtensionStateContext)
	if (context === undefined) {
		throw new Error("useExtensionState must be used within an ExtensionStateContextProvider")
	}
	return context
}
