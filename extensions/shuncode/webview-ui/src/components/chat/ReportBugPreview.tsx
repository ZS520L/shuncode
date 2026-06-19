import React from "react"
import { useI18n } from "@/i18n"
import MarkdownBlock from "../common/MarkdownBlock"

interface ReportBugPreviewProps {
	data: string
}

const ReportBugPreview: React.FC<ReportBugPreviewProps> = ({ data }) => {
	const { t } = useI18n()
	// Parse the JSON data from the context string
	const bugData = React.useMemo(() => {
		try {
			return JSON.parse(data || "{}")
		} catch (e) {
			console.error("Failed to parse bug report data", e)
			return {}
		}
	}, [data])

	return (
		<div className="bg-badge-background/50 text-badge-foreground rounded-xs p-3">
			<h2 className="font-bold mb-3">{bugData.title || t("chat.bugReport")}</h2>

			<div className="space-y-3 text-sm">
				{bugData.what_happened && (
					<div>
						<div className="font-semibold">{t("chat.whatHappened")}</div>
						<MarkdownBlock markdown={bugData.what_happened} />
					</div>
				)}

				{bugData.steps_to_reproduce && (
					<div>
						<div className="font-semibold">{t("chat.stepsToReproduce")}</div>
						<MarkdownBlock markdown={bugData.steps_to_reproduce} />
					</div>
				)}

				{bugData.api_request_output && (
					<div>
						<div className="font-semibold">{t("chat.relevantApiRequestOutput")}</div>
						<MarkdownBlock markdown={bugData.api_request_output} />
					</div>
				)}

				{bugData.provider_and_model && (
					<div>
						<div className="font-semibold">{t("chat.providerModel")}</div>
						<MarkdownBlock markdown={bugData.provider_and_model} />
					</div>
				)}

				{bugData.operating_system && (
					<div>
						<div className="font-semibold">{t("chat.operatingSystem")}</div>
						<MarkdownBlock markdown={bugData.operating_system} />
					</div>
				)}

				{bugData.system_info && (
					<div>
						<div className="font-semibold">{t("chat.systemInfo")}</div>
						<MarkdownBlock markdown={bugData.system_info} />
					</div>
				)}

				{bugData.shuncode_version && (
					<div>
						<div className="font-semibold">{t("chat.shuncodeVersion")}</div>
						<MarkdownBlock markdown={bugData.shuncode_version} />
					</div>
				)}

				{bugData.additional_context && (
					<div>
						<div className="font-semibold">{t("chat.additionalContext")}</div>
						<MarkdownBlock markdown={bugData.additional_context} />
					</div>
				)}
			</div>
		</div>
	)
}

export default ReportBugPreview
