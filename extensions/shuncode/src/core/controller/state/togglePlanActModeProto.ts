import { Boolean } from "@shared/proto/shuncode/common"
import { PlanActMode, TogglePlanActModeRequest } from "@shared/proto/shuncode/state"
import { Mode } from "@shared/storage/types"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Toggles between Plan and Act modes
 * @param controller The controller instance
 * @param request The request containing the chat settings and optional chat content
 * @returns An empty response
 */
export async function togglePlanActModeProto(controller: Controller, request: TogglePlanActModeRequest): Promise<Boolean> {
	try {
		let mode: Mode
		switch (request.mode) {
			case PlanActMode.PLAN:
				mode = "plan"
				break
			case PlanActMode.ACT:
				mode = "act"
				break
			case PlanActMode.PAM_ASK:
				mode = "ask"
				break
			case PlanActMode.DEBUG:
				mode = "debug"
				break
			case PlanActMode.CHAT:
				mode = "chat"
				break
			default:
				throw new Error(`Invalid mode value: ${request.mode}`)
		}
		const chatContent = request.chatContent

		// Call the existing controller implementation
		const sentMessage = await controller.togglePlanActMode(mode, chatContent)

		return Boolean.create({
			value: sentMessage,
		})
	} catch (error) {
		Logger.error("Failed to toggle Plan/Act mode:", error)
		throw error
	}
}
