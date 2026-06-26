import React from "react"
import { ShuncodeError, ShuncodeErrorType } from "../../../../src/services/error/ShuncodeError"
import { ProgressIndicator } from "./ChatRow"

interface ErrorBlockTitleProps {
	cost?: number
	apiReqCancelReason?: string
	apiRequestFailedMessage?: string
	retryStatus?: {
		attempt: number
		maxAttempts: number
		delaySec?: number
		errorSnippet?: string
	}
}

export const ErrorBlockTitle = ({
	cost,
	apiReqCancelReason,
	apiRequestFailedMessage,
	retryStatus,
	t,
}: ErrorBlockTitleProps & { t: (key: string, params?: Record<string, string | number>) => string }): [
	React.ReactElement,
	React.ReactElement,
] => {
	const getIconSpan = (iconName: string, colorClass: string) => (
		<div className="w-4 h-4 flex items-center justify-center">
			<span className={`codicon codicon-${iconName} text-base -mb-0.5 ${colorClass}`}></span>
		</div>
	)

	const icon =
		apiReqCancelReason != null ? (
			apiReqCancelReason === "user_cancelled" ? (
				getIconSpan("error", "text-(--vscode-descriptionForeground)")
			) : (
				getIconSpan("error", "text-(--vscode-errorForeground)")
			)
		) : cost != null ? (
			getIconSpan("check", "text-(--vscode-charts-green)")
		) : apiRequestFailedMessage ? (
			getIconSpan("error", "text-(--vscode-errorForeground)")
		) : (
			<ProgressIndicator />
		)

	const title = (() => {
		// Default loading state
		const details = { title: t("chat.apiRequestInProgress"), classNames: ["font-bold"] }
		// Handle cancellation states first
		if (apiReqCancelReason === "user_cancelled") {
			details.title = t("chat.apiRequestCancelled")
			details.classNames.push("text-(--vscode-foreground)")
		} else if (apiReqCancelReason != null) {
			details.title = t("chat.apiRequestFailed")
			details.classNames.push("text-(--vscode-errorForeground)")
		} else if (cost != null) {
			// Handle completed request
			details.title = t("chat.apiRequest")
			details.classNames.push("text-(--vscode-foreground)")
		} else if (apiRequestFailedMessage) {
			// Handle failed request
			const shuncodeError = ShuncodeError.parse(apiRequestFailedMessage)
			const titleText = shuncodeError?.isErrorType(ShuncodeErrorType.Balance)
				? t("chat.creditLimitReached")
				: t("chat.apiRequestFailed")
			details.title = titleText
			details.classNames.push("font-bold text-(--vscode-errorForeground)")
		} else if (retryStatus) {
			// Handle retry state
			details.title = t("chat.apiRequest")
			details.classNames.push("text-(--vscode-foreground)")
		}

		return <span className={details.classNames.join(" ")}>{details.title}</span>
	})()

	return [icon, title]
}
