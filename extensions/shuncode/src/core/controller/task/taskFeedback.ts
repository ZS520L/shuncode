import { Empty, StringRequest } from "@shared/proto/shuncode/common"
import { saveTaskEvaluation } from "@core/storage/disk"
import { telemetryService } from "@/services/telemetry"
import type { TaskEvaluationFeedback } from "@core/task/evaluation"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Handles task feedback submission (thumbs up/down)
 * @param controller The controller instance
 * @param request The StringRequest containing the feedback type ("thumbs_up" or "thumbs_down") in the value field
 * @returns Empty response
 */
export async function taskFeedback(controller: Controller, request: StringRequest): Promise<Empty> {
	if (!request.value) {
		Logger.warn("taskFeedback: Missing feedback type value")
		return Empty.create()
	}

	try {
		if (controller.task?.ulid) {
			const feedback = request.value as TaskEvaluationFeedback
			if (feedback !== "thumbs_up" && feedback !== "thumbs_down") {
				Logger.warn(`taskFeedback: Invalid feedback type '${request.value}'`)
				return Empty.create()
			}
			telemetryService.captureTaskFeedback(controller.task.ulid, feedback)
			controller.task.taskState.evaluationTracker.recordTaskFeedback(feedback)
			const evaluation = controller.task.taskState.evaluationTracker.finalize({
				taskId: controller.task.taskId,
				ulid: controller.task.ulid,
			})
			await saveTaskEvaluation(controller.task.taskId, evaluation)
			await controller.task.messageStateHandler.saveShuncodeMessagesAndUpdateHistory()
			await controller.postStateToWebview()
		} else {
			Logger.warn("taskFeedback: No active task to receive feedback")
		}
	} catch (error) {
		Logger.error("Error in taskFeedback handler:", error)
	}

	return Empty.create()
}
