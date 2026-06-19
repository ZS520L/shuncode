import type { ModelInfo as ModelInfoType } from "@shared/api"
import { ANTHROPIC_MIN_THINKING_BUDGET, ApiProvider } from "@shared/api"
import { StringRequest } from "@shared/proto/shuncode/common"
import { UpdateSettingsRequest } from "@shared/proto/shuncode/state"
import { Mode } from "@shared/storage/types"
import { ArrowLeftRight, Brain, Check, ChevronDownIcon, Search, Settings } from "lucide-react"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useWindowSize } from "react-use"
import PopupModalContainer from "@/components/common/PopupModalContainer"
import { freeModels, recommendedModels } from "@/components/settings/OpenRouterModelPicker"
import {
	SearchContainer,
	SearchInput,
	SettingsSection,
	IconToggle,
	ProviderRow,
	ProviderDropdownPortal,
	ProviderDropdownItem,
	ModelListContainer,
	ModelItemContainer,
	ModelInfoRow,
	ModelName,
	ModelProvider,
	ModelLabel,
	EmptyState,
	EmptyModelRow,
	CurrentModelRow,
	SplitModeRow,
	SplitModeCell,
	SplitModeLabel,
	SplitModeModel,
	SettingsOnlyContainer,
	ConfiguredModelName,
	SettingsOnlyLink,
} from "./ModelPickerModal.styles"
import { SUPPORTED_ANTHROPIC_THINKING_MODELS } from "@/components/settings/providers/AnthropicProvider"
import { SUPPORTED_BEDROCK_THINKING_MODELS } from "@/components/settings/providers/BedrockProvider"
import {
	filterOpenRouterModelIds,
	getModelsForProvider,
	getModeSpecificFields,
	getProviderInfo,
	normalizeApiConfiguration,
	syncModeConfigurations,
} from "@/components/settings/utils/providerUtils"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { StateServiceClient } from "@/services/grpc-client"
import { getProviderLabel } from "@/utils/getConfiguredProviders"
import ThinkingBudgetSlider from "../settings/ThinkingBudgetSlider"
import {
	ApiProviderConfig,
	getConfigModelIds,
	getMultiProviderModelOptions,
	readMultiProviderConfigs,
	writeMultiProviderConfigs,
} from "../settings/utils/multiProviderConfig"

const SETTINGS_ONLY_PROVIDERS: ApiProvider[] = [
	"openai",
	"ollama",
	"lmstudio",
	"vscode-lm",
	"requesty",
	"hicap",
	"dify",
	"oca",
	"aihubmix",
	"together",
]

const OPENROUTER_MODEL_PROVIDERS: ApiProvider[] = ["shuncode", "openrouter", "vercel-ai-gateway"]

interface ModelPickerModalProps {
	isOpen: boolean
	onOpenChange: (open: boolean) => void
	currentMode: Mode
	children: React.ReactNode
}

interface ModelItem {
	id: string
	name: string
	provider?: string
	description?: string
	label?: string
	info?: ModelInfoType
	modelId?: string
	multiProviderConfig?: ApiProviderConfig
}

// Star icon for favorites (only for openrouter/vercel-ai-gateway providers)
const StarIcon = ({ isFavorite, onClick }: { isFavorite: boolean; onClick: (e: React.MouseEvent) => void }) => {
	return (
		<div
			onClick={onClick}
			style={{
				cursor: "pointer",
				color: isFavorite ? "var(--vscode-terminal-ansiYellow)" : "var(--vscode-descriptionForeground)",
				marginLeft: "8px",
				fontSize: "14px",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				userSelect: "none",
				WebkitUserSelect: "none",
			}}>
			{/* allow-any-unicode-next-line */}
			{isFavorite ? "★" : "☆"}
		</div>
	)
}

