import { ShuncodeMessage } from "@shared/ExtensionMessage"
import { memo } from "react"
import CreditLimitError from "@/components/chat/CreditLimitError"
import { Button } from "@/components/ui/button"
import { useShuncodeAuth, useShuncodeSignIn } from "@/context/ShuncodeAuthContext"
import { useI18n } from "@/i18n"
import { ShuncodeError, ShuncodeErrorType } from "../../../../src/services/error/ShuncodeError"

const _errorColor = "var(--vscode-errorForeground)"

interface ErrorRowProps {
	message: ShuncodeMessage
	errorType: "error" | "mistake_limit_reached" | "diff_error" | "shuncodeignore_error"
	apiRequestFailedMessage?: string
	apiReqStreamingFailedMessage?: string
}

const ErrorRow = memo(({ message, errorType, apiRequestFailedMessage, apiReqStreamingFailedMessage }: ErrorRowProps) => {
	const { t } = useI18n()
	const { shuncodeUser } = useShuncodeAuth()
	const rawApiError = apiRequestFailedMessage || apiReqStreamingFailedMessage

	const { isLoginLoading, handleSignIn } = useShuncodeSignIn()

	const renderErrorContent = () => {
		switch (errorType) {
			case "error":
			case "mistake_limit_reached":
				// Handle API request errors with special error parsing
				if (rawApiError) {
					// FIXME: ShuncodeError parsing should not be applied to non-Shuncode providers, but it seems we're using shuncodeErrorMessage below in the default error display
					const shuncodeError = ShuncodeError.parse(rawApiError)
					const errorMessage = shuncodeError?._error?.message || shuncodeError?.message || rawApiError
					const requestId = shuncodeError?._error?.request_id
					const providerId = shuncodeError?.providerId || shuncodeError?._error?.providerId
					const isShuncodeProvider = providerId === "shuncode"
					const errorCode = shuncodeError?._error?.code

					if (shuncodeError?.isErrorType(ShuncodeErrorType.Balance)) {
						const errorDetails = shuncodeError._error?.details
						return (
							<CreditLimitError
								buyCreditsUrl={errorDetails?.buy_credits_url}
								currentBalance={errorDetails?.current_balance}
								message={errorDetails?.message}
								totalPromotions={errorDetails?.total_promotions}
								totalSpent={errorDetails?.total_spent}
							/>
						)
					}

					if (shuncodeError?.isErrorType(ShuncodeErrorType.RateLimit)) {
						return (
							<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere">
								{errorMessage}
								{requestId && (
									<div>
										{t("chat.requestId")}: {requestId}
									</div>
								)}
							</p>
						)
					}

					return (
						<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere flex flex-col gap-3">
							{/* Display the well-formatted error extracted from the ShuncodeError instance */}

							<header>
								{providerId && <span className="uppercase">[{providerId}] </span>}
								{errorCode && <span>{errorCode}</span>}
								{errorMessage}
								{requestId && (
									<div>
										{t("chat.requestId")}: {requestId}
									</div>
								)}
							</header>

							{/* Windows Powershell Issue */}
							{errorMessage?.toLowerCase()?.includes("powershell") && (
								<div>
									{t("chat.windowsPowershellIssue")}{" "}
								<a className="underline text-inherit" href="https://shuncode-ai.ru/ru/docs/terminal-troubleshooting">
									{t("chat.troubleshootingGuide")}
								</a>
									.
								</div>
							)}

							{/* Display raw API error if different from parsed error message */}
							{errorMessage !== rawApiError && <div>{rawApiError}</div>}

							{/* Display Login button for non-logged in users using the Shuncode provider */}
							<div>
								{/* The user is signed in or not using shuncode provider */}
								{isShuncodeProvider && !shuncodeUser ? (
									<Button className="w-full mb-4" disabled={isLoginLoading} onClick={handleSignIn}>
										{t("chat.signInToShuncode")}
										{isLoginLoading && (
											<span className="ml-1 animate-spin">
												<span className="codicon codicon-refresh"></span>
											</span>
										)}
									</Button>
								) : (
									<span className="mb-4 text-description">({t("chat.clickRetryBelow")})</span>
								)}
							</div>
						</p>
					)
				}

				// Regular error message
				return <p className="m-0 mt-4 whitespace-pre-wrap text-error wrap-anywhere">{message.text}</p>

			case "diff_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-quote text-foreground">
						<div>{t("chat.searchPatternNoMatchRetrying")}</div>
					</div>
				)

			case "shuncodeignore_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-quote text-foreground">
						<div>
							{t("chat.shuncodeTriedToAccess")} <code>{message.text}</code> {t("chat.blockedByShuncodeignore")}{" "}
							<code>.shuncodeignore</code> {t("chat.fileWord")}
						</div>
					</div>
				)

			default:
				return null
		}
	}

	// For diff_error and shuncodeignore_error, we don't show the header separately
	if (errorType === "diff_error" || errorType === "shuncodeignore_error") {
		return renderErrorContent()
	}

	// For other error types, show header + content
	return renderErrorContent()
})

export default ErrorRow
