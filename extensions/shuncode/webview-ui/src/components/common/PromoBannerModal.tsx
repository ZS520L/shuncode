import { BannerAction, BannerCardData } from "@shared/shuncode/banner"
import { DynamicIcon } from "lucide-react/dynamic"
import React, { useEffect } from "react"
import { useRemark } from "react-remark"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useI18n } from "@/i18n"

interface PromoBannerModalProps {
	banner: BannerCardData
	onAction: (action: BannerAction) => void
	onClose: () => void
}

const PromoBannerModal: React.FC<PromoBannerModalProps> = ({ banner, onAction, onClose }) => {
	const { t } = useI18n()
	const [markdownContent, setMarkdown] = useRemark()

	useEffect(() => {
		setMarkdown(banner.description)
	}, [banner.description, setMarkdown])

	const handleClose = () => {
		onClose()
	}

	return (
		<Dialog onOpenChange={(open) => !open && handleClose()} open>
			<DialogContent hideClose>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{banner.icon && (
							<DynamicIcon
								className="size-5"
								name={banner.icon as React.ComponentProps<typeof DynamicIcon>["name"]}
							/>
						)}
						{banner.title}
					</DialogTitle>
				</DialogHeader>

				<div className="text-sm text-description leading-relaxed [&>*:last-child]:mb-0 [&_a]:text-link [&_a]:hover:underline">
					{markdownContent}
				</div>

				<DialogFooter>
					{banner.actions?.map((action) => (
						<Button
							key={action.title}
							onClick={() => {
								onAction(action)
								handleClose()
							}}
							size="sm"
							variant="default">
							{action.title}
						</Button>
					))}
					<Button onClick={handleClose} size="sm" variant="secondary">
						{t("common.ok")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

export default PromoBannerModal
