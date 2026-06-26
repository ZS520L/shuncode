import { Int64Request } from "@shared/proto/shuncode/common"
import { RollbackPreview, RollbackPreviewFile } from "@shared/proto/shuncode/task"
import * as path from "path"
import { getCwd } from "@/utils/path"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Returns a read-only preview of the file changes that deleteFromMessage /
 * retryFromMessage would revert for the given message timestamp.
 *
 * Used by the webview to render a Devin-style "Confirm revert" dialog that
 * lists each affected file and its line delta (or "Deleted" for AI-created
 * files) before the user commits to the rollback. This handler does NOT
 * mutate any state.
 */
export async function getRollbackPreview(_controller: Controller, request: Int64Request): Promise<RollbackPreview> {
	const messageTs = Number(request.value)

	try {
		const { getDiffSystem } = await import("@core/diff-v2")
		const diffSystem = getDiffSystem()
		const preview = diffSystem.getRollbackPreview(messageTs)

		const cwd = await getCwd()
		const files: RollbackPreviewFile[] = preview.map((f) =>
			RollbackPreviewFile.create({
				fsPath: f.fsPath,
				displayPath: cwd ? path.relative(cwd, f.fsPath) : path.basename(f.fsPath),
				kind: f.kind,
				addedLines: f.addedLines,
				removedLines: f.removedLines,
			}),
		)

		return RollbackPreview.create({ files })
	} catch (error) {
		Logger.warn(`[getRollbackPreview] Failed to compute preview for ts=${messageTs}: ${error}`)
		return RollbackPreview.create({ files: [] })
	}
}

