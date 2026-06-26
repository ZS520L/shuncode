import { StringRequest, Empty } from "@shared/proto/shuncode/common"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Close a session tab by ID (multi-tab support).
 * Destroys the session and its task. If closing the active session,
 * switches to another available session.
 */
export async function closeSession(controller: Controller, request: StringRequest): Promise<Empty> {
	const sessionId = request.value
	try {
		await controller.closeSession(sessionId)
		Logger.info(`[SessionService] Closed session: ${sessionId}`)
		return Empty.create()
	} catch (error) {
		Logger.error("[SessionService] Error in closeSession:", error)
		throw error
	}
}
