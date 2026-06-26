import { qwenCodeModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the QwenCodeProvider component
 */
interface QwenCodeProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Qwen Code provider configuration component
 */
export const QwenCodeProvider = ({ showModelOptions, isPopup, currentMode }: QwenCodeProviderProps) => {
	const { t } = useI18n()
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<h3 style={{ color: "var(--vscode-foreground)", margin: "8px 0" }}>{t("provider.qwenCodeApiConfiguration")}</h3>
			<VSCodeTextField
				onInput={(e: any) => handleFieldChange("qwenCodeOauthPath", e.target.value)}
				placeholder={t("provider.qwenOauthCredsPathPlaceholder")}
				style={{ width: "100%" }}
				value={apiConfiguration?.qwenCodeOauthPath || ""}>
				{t("provider.oauthCredentialsPath")}
			</VSCodeTextField>
			<div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", marginTop: "4px" }}>
				{t("provider.qwenOauthCredentialsPathDescription")}
			</div>

			<div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", marginTop: "12px" }}>
				{t("provider.qwenCodeOauthDescription")}
			</div>

			<div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", marginTop: "8px" }}>
				{t("provider.toGetStarted")}:
				<br />
				1. {t("provider.installOfficialQwenClient")}
				<br />
				2. {t("provider.authenticateUsingAccount")}
				<br />
				3. {t("provider.oauthCredentialsStoredAutomatically")}
			</div>

			<VSCodeLink
				href="https://github.com/QwenLM/qwen-code/blob/main/README.md"
				style={{
					color: "var(--vscode-textLink-foreground)",
					marginTop: "8px",
					display: "inline-block",
					fontSize: "12px",
				}}>
				{t("provider.setupInstructions")}
			</VSCodeLink>

			{showModelOptions && (
				<>
					<ModelSelector
						label={t("provider.model")}
						models={qwenCodeModels}
						onChange={(modelId) => {
							const fieldName = currentMode === "plan" ? "planModeApiModelId" : "actModeApiModelId"
							handleFieldChange(fieldName, modelId)
						}}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
