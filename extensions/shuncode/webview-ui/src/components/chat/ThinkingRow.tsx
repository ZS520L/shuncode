import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { memo, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"

interface ThinkingRowProps {
	showTitle: boolean
	reasoningContent?: string
	isVisible: boolean
	isExpanded: boolean
	onToggle?: () => void
	/** Timestamp when thinking started (for timer) */
	startTime?: number
	/** Is thinking currently in progress (streaming)? */
	isThinking?: boolean
}

export const ThinkingRow = memo(
	({ showTitle = false, reasoningContent, isVisible, isExpanded, onToggle, startTime, isThinking }: ThinkingRowProps) => {
		const { t } = useI18n()
		const scrollRef = useRef<HTMLDivElement>(null)
		const [elapsedSeconds, setElapsedSeconds] = useState(0)

		// Elapsed seconds without setInterval: rAF while thinking; one sync when idle.
		useEffect(() => {
			if (!startTime) {
				return
			}

			const sync = () => setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000))
			sync()

			if (!isThinking) {
				return
			}

			let rafId = 0
			let lastSecond = -1
			const loop = () => {
				const s = Math.floor((Date.now() - startTime) / 1000)
				if (s !== lastSecond) {
					lastSecond = s
					setElapsedSeconds(s)
				}
				rafId = requestAnimationFrame(loop)
			}
			rafId = requestAnimationFrame(loop)
			return () => cancelAnimationFrame(rafId)
		}, [startTime, isThinking])

		// Only auto-scroll to bottom during streaming (showCursor=true)
		// For expanded collapsed thinking, start at top
		useEffect(() => {
			if (scrollRef.current && isVisible) {
				scrollRef.current.scrollTop = scrollRef.current.scrollHeight
			}
		}, [reasoningContent, isVisible])

		if (!isVisible) {
			return null
		}

		// Format thinking title with timer
		const thinkingTitle = isThinking
			? `${t("thinking.thinking")}${elapsedSeconds > 0 ? ` ${elapsedSeconds}${t("thinking.secondsShort")}` : "..."}`
			: `${t("thinking.thoughtFor")} ${elapsedSeconds}${t("thinking.secondsShort")}`

		return (
			<div className="ml-1">
				{showTitle ? (
					<Button
						className="inline-flex justify-baseline gap-0.5 text-left select-none cursor-pointer text-description px-0 w-full"
						onClick={onToggle}
						variant="icon">
						{isExpanded ? <ChevronDownIcon className="opacity-70" /> : <ChevronRightIcon className="opacity-70" />}
						<span className="font-semibold">{thinkingTitle}</span>
						<span className="italic break-words truncate [direction:rtl] w-full">
							{!isExpanded ? reasoningContent : ""}
						</span>
					</Button>
				) : null}

				{isExpanded && (
					<Button
						className={cn(
							"flex gap-0 overflow-hidden w-full min-w-0 max-h-0 opacity-0 items-baseline justify-baseline text-left p-0",
							"disabled:cursor-text disabled:opacity-100",
							{
								"max-h-[400px] opacity-100": isVisible,
								"transition-[max-height] duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)] [transition:max-height_250ms_cubic-bezier(0.4,0,0.2,1),opacity_150ms_ease-out]":
									isVisible,
							},
						)}
						disabled={!showTitle}
						onClick={onToggle}
						variant="text">
						<div
							className={cn(
								"flex max-h-[350px] overflow-y-auto text-description leading-normal truncated whitespace-pre-wrap break-words flex-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [direction:ltr]",
								{
									"pl-2 border-l border-description/50": showTitle,
								},
							)}
							ref={scrollRef}>
							<span>{reasoningContent}</span>
						</div>
					</Button>
				)}
			</div>
		)
	},
)

ThinkingRow.displayName = "ThinkingRow"
