import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { getModeSpecificFields } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the TogetherProvider component
 */
interface TogetherProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Together provider configuration component
 */
export const TogetherProvider = ({ showModelOptions: _showModelOptions, isPopup: _isPopup, currentMode }: TogetherProviderProps) => {
	const { t } = useI18n()
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const { togetherModelId } = getModeSpecificFields(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.togetherApiKey || ""}
				onChange={(value) => handleFieldChange("togetherApiKey", value)}
				providerName="Together"
			/>
			<DebouncedTextField
				initialValue={togetherModelId || ""}
				onChange={(value) =>
					handleModeFieldChange({ plan: "planModeTogetherModelId", act: "actModeTogetherModelId" }, value, currentMode)
				}
				placeholder={t("provider.enterModelId")}
				style={{ width: "100%" }}>
				<span style={{ fontWeight: 500 }}>{t("provider.modelId")}</span>
			</DebouncedTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				<span style={{ color: "var(--vscode-errorForeground)" }}>
					(<span style={{ fontWeight: 500 }}>{t("provider.notePrefix")}</span> {t("provider.noteText")})
				</span>
			</p>
		</div>
	)
}
