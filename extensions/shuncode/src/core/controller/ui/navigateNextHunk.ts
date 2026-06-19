import * as vscode from "vscode"
import type { Controller } from "@core/controller"
import { Empty, EmptyRequest } from "@shared/proto/shuncode/common"

/**
 * Navigate to the next pending diff hunk in the active editor
 */
export async function navigateNextHunk(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	console.log("[navigateNextHunk] Called")
	await vscode.commands.executeCommand("shuncode.diff.nextHunk")
	return Empty.create({})
}
