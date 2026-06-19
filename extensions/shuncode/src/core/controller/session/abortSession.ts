import { Empty, StringRequest } from "@shared/proto/shuncode/common"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

export async function abortSession(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		const session = controller.sessionManager.get(request.value)
		if (!session) {
			Logger.warn(`[SessionService] abortSession: Session not found: ${request.value}`)
			return Empty.create()
		}

		session.abort()
		return Empty.create()
	} catch (error) {
		Logger.error("[SessionService] Error in abortSession:", error)
		throw error
	}
}
