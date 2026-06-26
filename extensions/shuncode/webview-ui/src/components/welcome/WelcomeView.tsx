import { BooleanRequest } from "@shared/proto/shuncode/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import ShuncodeLogoWhite from "@/assets/ShuncodeLogoWhite"
import ApiOptions from "@/components/settings/ApiOptions"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useShuncodeSignIn } from "@/context/ShuncodeAuthContext"
import { useI18n } from "@/i18n"
import { StateServiceClient } from "@/services/grpc-client"
import { validateApiConfiguration } from "@/utils/validate"

const WelcomeView = memo(() => {
	const { t } = useI18n()
	const { apiConfiguration, mode } = useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [showApiOptions, setShowApiOptions] = useState(false)
	const { isLoginLoading: isLoading, loginError, clearError, handleSignIn: handleLogin } = useShuncodeSignIn()

	const disableLetsGoButton = apiErrorMessage != null

	const handleSubmit = async () => {
		try {
			await StateServiceClient.setWelcomeViewCompleted(BooleanRequest.create({ value: true }))
		} catch (error) {
			console.error("Failed to update API configuration or complete welcome view:", error)
		}
	}

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(mode, apiConfiguration))
	}, [apiConfiguration, mode])

	return (
		<div className="fixed inset-0 p-0 flex flex-col">
			<div className="h-full px-5 overflow-auto flex flex-col gap-2.5">
				<h2 className="text-lg font-semibold">{t("welcome.hiImShuncode")}</h2>
				<div className="flex justify-center my-5">
					<ShuncodeLogoWhite className="size-16" />
				</div>
				<p>
					{t("welcome.description")}
				</p>

				<p className="text-(--vscode-descriptionForeground)">
					{t("welcome.apiKeyHint")}
				</p>

			{loginError && (
				<div className="w-full p-3 rounded text-sm bg-[var(--vscode-inputValidation-errorBackground,rgba(255,0,0,0.1))] border border-[var(--vscode-inputValidation-errorBorder,#f44747)] text-[var(--vscode-errorForeground,#f44747)]">
					<div className="flex items-start gap-2">
						<span className="codicon codicon-error mt-0.5 shrink-0" />
						<div className="flex-1 break-words">
							<div className="font-medium mb-0.5">{t("account.loginFailed")}</div>
							<div className="text-xs opacity-80">{loginError}</div>
						</div>
						<button
							className="codicon codicon-close cursor-pointer bg-transparent border-none text-[var(--vscode-foreground)] opacity-60 hover:opacity-100 p-0"
							onClick={clearError}
							type="button"
						/>
					</div>
				</div>
			)}

			<VSCodeButton appearance="primary" className="w-full mt-1" disabled={isLoading} onClick={handleLogin}>
				{t("welcome.getStarted")}
				{isLoading && (
					<span className="ml-1 animate-spin">
						<span className="codicon codicon-refresh"></span>
					</span>
				)}
			</VSCodeButton>

				{!showApiOptions && (
					<VSCodeButton
						appearance="secondary"
						className="mt-2.5 w-full"
						onClick={() => setShowApiOptions(!showApiOptions)}>
						{t("welcome.useOwnApiKey")}
					</VSCodeButton>
				)}

				<div className="mt-4.5">
					{showApiOptions && (
						<div>
							<ApiOptions currentMode={mode} showModelOptions={false} />
							<VSCodeButton className="mt-0.75" disabled={disableLetsGoButton} onClick={handleSubmit}>
								Let's go!
							</VSCodeButton>
						</div>
					)}
				</div>
			</div>
		</div>
	)
})

export default WelcomeView
