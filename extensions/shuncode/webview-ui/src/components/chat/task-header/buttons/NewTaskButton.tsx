import { XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"

const NewTaskButton: React.FC<{
	onClick: () => void
	className?: string
}> = ({ className, onClick }) => {
	const { t } = useI18n()
	return (
		<Tooltip>
			<TooltipContent side="left">{t("chat.newTask")}</TooltipContent>
			<TooltipTrigger className={cn("flex items-center", className)}>
				<Button
					aria-label={t("chat.newTask")}
					onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						onClick()
					}}
					size="icon"
					variant="icon">
					<XIcon />
				</Button>
			</TooltipTrigger>
		</Tooltip>
	)
}

export default NewTaskButton