const ModelPickerModal: React.FC<ModelPickerModalProps> = ({ isOpen, onOpenChange, currentMode, children }) => {
	const { t } = useI18n()
	const {
		apiConfiguration,
		openRouterModels,
		vercelAiGatewayModels,
		navigateToSettings,
		planActSeparateModelsSetting,
		showSettings,
		showMcp,
		showHistory,
		showAccount,
		favoritedModelIds,
		basetenModels,
		liteLlmModels,
	} = useExtensionState()
	const { handleModeFieldChange, handleModeFieldsChange, handleFieldsChange } = useApiConfigurationHandlers()

	const [searchQuery, setSearchQuery] = useState("")
	const [activeEditMode, setActiveEditMode] = useState<Mode>(currentMode) // which mode we're editing in split view
	const [menuPosition, setMenuPosition] = useState(0)
	const [arrowPosition, setArrowPosition] = useState(0)
	const [isProviderExpanded, setIsProviderExpanded] = useState(false)
	const [providerDropdownPosition, setProviderDropdownPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 200 })
	const [selectedIndex, setSelectedIndex] = useState(-1) // For keyboard navigation
	const [multiProviderConfigs, setMultiProviderConfigs] = useState<ApiProviderConfig[]>(() => readMultiProviderConfigs())
	const searchInputRef = useRef<HTMLInputElement>(null)
	const triggerRef = useRef<HTMLDivElement>(null)
	const modalRef = useRef<HTMLDivElement>(null)
	const providerRowRef = useRef<HTMLDivElement>(null)
	const providerDropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([]) // For scrollIntoView
	const { width: viewportWidth, height: viewportHeight } = useWindowSize()

	// Get current provider from config - use activeEditMode when in split mode
	const effectiveMode = planActSeparateModelsSetting ? activeEditMode : currentMode
	const { selectedProvider, selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, effectiveMode)

	// Get both Plan and Act models for split view
	const planModel = useMemo(() => normalizeApiConfiguration(apiConfiguration, "plan"), [apiConfiguration])
	const actModel = useMemo(() => normalizeApiConfiguration(apiConfiguration, "act"), [apiConfiguration])

	// Use the setting for split mode
	const isSplit = planActSeparateModelsSetting

	// Check if model supports thinking (token-based budget)
	// OpenAI Codex uses discrete reasoning effort levels controlled via global settings, not token budgets
	const supportsThinking = useMemo(() => {
		if (selectedProvider === "openai-codex") {
			return false
		}
		if (selectedProvider === "anthropic" || selectedProvider === "claude-code") {
			return SUPPORTED_ANTHROPIC_THINKING_MODELS.includes(selectedModelId)
		}
		if (selectedProvider === "bedrock") {
			return SUPPORTED_BEDROCK_THINKING_MODELS.includes(selectedModelId)
		}
		return selectedModelInfo?.supportsReasoning || !!selectedModelInfo?.thinkingConfig
	}, [selectedProvider, selectedModelId, selectedModelInfo])

	// Get thinking budget from current mode config
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const thinkingBudget = modeFields.thinkingBudgetTokens || 0
	const thinkingEnabled = thinkingBudget > 0

	// Handle thinking toggle - uses ANTHROPIC_MIN_THINKING_BUDGET as default when enabling
	const handleThinkingToggle = useCallback(
		(enabled: boolean) => {
			const budget = enabled ? ANTHROPIC_MIN_THINKING_BUDGET : 0
			handleModeFieldChange(
				{ plan: "planModeThinkingBudgetTokens", act: "actModeThinkingBudgetTokens" },
				budget,
				currentMode,
			)
		},
		[handleModeFieldChange, currentMode],
	)

	// Get configured providers
	const configuredProviders = useMemo(() => ["openai"] as ApiProvider[], [])

	useEffect(() => {
		if (!isOpen) return
		const refreshMultiProviderConfigs = () => setMultiProviderConfigs(readMultiProviderConfigs())
		refreshMultiProviderConfigs()
		window.addEventListener("shuncode-api-configs-changed", refreshMultiProviderConfigs)
		window.addEventListener("storage", refreshMultiProviderConfigs)
		return () => {
			window.removeEventListener("shuncode-api-configs-changed", refreshMultiProviderConfigs)
			window.removeEventListener("storage", refreshMultiProviderConfigs)
		}
	}, [isOpen])

	// Whether the current provider comes from a multi-provider config
	const isMultiProviderMode = useMemo(
		() => selectedProvider === "openai" || (selectedProvider === "anthropic" && multiProviderConfigs.some(
			(config) => config.protocol === "anthropic" && getConfigModelIds(config).includes(selectedModelId),
		)),
		[selectedProvider, multiProviderConfigs, selectedModelId],
	)

	const selectedOpenAiConfig = useMemo(() => {
		if (!isMultiProviderMode) {
			return undefined
		}
		const activeConfig = multiProviderConfigs.find(
			(config) => config.isActive && getConfigModelIds(config).includes(selectedModelId),
		)
		if (activeConfig) {
			return activeConfig
		}
		return multiProviderConfigs.find((config) => {
			return (
				getConfigModelIds(config).includes(selectedModelId) &&
				((config.baseUrl || "") === (apiConfiguration?.openAiBaseUrl || "") ||
				 (config.baseUrl || "") === (apiConfiguration?.anthropicBaseUrl || ""))
			)
		})
	}, [isMultiProviderMode, selectedModelId, multiProviderConfigs, apiConfiguration?.openAiBaseUrl, apiConfiguration?.anthropicBaseUrl])

	const selectedOpenAiModelKey = selectedOpenAiConfig ? `${selectedOpenAiConfig.id}:${selectedModelId}` : undefined

	// Get models for current provider
	const allModels = useMemo((): ModelItem[] => {
		if (isMultiProviderMode) {
			return getMultiProviderModelOptions(multiProviderConfigs).map((option) => ({
				id: option.id,
				name: option.modelId,
				provider: option.config.name,
				description: option.config.baseUrl,
				info: option.info,
				modelId: option.modelId,
				multiProviderConfig: option.config,
			}))
		}

		if (OPENROUTER_MODEL_PROVIDERS.includes(selectedProvider)) {
			// Use vercelAiGatewayModels for Vercel provider, openRouterModels for others
			const modelsSource = selectedProvider === "vercel-ai-gateway" ? vercelAiGatewayModels : openRouterModels
			const modelIds = Object.keys(modelsSource || {})
			const filteredIds = filterOpenRouterModelIds(modelIds, selectedProvider)

			return filteredIds.map((id) => ({
				id,
				name: id.split("/").pop() || id,
				provider: id.split("/")[0],
				info: modelsSource[id],
			}))
		}

		// Use centralized helper for static provider models
		const models = getModelsForProvider(selectedProvider, apiConfiguration, {
			basetenModels,
			liteLlmModels,
		})
		if (models) {
			return Object.entries(models).map(([id, info]) => ({
				id,
				name: id,
				provider: selectedProvider,
				info,
			}))
		}

		return []
	}, [
		isMultiProviderMode,
		selectedProvider,
		multiProviderConfigs,
		openRouterModels,
		vercelAiGatewayModels,
		apiConfiguration,
		basetenModels,
		liteLlmModels,
	])

	// Multi-word substring search - all words must match somewhere in id/name/provider
	const matchesSearch = useCallback((model: ModelItem, query: string): boolean => {
		if (!query.trim()) {
			return true
		}
		const queryWords = query.toLowerCase().trim().split(/\s+/)
		const searchText = `${model.id} ${model.name} ${model.provider || ""}`.toLowerCase()
		return queryWords.every((word) => searchText.includes(word))
	}, [])

	// Filtered models - for OpenRouter/Vercel show all by default, for Shuncode only when searching
	const filteredModels = useMemo(() => {
		const isShuncode = selectedProvider === "shuncode"

		// For Shuncode: only show non-featured models when searching
		if (isShuncode && !searchQuery) {
			return []
		}

		let models: ModelItem[]
		if (searchQuery) {
			models = allModels.filter((m) => matchesSearch(m, searchQuery))
		} else {
			// For non-Shuncode OpenRouter providers: show all models by default
			models = [...allModels]
		}

		// Filter out current model
		models = models.filter((m) => {
			if (isMultiProviderMode && m.multiProviderConfig) {
				return m.id !== selectedOpenAiModelKey
			}
			return (m.modelId || m.id) !== selectedModelId
		})

		// For Shuncode when searching, also filter out featured models (they're shown separately)
		if (isShuncode) {
			const featuredIds = new Set([...recommendedModels, ...freeModels].map((m) => m.id))
			models = models.filter((m) => !featuredIds.has(m.id))
		}

		// For openrouter/vercel-ai-gateway (not shuncode): put favorites first
		if (!isShuncode && (selectedProvider === "openrouter" || selectedProvider === "vercel-ai-gateway")) {
			const favoriteSet = new Set(favoritedModelIds || [])
			const favoritedModels = models.filter((m) => favoriteSet.has(m.id))
			const nonFavoritedModels = models.filter((m) => !favoriteSet.has(m.id))
			// Sort non-favorited alphabetically by provider
			nonFavoritedModels.sort((a, b) => (a.provider || "").localeCompare(b.provider || ""))
			return [...favoritedModels, ...nonFavoritedModels]
		}

		// Sort alphabetically by provider
		models = models.sort((a, b) => (a.provider || "").localeCompare(b.provider || ""))
		return models
	}, [searchQuery, matchesSearch, selectedModelId, selectedProvider, isMultiProviderMode, selectedOpenAiModelKey, allModels, favoritedModelIds])

	// Featured models for Shuncode provider (recommended + free)
	const featuredModels = useMemo(() => {
		if (selectedProvider !== "shuncode") {
			return []
		}

		const allFeatured = [...recommendedModels, ...freeModels].map((m) => ({
			...m,
			name: m.id.split("/").pop() || m.id,
			provider: m.id.split("/")[0],
		}))

		// Filter out current model
		const filtered = allFeatured.filter((m) => m.id !== selectedModelId)

		// Apply search filter if searching (uses same multi-word logic)
		if (searchQuery) {
			return filtered.filter((m) => matchesSearch(m, searchQuery))
		}

		return filtered
	}, [selectedProvider, searchQuery, selectedModelId, matchesSearch])

	// Handle model selection - in split mode uses activeEditMode, otherwise closes modal
	const handleSelectModel = useCallback(
		(modelId: string, modelInfo?: ModelInfoType, multiProviderConfig?: ApiProviderConfig) => {
			const modeToUse = isSplit ? activeEditMode : currentMode

			if (isMultiProviderMode && multiProviderConfig) {
				const updatedConfigs = multiProviderConfigs.map((config) => ({
					...config,
					isActive: config.id === multiProviderConfig.id,
				}))
				setMultiProviderConfigs(updatedConfigs)
				writeMultiProviderConfigs(updatedConfigs)
				const apiMode = modeToUse === "plan" || modeToUse === "ask" || modeToUse === "chat" ? "plan" : "act"
				const protocol = multiProviderConfig.protocol || "openai-chat"

				if (protocol === "anthropic") {
					// Anthropic Messages API
					const modeModelUpdates = planActSeparateModelsSetting
						? apiMode === "plan"
							? { planModeApiModelId: modelId }
							: { actModeApiModelId: modelId }
						: { planModeApiModelId: modelId, actModeApiModelId: modelId }

					handleFieldsChange({
						...modeModelUpdates,
						planModeApiProvider: "anthropic",
						actModeApiProvider: "anthropic",
						anthropicBaseUrl: multiProviderConfig.baseUrl || "",
						apiKey: multiProviderConfig.apiKey,
					})
				} else if (protocol === "openai-responses") {
					// OpenAI Responses API
					const responsesModelInfo = { ...modelInfo, supportsPromptCache: modelInfo?.supportsPromptCache ?? false, apiFormat: 1 } // ApiFormat.OPENAI_RESPONSES = 1
					const modeModelUpdates = planActSeparateModelsSetting
						? apiMode === "plan"
							? { planModeOpenAiModelId: modelId, planModeOpenAiModelInfo: responsesModelInfo }
							: { actModeOpenAiModelId: modelId, actModeOpenAiModelInfo: responsesModelInfo }
						: {
								planModeOpenAiModelId: modelId,
								actModeOpenAiModelId: modelId,
								planModeOpenAiModelInfo: responsesModelInfo,
								actModeOpenAiModelInfo: responsesModelInfo,
							}

					handleFieldsChange({
						...modeModelUpdates,
						planModeApiProvider: "openai",
						actModeApiProvider: "openai",
						openAiBaseUrl: multiProviderConfig.baseUrl || "",
						openAiApiKey: multiProviderConfig.apiKey,
						openAiHeaders: multiProviderConfig.customHeaders || {},
					})
				} else {
					// Default: OpenAI Chat Completions
					const modeModelUpdates = planActSeparateModelsSetting
						? apiMode === "plan"
							? { planModeOpenAiModelId: modelId, planModeOpenAiModelInfo: modelInfo }
							: { actModeOpenAiModelId: modelId, actModeOpenAiModelInfo: modelInfo }
						: {
								planModeOpenAiModelId: modelId,
								actModeOpenAiModelId: modelId,
								planModeOpenAiModelInfo: modelInfo,
								actModeOpenAiModelInfo: modelInfo,
							}

					handleFieldsChange({
						...modeModelUpdates,
						planModeApiProvider: "openai",
						actModeApiProvider: "openai",
						openAiBaseUrl: multiProviderConfig.baseUrl || "",
						openAiApiKey: multiProviderConfig.apiKey,
						openAiHeaders: multiProviderConfig.customHeaders || {},
					})
				}
			} else if (selectedProvider === "vercel-ai-gateway") {
				// Vercel AI Gateway uses its own model fields
				const modelInfoToUse = modelInfo || vercelAiGatewayModels[modelId]
				handleModeFieldsChange(
					{
						vercelAiGatewayModelId: { plan: "planModeVercelAiGatewayModelId", act: "actModeVercelAiGatewayModelId" },
						vercelAiGatewayModelInfo: {
							plan: "planModeVercelAiGatewayModelInfo",
							act: "actModeVercelAiGatewayModelInfo",
						},
					},
					{
						vercelAiGatewayModelId: modelId,
						vercelAiGatewayModelInfo: modelInfoToUse,
					},
					modeToUse,
				)
			} else if (OPENROUTER_MODEL_PROVIDERS.includes(selectedProvider)) {
				// Shuncode and OpenRouter use openRouter fields
				const modelInfoToUse = modelInfo || openRouterModels[modelId]
				handleModeFieldsChange(
					{
						openRouterModelId: { plan: "planModeOpenRouterModelId", act: "actModeOpenRouterModelId" },
						openRouterModelInfo: { plan: "planModeOpenRouterModelInfo", act: "actModeOpenRouterModelInfo" },
					},
					{
						openRouterModelId: modelId,
						openRouterModelInfo: modelInfoToUse,
					},
					modeToUse,
				)
			} else if (selectedProvider === "baseten") {
				// Baseten uses provider-specific model ID and info fields
				handleModeFieldsChange(
					{
						basetenModelId: { plan: "planModeBasetenModelId", act: "actModeBasetenModelId" },
						basetenModelInfo: { plan: "planModeBasetenModelInfo", act: "actModeBasetenModelInfo" },
					},
					{
						basetenModelId: modelId,
						basetenModelInfo: modelInfo,
					},
					modeToUse,
				)
			} else if (selectedProvider === "litellm") {
				// LiteLLM uses provider-specific model ID and info fields
				handleModeFieldsChange(
					{
						liteLlmModelId: { plan: "planModeLiteLlmModelId", act: "actModeLiteLlmModelId" },
						liteLlmModelInfo: { plan: "planModeLiteLlmModelInfo", act: "actModeLiteLlmModelInfo" },
					},
					{
						liteLlmModelId: modelId,
						liteLlmModelInfo: modelInfo,
					},
					modeToUse,
				)
			} else {
				// Static model providers use apiModelId
				handleModeFieldChange({ plan: "planModeApiModelId", act: "actModeApiModelId" }, modelId, modeToUse)
			}
			// Reset lightweight mode when model changes
			StateServiceClient.updateSettings(UpdateSettingsRequest.create({ lightweightMode: false })).catch((err) =>
				console.error("Failed to reset lightweightMode:", err),
			)

			// Only close modal if not in split mode
			if (!isSplit) {
				onOpenChange(false)
			}
		},
		[
			isMultiProviderMode,
			selectedProvider,
			handleModeFieldsChange,
			handleModeFieldChange,
			handleFieldsChange,
			currentMode,
			isSplit,
			planActSeparateModelsSetting,
			activeEditMode,
			openRouterModels,
			vercelAiGatewayModels,
			multiProviderConfigs,
			onOpenChange,
		],
	)

	// Handle provider selection from inline list
	const handleProviderSelect = useCallback(
		(provider: ApiProvider) => {
			const modeToUse = isSplit ? activeEditMode : currentMode
			handleModeFieldChange({ plan: "planModeApiProvider", act: "actModeApiProvider" }, provider, modeToUse)
			setIsProviderExpanded(false)
		},
		[handleModeFieldChange, currentMode, isSplit, activeEditMode],
	)

	// Handle split toggle - should NOT close modal
	const handleSplitToggle = useCallback(
		async (enabled: boolean) => {
			// Update the setting
			await StateServiceClient.updateSettings(
				UpdateSettingsRequest.create({
					planActSeparateModelsSetting: enabled,
				}),
			)
			// If disabling split mode, sync configurations
			if (!enabled) {
				syncModeConfigurations(apiConfiguration, currentMode, handleFieldsChange)
			}
		},
		[apiConfiguration, currentMode, handleFieldsChange],
	)

	// Handle configure link click
	const handleConfigureClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			e.preventDefault()
			onOpenChange(false)
			navigateToSettings?.()
		},
		[onOpenChange, navigateToSettings],
	)

	// Keyboard navigation handler
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			const totalItems = filteredModels.length + featuredModels.length
			if (totalItems === 0) {
				return
			}

			switch (e.key) {
				case "ArrowDown":
					e.preventDefault()
					setSelectedIndex((prev) => (prev < totalItems - 1 ? prev + 1 : prev))
					break
				case "ArrowUp":
					e.preventDefault()
					setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
					break
				case "Enter":
					e.preventDefault()
					if (selectedIndex >= 0) {
						// Determine which list the index falls into
						if (selectedIndex < featuredModels.length) {
							const model = featuredModels[selectedIndex]
							handleSelectModel(model.id, openRouterModels[model.id])
						} else {
							const model = filteredModels[selectedIndex - featuredModels.length]
							handleSelectModel(model.modelId || model.id, model.info, model.multiProviderConfig)
						}
					}
					break
				case "Escape":
					e.preventDefault()
					onOpenChange(false)
					break
			}
		},
		[filteredModels, featuredModels, selectedIndex, handleSelectModel, openRouterModels, onOpenChange],
	)

	// Reset selectedIndex and clear refs when search/provider changes
	useEffect(() => {
		setSelectedIndex(-1)
		itemRefs.current = []
	}, [searchQuery, selectedProvider])

	// Scroll selected item into view
	useEffect(() => {
		if (selectedIndex >= 0) {
			// Use requestAnimationFrame to ensure DOM is updated
			requestAnimationFrame(() => {
				const element = itemRefs.current[selectedIndex]
				if (element) {
					element.scrollIntoView({
						block: "nearest",
						behavior: "smooth",
					})
				}
			})
		}
	}, [selectedIndex])

	// Reset states when opening/closing
	useEffect(() => {
		if (isOpen) {
			setIsProviderExpanded(false)
			setSelectedIndex(-1)
			setTimeout(() => searchInputRef.current?.focus(), 100)
		} else {
			setSearchQuery("")
			setSelectedIndex(-1)
		}
	}, [isOpen])

	// Calculate positions for modal and arrow (update on viewport resize)
	useEffect(() => {
		if (isOpen && triggerRef.current) {
			const rect = triggerRef.current.getBoundingClientRect()
			const buttonCenter = rect.left + rect.width / 2
			const rightPosition = document.documentElement.clientWidth - buttonCenter - 5
			setMenuPosition(rect.top + 1)
			setArrowPosition(rightPosition)
		}
	}, [isOpen, viewportWidth, viewportHeight])

	// Handle click outside to close
	useEffect(() => {
		if (!isOpen) {
			return
		}

		const handleClickOutside = (e: MouseEvent) => {
			// Don't close if clicking inside modal, trigger, or provider dropdown portal
			if (
				modalRef.current &&
				!modalRef.current.contains(e.target as Node) &&
				triggerRef.current &&
				!triggerRef.current.contains(e.target as Node) &&
				(!providerDropdownRef.current || !providerDropdownRef.current.contains(e.target as Node))
			) {
				onOpenChange(false)
			}
		}

		// Delay adding listener to avoid immediate close
		const timeoutId = setTimeout(() => {
			document.addEventListener("mousedown", handleClickOutside)
		}, 0)

		return () => {
			clearTimeout(timeoutId)
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [isOpen, onOpenChange])

	// Handle escape key
	useEffect(() => {
		if (!isOpen) {
			return
		}

		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onOpenChange(false)
			}
		}

		document.addEventListener("keydown", handleEscape)
		return () => document.removeEventListener("keydown", handleEscape)
	}, [isOpen, onOpenChange])

	// Close modal when navigating to other views (settings, MCP, history, account)
	useEffect(() => {
		if (isOpen && (showSettings || showMcp || showHistory || showAccount)) {
			onOpenChange(false)
		}
	}, [isOpen, showSettings, showMcp, showHistory, showAccount, onOpenChange])

	// Check if current model actually belongs to current provider (not auto-selected fallback)
	const modelBelongsToProvider = useMemo(() => {
		if (!selectedModelId) {
			return false
		}
		return allModels.some((m) => (m.modelId || m.id) === selectedModelId)
	}, [selectedModelId, allModels])

	// Handle trigger click
	const handleTriggerClick = useCallback(() => {
		onOpenChange(!isOpen)
	}, [isOpen, onOpenChange])

	const isShuncodeProvider = selectedProvider === "shuncode"
	const isSearching = !!searchQuery
	const isSettingsOnlyProvider =
		SETTINGS_ONLY_PROVIDERS.includes(selectedProvider) && !(isMultiProviderMode && allModels.length > 0)

	return (
		<>
			{/* Trigger wrapper */}
			<div onClick={handleTriggerClick} ref={triggerRef} style={{ cursor: "pointer", display: "inline", minWidth: 0 }}>
				{children}
			</div>

			{/* Modal - rendered via portal with fixed positioning */}
			{isOpen &&
				createPortal(
					<PopupModalContainer
						$arrowPosition={arrowPosition}
						$bottomOffset={5}
						$maxHeight="18em"
						$menuPosition={menuPosition}
						ref={modalRef}>
						{/* Search */}
						<SearchContainer>
							<Search size={14} style={{ color: "var(--vscode-descriptionForeground)", flexShrink: 0 }} />
							<SearchInput
								onChange={(e) => {
									setSearchQuery(e.target.value)
									setIsProviderExpanded(false)
								}}
								onKeyDown={handleKeyDown}
								placeholder={`${t("chat.search")} ${allModels.length} ${t("chat.models")}`}
								ref={searchInputRef as any}
								value={searchQuery}
							/>
						</SearchContainer>

						{/* Settings section - provider + icon toggles */}
						<SettingsSection onClick={(e) => e.stopPropagation()}>
							<div className="flex items-center justify-between">
								{/* Provider - collapsible with dropdown portal */}
								<Tooltip>
									<TooltipTrigger asChild>
										<ProviderRow
											onClick={() => {
												if (providerRowRef.current) {
													const rect = providerRowRef.current.getBoundingClientRect()
													const viewportHeight = window.innerHeight
													const spaceBelow = viewportHeight - rect.bottom
													const itemHeight = 28 // approximate height per item
													const numItems = configuredProviders.length + 1 // +1 for "Add provider"
													const dropdownHeight = Math.min(numItems * itemHeight + 8, 200) // 8px for padding

													// If not enough space below, position above
													const shouldFlipUp = spaceBelow < dropdownHeight + 10 && rect.top > spaceBelow

													setProviderDropdownPosition({
														top: shouldFlipUp ? rect.top - dropdownHeight - 4 : rect.bottom + 4,
														left: rect.left,
														width: modalRef.current?.getBoundingClientRect().width || rect.width,
														maxHeight: shouldFlipUp ? rect.top - 10 : spaceBelow - 10,
													})
												}
												setIsProviderExpanded(!isProviderExpanded)
											}}
											ref={providerRowRef}>
											<div className="text-[11px] text-description">{t("apiOptions.provider")}:</div>
											<span className="text-[11px] text-description">
												{getProviderLabel(selectedProvider)}
											</span>
											<ChevronDownIcon className="text-description" size={12} />
										</ProviderRow>
									</TooltipTrigger>
									{!isProviderExpanded && (
										<TooltipContent side="top" style={{ zIndex: 9999 }}>
											{t("chat.configuredProviders")}
										</TooltipContent>
									)}
								</Tooltip>

								{/* Icon toggles */}
								<div className="flex items-center gap-2">
									<Tooltip>
										<TooltipTrigger asChild>
											<IconToggle
												$isActive={thinkingEnabled}
												$isHidden={!supportsThinking}
												onClick={(e) => {
													e.stopPropagation()
													supportsThinking && handleThinkingToggle(!thinkingEnabled)
												}}>
												<Brain size={14} />
											</IconToggle>
										</TooltipTrigger>
										{supportsThinking && (
											<TooltipContent side="top" style={{ zIndex: 9999 }}>
												{thinkingEnabled
													? t("chat.extendedThinkingEnabled")
													: t("chat.enableExtendedThinking")}
											</TooltipContent>
										)}
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<IconToggle
												$isActive={isSplit}
												onClick={(e) => {
													e.stopPropagation()
													handleSplitToggle(!isSplit)
												}}>
												<ArrowLeftRight size={14} />
											</IconToggle>
										</TooltipTrigger>
										<TooltipContent side="top" style={{ zIndex: 9999 }}>
											{t("chat.useDifferentModelsPlanAct")}
										</TooltipContent>
									</Tooltip>
								</div>
							</div>
							{/* Thinking budget slider - shown when model supports thinking, greyed out when disabled */}
							{supportsThinking && (
								<div className="flex items-center gap-2 py-1.5 px-0 mt-0.5 w-full">
									<div className="text-description whitespace-nowrap min-w-[130px] text-[10px]">
										{t("chat.thinking")} ({(thinkingBudget ?? 0).toLocaleString()} {t("chat.tokens")})
									</div>
									<ThinkingBudgetSlider currentMode={currentMode} showEnableToggle={false} />
								</div>
							)}
						</SettingsSection>

						{/* Scrollable content */}
						<ModelListContainer>
							{/* Current model - inside scroll area for seamless scrolling */}
							{isSplit ? (
								<SplitModeRow onClick={(e) => e.stopPropagation()}>
									<Tooltip>
										<TooltipTrigger asChild>
											<SplitModeCell
												$isActive={activeEditMode === "plan"}
												onClick={() => setActiveEditMode("plan")}>
												<SplitModeLabel $mode="plan">P</SplitModeLabel>
												<SplitModeModel>
													{planModel.selectedModelId?.split("/").pop() || t("chat.notSet")}
												</SplitModeModel>
											</SplitModeCell>
										</TooltipTrigger>
										<TooltipContent side="top" style={{ zIndex: 9999 }}>
											{t("chat.planMode")}
										</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<SplitModeCell
												$isActive={activeEditMode === "act"}
												onClick={() => setActiveEditMode("act")}>
												<SplitModeLabel $mode="act">A</SplitModeLabel>
												<SplitModeModel>
													{actModel.selectedModelId?.split("/").pop() || t("chat.notSet")}
												</SplitModeModel>
											</SplitModeCell>
										</TooltipTrigger>
										<TooltipContent side="top" style={{ zIndex: 9999 }}>
											{t("chat.actMode")}
										</TooltipContent>
									</Tooltip>
								</SplitModeRow>
							) : selectedModelId && modelBelongsToProvider ? (
								(() => {
									// Check if current model has a featured label (only for Shuncode provider)
									const currentFeaturedModel = isShuncodeProvider
										? [...recommendedModels, ...freeModels].find((m) => m.id === selectedModelId)
										: undefined
									return (
										<CurrentModelRow onClick={() => onOpenChange(false)}>
											<ModelInfoRow>
												<div className="text-[11px] text-foreground whitespace-nowrap overflow-hidden text-ellipsis">
													{selectedModelId.split("/").pop() || selectedModelId}
												</div>
												<ModelProvider>
													{OPENROUTER_MODEL_PROVIDERS.includes(selectedProvider)
														? selectedModelId.split("/")[0]
														: isMultiProviderMode && selectedOpenAiConfig
															? selectedOpenAiConfig.name
															: selectedProvider}
												</ModelProvider>
											</ModelInfoRow>
											{currentFeaturedModel?.label && <ModelLabel>{currentFeaturedModel.label}</ModelLabel>}
											<Check
												size={14}
												style={{
													color: "var(--vscode-foreground)",
													flexShrink: 0,
												}}
											/>
										</CurrentModelRow>
									)
								})()
							) : !selectedModelId && selectedProvider === "vercel-ai-gateway" ? (
								<EmptyModelRow>
									<span className="text-[11px] text-description">{t("chat.selectModelBelow")}</span>
								</EmptyModelRow>
							) : null}

							{/* For Shuncode: Show recommended models */}
							{isShuncodeProvider &&
								featuredModels.map((model, index) => (
									<ModelItemContainer
										$isSelected={index === selectedIndex}
										key={model.id}
										onClick={() => handleSelectModel(model.id, openRouterModels[model.id])}
										onMouseEnter={() => setSelectedIndex(index)}
										ref={(el) => {
											itemRefs.current[index] = el
										}}>
										<ModelInfoRow>
											<ModelName>{model.name}</ModelName>
											<ModelProvider>{model.provider}</ModelProvider>
										</ModelInfoRow>
										<ModelLabel>{model.label}</ModelLabel>
									</ModelItemContainer>
								))}

							{/* All other models (for non-Shuncode always, for Shuncode only when searching) */}
							{filteredModels.map((model, index) => {
								const globalIndex = featuredModels.length + index
								const isFavorite = (favoritedModelIds || []).includes(model.id)
								const showStar = selectedProvider === "openrouter" || selectedProvider === "vercel-ai-gateway"
								return (
									<ModelItemContainer
										$isSelected={globalIndex === selectedIndex}
										key={model.id}
										onClick={() =>
											handleSelectModel(model.modelId || model.id, model.info, model.multiProviderConfig)
										}
										onMouseEnter={() => setSelectedIndex(globalIndex)}
										ref={(el) => {
											itemRefs.current[globalIndex] = el
										}}>
										<ModelInfoRow>
											<ModelName>{model.name}</ModelName>
											<ModelProvider>{model.provider}</ModelProvider>
										</ModelInfoRow>
										{showStar && (
											<StarIcon
												isFavorite={isFavorite}
												onClick={(e) => {
													e.stopPropagation()
													StateServiceClient.toggleFavoriteModel(
														StringRequest.create({ value: model.id }),
													).catch((error: Error) =>
														console.error("Failed to toggle favorite model:", error),
													)
												}}
											/>
										)}
									</ModelItemContainer>
								)
							})}

							{/* Settings-only providers: show configured model info and help text */}
							{isSettingsOnlyProvider &&
								(() => {
									const providerInfo = getProviderInfo(
										selectedProvider,
										apiConfiguration,
										effectiveMode === "plan" || effectiveMode === "ask" ? "plan" : "act",
									)
									return (
										<SettingsOnlyContainer>
											{/* Show configured model if exists */}
											{providerInfo.modelId && (
												<div className="flex items-center gap-1.5">
													<div className="text-[10px] text-description shrink-0">
														{t("chat.currentModel")}:
													</div>
													<ConfiguredModelName>{providerInfo.modelId}</ConfiguredModelName>
												</div>
											)}
											{/* Show base URL if configured */}
											{providerInfo.baseUrl && (
												<div className="flex items-center gap-1.5">
													<div className="text-[10px] text-description shrink-0">
														{t("chat.endpoint")}:
													</div>
													<div className="text-[10px] text-description whitespace-nowrap overflow-hidden text-ellipsis font-editor">
														{providerInfo.baseUrl}
													</div>
												</div>
											)}
											{/* Help text / empty state guidance */}
											{!providerInfo.modelId && (
												<div className="text-center text-[11px] text-description py-1 px-0">
													{providerInfo.helpText}
												</div>
											)}
											{/* Configure link */}
											<SettingsOnlyLink onClick={handleConfigureClick}>
												<Settings size={12} />
												<span>
													{providerInfo.modelId
														? t("chat.editInSettings")
														: t("chat.configureInSettings")}
												</span>
											</SettingsOnlyLink>
										</SettingsOnlyContainer>
									)
								})()}

							{/* Empty state */}
							{isSearching &&
								filteredModels.length === 0 &&
								featuredModels.length === 0 &&
								!isSettingsOnlyProvider && <EmptyState>{t("chat.noModelsFound")}</EmptyState>}
						</ModelListContainer>
					</PopupModalContainer>,
					document.body,
				)}

			{/* Provider dropdown - rendered via portal to avoid clipping */}
			{isOpen &&
				isProviderExpanded &&
				createPortal(
					<ProviderDropdownPortal
						onClick={(e) => e.stopPropagation()}
						ref={providerDropdownRef}
						style={{
							top: providerDropdownPosition.top,
							left: providerDropdownPosition.left,
							width: providerDropdownPosition.width - 20, // Account for modal padding
							maxHeight: providerDropdownPosition.maxHeight,
						}}>
						{configuredProviders.map((provider) => (
							<ProviderDropdownItem
								$isSelected={provider === selectedProvider}
								key={provider}
								onClick={() => handleProviderSelect(provider)}>
								{provider === selectedProvider && <span style={{ marginRight: 4 }}>✓</span>}
								<span>{getProviderLabel(provider)}</span>
							</ProviderDropdownItem>
						))}
						<ProviderDropdownItem $isSelected={false} onClick={handleConfigureClick}>
							<span style={{ color: "var(--vscode-textLink-foreground)" }}>+ {t("chat.addProvider")}</span>
						</ProviderDropdownItem>
					</ProviderDropdownPortal>,
					document.body,
				)}
		</>
	)
}

export default ModelPickerModal
