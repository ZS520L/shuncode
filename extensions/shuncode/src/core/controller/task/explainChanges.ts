// [SHUNCODE] TEMPORARILY DISABLED — legacy Cline shadow-git checkpoint system.
// explainChanges relied on shadow-git CheckpointTracker for diffs. Now no-ops.
// Will be re-implemented using DiffSystem V2 when needed.

import { Empty } from "@shared/proto/shuncode/common"
import { ExplainChangesRequest } from "@shared/proto/shuncode/task"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."
import { sendRelinquishControlEvent } from "../ui/subscribeToRelinquishControl"

/**
 * Explains the changes made by the AI and adds inline comments explaining them.
 * TEMPORARILY DISABLED — legacy Cline shadow-git checkpoint system.
 */
export async function explainChanges(_controller: Controller, _request: ExplainChangesRequest): Promise<Empty> {
	Logger.log("[explainChanges] Legacy Cline checkpoint explain changes is temporarily disabled.")
	sendRelinquishControlEvent()
	return Empty.create({})
}
