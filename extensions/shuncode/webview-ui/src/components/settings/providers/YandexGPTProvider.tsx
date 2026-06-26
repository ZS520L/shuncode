import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { yandexGptModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useDebouncedInput } from "../utils/useDebouncedInput"

/**
 * Props for the YandexGPTProvider component
 */
interface YandexGPTProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The YandexGPT provider configuration component
 */
export const YandexGPTProvider = ({ showModelOptions, isPopup, currentMode }: YandexGPTProviderProps) => {
	const { t } = useI18n()
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()
	const [localKey, setLocalKey] = useDebouncedInput(apiConfiguration?.yandexGptApiKey || "", (value) =>
		handleFieldChange("yandexGptApiKey", value),
	)
	const [localFolderId, setLocalFolderId] = useDebouncedInput(
		apiConfiguration?.yandexGptFolderId || "",
		(value) => handleFieldChange("yandexGptFolderId", value),
	)

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<div>
				<VSCodeTextField
					onInput={(e: any) => setLocalKey(e.target.value)}
					placeholder={t("provider.yandexgpt.enterApiKey")}
					required={true}
					style={{ width: "100%" }}
					type="password"
					value={localKey}>
					<span style={{ fontWeight: 500 }}>{t("provider.yandexgpt.apiKey")}</span>
				</VSCodeTextField>
				<p
					style={{
						fontSize: "12px",
						marginTop: 3,
						color: "var(--vscode-descriptionForeground)",
					}}>
					{t("provider.yandexgpt.keyStoredLocally")}
					{!localKey && (
						<>
							{" "}
							{t("provider.yandexgpt.getKey")}{" "}
							<VSCodeLink
								href="https://yandex.cloud/ru/docs/ai-studio/operations/get-api-key"
								style={{ display: "inline", fontSize: "inherit" }}>
								{t("provider.yandexgpt.console")}
							</VSCodeLink>
							.
						</>
					)}
				</p>
			</div>

			<div style={{ marginTop: 5 }}>
				<VSCodeTextField
					onInput={(e: any) => setLocalFolderId(e.target.value)}
					placeholder={t("provider.yandexgpt.enterFolderId")}
					required={true}
					style={{ width: "100%" }}
					value={localFolderId}>
					<span style={{ fontWeight: 500 }}>{t("provider.yandexgpt.folderId")}</span>
				</VSCodeTextField>
				<p
					style={{
						fontSize: "12px",
						marginTop: 3,
						color: "var(--vscode-descriptionForeground)",
					}}>
					{t("provider.yandexgpt.folderIdHint")}
				</p>
			</div>

			{showModelOptions && (
				<>
					<ModelSelector
						label={t("provider.yandexgpt.model")}
						models={yandexGptModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
