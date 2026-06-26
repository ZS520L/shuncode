import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { resolveWorkspacePath } from "@core/workspace"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { ShuncodeDefaultTool } from "@/shared/tools"
import { truncateToolOutput } from "../utils/ToolConstants"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

const MAX_FILES_PER_CALL = 10
const MAX_LINES_PER_FILE = 300

function addLineNumbers(text: string, startLine: number = 1): string {
	const lines = text.split("\n")
	const maxLineNum = startLine + lines.length - 1
	const padding = String(maxLineNum).length
	return lines.map((line, i) => `${String(startLine + i).padStart(padding)}│${line}`).join("\n")
}

export class ReadFilesToolHandler implements IFullyManagedTool {
	readonly name = ShuncodeDefaultTool.READ_FILES
	readonly isConcurrencySafe = true

	constructor(private validator: ToolValidator) { }

	getDescription(block: ToolUse): string {
		return `[${block.name} for multiple files]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// Try to parse paths to show first filename during streaming
		let displayPath = "files"
		try {
			const rawPaths = uiHelpers.removeClosingTag(block, "paths", block.params.paths)
			if (rawPaths) {
				const parsed = JSON.parse(rawPaths)
				if (Array.isArray(parsed) && parsed.length > 0) {
					displayPath = parsed[0]
				}
			}
		} catch { /* use default */ }

		const sharedMessageProps = {
			tool: "readFile",
			path: displayPath,
			content: "",
			operationIsLocatedInWorkspace: true,
		}
		const partialMessage = JSON.stringify(sharedMessageProps)
		await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const pathsRaw: string | undefined = block.params.paths

		// Extract provider for telemetry
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		if (!pathsRaw) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "paths")
		}

		// Parse paths JSON
		let paths: string[]
		try {
			paths = JSON.parse(pathsRaw)
			if (!Array.isArray(paths) || paths.length === 0) {
				throw new Error("paths must be a non-empty JSON array of strings")
			}
		} catch (parseError) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(
				`Invalid paths JSON: ${(parseError as Error).message}\n` +
				`Expected: ["src/file1.ts", "src/file2.ts"]`,
			)
		}

		if (paths.length > MAX_FILES_PER_CALL) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(
				`Too many files (${paths.length}). Maximum is ${MAX_FILES_PER_CALL} per call. Split into multiple read_files calls.`,
			)
		}

		config.taskState.consecutiveMistakeCount = 0

		const results: string[] = []
		let filesRead = 0

		for (const relPath of paths) {
			if (typeof relPath !== "string" || relPath.trim() === "") {
				results.push(`\n═══ ${relPath} ═══\n[Error: Invalid path]`)
				continue
			}

			try {
				const pathResult = resolveWorkspacePath(config, relPath, "ReadFilesToolHandler.execute")
				const { absolutePath } =
					typeof pathResult === "string" ? { absolutePath: pathResult } : pathResult

				// Try editor buffer first, then disk
				let text: string
				const openDoc = vscode.workspace.textDocuments.find(
					(d) => d.uri.fsPath.toLowerCase() === absolutePath.toLowerCase(),
				)
				if (openDoc) {
					text = openDoc.getText()
				} else {
					text = await fs.readFile(absolutePath, "utf8")
				}

				const totalLines = text.split("\n").length

				// Truncate large files
				let displayText: string
				if (totalLines > MAX_LINES_PER_FILE) {
					const lines = text.split("\n")
					const shown = lines.slice(0, MAX_LINES_PER_FILE).join("\n")
					displayText = addLineNumbers(shown) + `\n... (${totalLines - MAX_LINES_PER_FILE} more lines, use read_file with start_line/end_line for full content)`
				} else {
					displayText = addLineNumbers(text)
				}

				results.push(`\n═══ ${relPath} (${totalLines} lines) ═══\n${displayText}`)
				filesRead++

				// Track file context
				await config.services.fileContextTracker.trackFileContext(relPath, "read_tool")
			} catch (readError) {
				results.push(`\n═══ ${relPath} ═══\n[Error: ${(readError as Error).message}]`)
			}
		}

		// Send individual UI messages per file for frontend grouping
		await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")
		for (const relPath of paths) {
			if (typeof relPath !== "string" || relPath.trim() === "") continue
			const readablePath = relPath
			let absolutePath = ""
			try {
				const pathResult = resolveWorkspacePath(config, relPath, "ReadFilesToolHandler.ui")
				absolutePath = typeof pathResult === "string" ? pathResult : pathResult.absolutePath
			} catch { /* skip */ }
			const props = {
				tool: "readFile",
				path: readablePath,
				content: absolutePath,
				operationIsLocatedInWorkspace: true,
			}
			await config.callbacks.say("tool", JSON.stringify(props), undefined, undefined, false)
		}

		// Telemetry
		telemetryService.captureToolUsage(
			config.ulid,
			block.name,
			config.api.getModel().id,
			provider,
			true,
			true,
			undefined,
			block.isNativeToolCall,
		)

		return truncateToolOutput(results.join("\n"))
	}
}
