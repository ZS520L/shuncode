import { Empty, StringRequest } from "@shared/proto/shuncode/common"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

export async function resumeSession(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		const session = controller.sessionManager.get(request.value)
		if (!session) {
			Logger.warn(`[SessionService] resumeSession: Session not found: ${request.value}`)
			return Empty.create()
		}

		session.resume()
		return Empty.create()
	} catch (error) {
		Logger.error("[SessionService] Error in resumeSession:", error)
		throw error
	}
}
