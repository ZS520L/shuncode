import path from "node:path"
import * as vscode from "vscode"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { resolveWorkspacePath } from "@core/workspace"
import { ShuncodeSayTool } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

/** Represents a single cell in a Jupyter notebook (.ipynb) */
interface NotebookCell {
	cell_type: "code" | "markdown" | "raw"
	source: string[]
	metadata: Record<string, unknown>
	execution_count?: number | null
	outputs?: unknown[]
}

/** Represents a Jupyter notebook (.ipynb) structure */
interface NotebookJSON {
	nbformat: number
	nbformat_minor: number
	metadata: Record<string, unknown>
	cells: NotebookCell[]
}

/**
 * Maps cell_language param to notebook cell_type.
 * Everything except "markdown" and "raw" maps to "code".
 */
function languageToCellType(lang: string): "code" | "markdown" | "raw" {
	const lower = lang.toLowerCase().trim()
	if (lower === "markdown") return "markdown"
	if (lower === "raw") return "raw"
	return "code"
}

/**
 * Builds kernel display_name → language_info mapping based on cell language.
 * Used when creating a brand-new notebook.
 */
function buildKernelMetadata(lang: string): Record<string, unknown> {
	const lower = lang.toLowerCase().trim()
	if (lower === "markdown" || lower === "raw") return {}
	const langMap: Record<string, { name: string; display_name: string }> = {
		python: { name: "python", display_name: "Python 3" },
		javascript: { name: "javascript", display_name: "JavaScript" },
		typescript: { name: "typescript", display_name: "TypeScript" },
		r: { name: "ir", display_name: "R" },
		sql: { name: "sql", display_name: "SQL" },
		shell: { name: "bash", display_name: "Bash" },
	}
	const info = langMap[lower]
	if (info) {
		return {
			kernelspec: { display_name: info.display_name, language: info.name, name: info.name },
			language_info: { name: info.name },
		}
	}
	return {}
}

/**
 * EditNotebookToolHandler — Jupyter notebook cell editing.
 *
 * Supports:
 * - Creating new cells at a given index
 * - Editing existing cells via search & replace (old_string → new_string)
 * - Creating new notebooks from scratch
 *
 * Parameters:
 *   target_notebook (required) — path to .ipynb file
 *   cell_idx (required) — 0-based cell index
 *   is_new_cell (required) — "true" to insert, "false" to edit
 *   cell_language (required) — python, markdown, javascript, typescript, r, sql, shell, raw, other
 *   old_string (required for edit) — text to find in cell source
 *   new_string (required) — replacement text or new cell content
 */
