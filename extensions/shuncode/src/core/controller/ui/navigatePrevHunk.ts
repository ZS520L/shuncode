import * as vscode from "vscode"
import type { Controller } from "@core/controller"
import { Empty, EmptyRequest } from "@shared/proto/shuncode/common"

/**
 * Navigate to the previous pending diff hunk in the active editor
 */
export async function navigatePrevHunk(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	console.log("[navigatePrevHunk] Called")
	await vscode.commands.executeCommand("shuncode.diff.prevHunk")
	return Empty.create({})
}
