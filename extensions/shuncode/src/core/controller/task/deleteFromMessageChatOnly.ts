import { Empty } from "@shared/proto/shuncode/common"
import { Int64Request } from "@shared/proto/shuncode/common"
import { ShuncodeApiReqInfo } from "@shared/ExtensionMessage"
import { getApiMetrics } from "@shared/getApiMetrics"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import { Controller } from ".."

/**
 * Deletes a message (chat only) WITHOUT reverting file changes.
 * Used when user wants to undo conversation but keep file modifications.
 *
 * Flow:
 * 1. Truncate shuncodeMessages and API history (persisted to disk)
 * 2. Preserve cost/token metrics from deleted messages as deleted_api_reqs
 * 3. cancelTask() — aborts the running task, re-inits from truncated history, shows resume UI
 *
 * Unlike deleteFromMessage, this does NOT call DiffSystem.rollbackFromMessage().
 */
export async function deleteFromMessageChatOnly(controller: Controller, request: Int64Request): Promise<Empty> {
	const messageTs = Number(request.value)

	console.log(`[deleteFromMessageChatOnly] ===== START ===== ts=${messageTs}`)

	// NOTE: No file rollback — user chose to keep file changes

	// Truncate shuncodeMessages and API history (persist to disk)
	if (controller.task) {
		const messageStateHandler = controller.task.messageStateHandler
		const shuncodeMessages = messageStateHandler.getShuncodeMessages()

		console.log(`[deleteFromMessageChatOnly] Total shuncodeMessages: ${shuncodeMessages.length}`)

		const messageIndex = shuncodeMessages.findIndex((m) => m.ts === messageTs)
		console.log(`[deleteFromMessageChatOnly] messageIndex: ${messageIndex}`)

		if (messageIndex !== -1) {
			// Aggregate cost/token metrics from messages being deleted
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
					`[deleteFromMessageChatOnly] Preserved deleted metrics: cost=${deletedApiReqsMetrics.totalCost}, tokensIn=${deletedApiReqsMetrics.totalTokensIn}, tokensOut=${deletedApiReqsMetrics.totalTokensOut}`,
				)
			}

			await messageStateHandler.overwriteShuncodeMessages(messagesToKeep)
			console.log(
				`[deleteFromMessageChatOnly] Truncated shuncodeMessages: ${shuncodeMessages.length} -> ${messagesToKeep.length}`,
			)

			// Truncate API history
			const targetMessage = shuncodeMessages[messageIndex]
			const apiHistoryIndex = targetMessage.conversationHistoryIndex
			if (apiHistoryIndex !== undefined && apiHistoryIndex >= 0) {
				const apiHistory = messageStateHandler.getApiConversationHistory()
				const apiHistoryToKeep = apiHistory.slice(0, apiHistoryIndex)
				await messageStateHandler.overwriteApiConversationHistory(apiHistoryToKeep)
				console.log(
					`[deleteFromMessageChatOnly] Truncated API history: ${apiHistory.length} -> ${apiHistoryToKeep.length}`,
				)
			}
		} else {
			console.error(`[deleteFromMessageChatOnly] Message ts=${messageTs} NOT FOUND`)
		}
	}

	// Cancel the current task — aborts it, re-initializes from the truncated history on disk
	console.log(`[deleteFromMessageChatOnly] Calling cancelTask()...`)
	await controller.cancelTask()
	console.log(`[deleteFromMessageChatOnly] cancelTask() done`)

	console.log(`[deleteFromMessageChatOnly] ===== END =====`)
	return Empty.create({})
}
