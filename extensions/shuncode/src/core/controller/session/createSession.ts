import { CreateSessionRequest, SessionInfo, SessionStateProto } from "@shared/proto/shuncode/session"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

export async function createSession(controller: Controller, request: CreateSessionRequest): Promise<SessionInfo> {
	try {
		Logger.info(
			`[SessionService] createSession called. Current sessions: ${controller.sessionManager.size}, activeId: ${controller.sessionManager.activeSessionId}`,
		)

		// Suspend (detach) current task — it keeps running in its session
		await controller.suspendCurrentTask()

		// Create and switch to the new session
		const session = controller.sessionManager.create(request.sessionId)
		controller.sessionManager.switchTo(session.id)
		Logger.info(`[SessionService] Created session: ${session.id}. Total sessions now: ${controller.sessionManager.size}`)

		// Notify webview of the new state (empty chat for new session)
		await controller.postStateToWebview()

		return SessionInfo.create({
			sessionId: session.id,
			state: SessionStateProto.SESSION_IDLE,
		})
	} catch (error) {
		Logger.error("[SessionService] Error creating session:", error)
		throw error
	}
}
