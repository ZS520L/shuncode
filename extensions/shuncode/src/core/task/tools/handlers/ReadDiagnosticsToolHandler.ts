import * as path from "path"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { ShuncodeDefaultTool } from "@/shared/tools"
import { getDiagnostics } from "@/hosts/vscode/hostbridge/workspace/getDiagnostics"
import { diagnosticsToProblemsString } from "@/integrations/diagnostics"
import { DiagnosticSeverity, FileDiagnostics } from "@/shared/proto/index.shuncode"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

/**
 * ReadDiagnosticsToolHandler - reads linter/compiler errors from VS Code
 * 
 * This is a read-only tool that auto-approves (no user confirmation needed).
 * Similar to Cursor's ReadLints tool.
 * 
 * Parameters:
 * - paths (optional): Array of file/directory paths to filter diagnostics
 *                     If not provided, returns diagnostics for all files
 */
export class ReadDiagnosticsToolHandler implements IFullyManagedTool {
	readonly name = ShuncodeDefaultTool.READ_DIAGNOSTICS

	getDescription(block: ToolUse): string {
		const paths = block.params.paths
		if (paths) {
			return `[${block.name} for '${paths}']`
		}
		return `[${block.name} for all files]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const paths = block.params.paths || "all files"
		const partialMessage = JSON.stringify({
			tool: "readDiagnostics",
			paths,
			content: "",
		})
		
		// Auto-approve - just show as "say" (no ask)
		await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		config.taskState.consecutiveMistakeCount = 0

		// Get all diagnostics from VS Code
		const response = await getDiagnostics({})
		let fileDiagnostics = response.fileDiagnostics || []

		// Filter by paths if specified
		const pathsParam = block.params.paths
		if (pathsParam) {
			const pathsList = this.parsePathsParam(pathsParam)
			if (pathsList.length > 0) {
				fileDiagnostics = this.filterByPaths(fileDiagnostics, pathsList, config.cwd)
			}
		}

		// Filter only errors and warnings (skip hints and info)
		const severities = [DiagnosticSeverity.DIAGNOSTIC_ERROR, DiagnosticSeverity.DIAGNOSTIC_WARNING]
		
		// Convert to readable string
		const problemsString = await diagnosticsToProblemsString(fileDiagnostics, severities)

		// Build result
		let result: string
		if (!problemsString || problemsString.trim() === "") {
			result = "No errors or warnings found."
		} else {
			const errorCount = this.countBySeverity(fileDiagnostics, DiagnosticSeverity.DIAGNOSTIC_ERROR)
			const warningCount = this.countBySeverity(fileDiagnostics, DiagnosticSeverity.DIAGNOSTIC_WARNING)
			result = `Found ${errorCount} error(s) and ${warningCount} warning(s):\n\n${problemsString}`
		}

		// Show in UI (auto-approved, no ask needed)
		const completeMessage = JSON.stringify({
			tool: "readDiagnostics",
			paths: pathsParam || "all files",
			content: result,
		})
		
		await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await config.callbacks.say("tool", completeMessage, undefined, undefined, false)

		return result
	}

	/**
	 * Parse paths parameter - can be comma-separated or JSON array
	 */
	private parsePathsParam(pathsParam: string): string[] {
		// Try JSON array first
		try {
			const parsed = JSON.parse(pathsParam)
			if (Array.isArray(parsed)) {
				return parsed.map(p => String(p).trim()).filter(p => p.length > 0)
			}
		} catch {
			// Not JSON, try comma-separated
		}
		
		// Comma-separated
		return pathsParam.split(",").map(p => p.trim()).filter(p => p.length > 0)
	}

	/**
	 * Filter diagnostics by paths (file or directory)
	 */
	private filterByPaths(diagnostics: FileDiagnostics[], paths: string[], cwd: string): FileDiagnostics[] {
		return diagnostics.filter(fd => {
			const filePath = fd.filePath
			return paths.some(p => {
				// Resolve to absolute path
				const absPath = path.isAbsolute(p) ? p : path.resolve(cwd, p)
				// Check if file matches path or is inside directory
				const normalizedFilePath = path.normalize(filePath).toLowerCase()
				const normalizedAbsPath = path.normalize(absPath).toLowerCase()
				
				return normalizedFilePath === normalizedAbsPath || 
				       normalizedFilePath.startsWith(normalizedAbsPath + path.sep)
			})
		})
	}

	/**
	 * Count diagnostics by severity
	 */
	private countBySeverity(diagnostics: FileDiagnostics[], severity: DiagnosticSeverity): number {
		let count = 0
		for (const fd of diagnostics) {
			count += fd.diagnostics.filter(d => d.severity === severity).length
		}
		return count
	}
}