export class EditNotebookToolHandler implements IFullyManagedTool {
	readonly name = ShuncodeDefaultTool.EDIT_NOTEBOOK

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		const notebook = block.params.target_notebook || "?"
		const cellIdx = block.params.cell_idx || "?"
		const isNew = block.params.is_new_cell === "true" ? "new" : "edit"
		return `[edit_notebook ${isNew} cell ${cellIdx} in '${notebook}']`
	}

	async handlePartialBlock(_block: ToolUse, _uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// No streaming preview for notebook edits
		return
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const rawPath = block.params.target_notebook
		const rawCellIdx = block.params.cell_idx
		const rawIsNewCell = block.params.is_new_cell
		const rawCellLanguage = block.params.cell_language
		const rawOldString = block.params.old_string
		const rawNewString = block.params.new_string

		// --- Validate required params ---
		if (!rawPath) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "target_notebook")
		}
		if (rawCellIdx === undefined || rawCellIdx === null || rawCellIdx === "") {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "cell_idx")
		}
		if (rawIsNewCell === undefined || rawIsNewCell === null || rawIsNewCell === "") {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "is_new_cell")
		}
		if (!rawCellLanguage) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "cell_language")
		}
		if (rawNewString === undefined || rawNewString === null) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "new_string")
		}

		const cellIdx = parseInt(rawCellIdx, 10)
		if (isNaN(cellIdx) || cellIdx < 0) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(
				`Invalid cell_idx: "${rawCellIdx}". Must be a non-negative integer (0-based).`,
			)
		}

		const isNewCell = rawIsNewCell.toLowerCase() === "true"

		// For editing existing cells, old_string is required
		if (!isNewCell && (rawOldString === undefined || rawOldString === null || rawOldString === "")) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(
				`Missing required parameter 'old_string' for editing an existing cell. ` +
					`When is_new_cell is false, you must provide old_string to identify the text to replace.`,
			)
		}

		// Check shuncodeignore
		const accessValidation = this.validator.checkShuncodeIgnorePath(rawPath)
		if (!accessValidation.ok) {
			await config.callbacks.say("shuncodeignore_error", rawPath)
			return formatResponse.toolError(formatResponse.shuncodeIgnoreError(rawPath))
		}

		config.taskState.consecutiveMistakeCount = 0

		// --- Resolve path ---
		const pathResult = resolveWorkspacePath(config, rawPath, "EditNotebookToolHandler.execute")
		const { absolutePath, resolvedPath } =
			typeof pathResult === "string"
				? { absolutePath: pathResult, resolvedPath: rawPath }
				: { absolutePath: pathResult.absolutePath, resolvedPath: pathResult.resolvedPath }

		try {
			const fileExists = await fileExistsAtPath(absolutePath)
			let notebook: NotebookJSON

			if (fileExists) {
				// Read existing notebook
				const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePath))
				const text = Buffer.from(raw).toString("utf-8")
				try {
					notebook = JSON.parse(text) as NotebookJSON
				} catch {
					return formatResponse.toolError(
						`Failed to parse notebook JSON at '${resolvedPath}'. The file may be corrupted or not a valid .ipynb file.`,
					)
				}

				if (!Array.isArray(notebook.cells)) {
					return formatResponse.toolError(
						`Invalid notebook structure at '${resolvedPath}': missing 'cells' array.`,
					)
				}
			} else {
				// Create new notebook
				notebook = {
					nbformat: 4,
					nbformat_minor: 5,
					metadata: buildKernelMetadata(rawCellLanguage),
					cells: [],
				}
				// Ensure directory exists
				const dir = path.dirname(absolutePath)
				await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir))
			}

			let changeDescription: string

			if (isNewCell) {
				// --- INSERT NEW CELL ---
				const insertIdx = Math.min(cellIdx, notebook.cells.length)
				const cellType = languageToCellType(rawCellLanguage)
				const newCell: NotebookCell = {
					cell_type: cellType,
					source: rawNewString.split("\n").map((line, i, arr) => (i < arr.length - 1 ? line + "\n" : line)),
					metadata: {},
				}
				if (cellType === "code") {
					newCell.execution_count = null
					newCell.outputs = []
				}

				notebook.cells.splice(insertIdx, 0, newCell)
				changeDescription = `Inserted new ${cellType} cell at index ${insertIdx}`
			} else {
				// --- EDIT EXISTING CELL ---
				if (cellIdx >= notebook.cells.length) {
					return formatResponse.toolError(
						`Cell index ${cellIdx} is out of range. The notebook has ${notebook.cells.length} cells (indices 0-${notebook.cells.length - 1}).`,
					)
				}

				const cell = notebook.cells[cellIdx]
				const cellSource = Array.isArray(cell.source) ? cell.source.join("") : String(cell.source)
				const oldStr = rawOldString || ""

				// Find old_string in cell source
				const matchIndex = cellSource.indexOf(oldStr)
				if (matchIndex === -1) {
					// Provide helpful error with cell content preview
					const preview = cellSource.length > 200 ? cellSource.substring(0, 200) + "..." : cellSource
					return formatResponse.toolError(
						`old_string not found in cell ${cellIdx}.\n\n` +
							`Searched for:\n"${oldStr.substring(0, 100)}${oldStr.length > 100 ? "..." : ""}"\n\n` +
							`Cell ${cellIdx} content:\n"${preview}"\n\n` +
							`Make sure old_string matches the cell content exactly, including whitespace and indentation.`,
					)
				}

				// Replace ONE occurrence
				const newSource = cellSource.substring(0, matchIndex) + rawNewString + cellSource.substring(matchIndex + oldStr.length)
				cell.source = newSource.split("\n").map((line, i, arr) => (i < arr.length - 1 ? line + "\n" : line))

				// Update cell_type if language changed
				const newCellType = languageToCellType(rawCellLanguage)
				if (cell.cell_type !== newCellType) {
					cell.cell_type = newCellType
					if (newCellType === "code" && !cell.outputs) {
						cell.outputs = []
						cell.execution_count = null
					}
				}

				const addedLines = rawNewString.split("\n").length
				const removedLines = oldStr.split("\n").length
				changeDescription = `Edited cell ${cellIdx}: replaced ${removedLines} line(s) with ${addedLines} line(s)`
			}

			// --- Approval check ---
			const readablePath = getReadablePath(config.cwd, resolvedPath)
			const isInWorkspace = await isLocatedInWorkspace(resolvedPath)

			// Extract provider for telemetry
			const apiConfig = config.services.stateManager.getApiConfiguration()
			const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
			const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

			// [SHUNCODE] Check editNotebooks auto-approval setting
			const autoApproveResult = config.autoApprover
				? config.autoApprover.shouldAutoApproveTool(ShuncodeDefaultTool.EDIT_NOTEBOOK)
				: false
			const didAutoApprove = autoApproveResult === true || (Array.isArray(autoApproveResult) && autoApproveResult[0])

			const toolMessage: ShuncodeSayTool = {
				tool: fileExists ? "editedExistingFile" : "newFileCreated",
				path: readablePath,
				content: changeDescription,
				operationIsLocatedInWorkspace: isInWorkspace,
			}
			const completeMessage = JSON.stringify(toolMessage)

			if (didAutoApprove) {
				// Auto-approved: show as info (no ask)
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			} else {
				// Manual approval: ask user
				showNotificationForApproval(
					`Shuncode wants to edit notebook: ${readablePath}`,
					config.autoApprovalSettings.enableNotifications,
				)
				await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")
				const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)
				if (!didApprove) {
					telemetryService.captureToolUsage(
						config.ulid,
						block.name,
						config.api.getModel().id,
						provider,
						false,
						false,
						undefined,
						block.isNativeToolCall,
					)
					return formatResponse.toolDenied()
				}
			}

			// --- Write notebook back ---
			const output = JSON.stringify(notebook, null, 1) + "\n"
			await vscode.workspace.fs.writeFile(vscode.Uri.file(absolutePath), Buffer.from(output))

			// --- Open notebook in editor ---
			try {
				const doc = await vscode.workspace.openNotebookDocument(vscode.Uri.file(absolutePath))
				await vscode.window.showNotebookDocument(doc)
			} catch {
				// Fallback: open as regular text if notebook viewer unavailable
				const doc = await vscode.workspace.openTextDocument(absolutePath)
				await vscode.window.showTextDocument(doc)
			}

			// Track telemetry
			telemetryService.captureToolUsage(
				config.ulid,
				block.name,
				config.api.getModel().id,
				provider,
				didAutoApprove,
				true,
				undefined,
				block.isNativeToolCall,
			)

			config.taskState.didEditFile = true
			config.services.fileContextTracker.markFileAsEditedByShuncode(resolvedPath)
			await config.services.fileContextTracker.trackFileContext(resolvedPath, "shuncode_edited")

			return `${changeDescription} in ${readablePath}`
		} catch (error) {
			if (error instanceof Error && error.message === "Shuncode instance aborted") {
				console.log("[EditNotebookToolHandler] Task aborted, ignoring error")
				return formatResponse.toolResult("Operation cancelled")
			}
			console.error("[EditNotebookToolHandler] Error:", error)
			return formatResponse.toolError(
				`Failed to edit notebook: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}
}
