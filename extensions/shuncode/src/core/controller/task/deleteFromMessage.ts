import { Empty } from "@shared/proto/shuncode/common"
import { Int64Request } from "@shared/proto/shuncode/common"
import { ShuncodeApiReqInfo } from "@shared/ExtensionMessage"
import { getApiMetrics } from "@shared/getApiMetrics"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import { Controller } from ".."

/**
 * Deletes a message and reverts all file changes from that message onwards.
 * Used for the "Delete" button on user messages in chat.
 *
 * Flow:
 * 1. Truncate shuncodeMessages and API history (persisted to disk)
 * 2. Preserve cost/token metrics from deleted messages as deleted_api_reqs
 * 3. cancelTask() — aborts the running task, re-inits from truncated history, shows resume UI
 */
export async function deleteFromMessage(controller: Controller, request: Int64Request): Promise<Empty> {
	const messageTs = Number(request.value)

	console.log(`[deleteFromMessage] ===== START ===== ts=${messageTs}`)

	// 1. Try to rollback file changes (non-blocking)
	try {
		const { getDiffSystem } = await import("@core/diff-v2")
		const diffSystem = getDiffSystem()
		const revertedCheckpoints = await diffSystem.rollbackFromMessage(messageTs)
		console.log(`[deleteFromMessage] Reverted ${revertedCheckpoints.length} checkpoints`)
	} catch (error) {
		console.error("[deleteFromMessage] DiffSystem rollback failed (continuing):", error)
	}

	// 2. Truncate shuncodeMessages and API history (persist to disk)
	if (controller.task) {
		const messageStateHandler = controller.task.messageStateHandler
		const shuncodeMessages = messageStateHandler.getShuncodeMessages()

		console.log(`[deleteFromMessage] Total shuncodeMessages: ${shuncodeMessages.length}`)

		const messageIndex = shuncodeMessages.findIndex((m) => m.ts === messageTs)
		console.log(`[deleteFromMessage] messageIndex: ${messageIndex}`)

		if (messageIndex !== -1) {
			// Aggregate cost/token metrics from messages being deleted
			// so the total cost display remains accurate (money already spent)
			const deletedMessages = shuncodeMessages.slice(messageIndex)
			const deletedApiReqsMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(deletedMessages)))

			// Keep messages before this one
			const messagesToKeep = shuncodeMessages.slice(0, messageIndex)

			// If deleted messages had any cost, preserve it as a deleted_api_reqs message
			if (
				deletedApiReqsMetrics.totalCost > 0 ||
				deletedApiReqsMetrics.totalTokensIn > 0 ||
				deletedApiReqsMetrics.totalTokensOut > 0
			) {
				messagesToKeep.push({
					ts: Date.now(),
					type: "say",
					say: "deleted_api_reqs",
					text: JSON.stringify({
						tokensIn: deletedApiReqsMetrics.totalTokensIn,
						tokensOut: deletedApiReqsMetrics.totalTokensOut,
						cacheWrites: deletedApiReqsMetrics.totalCacheWrites,
						cacheReads: deletedApiReqsMetrics.totalCacheReads,
						cost: deletedApiReqsMetrics.totalCost,
					} satisfies ShuncodeApiReqInfo),
				})
				console.log(
					`[deleteFromMessage] Preserved deleted metrics: cost=${deletedApiReqsMetrics.totalCost}, tokensIn=${deletedApiReqsMetrics.totalTokensIn}, tokensOut=${deletedApiReqsMetrics.totalTokensOut}`,
				)
			}

			await messageStateHandler.overwriteShuncodeMessages(messagesToKeep)
			console.log(`[deleteFromMessage] Truncated shuncodeMessages: ${shuncodeMessages.length} -> ${messagesToKeep.length}`)

			// Truncate API history
			const targetMessage = shuncodeMessages[messageIndex]
			const apiHistoryIndex = targetMessage.conversationHistoryIndex
			if (apiHistoryIndex !== undefined && apiHistoryIndex >= 0) {
				const apiHistory = messageStateHandler.getApiConversationHistory()
				const apiHistoryToKeep = apiHistory.slice(0, apiHistoryIndex)
				await messageStateHandler.overwriteApiConversationHistory(apiHistoryToKeep)
				console.log(`[deleteFromMessage] Truncated API history: ${apiHistory.length} -> ${apiHistoryToKeep.length}`)
			}
		} else {
			console.error(`[deleteFromMessage] Message ts=${messageTs} NOT FOUND`)
		}
	}

	// 3. Cancel the current task — aborts it, re-initializes from the truncated history on disk
	// This properly handles:
	// - Aborting any running AI processing
	// - Saving the truncated state
	// - Re-creating the task from the truncated history
	// - Showing the resume UI with the correct truncated messages
	console.log(`[deleteFromMessage] Calling cancelTask()...`)
	await controller.cancelTask()
	console.log(`[deleteFromMessage] cancelTask() done`)

	console.log(`[deleteFromMessage] ===== END =====`)
	return Empty.create({})
}
