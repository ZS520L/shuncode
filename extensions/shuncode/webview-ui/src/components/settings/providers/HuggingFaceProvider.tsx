import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { HuggingFaceModelPicker } from "../HuggingFaceModelPicker"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the HuggingFaceProvider component
 */
interface HuggingFaceProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Hugging Face provider configuration component
 */
export const HuggingFaceProvider = ({ showModelOptions, isPopup, currentMode }: HuggingFaceProviderProps) => {
	const { t } = useI18n()
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<DebouncedTextField
				initialValue={apiConfiguration?.huggingFaceApiKey || ""}
				onChange={(value) => handleFieldChange("huggingFaceApiKey", value)}
				placeholder={t("provider.enterApiKey")}
				style={{ width: "100%" }}
				type="password">
				<span style={{ fontWeight: 500 }}>{t("provider.huggingFaceApiKey")}</span>
			</DebouncedTextField>
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				{t("provider.huggingFaceKeyDescription")}{" "}
				<a href="https://huggingface.co/settings/tokens" rel="noopener noreferrer" target="_blank">
					{t("provider.getYourApiKeyHere")}
				</a>
			</p>

			{showModelOptions && <HuggingFaceModelPicker currentMode={currentMode} isPopup={isPopup} />}
		</div>
	)
}
