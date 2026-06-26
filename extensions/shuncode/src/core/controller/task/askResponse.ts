import { Empty } from "@shared/proto/shuncode/common"
import { AskResponseRequest } from "@shared/proto/shuncode/task"
import { Logger } from "@/shared/services/Logger"
import { ShuncodeAskResponse } from "../../../shared/WebviewMessage"
import { Controller } from ".."

/**
 * @deprecated Use SessionService.respondToApproval instead.
 * This handler is kept for backward compatibility during migration.
 * New code should use SessionServiceClient.respondToApproval with approval_id.
 *
 * Handles a response from the webview for a previous ask operation
 *
 * @param controller The controller instance
 * @param request The request containing response type, optional text and optional images
 * @returns Empty response
 */
export async function askResponse(controller: Controller, request: AskResponseRequest): Promise<Empty> {
	try {
		// Free-trial gate: check message limit for user messages
		if (request.responseType === "messageResponse") {
			const allowed = await controller.checkFreeRequestGate()
			if (!allowed) {
				return Empty.create()
			}
		}

		if (!controller.task) {
			Logger.warn("askResponse: No active task to receive response")
			return Empty.create()
		}

		// Map the string responseType to the ShuncodeAskResponse enum
		let responseType: ShuncodeAskResponse
		switch (request.responseType) {
			case "yesButtonClicked":
				responseType = "yesButtonClicked"
				break
			case "noButtonClicked":
				responseType = "noButtonClicked"
				break
			case "messageResponse":
				responseType = "messageResponse"
				break
			default:
				Logger.warn(`askResponse: Unknown response type: ${request.responseType}`)
				return Empty.create()
		}

		// Call the task's handler for webview responses
		// Pass approvalId if present (for ApprovalGate routing)
		await controller.task.handleWebviewAskResponse(
			responseType,
			request.text,
			request.images,
			request.files,
			request.approvalId,
		)

		return Empty.create()
	} catch (error) {
		Logger.error("Error in askResponse handler:", error)
		throw error
	}
}
