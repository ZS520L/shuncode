import { Empty } from "@shared/proto/shuncode/common"
import { AskResponseRequest } from "@shared/proto/shuncode/task"
import { Controller } from ".."

// Lock to prevent concurrent interruptAndSend calls
let interruptInProgress = false

/**
 * Atomic interrupt and send - stops AI stream and immediately processes user message.
 * Unlike cancelTask, this doesn't reinit the task - it interrupts the current stream
 * and injects the user message to be processed.
 *
 * @param controller The controller instance
 * @param request The message to send after interrupting
 * @returns Empty response
 */
export async function interruptAndSend(controller: Controller, request: AskResponseRequest): Promise<Empty> {
	// Free-trial gate: check message limit
	const allowed = await controller.checkFreeRequestGate()
	if (!allowed) {
		return Empty.create()
	}

	// Prevent concurrent calls - just update the pending message
	if (interruptInProgress) {
		// Update pending message with latest text (don't lose user input)
		if (controller.task?.taskState) {
			controller.task.taskState.pendingUserMessage = {
				text: request.text || "",
				images: request.images,
				files: request.files,
			}
		}
		return Empty.create()
	}

	if (!controller.task) {
		return Empty.create()
	}

	interruptInProgress = true

	try {
		const task = controller.task
		const taskState = task.taskState

		// Store the pending message
		taskState.pendingUserMessage = {
			text: request.text || "",
			images: request.images,
			files: request.files,
		}

		// If task is streaming, interrupt it
		if (taskState.isStreaming) {
			taskState.softInterrupt = true
			task.api?.abort?.()

			// Wait for streaming to stop (with timeout)
			const maxWait = 3000
			const pollInterval = 50
			let waited = 0

			while (taskState.isStreaming && waited < maxWait) {
				await new Promise((resolve) => setTimeout(resolve, pollInterval))
				waited += pollInterval
			}

			taskState.softInterrupt = false
		}
	} finally {
		interruptInProgress = false
	}

	return Empty.create()
}
