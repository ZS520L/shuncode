// [SHUNCODE] TEMPORARILY DISABLED — legacy Cline shadow-git checkpoint system.
// checkpointDiff relied on shadow-git CheckpointTracker. Now no-ops.

import { Empty, Int64Request } from "@shared/proto/shuncode/common"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

export async function checkpointDiff(_controller: Controller, _request: Int64Request): Promise<Empty> {
	Logger.log("[checkpointDiff] Legacy Cline checkpoint diff is temporarily disabled.")
	return Empty.create()
}
