import { UpdateApiConfigurationRequestNew } from "@shared/proto/index.shuncode"
import { Mode } from "@shared/storage/types"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { ModelsServiceClient } from "@/services/grpc-client"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { LockIcon, RemotelyConfiguredInputWrapper } from "../common/RemotelyConfiguredInputWrapper"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the LiteLlmProvider component
 */
interface LiteLlmProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const LiteLlmProvider = ({ showModelOptions, isPopup, currentMode }: LiteLlmProviderProps) => {
	const { t } = useI18n()
	const { apiConfiguration, remoteConfigSettings, liteLlmModels } = useExtensionState()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()

	// Get the normalized configuration with model info
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// Handle model change
	const handleModelChange = (e: any) => {
		const newModelId = e.target.value
		const modelInfo = liteLlmModels[newModelId]

		handleModeFieldsChange(
			{
				liteLlmModelId: { plan: "planModeLiteLlmModelId", act: "actModeLiteLlmModelId" },
				liteLlmModelInfo: { plan: "planModeLiteLlmModelInfo", act: "actModeLiteLlmModelInfo" },
			},
			{
				liteLlmModelId: newModelId,
				liteLlmModelInfo: modelInfo,
			},
			currentMode,
		)
	}

	return (
		<div>
			<RemotelyConfiguredInputWrapper hidden={remoteConfigSettings?.liteLlmBaseUrl === undefined}>
				<DebouncedTextField
					disabled={remoteConfigSettings?.liteLlmBaseUrl !== undefined}
					initialValue={apiConfiguration?.liteLlmBaseUrl || ""}
					onChange={async (value) => {
						await ModelsServiceClient.updateApiConfiguration(
							UpdateApiConfigurationRequestNew.create({
								updates: {
									options: {
										liteLlmBaseUrl: value,
									},
								},
								updateMask: ["options.liteLlmBaseUrl"],
							}),
						)
					}}
					placeholder={t("litellm.baseUrlPlaceholder")}
					style={{ width: "100%" }}
					type="text">
					<div className="flex items-center gap-2 mb-1">
						<span style={{ fontWeight: 500 }}>{t("litellm.baseUrlOptional")}</span>
						{remoteConfigSettings?.liteLlmBaseUrl !== undefined && <LockIcon />}
					</div>
				</DebouncedTextField>
			</RemotelyConfiguredInputWrapper>
			<DebouncedTextField
				initialValue={apiConfiguration?.liteLlmApiKey || ""}
				onChange={async (value) => {
					await ModelsServiceClient.updateApiConfiguration(
						UpdateApiConfigurationRequestNew.create({
							updates: {
								secrets: {
									liteLlmApiKey: value,
								},
							},
							updateMask: ["secrets.liteLlmApiKey"],
						}),
					)
				}}
				placeholder={t("litellm.apiKeyPlaceholder")}
				style={{ width: "100%" }}
				type="password">
				<span style={{ fontWeight: 500 }}>{t("litellm.apiKey")}</span>
			</DebouncedTextField>
			{showModelOptions && (
				<>
					<ModelSelector
						label={t("litellm.model")}
						models={liteLlmModels}
						onChange={handleModelChange}
						selectedModelId={selectedModelId}
					/>

					{selectedModelInfo?.supportsReasoning && <ThinkingBudgetSlider currentMode={currentMode} />}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				{t("litellm.reasoningDescription")}{" "}
				<VSCodeLink
					href="https://docs.litellm.ai/docs/reasoning_content"
					style={{ display: "inline", fontSize: "inherit" }}>
					{t("litellm.reasoningLink")}
				</VSCodeLink>
			</p>

			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				{t("litellm.unifiedDescription")}{" "}
				<VSCodeLink href="https://docs.litellm.ai/docs/" style={{ display: "inline", fontSize: "inherit" }}>
					{t("litellm.quickstart")}
				</VSCodeLink>{" "}
				{t("litellm.moreInfo")}
			</p>
		</div>
	)
}
