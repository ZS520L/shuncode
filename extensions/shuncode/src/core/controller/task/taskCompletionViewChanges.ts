// [SHUNCODE] TEMPORARILY DISABLED — legacy Cline shadow-git checkpoint system.
// taskCompletionViewChanges relied on shadow-git presentMultifileDiff. Now no-ops.

import { Empty, Int64Request } from "@shared/proto/shuncode/common"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Shows task completion changes in a diff view
 * @param controller The controller instance
 * @param request The request containing the timestamp of the message
 * @returns Empty response
 */
export async function taskCompletionViewChanges(_controller: Controller, _request: Int64Request): Promise<Empty> {
	Logger.log("[taskCompletionViewChanges] Legacy Cline checkpoint view changes is temporarily disabled.")
	return Empty.create()
}
