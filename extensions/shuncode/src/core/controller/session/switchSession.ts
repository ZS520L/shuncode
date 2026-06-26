import { StringRequest } from "@shared/proto/shuncode/common"
import { SessionInfo, SessionStateProto } from "@shared/proto/shuncode/session"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Switch to an existing session by ID (multi-tab support).
 * Suspends the current task and activates the target session's task.
 */
export async function switchSession(controller: Controller, request: StringRequest): Promise<SessionInfo> {
	const sessionId = request.value
	try {
		const success = await controller.switchToSession(sessionId)
		if (!success) {
			Logger.warn(`[SessionService] switchSession: Session not found: ${sessionId}`)
			return SessionInfo.create({
				sessionId,
				state: SessionStateProto.SESSION_ERROR,
			})
		}

		const session = controller.sessionManager.get(sessionId)
		const state =
			session?.state === "running"
				? SessionStateProto.SESSION_RUNNING
				: session?.state === "paused"
					? SessionStateProto.SESSION_PAUSED
					: SessionStateProto.SESSION_IDLE

		return SessionInfo.create({
			sessionId,
			state,
		})
	} catch (error) {
		Logger.error("[SessionService] Error in switchSession:", error)
		throw error
	}
}
