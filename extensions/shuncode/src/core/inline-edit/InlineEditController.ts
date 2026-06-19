import * as vscode from "vscode"
import { buildApiHandler } from "@core/api"
import { StateManager } from "@/core/storage/StateManager"
import { getDiffSystem } from "@/core/diff-v2/DiffSystem"
import { t } from "@/i18n/backend-i18n"
import { Logger } from "@/shared/services/Logger"

/**
 * Inline Edit Controller (IMPL-09)
 *
 * Allows editing selected code directly in the editor via Ctrl+Shift+K.
 * Uses a compact prompt, streams LLM response, and shows inline diff
 * through the existing DiffSystem (Accept/Reject).
 */

const SYSTEM_PROMPT = `You are a precise code editor. You receive a code selection with surrounding context and an editing instruction. Return ONLY the replacement code for the selected section.

Rules:
- Return ONLY the edited code that replaces the selection
- Do NOT include the surrounding context (before/after)
- Do NOT wrap in markdown code fences
- Do NOT add any explanation or commentary
- Preserve the exact indentation style of the original code
- If the instruction is unclear, make a reasonable assumption
- If no changes are needed, return the original selection unchanged`

function buildUserPrompt(
	instruction: string,
	selectedCode: string,
	filePath: string,
	language: string,
	beforeContext: string,
	afterContext: string,
): string {
	return `File: ${filePath}
Language: ${language}

Context before selection:
\`\`\`${language}
${beforeContext}
\`\`\`

Selected code (EDIT THIS):
\`\`\`${language}
${selectedCode}
\`\`\`

Context after selection:
\`\`\`${language}
${afterContext}
\`\`\`

Instruction: ${instruction}`
}

let activeAbortController: AbortController | undefined

export async function executeInlineEdit(stateManager: StateManager): Promise<void> {
	const editor = vscode.window.activeTextEditor
	if (!editor) {
		return
	}

	const selection = editor.selection
	if (selection.isEmpty) {
		vscode.window.showInformationMessage(t("inlineEdit.selectCode"))
		return
	}

	// Get instruction from user
	const instruction = await vscode.window.showInputBox({
		prompt: t("inlineEdit.inputPrompt"),
		placeHolder: t("inlineEdit.inputPlaceholder"),
		ignoreFocusOut: true,
	})

	if (!instruction) {
		return
	}

	const document = editor.document
	const selectedCode = document.getText(selection)
	const filePath = vscode.workspace.asRelativePath(document.uri)
	const language = document.languageId

	// Gather surrounding context (up to 15 lines before/after)
	const contextLines = 15
	const startLine = Math.max(0, selection.start.line - contextLines)
	const endLine = Math.min(document.lineCount - 1, selection.end.line + contextLines)

	const beforeRange = new vscode.Range(startLine, 0, selection.start.line, 0)
	const afterRange = new vscode.Range(
		selection.end.line + 1,
		0,
		Math.min(endLine + 1, document.lineCount),
		0,
	)

	const beforeContext = document.getText(beforeRange)
	const afterContext = document.getText(afterRange)

	const userPrompt = buildUserPrompt(
		instruction,
		selectedCode,
		filePath,
		language,
		beforeContext,
		afterContext,
	)

	// Execute with progress
	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: t("inlineEdit.progress"),
			cancellable: true,
		},
		async (_progress, token) => {
			try {
				activeAbortController = new AbortController()

				token.onCancellationRequested(() => {
					activeAbortController?.abort()
				})

				// Build API handler from current settings
				const apiConfiguration = stateManager.getApiConfiguration()
				const apiHandler = buildApiHandler(apiConfiguration, "act")

				// Stream LLM response
				const messages = [{ role: "user" as const, content: userPrompt }]
				const stream = apiHandler.createMessage(SYSTEM_PROMPT, messages)

				let newCode = ""
				for await (const chunk of stream) {
					activeAbortController.signal.throwIfAborted()
					if (chunk.type === "text") {
						newCode += chunk.text
					}
				}

				if (!newCode.trim()) {
					vscode.window.showWarningMessage(t("inlineEdit.emptyResponse"))
					return
				}

				// Clean up — remove markdown fences if model wrapped them anyway
				newCode = stripCodeFences(newCode)

				// If the result is identical to the original, nothing to do
				if (newCode.trim() === selectedCode.trim()) {
					vscode.window.showInformationMessage(t("inlineEdit.noChanges"))
					return
				}

				// Show diff via DiffSystem (Accept/Reject)
				const originalLines = selectedCode.split("\n")
				const newLines = newCode.split("\n")

				try {
					const diffSystem = getDiffSystem()
					await diffSystem.replaceLines(
						document.uri.fsPath,
						selection.start.line,
						originalLines,
						newLines,
					)
					Logger.log(`[InlineEdit] Diff shown for ${filePath}:${selection.start.line}-${selection.end.line}`)
				} catch {
					// DiffSystem not available — fallback to direct replacement
					Logger.log("[InlineEdit] DiffSystem unavailable, applying directly")
					await editor.edit((editBuilder) => {
						editBuilder.replace(selection, newCode)
					})
				}
			} catch (error: unknown) {
				if (error instanceof Error && error.name === "AbortError") {
					return // User cancelled
				}
				const msg = error instanceof Error ? error.message : String(error)
				vscode.window.showErrorMessage(t("inlineEdit.error", { error: msg }))
				Logger.error("[InlineEdit] Error:", error)
			} finally {
				activeAbortController = undefined
			}
		},
	)
}

/**
 * Strip markdown code fences if the model wrapped the response.
 */
function stripCodeFences(text: string): string {
	let result = text.trim()
	// Remove opening fence: ```lang\n or ```\n
	if (/^```[^\n]*\n/.test(result)) {
		result = result.replace(/^```[^\n]*\n/, "")
	}
	// Remove closing fence: \n```
	if (/\n```\s*$/.test(result)) {
		result = result.replace(/\n```\s*$/, "")
	}
	return result
}
