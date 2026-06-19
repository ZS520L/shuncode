import { CreateSessionRequest, SessionInfo, SessionStateProto } from "@shared/proto/shuncode/session"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

export async function createSession(controller: Controller, request: CreateSessionRequest): Promise<SessionInfo> {
	try {
		const session = controller.sessionManager.create(request.sessionId)
		Logger.info(`[SessionService] Created session: ${session.id}`)

		return SessionInfo.create({
			sessionId: session.id,
			state: SessionStateProto.SESSION_IDLE,
		})
	} catch (error) {
		Logger.error("[SessionService] Error creating session:", error)
		throw error
	}
}
