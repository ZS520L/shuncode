import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { gigaChatModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useDebouncedInput } from "../utils/useDebouncedInput"

/**
 * Props for the GigaChatProvider component
 */
interface GigaChatProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The GigaChat (Sber) provider configuration component
 */
export const GigaChatProvider = ({ showModelOptions, isPopup, currentMode }: GigaChatProviderProps) => {
	const { t } = useI18n()
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()
	const [localKey, setLocalKey] = useDebouncedInput(apiConfiguration?.gigaChatApiKey || "", (value) =>
		handleFieldChange("gigaChatApiKey", value),
	)

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<div>
				<VSCodeTextField
					onInput={(e: any) => setLocalKey(e.target.value)}
					placeholder={t("provider.gigachat.enterAuthKey")}
					required={true}
					style={{ width: "100%" }}
					type="password"
					value={localKey}>
					<span style={{ fontWeight: 500 }}>{t("provider.gigachat.authKey")}</span>
				</VSCodeTextField>
				<p
					style={{
						fontSize: "12px",
						marginTop: 3,
						color: "var(--vscode-descriptionForeground)",
					}}>
					{t("provider.gigachat.keyStoredLocally")}
					{!localKey && (
						<>
							{" "}
							{t("provider.gigachat.getKey")}{" "}
							<VSCodeLink
								href="https://developers.sber.ru/studio/workspaces/"
								style={{ display: "inline", fontSize: "inherit" }}>
								{t("provider.gigachat.studio")}
							</VSCodeLink>
							.
						</>
					)}
				</p>
			</div>

			<div style={{ marginBottom: 5 }}>
				<label htmlFor="gigachat-scope" style={{ fontWeight: 500, display: "block", marginBottom: 5 }}>
					{t("provider.gigachat.scope")}
				</label>
				<select
					id="gigachat-scope"
					value={apiConfiguration?.gigaChatScope || "GIGACHAT_API_PERS"}
					onChange={(e) => handleFieldChange("gigaChatScope", e.target.value)}
					style={{ width: "100%" }}>
					<option value="GIGACHAT_API_PERS">{t("provider.gigachat.scopePers")}</option>
					<option value="GIGACHAT_API_CORP">{t("provider.gigachat.scopeCorp")}</option>
					<option value="GIGACHAT_API_B2B">{t("provider.gigachat.scopeB2B")}</option>
				</select>
			</div>

			{showModelOptions && (
				<>
					<ModelSelector
						label={t("provider.gigachat.model")}
						models={gigaChatModels}
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
