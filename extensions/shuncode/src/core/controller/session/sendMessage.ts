import { Empty } from "@shared/proto/shuncode/common"
import { SendMessageRequest } from "@shared/proto/shuncode/session"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

export async function sendMessage(controller: Controller, request: SendMessageRequest): Promise<Empty> {
	try {
		// Free-trial gate: check message limit
		const allowed = await controller.checkFreeRequestGate()
		if (!allowed) {
			return Empty.create()
		}

		const session = controller.sessionManager.get(request.sessionId)
		if (!session) {
			Logger.warn(`[SessionService] sendMessage: Session not found: ${request.sessionId}`)
			return Empty.create()
		}

		session.inject({
			text: request.text,
			images: request.images,
			files: request.files,
		})

		return Empty.create()
	} catch (error) {
		Logger.error("[SessionService] Error in sendMessage:", error)
		throw error
	}
}
