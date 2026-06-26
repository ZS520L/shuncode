import { StringRequest } from "@shared/proto/shuncode/common"
import { ArrowDownToLineIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"

const OpenDiskConversationHistoryButton: React.FC<{
	taskId?: string
	className?: string
}> = ({ taskId, className }) => {
	const { t } = useI18n()
	const handleOpenDiskConversationHistory = () => {
		if (!taskId) {
			return
		}

		FileServiceClient.openDiskConversationHistory(StringRequest.create({ value: taskId })).catch((err) => {
			console.error(err)
		})
	}

	return (
		<Tooltip>
			<TooltipContent>{t("taskHeader.openConversationHistoryFile")}</TooltipContent>
			<TooltipTrigger className={cn("flex items-center", className)}>
				<Button
					aria-label={t("taskHeader.openDiskConversationHistory")}
					onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						handleOpenDiskConversationHistory()
					}}
					size="icon"
					variant="icon">
					<ArrowDownToLineIcon />
				</Button>
			</TooltipTrigger>
		</Tooltip>
	)
}

OpenDiskConversationHistoryButton.displayName = "OpenDiskConversationHistoryButton"
export default OpenDiskConversationHistoryButton
