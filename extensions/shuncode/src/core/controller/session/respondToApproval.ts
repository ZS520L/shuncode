import { Empty } from "@shared/proto/shuncode/common"
import { ApprovalResponse } from "@shared/proto/shuncode/session"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

export async function respondToApproval(controller: Controller, request: ApprovalResponse): Promise<Empty> {
	try {
		const session = controller.sessionManager.get(request.sessionId)
		if (!session) {
			Logger.warn(`[SessionService] respondToApproval: Session not found: ${request.sessionId}`)
			return Empty.create()
		}

		const task = session.task
		if (!task) {
			Logger.warn(`[SessionService] respondToApproval: No task in session: ${request.sessionId}`)
			return Empty.create()
		}

		// Route through ApprovalGate with approval ID
		const response = request.approved ? "yesButtonClicked" : "noButtonClicked"
		const askTs = request.approvalId ? Number(request.approvalId) : undefined
		task.approvalGate.handleResponse(response as any, request.feedback, request.images, request.files, askTs)

		return Empty.create()
	} catch (error) {
		Logger.error("[SessionService] Error in respondToApproval:", error)
		throw error
	}
}
