import * as path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { resolveWorkspacePath } from "@core/workspace"
import { globby } from "globby"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

const MAX_RESULTS = 200
const GLOB_TIMEOUT_MS = 10_000

const DEFAULT_IGNORE = [
	"**/node_modules/**",
	"**/.git/**",
	"**/dist/**",
	"**/build/**",
	"**/.next/**",
	"**/coverage/**",
	"**/__pycache__/**",
	"**/.venv/**",
	"**/venv/**",
	"**/vendor/**",
	"**/target/**",
]

export class GlobToolHandler implements IFullyManagedTool {
	readonly name = ShuncodeDefaultTool.GLOB
	readonly isConcurrencySafe = true

	constructor(private validator: ToolValidator) { }

	getDescription(block: ToolUse): string {
		return `[glob for '${block.params.pattern}' in '${block.params.path || "."}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const config = uiHelpers.getConfig()
		const sharedMessageProps = {
			tool: "glob",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "pattern", block.params.pattern) || ""),
			content: "",
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(block.params.path || "."),
		}
		const partialMessage = JSON.stringify(sharedMessageProps)
		await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const pattern: string | undefined = block.params.pattern
		const relDirPath: string | undefined = block.params.path

		// Extract provider for telemetry
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		// Validate required parameters
		if (!pattern) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "pattern")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Resolve the base directory
		const baseDir = relDirPath
			? (() => {
				const pathResult = resolveWorkspacePath(config, relDirPath, "GlobToolHandler.execute")
				const { absolutePath } =
					typeof pathResult === "string" ? { absolutePath: pathResult } : pathResult
				return absolutePath
			})()
			: config.cwd

		// Check shuncodeignore access
		if (relDirPath) {
			const accessValidation = this.validator.checkShuncodeIgnorePath(relDirPath)
			if (!accessValidation.ok) {
				await config.callbacks.say("shuncodeignore_error", relDirPath)
				return formatResponse.toolError(formatResponse.shuncodeIgnoreError(relDirPath))
			}
		}

		try {
			// Run glob with timeout
			const files = await Promise.race([
				globby(pattern, {
					cwd: baseDir,
					dot: false,
					ignore: DEFAULT_IGNORE,
					onlyFiles: true,
					absolute: false,
					suppressErrors: true,
					gitignore: true,
				}),
				new Promise<string[]>((_, reject) =>
					setTimeout(() => reject(new Error("Glob search timed out")), GLOB_TIMEOUT_MS),
				),
			])

			// Sort by path (alphabetical for consistency)
			files.sort()

			const truncated = files.length > MAX_RESULTS
			const displayFiles = files.slice(0, MAX_RESULTS)

			let result: string
			if (files.length === 0) {
				result = `No files found matching pattern "${pattern}"${relDirPath ? ` in ${relDirPath}` : ""}`
			} else {
				const fileList = displayFiles
					.map((f) => (relDirPath ? path.join(relDirPath, f) : f))
					.join("\n")
				const header = `Found ${files.length} file(s) matching "${pattern}"${relDirPath ? ` in ${relDirPath}` : ""}:`
				const footer = truncated ? `\n... and ${files.length - MAX_RESULTS} more files (truncated)` : ""
				result = `${header}\n${fileList}${footer}`
			}

			// Show result in UI
			const sharedMessageProps = {
				tool: "glob",
				path: getReadablePath(config.cwd, pattern),
				content: result,
				operationIsLocatedInWorkspace: await isLocatedInWorkspace(relDirPath || "."),
			}
			const completeMessage = JSON.stringify(sharedMessageProps)
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)

			telemetryService.captureToolUsage(
				config.ulid,
				block.name,
				config.api.getModel().id,
				provider,
				true,
				true,
				{
					isMultiRootEnabled: config.isMultiRootEnabled || false,
					usedWorkspaceHint: false,
					resolvedToNonPrimary: false,
					resolutionMethod: "primary_fallback" as const,
				},
				block.isNativeToolCall,
			)

			// Run PreToolUse hook
			try {
				const { ToolHookUtils } = await import("../utils/ToolHookUtils")
				await ToolHookUtils.runPreToolUseIfEnabled(config, block)
			} catch (error) {
				const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
				if (error instanceof PreToolUseHookCancellationError) {
					return formatResponse.toolDenied()
				}
				throw error
			}

			return result
		} catch (error) {
			const errorMsg = `Error searching for files: ${error instanceof Error ? error.message : String(error)}`
			return formatResponse.toolError(errorMsg)
		}
	}
}
