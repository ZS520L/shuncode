import { Mode } from "@shared/storage/types"
import { MessageCircleIcon, NotepadTextIcon } from "lucide-react"
import { CSSProperties, memo, useMemo, useRef } from "react"
import { MODE_COLORS } from "@/components/chat/chat-text-area/ChatTextArea.styles"
import { MarkdownDualCopyButtons } from "@/components/common/CopyButton"
import MarkdownBlock from "@/components/common/MarkdownBlock"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"

interface PlanCompletionOutputProps {
	text: string
	onCopy?: () => void
	headClassNames?: string
	mode?: Mode
}

function getModeHeaderConfig(mode: Mode | undefined, t: (key: string) => string) {
	switch (mode) {
		case "chat":
			return {
				icon: <MessageCircleIcon className="size-2" />,
				title: t("chat.modeResponse"),
			}
		case "plan":
		default:
			return {
				icon: <NotepadTextIcon className="size-2" />,
				title: t("chat.planCreated"),
			}
	}
}

/**
 * Styled completion output for plan_mode_respond.
 * Border and background tint follow the active mode's color via MODE_COLORS.
 */
const PlanCompletionOutputRow = memo(({ text, headClassNames, mode }: PlanCompletionOutputProps) => {
	const { t } = useI18n()
	const renderedRef = useRef<HTMLDivElement>(null)
	const source = text || ""

	const modeColor = mode ? MODE_COLORS[mode] : undefined
	const { icon, title } = getModeHeaderConfig(mode, t)

	const containerStyle = useMemo<CSSProperties | undefined>(() => {
		if (!modeColor) return undefined
		return {
			borderColor: `color-mix(in srgb, ${modeColor} 40%, transparent)`,
			backgroundColor: `color-mix(in srgb, ${modeColor} 6%, transparent)`,
		}
	}, [modeColor])

	const dividerStyle = useMemo<CSSProperties | undefined>(() => {
		if (!modeColor) return undefined
		return {
			borderTopColor: `color-mix(in srgb, ${modeColor} 20%, transparent)`,
		}
	}, [modeColor])

	const titleStyle = useMemo<CSSProperties | undefined>(() => {
		if (!modeColor) return undefined
		return { color: modeColor }
	}, [modeColor])

	return (
		<div
			className={cn("rounded-sm border overflow-visible p-2 pt-3", !modeColor && "border-description/50 bg-code")}
			style={containerStyle}>
			{/* Header */}
			<div className={cn(headClassNames, "justify-between px-1")}>
				<div className="flex gap-2 items-center" style={titleStyle}>
					{icon}
					<span className="font-bold">{title}</span>
				</div>
				<MarkdownDualCopyButtons markdownSource={source} renderedRef={renderedRef} />
			</div>

			{/* Content */}
			<div
				className={cn("w-full relative border-t-1 rounded-b-sm", !modeColor && "border-description/20")}
				style={dividerStyle}>
				<div className="plan-completion-content p-2 pt-3 w-full [&_hr]:opacity-20 [&_p:last-child]:mb-0">
					<div className="wrap-anywhere [&_hr]:opacity-20" ref={renderedRef}>
						<MarkdownBlock markdown={text} />
					</div>
				</div>
			</div>
		</div>
	)
})

PlanCompletionOutputRow.displayName = "PlanCompletionOutputRow"

export default PlanCompletionOutputRow
