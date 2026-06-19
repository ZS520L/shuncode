import React from "react"
import { useI18n } from "@/i18n"
import MarkdownBlock from "../common/MarkdownBlock"

interface NewTaskPreviewProps {
	context: string
}

const NewTaskPreview: React.FC<NewTaskPreviewProps> = ({ context }) => {
	const { t } = useI18n()
	return (
		<div className="bg-(--vscode-badge-background) text-(--vscode-badge-foreground) rounded-[3px] p-[14px] pb-[6px]">
			<span style={{ fontWeight: "bold" }}>{t("chat.task")}</span>
			<MarkdownBlock markdown={context} />
		</div>
	)
}

export default NewTaskPreview
