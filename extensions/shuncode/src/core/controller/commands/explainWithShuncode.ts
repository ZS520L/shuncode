import { getFileMentionFromPath } from "@/core/mentions"
import { HostProvider } from "@/hosts/host-provider"
import { telemetryService } from "@/services/telemetry"
import { CommandContext, Empty } from "@/shared/proto/index.shuncode"
import { ShowMessageType } from "@/shared/proto/index.host"
import { Logger } from "@/shared/services/Logger"
import { t } from "@/i18n/backend-i18n"
import { Controller } from "../index"

export async function explainWithShuncode(
	controller: Controller,
	request: CommandContext,
	notebookContext?: string,
): Promise<Empty> {
	if (!request.selectedText?.trim() && !notebookContext) {
		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: t("commands.selectCodeToExplain"),
		})
		return {}
	}

	const filePath = request.filePath || ""
	const fileMention = await getFileMentionFromPath(filePath)
	let prompt = `Explain the following code from ${fileMention}:
\`\`\`${request.language}\n${request.selectedText}\n\`\`\``

	// Add notebook context if provided (includes cell JSON)
	if (notebookContext) {
		Logger.log("Adding notebook context to explainWithShuncode task")
		prompt += notebookContext
	}

	await controller.initTask(prompt)
	telemetryService.captureButtonClick("codeAction_explainCode", controller.task?.ulid)

	return {}
}
