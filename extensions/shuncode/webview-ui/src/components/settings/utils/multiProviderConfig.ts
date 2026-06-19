import { openAiModelInfoSaneDefaults, type ModelInfo } from "@shared/api"

export const MULTI_PROVIDER_STORAGE_KEY = "shuncode_openai_chat_endpoints"
const LEGACY_MULTI_PROVIDER_STORAGE_KEY = "shuncode_api_configs"

/** 支持的 API 协议类型 */
export type ApiProtocol = "openai-chat" | "openai-responses" | "anthropic"

export const API_PROTOCOL_LABELS: Record<ApiProtocol, string> = {
	"openai-chat": "OpenAI Chat Completions",
	"openai-responses": "OpenAI Responses API",
	"anthropic": "Anthropic Messages API",
}

/** 单个模型的配置 */
export interface ModelEntry {
	id: string
	contextWindow: number // 128_000 | 1_000_000
}

export interface ApiProviderConfig {
	id: string
	name: string
	provider?: "openai" | "anthropic"
	/** API 协议类型，默认 "openai-chat" */
	protocol?: ApiProtocol
	baseUrl?: string
	apiKey: string
	modelId: string
	modelIds?: string[]
	/** 每个模型独立的配置（上下文长度等） */
	models?: ModelEntry[]
	isActive: boolean
	description?: string
	createdAt: number
	updatedAt: number
	tags?: string[]
	customHeaders?: Record<string, string>
	timeout?: number
	retryCount?: number
	/** @deprecated 使用 models[].contextWindow 代替 */
	contextWindow?: number
	rateLimit?: {
		requestsPerMinute?: number
		tokensPerMinute?: number
	}
}

export interface MultiProviderModelOption {
	id: string
	config: ApiProviderConfig
	modelId: string
	info: ModelInfo
}

export const splitModelIds = (value: string | string[] | undefined): string[] => {
	const raw = Array.isArray(value) ? value.join("\n") : value || ""
	return Array.from(
		new Set(
			raw
				.split(/[\n,;]+/)
				.map((item) => item.trim())
				.filter(Boolean),
		),
	)
}

export const getConfigModelIds = (config: Pick<ApiProviderConfig, "modelId" | "modelIds">): string[] => {
	const fromList = splitModelIds(config.modelIds)
	const fromModelId = splitModelIds(config.modelId)
	return fromList.length > 0 ? fromList : fromModelId
}

export const normalizeApiProviderConfig = (config: ApiProviderConfig): ApiProviderConfig => {
	const modelIds = getConfigModelIds(config)
	const protocol = config.protocol || "openai-chat"
	// Derive the actual provider from the protocol
	const provider = protocol === "anthropic" ? "anthropic" : "openai"
	return {
		...config,
		modelId: modelIds[0] || config.modelId || "",
		modelIds,
		provider,
		protocol,
	}
}

export const readMultiProviderConfigs = (): ApiProviderConfig[] => {
	try {
		const raw = localStorage.getItem(MULTI_PROVIDER_STORAGE_KEY) || localStorage.getItem(LEGACY_MULTI_PROVIDER_STORAGE_KEY)
		const parsed = JSON.parse(raw || "[]")
		return Array.isArray(parsed) ? parsed.map(normalizeApiProviderConfig) : []
	} catch {
		return []
	}
}

export const writeMultiProviderConfigs = (configs: ApiProviderConfig[]) => {
	localStorage.setItem(MULTI_PROVIDER_STORAGE_KEY, JSON.stringify(configs.map(normalizeApiProviderConfig)))
	window.dispatchEvent(new Event("shuncode-api-configs-changed"))
}

/** 获取单个模型的上下文窗口大小（优先从 models[] 读取，fallback 到旧字段） */
export const getModelContextWindow = (config: ApiProviderConfig, modelId: string): number => {
	const entry = config.models?.find((m) => m.id === modelId)
	if (entry) return entry.contextWindow
	return config.contextWindow || 128_000
}

export const getMultiProviderModelOptions = (configs = readMultiProviderConfigs()): MultiProviderModelOption[] => {
	return configs.flatMap((config) => {
		const normalizedConfig = normalizeApiProviderConfig(config)
		const protocolLabel = API_PROTOCOL_LABELS[normalizedConfig.protocol || "openai-chat"]
		return getConfigModelIds(normalizedConfig).map((modelId) => ({
			id: `${normalizedConfig.id}:${modelId}`,
			config: normalizedConfig,
			modelId,
			info: {
				...openAiModelInfoSaneDefaults,
				contextWindow: getModelContextWindow(normalizedConfig, modelId),
				description: normalizedConfig.description || `${normalizedConfig.name} • ${protocolLabel}`,
				supportsReasoning: true,
				reasoningEffortOptions: ["low", "medium", "high", "xhigh"],
			},
		}))
	})
}
