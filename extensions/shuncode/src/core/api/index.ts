import { ApiConfiguration, ModelInfo, QwenApiRegions } from "@shared/api"
import { getApiSettingsMode, Mode } from "@shared/storage/types"
import { ShuncodeStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { ShuncodeTool } from "@/shared/tools"
import { AIhubmixHandler } from "./providers/aihubmix"
import { AnthropicHandler } from "./providers/anthropic"
import { AskSageHandler } from "./providers/asksage"
import { BasetenHandler } from "./providers/baseten"
import { AwsBedrockHandler } from "./providers/bedrock"
import { CerebrasHandler } from "./providers/cerebras"
import { ClaudeCodeHandler } from "./providers/claude-code"
import { ShuncodeHandler } from "./providers/shuncode"
import { DeepSeekHandler } from "./providers/deepseek"
import { DifyHandler } from "./providers/dify"
import { DoubaoHandler } from "./providers/doubao"
import { FireworksHandler } from "./providers/fireworks"
import { GeminiHandler } from "./providers/gemini"
import { GroqHandler } from "./providers/groq"
import { HicapHandler } from "./providers/hicap"
import { HuaweiCloudMaaSHandler } from "./providers/huawei-cloud-maas"
import { HuggingFaceHandler } from "./providers/huggingface"
import { LiteLlmHandler } from "./providers/litellm"
import { LmStudioHandler } from "./providers/lmstudio"
import { MinimaxHandler } from "./providers/minimax"
import { MistralHandler } from "./providers/mistral"
import { MoonshotHandler } from "./providers/moonshot"
import { NebiusHandler } from "./providers/nebius"
import { NousResearchHandler } from "./providers/nousresearch"
import { OcaHandler } from "./providers/oca"
import { OllamaHandler } from "./providers/ollama"
import { OpenAiHandler } from "./providers/openai"
import { OpenAiCodexHandler } from "./providers/openai-codex"
import { OpenAiNativeHandler } from "./providers/openai-native"
import { OpenRouterHandler } from "./providers/openrouter"
import { QwenHandler } from "./providers/qwen"
import { QwenCodeHandler } from "./providers/qwen-code"
import { RequestyHandler } from "./providers/requesty"
import { SambanovaHandler } from "./providers/sambanova"
import { SapAiCoreHandler } from "./providers/sapaicore"
import { TogetherHandler } from "./providers/together"
import { VercelAIGatewayHandler } from "./providers/vercel-ai-gateway"
import { VertexHandler } from "./providers/vertex"
import { VsCodeLmHandler } from "./providers/vscode-lm"
import { XAIHandler } from "./providers/xai"
import { GigaChatHandler } from "./providers/gigachat"
import { YandexGptHandler } from "./providers/yandexgpt"
import { ZAiHandler } from "./providers/zai"
import { ApiStream, ApiStreamUsageChunk } from "./transform/stream"

export type CommonApiHandlerOptions = {
	onRetryAttempt?: ApiConfiguration["onRetryAttempt"]
}
export interface ApiHandler {
	createMessage(systemPrompt: string, messages: ShuncodeStorageMessage[], tools?: ShuncodeTool[], useResponseApi?: boolean): ApiStream
	getModel(): ApiHandlerModel
	getApiStreamUsage?(): Promise<ApiStreamUsageChunk | undefined>
	abort?(): void
}

export interface ApiHandlerModel {
	id: string
	info: ModelInfo
}

export interface ApiProviderInfo {
	providerId: string
	model: ApiHandlerModel
	mode: Mode
	customPrompt?: string // "compact"
	autoCondenseThreshold?: number // 0-1 range
}

export interface SingleCompletionHandler {
	completePrompt(prompt: string): Promise<string>
}

function createHandlerForProvider(
	apiProvider: string | undefined,
	options: Omit<ApiConfiguration, "apiProvider">,
	mode: Mode,
): ApiHandler {
	// Map ask→plan, debug→act for API settings lookup
	const isPlan = getApiSettingsMode(mode) === "plan"
	switch (apiProvider) {
		case "anthropic":
			return new AnthropicHandler({
				onRetryAttempt: options.onRetryAttempt,
				apiKey: options.apiKey,
				anthropicBaseUrl: options.anthropicBaseUrl,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					isPlan ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
		case "openrouter":
			return new OpenRouterHandler({
				onRetryAttempt: options.onRetryAttempt,
				openRouterApiKey: options.openRouterApiKey,
				openRouterModelId: isPlan ? options.planModeOpenRouterModelId : options.actModeOpenRouterModelId,
				openRouterModelInfo: isPlan ? options.planModeOpenRouterModelInfo : options.actModeOpenRouterModelInfo,
				openRouterProviderSorting: options.openRouterProviderSorting,
				reasoningEffort: isPlan ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				thinkingBudgetTokens:
					isPlan ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				geminiThinkingLevel: isPlan ? options.geminiPlanModeThinkingLevel : options.geminiActModeThinkingLevel,
			})
		case "bedrock":
			return new AwsBedrockHandler({
				onRetryAttempt: options.onRetryAttempt,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
				awsAccessKey: options.awsAccessKey,
				awsSecretKey: options.awsSecretKey,
				awsSessionToken: options.awsSessionToken,
				awsRegion: options.awsRegion,
				awsAuthentication: options.awsAuthentication,
				awsBedrockApiKey: options.awsBedrockApiKey,
				awsUseCrossRegionInference: options.awsUseCrossRegionInference,
				awsUseGlobalInference: options.awsUseGlobalInference,
				awsBedrockUsePromptCache: options.awsBedrockUsePromptCache,
				awsUseProfile: options.awsUseProfile,
				awsProfile: options.awsProfile,
				awsBedrockEndpoint: options.awsBedrockEndpoint,
				awsBedrockCustomSelected:
					isPlan ? options.planModeAwsBedrockCustomSelected : options.actModeAwsBedrockCustomSelected,
				awsBedrockCustomModelBaseId:
					isPlan ? options.planModeAwsBedrockCustomModelBaseId : options.actModeAwsBedrockCustomModelBaseId,
				thinkingBudgetTokens:
					isPlan ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
		case "vertex":
			return new VertexHandler({
				onRetryAttempt: options.onRetryAttempt,
				vertexProjectId: options.vertexProjectId,
				vertexRegion: options.vertexRegion,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					isPlan ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				geminiApiKey: options.geminiApiKey,
				geminiBaseUrl: options.geminiBaseUrl,
				thinkingLevel: isPlan ? options.geminiPlanModeThinkingLevel : options.geminiActModeThinkingLevel,
				ulid: options.ulid,
			})
		case "openai":
			return new OpenAiHandler({
				onRetryAttempt: options.onRetryAttempt,
				openAiApiKey: options.openAiApiKey,
				openAiBaseUrl: options.openAiBaseUrl,
				azureApiVersion: options.azureApiVersion,
				azureIdentity: options.azureIdentity,
				openAiHeaders: options.openAiHeaders,
				openAiModelId: isPlan ? options.planModeOpenAiModelId : options.actModeOpenAiModelId,
				openAiModelInfo: isPlan ? options.planModeOpenAiModelInfo : options.actModeOpenAiModelInfo,
				reasoningEffort: isPlan ? options.planModeReasoningEffort : options.actModeReasoningEffort,
			})
		case "ollama":
			return new OllamaHandler({
				onRetryAttempt: options.onRetryAttempt,
				ollamaBaseUrl: options.ollamaBaseUrl,
				ollamaApiKey: options.ollamaApiKey,
				ollamaModelId: isPlan ? options.planModeOllamaModelId : options.actModeOllamaModelId,
				ollamaApiOptionsCtxNum: options.ollamaApiOptionsCtxNum,
				requestTimeoutMs: options.requestTimeoutMs,
			})
		case "lmstudio":
			return new LmStudioHandler({
				onRetryAttempt: options.onRetryAttempt,
				lmStudioBaseUrl: options.lmStudioBaseUrl,
				lmStudioModelId: isPlan ? options.planModeLmStudioModelId : options.actModeLmStudioModelId,
				lmStudioMaxTokens: options.lmStudioMaxTokens,
			})
		case "gemini":
			return new GeminiHandler({
				onRetryAttempt: options.onRetryAttempt,
				vertexProjectId: options.vertexProjectId,
				vertexRegion: options.vertexRegion,
				geminiApiKey: options.geminiApiKey,
				geminiBaseUrl: options.geminiBaseUrl,
				thinkingBudgetTokens:
					isPlan ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				thinkingLevel: isPlan ? options.geminiPlanModeThinkingLevel : options.geminiActModeThinkingLevel,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
				ulid: options.ulid,
			})
		case "openai-native":
			return new OpenAiNativeHandler({
				onRetryAttempt: options.onRetryAttempt,
				openAiNativeApiKey: options.openAiNativeApiKey,
				reasoningEffort: isPlan ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					isPlan ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
		case "openai-codex":
			return new OpenAiCodexHandler({
				onRetryAttempt: options.onRetryAttempt,
				reasoningEffort: isPlan ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "deepseek":
			return new DeepSeekHandler({
				onRetryAttempt: options.onRetryAttempt,
				deepSeekApiKey: options.deepSeekApiKey,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
				reasoningEffort: isPlan ? options.planModeReasoningEffort : options.actModeReasoningEffort,
			})
		case "requesty":
			return new RequestyHandler({
				onRetryAttempt: options.onRetryAttempt,
				requestyBaseUrl: options.requestyBaseUrl,
				requestyApiKey: options.requestyApiKey,
				reasoningEffort: isPlan ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				thinkingBudgetTokens:
					isPlan ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				requestyModelId: isPlan ? options.planModeRequestyModelId : options.actModeRequestyModelId,
				requestyModelInfo: isPlan ? options.planModeRequestyModelInfo : options.actModeRequestyModelInfo,
			})
		case "fireworks":
			return new FireworksHandler({
				onRetryAttempt: options.onRetryAttempt,
				fireworksApiKey: options.fireworksApiKey,
				fireworksModelId: isPlan ? options.planModeFireworksModelId : options.actModeFireworksModelId,
			})
		case "together":
			return new TogetherHandler({
				onRetryAttempt: options.onRetryAttempt,
				togetherApiKey: options.togetherApiKey,
				togetherModelId: isPlan ? options.planModeTogetherModelId : options.actModeTogetherModelId,
			})
		case "qwen":
			return new QwenHandler({
				onRetryAttempt: options.onRetryAttempt,
				qwenApiKey: options.qwenApiKey,
				qwenApiLine:
					options.qwenApiLine === QwenApiRegions.INTERNATIONAL ? QwenApiRegions.INTERNATIONAL : QwenApiRegions.CHINA,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					isPlan ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
		case "qwen-code":
			return new QwenCodeHandler({
				onRetryAttempt: options.onRetryAttempt,
				qwenCodeOauthPath: options.qwenCodeOauthPath,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "doubao":
			return new DoubaoHandler({
				onRetryAttempt: options.onRetryAttempt,
				doubaoApiKey: options.doubaoApiKey,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "mistral":
			return new MistralHandler({
				onRetryAttempt: options.onRetryAttempt,
				mistralApiKey: options.mistralApiKey,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "vscode-lm":
			return new VsCodeLmHandler({
				onRetryAttempt: options.onRetryAttempt,
				vsCodeLmModelSelector:
					isPlan ? options.planModeVsCodeLmModelSelector : options.actModeVsCodeLmModelSelector,
			})
		case "shuncode":
			return new ShuncodeHandler({
				onRetryAttempt: options.onRetryAttempt,
				shuncodeAccountId: options.shuncodeAccountId,
				ulid: options.ulid,
				reasoningEffort: isPlan ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				thinkingBudgetTokens:
					isPlan ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				openRouterProviderSorting: options.openRouterProviderSorting,
				openRouterModelId: isPlan ? options.planModeOpenRouterModelId : options.actModeOpenRouterModelId,
				openRouterModelInfo: isPlan ? options.planModeOpenRouterModelInfo : options.actModeOpenRouterModelInfo,
				geminiThinkingLevel: isPlan ? options.geminiPlanModeThinkingLevel : options.geminiActModeThinkingLevel,
			})
		case "litellm":
			return new LiteLlmHandler({
				onRetryAttempt: options.onRetryAttempt,
				liteLlmApiKey: options.liteLlmApiKey,
				liteLlmBaseUrl: options.liteLlmBaseUrl,
				liteLlmModelId: isPlan ? options.planModeLiteLlmModelId : options.actModeLiteLlmModelId,
				liteLlmModelInfo: isPlan ? options.planModeLiteLlmModelInfo : options.actModeLiteLlmModelInfo,
				thinkingBudgetTokens:
					isPlan ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				liteLlmUsePromptCache: options.liteLlmUsePromptCache,
				ulid: options.ulid,
			})
		case "moonshot":
			return new MoonshotHandler({
				onRetryAttempt: options.onRetryAttempt,
				moonshotApiKey: options.moonshotApiKey,
				moonshotApiLine: options.moonshotApiLine,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "huggingface":
			return new HuggingFaceHandler({
				onRetryAttempt: options.onRetryAttempt,
				huggingFaceApiKey: options.huggingFaceApiKey,
				huggingFaceModelId: isPlan ? options.planModeHuggingFaceModelId : options.actModeHuggingFaceModelId,
				huggingFaceModelInfo:
					isPlan ? options.planModeHuggingFaceModelInfo : options.actModeHuggingFaceModelInfo,
			})
		case "nebius":
			return new NebiusHandler({
				onRetryAttempt: options.onRetryAttempt,
				nebiusApiKey: options.nebiusApiKey,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "asksage":
			return new AskSageHandler({
				onRetryAttempt: options.onRetryAttempt,
				asksageApiKey: options.asksageApiKey,
				asksageApiUrl: options.asksageApiUrl,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "xai":
			return new XAIHandler({
				onRetryAttempt: options.onRetryAttempt,
				xaiApiKey: options.xaiApiKey,
				reasoningEffort: isPlan ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "sambanova":
			return new SambanovaHandler({
				onRetryAttempt: options.onRetryAttempt,
				sambanovaApiKey: options.sambanovaApiKey,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "cerebras":
			return new CerebrasHandler({
				onRetryAttempt: options.onRetryAttempt,
				cerebrasApiKey: options.cerebrasApiKey,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "groq":
			return new GroqHandler({
				onRetryAttempt: options.onRetryAttempt,
				groqApiKey: options.groqApiKey,
				groqModelId: isPlan ? options.planModeGroqModelId : options.actModeGroqModelId,
				groqModelInfo: isPlan ? options.planModeGroqModelInfo : options.actModeGroqModelInfo,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "baseten":
			return new BasetenHandler({
				onRetryAttempt: options.onRetryAttempt,
				basetenApiKey: options.basetenApiKey,
				basetenModelId: isPlan ? options.planModeBasetenModelId : options.actModeBasetenModelId,
				basetenModelInfo: isPlan ? options.planModeBasetenModelInfo : options.actModeBasetenModelInfo,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "sapaicore":
			return new SapAiCoreHandler({
				onRetryAttempt: options.onRetryAttempt,
				sapAiCoreClientId: options.sapAiCoreClientId,
				sapAiCoreClientSecret: options.sapAiCoreClientSecret,
				sapAiCoreTokenUrl: options.sapAiCoreTokenUrl,
				sapAiResourceGroup: options.sapAiResourceGroup,
				sapAiCoreBaseUrl: options.sapAiCoreBaseUrl,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					isPlan ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				reasoningEffort: isPlan ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				deploymentId: isPlan ? options.planModeSapAiCoreDeploymentId : options.actModeSapAiCoreDeploymentId,
				sapAiCoreUseOrchestrationMode: options.sapAiCoreUseOrchestrationMode,
			})
		case "claude-code":
			return new ClaudeCodeHandler({
				onRetryAttempt: options.onRetryAttempt,
				claudeCodePath: options.claudeCodePath,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					isPlan ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
		case "huawei-cloud-maas":
			return new HuaweiCloudMaaSHandler({
				onRetryAttempt: options.onRetryAttempt,
				huaweiCloudMaasApiKey: options.huaweiCloudMaasApiKey,
				huaweiCloudMaasModelId:
					isPlan ? options.planModeHuaweiCloudMaasModelId : options.actModeHuaweiCloudMaasModelId,
				huaweiCloudMaasModelInfo:
					isPlan ? options.planModeHuaweiCloudMaasModelInfo : options.actModeHuaweiCloudMaasModelInfo,
			})
		case "dify": // Add Dify.ai handler
			return new DifyHandler({
				difyApiKey: options.difyApiKey,
				difyBaseUrl: options.difyBaseUrl,
			})
		case "vercel-ai-gateway":
			return new VercelAIGatewayHandler({
				onRetryAttempt: options.onRetryAttempt,
				vercelAiGatewayApiKey: options.vercelAiGatewayApiKey,
				openRouterModelId:
					isPlan ? options.planModeVercelAiGatewayModelId : options.actModeVercelAiGatewayModelId,
				openRouterModelInfo:
					isPlan ? options.planModeVercelAiGatewayModelInfo : options.actModeVercelAiGatewayModelInfo,
				reasoningEffort: isPlan ? options.planModeReasoningEffort : options.actModeReasoningEffort,
				thinkingBudgetTokens:
					isPlan ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				geminiThinkingLevel: isPlan ? options.geminiPlanModeThinkingLevel : options.geminiActModeThinkingLevel,
			})
		case "zai":
			return new ZAiHandler({
				onRetryAttempt: options.onRetryAttempt,
				zaiApiLine: options.zaiApiLine,
				zaiApiKey: options.zaiApiKey,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "oca":
			return new OcaHandler({
				ocaMode: options.ocaMode || "internal",
				ocaBaseUrl: options.ocaBaseUrl,
				ocaModelId: isPlan ? options.planModeOcaModelId : options.actModeOcaModelId,
				ocaModelInfo: isPlan ? options.planModeOcaModelInfo : options.actModeOcaModelInfo,
				ocaReasoningEffort: isPlan ? options.planModeOcaReasoningEffort : options.actModeOcaReasoningEffort,
				thinkingBudgetTokens:
					isPlan ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
				ocaUsePromptCache:
					isPlan
						? options.planModeOcaModelInfo?.supportsPromptCache
						: options.actModeOcaModelInfo?.supportsPromptCache,
				taskId: options.ulid,
			})
		case "aihubmix":
			return new AIhubmixHandler({
				onRetryAttempt: options.onRetryAttempt,
				apiKey: options.aihubmixApiKey,
				baseURL: options.aihubmixBaseUrl,
				appCode: options.aihubmixAppCode,
				modelId: isPlan ? (options as any).planModeAihubmixModelId : (options as any).actModeAihubmixModelId,
				modelInfo:
					isPlan ? (options as any).planModeAihubmixModelInfo : (options as any).actModeAihubmixModelInfo,
			})
		case "minimax":
			return new MinimaxHandler({
				onRetryAttempt: options.onRetryAttempt,
				minimaxApiKey: options.minimaxApiKey,
				minimaxApiLine: options.minimaxApiLine,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "hicap":
			return new HicapHandler({
				onRetryAttempt: options.onRetryAttempt,
				hicapApiKey: options.hicapApiKey,
				hicapModelId: isPlan ? options.planModeHicapModelId : options.actModeHicapModelId,
			})
		case "nousResearch":
			return new NousResearchHandler({
				onRetryAttempt: options.onRetryAttempt,
				nousResearchApiKey: options.nousResearchApiKey,
				apiModelId: isPlan ? options.planModeNousResearchModelId : options.actModeNousResearchModelId,
			})
		case "gigachat":
			return new GigaChatHandler({
				onRetryAttempt: options.onRetryAttempt,
				gigaChatApiKey: options.gigaChatApiKey,
				gigaChatScope: options.gigaChatScope,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
			})
		case "yandexgpt":
			return new YandexGptHandler({
				onRetryAttempt: options.onRetryAttempt,
				yandexGptApiKey: options.yandexGptApiKey,
				yandexGptFolderId: options.yandexGptFolderId,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
			})
		default:
			return new AnthropicHandler({
				onRetryAttempt: options.onRetryAttempt,
				apiKey: options.apiKey,
				anthropicBaseUrl: options.anthropicBaseUrl,
				apiModelId: isPlan ? options.planModeApiModelId : options.actModeApiModelId,
				thinkingBudgetTokens:
					isPlan ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens,
			})
	}
}

export function buildApiHandler(configuration: ApiConfiguration, mode: Mode): ApiHandler {
	const { planModeApiProvider, actModeApiProvider, ...options } = configuration
	const isPlan = getApiSettingsMode(mode) === "plan"

	const apiProvider = isPlan ? planModeApiProvider : actModeApiProvider

	// Validate thinking budget tokens against model's maxTokens to prevent API errors
	// wrapped in a try-catch for safety, but this should never throw
	try {
		const thinkingBudgetTokens = isPlan ? options.planModeThinkingBudgetTokens : options.actModeThinkingBudgetTokens
		if (thinkingBudgetTokens && thinkingBudgetTokens > 0) {
			const handler = createHandlerForProvider(apiProvider, options, mode)

			const modelInfo = handler.getModel().info
			if (modelInfo?.maxTokens && modelInfo.maxTokens > 0 && thinkingBudgetTokens > modelInfo.maxTokens) {
				const clippedValue = modelInfo.maxTokens - 1
				if (isPlan) {
					options.planModeThinkingBudgetTokens = clippedValue
				} else {
					options.actModeThinkingBudgetTokens = clippedValue
				}
			} else {
				return handler // don't rebuild unless its necessary
			}
		}
	} catch (error) {
		Logger.error("buildApiHandler error:", error)
	}

	return createHandlerForProvider(apiProvider, options, mode)
}
