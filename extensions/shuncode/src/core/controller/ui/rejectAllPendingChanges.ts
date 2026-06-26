import type { Controller } from "@core/controller"
import { getDiffSystem } from "@core/diff-v2/DiffSystem"
import { Empty, EmptyRequest } from "@shared/proto/shuncode/common"

/**
 * Reject all pending changes in the diff system.
 * Delegates to DiffSystem.rejectAll() which groups hunks by file
 * and processes them bottom-to-top — safe for multi-hunk files.
 */
export async function rejectAllPendingChanges(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	console.log("[rejectAllPendingChanges] Called")
	const diffSystem = getDiffSystem()

	const count = diffSystem.getPendingCount()
	console.log("[rejectAllPendingChanges] Pending hunks:", count)

	if (count === 0) {
		return Empty.create({})
	}

	await diffSystem.rejectAll()

	await controller.postStateToWebview()

	return Empty.create({})
}
