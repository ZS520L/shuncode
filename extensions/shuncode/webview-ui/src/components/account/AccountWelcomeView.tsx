import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useShuncodeSignIn } from "@/context/ShuncodeAuthContext"
import { useI18n } from "@/i18n"
import ShuncodeLogoVariable from "../../assets/ShuncodeLogoVariable"

// export const AccountWelcomeView = () => (
// 	<div className="flex flex-col items-center pr-3 gap-2.5">
// 		<ShuncodeLogoWhite className="size-16 mb-4" />
export const AccountWelcomeView = () => {
	const { t } = useI18n()
	const { environment, freeRequestLimit } = useExtensionState()
	const { isLoginLoading, loginError, clearError, handleSignIn } = useShuncodeSignIn()

	return (
		<div className="flex flex-col items-center pr-3 gap-2.5">
			<ShuncodeLogoVariable className="size-16 mb-4" environment={environment} />

			<div className="w-full p-3 rounded-lg text-sm bg-[var(--vscode-editorWidget-background,var(--vscode-editor-background))] border border-[var(--vscode-editorWidget-border,rgba(127,127,127,0.2))]">
				<div className="flex items-start gap-2.5">
					<span className="text-base leading-none mt-0.5">👋</span>
					<p className="m-0 text-[var(--vscode-foreground)]">
						{t("account.freeTrialWelcome", { limit: String(freeRequestLimit ?? 20) })}
					</p>
				</div>
			</div>

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

			<VSCodeButton className="w-full mb-4" disabled={isLoginLoading} onClick={handleSignIn}>
				{t("account.signUpWithShuncode")}
				{isLoginLoading && (
					<span className="ml-1 animate-spin">
						<span className="codicon codicon-refresh"></span>
					</span>
				)}
			</VSCodeButton>

			<p className="text-(--vscode-descriptionForeground) text-xs text-center m-0">
				{t("account.byContinuingAgree")} <VSCodeLink href="https://shuncode-ai.ru/ru/license">{t("account.termsOfService")}</VSCodeLink>{" "}
				{t("account.and")} <VSCodeLink href="https://shuncode-ai.ru/ru/privacy">{t("account.privacyPolicy")}</VSCodeLink>
			</p>
		</div>
	)
}
