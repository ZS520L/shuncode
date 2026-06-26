import { Int64Request } from "@shared/proto/shuncode/common"
import { CheckIcon } from "lucide-react"
import { memo, type MouseEventHandler, type RefObject, useEffect, useRef, useState } from "react"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { MarkdownDualCopyButtons } from "../common/CopyButton"
import SuccessButton from "../common/SuccessButton"
import { QuoteButtonState } from "./ChatRow"
import { MarkdownRow } from "./MarkdownRow"
import QuoteButton from "./QuoteButton"

interface CompletionOutputRowProps {
	text: string
	quoteButtonState: QuoteButtonState
	handleQuoteClick: () => void
	contentRef?: RefObject<HTMLDivElement>
	handleMouseUp?: MouseEventHandler<HTMLDivElement>
	headClassNames?: string
	showActionRow?: boolean
	seeNewChangesDisabled: boolean
	setSeeNewChangesDisabled: (value: boolean) => void
	explainChangesDisabled: boolean
	setExplainChangesDisabled: (value: boolean) => void
	messageTs: number
	stream?: boolean
}

export const CompletionOutputRow = memo(
	({
		headClassNames,
		text,
		quoteButtonState,
		showActionRow,
		seeNewChangesDisabled,
		setSeeNewChangesDisabled,
		explainChangesDisabled,
		setExplainChangesDisabled,
		messageTs,
		stream = false,
		handleQuoteClick,
		contentRef,
		handleMouseUp,
	}: CompletionOutputRowProps) => {
		const { t } = useI18n()
		const renderedRef = useRef<HTMLDivElement>(null)
		const [displayedText, setDisplayedText] = useState(stream ? "" : text)

		useEffect(() => {
			if (!stream || text.length === 0) {
				setDisplayedText(text)
				return
			}

			setDisplayedText("")
			let currentLength = 0
			let rafId = 0
			const charsPerFrame = Math.max(1, Math.ceil(text.length / 120))

			const tick = () => {
				currentLength = Math.min(text.length, currentLength + charsPerFrame)
				setDisplayedText(text.slice(0, currentLength))

				if (currentLength < text.length) {
					rafId = requestAnimationFrame(tick)
				}
			}

			rafId = requestAnimationFrame(tick)

			return () => cancelAnimationFrame(rafId)
		}, [stream, text])

		return (
			<div onMouseUp={handleMouseUp} ref={contentRef}>
				<div className="rounded-md border border-success/20 overflow-visible bg-success/10 p-2 pt-3 transition-colors duration-150">
					{/* Title */}
					<div className={cn(headClassNames, "justify-between px-1")}>
						<div className="flex gap-2 items-center">
							<CheckIcon className="size-3 text-success" />
							<span className="text-success font-bold">{t("chat.taskCompleted")}</span>
						</div>
						<MarkdownDualCopyButtons
							buttonClassName="text-success"
							markdownSource={text}
							renderedRef={renderedRef}
						/>
					</div>
					{/* Content */}
					<div className="w-full relative border-t-1 border-description/20 rounded-b-sm">
						<div
							className="completion-output-content p-2 pt-3 w-full [&_hr]:opacity-20 [&_p:last-child]:mb-0 rounded-sm"
							ref={renderedRef}>
							<MarkdownRow markdown={displayedText} showCursor={stream && displayedText.length < text.length} />
							{quoteButtonState.visible && (
								<QuoteButton left={quoteButtonState.left} onClick={handleQuoteClick} top={quoteButtonState.top} />
							)}
						</div>
					</div>
				</div>
				{/* Action Buttons */}
				{showActionRow && (
					<CompletionOutputActionRow
						explainChangesDisabled={explainChangesDisabled}
						messageTs={messageTs}
						seeNewChangesDisabled={seeNewChangesDisabled}
						setExplainChangesDisabled={setExplainChangesDisabled}
						setSeeNewChangesDisabled={setSeeNewChangesDisabled}
					/>
				)}
			</div>
		)
	},
)

CompletionOutputRow.displayName = "CompletionOutputRow"

const CompletionOutputActionRow = memo(
	({
		seeNewChangesDisabled,
		setSeeNewChangesDisabled,
		explainChangesDisabled,
		setExplainChangesDisabled,
		messageTs,
	}: {
		seeNewChangesDisabled: boolean
		setSeeNewChangesDisabled: (value: boolean) => void
		explainChangesDisabled: boolean
		setExplainChangesDisabled: (value: boolean) => void
		messageTs: number
	}) => {
		const { t } = useI18n()
		return (
			<div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
				<SuccessButton
					disabled={seeNewChangesDisabled}
					onClick={() => {
						setSeeNewChangesDisabled(true)
						TaskServiceClient.taskCompletionViewChanges(
							Int64Request.create({
								value: messageTs,
							}),
						).catch((err) => console.error("Failed to show task completion view changes:", err))
					}}
					style={{
						cursor: seeNewChangesDisabled ? "wait" : "pointer",
						width: "100%",
					}}>
					<i className="codicon codicon-new-file" style={{ marginRight: 6 }} />
					{t("chat.viewChanges")}
				</SuccessButton>

				{PLATFORM_CONFIG.type === PlatformType.VSCODE && (
					<SuccessButton
						disabled={explainChangesDisabled}
						onClick={() => {
							setExplainChangesDisabled(true)
							TaskServiceClient.explainChanges({
								metadata: {},
								messageTs,
							}).catch((err) => {
								console.error("Failed to explain changes:", err)
								setExplainChangesDisabled(false)
							})
						}}
						style={{
							cursor: explainChangesDisabled ? "wait" : "pointer",
							width: "100%",
						}}>
						<i className="codicon codicon-comment-discussion" style={{ marginRight: 6 }} />
						{explainChangesDisabled ? t("chat.explaining") : t("chat.explainChanges")}
					</SuccessButton>
				)}
			</div>
		)
	},
)
