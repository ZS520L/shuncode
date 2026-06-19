import { cn } from "@heroui/react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useI18n } from "@/i18n"

const CopyTaskButton: React.FC<{
	taskText?: string
	className?: string
}> = ({ taskText, className }) => {
	const { t } = useI18n()
	const [copied, setCopied] = useState(false)

	const handleCopy = useCallback(() => {
		if (!taskText) {
			return
		}

		navigator.clipboard.writeText(taskText).then(() => {
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		})
	}, [taskText])

	return (
		<Tooltip>
			<TooltipContent side="bottom">{t("taskHeader.copyText")}</TooltipContent>
			<TooltipTrigger className={cn("flex items-center", className)}>
				<Button
					aria-label={t("taskHeader.copy")}
					onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						handleCopy()
					}}
					size="icon"
					variant="icon">
					{copied ? <CheckIcon /> : <CopyIcon />}
				</Button>
			</TooltipTrigger>
		</Tooltip>
	)
}

export default CopyTaskButton
