import { Mode } from "@shared/storage/types"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import VercelModelPicker from "../VercelModelPicker"

/**
 * Props for the VercelAIGatewayProvider component
 */
interface VercelAIGatewayProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Vercel AI Gateway provider configuration component
 */
export const VercelAIGatewayProvider = ({ showModelOptions, isPopup, currentMode }: VercelAIGatewayProviderProps) => {
	const { t } = useI18n()
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	return (
		<div>
			<div>
				<DebouncedTextField
					initialValue={apiConfiguration?.vercelAiGatewayApiKey || ""}
					onChange={(value) => handleFieldChange("vercelAiGatewayApiKey", value)}
					placeholder={t("provider.enterApiKey")}
					style={{ width: "100%" }}
					type="password">
					<span style={{ fontWeight: 500 }}>{t("provider.vercelAiGatewayApiKey")}</span>
				</DebouncedTextField>
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					{t("provider.keyStoredLocally")}
					{!apiConfiguration?.vercelAiGatewayApiKey && (
						<>
							{" "}
							{t("provider.getVercelApiKeyBy")}{" "}
							<VSCodeLink
								href="https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai"
								style={{ display: "inline", fontSize: "inherit" }}>
								{t("provider.signingUpHere")}
							</VSCodeLink>
						</>
					)}
				</p>
			</div>

			{showModelOptions && <VercelModelPicker currentMode={currentMode} isPopup={isPopup} />}
		</div>
	)
}
