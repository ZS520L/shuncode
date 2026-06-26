import { useCallback, useMemo } from "react"
import { EmptyRequest } from "@shared/proto/shuncode/common"
import { UpdateApiConfigurationRequest } from "@shared/proto/shuncode/models"
import { PlanActMode, TogglePlanActModeRequest } from "@shared/proto/shuncode/state"
import { convertApiConfigurationToProto } from "@shared/proto-conversions/models/api-configuration-conversion"
import type { Mode } from "@shared/storage/types"
import type { ApiConfiguration } from "@shared/api"
import { getModeSpecificFields, normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import { readMultiProviderConfigs } from "@/components/settings/utils/multiProviderConfig"
import { ModelsServiceClient, StateServiceClient } from "@/services/grpc-client"
import { validateApiConfiguration, validateModelId } from "@/utils/validate"

interface UseModelSelectorParams {
	mode: Mode
	apiConfiguration: ApiConfiguration | undefined
	openRouterModels: Record<string, any> | undefined
	showModelSelector: boolean
	inputValue: string
	selectedImages: string[]
	selectedFiles: string[]
	setInputValue: (v: string) => void
	textAreaRef: React.RefObject<HTMLTextAreaElement | null>
}

export function useModelSelector({
	mode,
	apiConfiguration,
	openRouterModels,
	showModelSelector,
	inputValue,
	selectedImages,
	selectedFiles,
	setInputValue,
	textAreaRef,
}: UseModelSelectorParams) {
	const submitApiConfig = useCallback(async () => {
		const apiValidationResult = validateApiConfiguration(mode, apiConfiguration)
		const modelIdValidationResult = validateModelId(mode, apiConfiguration, openRouterModels)

		if (!apiValidationResult && !modelIdValidationResult && apiConfiguration) {
			try {
				await ModelsServiceClient.updateApiConfigurationProto(
					UpdateApiConfigurationRequest.create({
						apiConfiguration: convertApiConfigurationToProto(apiConfiguration),
					}),
				)
			} catch (error) {
				console.error("Failed to update API configuration:", error)
			}
		} else {
			StateServiceClient.getLatestState(EmptyRequest.create())
				.then(() => console.log("State refreshed"))
				.catch((error) => console.error("Error refreshing state:", error))
		}
	}, [apiConfiguration, openRouterModels])

	const switchToMode = useCallback(
		(targetMode: Mode) => {
			if (targetMode === mode) return
			let changeModeDelay = 0
			if (showModelSelector) {
				submitApiConfig()
				changeModeDelay = 250
			}
			setTimeout(async () => {
				const protoModeMap: Record<Mode, PlanActMode> = {
					plan: PlanActMode.PLAN,
					act: PlanActMode.ACT,
					ask: PlanActMode.PAM_ASK,
					debug: PlanActMode.DEBUG,
					chat: PlanActMode.CHAT,
				}
				const response = await StateServiceClient.togglePlanActModeProto(
					TogglePlanActModeRequest.create({
						mode: protoModeMap[targetMode],
						chatContent: {
							message: inputValue.trim() ? inputValue : undefined,
							images: selectedImages,
							files: selectedFiles,
						},
					}),
				)
				setTimeout(() => {
					if (response.value) {
						setInputValue("")
					}
					textAreaRef.current?.focus()
				}, 100)
			}, changeModeDelay)
		},
		[mode, showModelSelector, submitApiConfig, inputValue, selectedImages, selectedFiles],
	)

	const onModeToggle = useCallback(() => {
		const modeOrder: Mode[] = ["plan", "act", "ask", "debug"]
		const currentIdx = modeOrder.indexOf(mode)
		const nextMode = modeOrder[(currentIdx + 1) % modeOrder.length]
		switchToMode(nextMode)
	}, [mode, switchToMode])

	const modelDisplayName = useMemo(() => {
		const { selectedProvider, selectedModelId } = normalizeApiConfiguration(apiConfiguration, mode)
		const {
			vsCodeLmModelSelector,
			togetherModelId,
			lmStudioModelId,
			ollamaModelId,
			liteLlmModelId,
			requestyModelId,
			vercelAiGatewayModelId,
		} = getModeSpecificFields(apiConfiguration, mode)
		const unknownModel = "unknown"

		if (!apiConfiguration) return unknownModel
		switch (selectedProvider) {
			case "shuncode":
				return `${selectedProvider}:${selectedModelId}`
			case "openai": {
				const activeEndpoint = readMultiProviderConfigs().find((config) => config.isActive)
				return `${activeEndpoint?.name || "openai-compat"}:${selectedModelId}`
			}
			case "vscode-lm":
				return `vscode-lm:${vsCodeLmModelSelector ? `${vsCodeLmModelSelector.vendor ?? ""}/${vsCodeLmModelSelector.family ?? ""}` : unknownModel}`
			case "together":
				return `${selectedProvider}:${togetherModelId}`
			case "lmstudio":
				return `${selectedProvider}:${lmStudioModelId}`
			case "ollama":
				return `${selectedProvider}:${ollamaModelId}`
			case "litellm":
				return `${selectedProvider}:${liteLlmModelId}`
			case "requesty":
				return `${selectedProvider}:${requestyModelId}`
			case "vercel-ai-gateway":
				return `${selectedProvider}:${vercelAiGatewayModelId || selectedModelId}`
			case "anthropic":
			case "openrouter":
			default:
				return `${selectedProvider}:${selectedModelId}`
		}
	}, [apiConfiguration, mode])

	return { modelDisplayName, submitApiConfig, switchToMode, onModeToggle }
}
