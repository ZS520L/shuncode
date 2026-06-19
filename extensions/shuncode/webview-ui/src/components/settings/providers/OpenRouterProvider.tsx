import { EmptyRequest } from "@shared/proto/shuncode/common"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { AccountServiceClient } from "@/services/grpc-client"
import { useOpenRouterKeyInfo } from "../../ui/hooks/useOpenRouterKeyInfo"
import { DebouncedTextField } from "../common/DebouncedTextField"
import OpenRouterModelPicker from "../OpenRouterModelPicker"
import { formatPrice } from "../utils/pricingUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Component to display OpenRouter balance information
 */
const OpenRouterBalanceDisplay = ({ apiKey }: { apiKey: string }) => {
	const { t } = useI18n()
	const { data: keyInfo, isLoading, error } = useOpenRouterKeyInfo(apiKey)

	if (isLoading) {
		return <span style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>{t("provider.loading")}</span>
	}

	if (error || keyInfo?.limit == null) {
		// Don't show anything if there's an error, no info, or no limit set
		return null
	}

	// Calculate remaining balance
	const remainingBalance = keyInfo.limit - keyInfo.usage
	const formattedBalance = formatPrice(remainingBalance)

	return (
		<VSCodeLink
			href="https://openrouter.ai/settings/keys"
			style={{
				fontSize: "12px",
				color: "var(--vscode-foreground)",
				textDecoration: "none",
				fontWeight: 500,
				paddingLeft: 4,
				cursor: "pointer",
			}}
			title={`${t("provider.remainingBalance")}: ${formattedBalance}\n${t("provider.limit")}: ${formatPrice(keyInfo.limit)}\n${t("provider.usage")}: ${formatPrice(keyInfo.usage)}`}>
			{t("provider.balance")}: {formattedBalance}
		</VSCodeLink>
	)
}

/**
 * Props for the OpenRouterProvider component
 */
interface OpenRouterProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The OpenRouter provider configuration component
 */
export const OpenRouterProvider = ({ showModelOptions, isPopup, currentMode }: OpenRouterProviderProps) => {
	const { t } = useI18n()
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	return (
		<div>
			<div>
				<DebouncedTextField
					initialValue={apiConfiguration?.openRouterApiKey || ""}
					onChange={(value) => handleFieldChange("openRouterApiKey", value)}
					placeholder={t("provider.enterApiKey")}
					style={{ width: "100%" }}
					type="password">
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
						<span style={{ fontWeight: 500 }}>{t("provider.openRouterApiKey")}</span>
						{apiConfiguration?.openRouterApiKey && (
							<OpenRouterBalanceDisplay apiKey={apiConfiguration.openRouterApiKey} />
						)}
					</div>
				</DebouncedTextField>
				{!apiConfiguration?.openRouterApiKey && (
					<VSCodeButton
						appearance="secondary"
						onClick={async () => {
							try {
								await AccountServiceClient.openrouterAuthClicked(EmptyRequest.create())
							} catch (error) {
								console.error("Failed to open OpenRouter auth:", error)
							}
						}}
						style={{ margin: "5px 0 0 0" }}>
						{t("provider.getOpenRouterApiKey")}
					</VSCodeButton>
				)}
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					{t("provider.keyStoredLocally")}
				</p>
			</div>

			{showModelOptions && <OpenRouterModelPicker currentMode={currentMode} isPopup={isPopup} showProviderRouting={true} />}
		</div>
	)
}
