import {
	CheckCheckIcon,
	Copy as CopyIcon,
	FileCode as FileCodeIcon,
	LetterText as LetterTextIcon,
} from "lucide-react"
import { forwardRef, useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/i18n"
import { writeRichHtmlFromRenderedRoot } from "@/lib/copyRichClipboard"
import { cn } from "@/lib/utils"

interface CopyButtonProps {
	textToCopy?: string
	onCopy?: () => string | undefined | null
	className?: string
	ariaLabel?: string
}

interface WithCopyButtonProps {
	children: React.ReactNode
	textToCopy?: string
	onCopy?: () => string | undefined | null
	/** Left: formatted (Word); right: Markdown source. Requires ref on rendered markdown container. */
	markdownDualCopy?: {
		markdownSource: string
		renderedRef: React.RefObject<HTMLElement | null>
	}
	position?: "top-right" | "bottom-right"
	style?: React.CSSProperties
	className?: string
	copyButtonClassname?: string
	onMouseUp?: (event: React.MouseEvent<HTMLDivElement>) => void
	ariaLabel?: string
}

const COPIED_TIMEOUT = 1500

const POSITION_CLASSES = {
	"top-right": "top-5 right-5",
	"bottom-right": "bottom-1 right-2",
} as const

/**
 * Base copy button component with clipboard functionality
 */
export const CopyButton: React.FC<CopyButtonProps> = ({ textToCopy, onCopy, className, ariaLabel }) => {
	const [copied, setCopied] = useState(false)

	const handleCopy = useCallback(() => {
		const text = onCopy?.() || textToCopy
		if (!text) {
			return
		}

		navigator.clipboard
			.writeText(text)
			.then(() => {
				setCopied(true)
				setTimeout(() => setCopied(false), COPIED_TIMEOUT)
			})
			.catch((err) => console.error("Copy failed", err))
	}, [textToCopy, onCopy])

	return (
		<Button
			aria-label={copied ? "Copied" : ariaLabel || "Copy"}
			className={cn("scale-90", className)}
			onClick={handleCopy}
			size="icon"
			variant="icon">
			{copied ? <CheckCheckIcon className="size-2" /> : <CopyIcon className="size-2" />}
		</Button>
	)
}

/**
 * Container component that wraps content with a copy button
 */
export const WithCopyButton = forwardRef<HTMLDivElement, WithCopyButtonProps>(
	(
		{
			children,
			textToCopy,
			onCopy,
			markdownDualCopy,
			position = "top-right",
			style,
			className,
			copyButtonClassname,
			onMouseUp,
			ariaLabel,
			...props
		},
		ref,
	) => {
		const hasCopyFunctionality = !!(textToCopy || onCopy || markdownDualCopy)

		return (
			<div className={cn("group relative w-full", className)} onMouseUp={onMouseUp} ref={ref} style={style} {...props}>
				{hasCopyFunctionality && (
					<div
						className={cn(
							"absolute opacity-0 group-hover:opacity-100 transition-opacity z-[1]",
							POSITION_CLASSES[position],
							copyButtonClassname,
						)}>
						{markdownDualCopy ? (
							<MarkdownDualCopyButtons
								buttonClassName={copyButtonClassname}
								markdownSource={markdownDualCopy.markdownSource}
								renderedRef={markdownDualCopy.renderedRef}
							/>
						) : (
							<CopyButton ariaLabel={ariaLabel} onCopy={onCopy} textToCopy={textToCopy} />
						)}
					</div>
				)}
				{children}
			</div>
		)
	},
)

WithCopyButton.displayName = "WithCopyButton"

const DUAL_COPIED_MS = 1500

export function MarkdownDualCopyButtons({
	markdownSource,
	renderedRef,
	buttonClassName,
}: {
	markdownSource: string
	renderedRef: React.RefObject<HTMLElement | null>
	buttonClassName?: string
}) {
	const { t } = useI18n()
	const [formattedCopied, setFormattedCopied] = useState(false)
	const [markdownCopied, setMarkdownCopied] = useState(false)

	const handleFormatted = useCallback(() => {
		writeRichHtmlFromRenderedRoot(renderedRef.current, markdownSource)
			.then(() => {
				setFormattedCopied(true)
				setTimeout(() => setFormattedCopied(false), DUAL_COPIED_MS)
			})
			.catch((err) => console.error("Copy formatted failed", err))
	}, [markdownSource, renderedRef])

	const handleMarkdown = useCallback(() => {
		const text = markdownSource
		if (!text) {
			return
		}
		navigator.clipboard
			.writeText(text)
			.then(() => {
				setMarkdownCopied(true)
				setTimeout(() => setMarkdownCopied(false), DUAL_COPIED_MS)
			})
			.catch((err) => console.error("Copy markdown failed", err))
	}, [markdownSource])

	return (
		<div className="flex flex-row items-center gap-0.5">
			<Button
				aria-label={formattedCopied ? t("chat.copied") : t("chat.copyFormattedAria")}
				className={cn("scale-90", buttonClassName)}
				onClick={handleFormatted}
				size="icon"
				title={t("chat.copyFormattedHint")}
				type="button"
				variant="icon">
				{formattedCopied ? <CheckCheckIcon className="size-2" /> : <LetterTextIcon className="size-2" />}
			</Button>
			<Button
				aria-label={markdownCopied ? t("chat.copied") : t("chat.copyMarkdownAria")}
				className={cn("scale-90", buttonClassName)}
				onClick={handleMarkdown}
				size="icon"
				title={t("chat.copyMarkdownHint")}
				type="button"
				variant="icon">
				{markdownCopied ? <CheckCheckIcon className="size-2" /> : <FileCodeIcon className="size-2" />}
			</Button>
		</div>
	)
}
