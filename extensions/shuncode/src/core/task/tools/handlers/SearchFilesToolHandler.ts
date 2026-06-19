import type { ToolUse } from "@core/assistant-message"
import { regexSearchFiles } from "@services/ripgrep"
import { arePathsEqual, getReadablePath, isLocatedInWorkspace } from "@utils/path"
import * as path from "path"
import { formatResponse } from "@/core/prompts/responses"
import { parseWorkspaceInlinePath } from "@/core/workspace/utils/parseWorkspaceInlinePath"
import { WorkspacePathAdapter } from "@/core/workspace/WorkspacePathAdapter"
import { resolveWorkspacePath } from "@/core/workspace/WorkspaceResolver"
import { telemetryService } from "@/services/telemetry"
import { ShuncodeSayTool } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class SearchFilesToolHandler implements IFullyManagedTool {
	readonly name = ShuncodeDefaultTool.SEARCH
	private static readonly SAFE_FILE_PATTERN = "*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,cs,rb,php,vue,svelte,c,cpp,h,hpp}"
	private static readonly INDEX_SHORTLIST_LIMIT = 8

	constructor(private validator: ToolValidator) { }

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.regex}'${block.params.file_pattern ? ` in '${block.params.file_pattern}'` : ""
			}]`
	}

	/**
	 * Determines which paths to search based on workspace configuration and hints
	 */
	private determineSearchPaths(
		config: TaskConfig,
		parsedPath: string,
		workspaceHint: string | undefined,
		originalPath: string,
	): Array<{ absolutePath: string; workspaceName?: string; workspaceRoot?: string }> {
		if (config.isMultiRootEnabled && config.workspaceManager) {
			const adapter = new WorkspacePathAdapter({
				cwd: config.cwd,
				isMultiRootEnabled: true,
				workspaceManager: config.workspaceManager,
			})

			if (workspaceHint) {
				// Search only in the specified workspace
				const absolutePath = adapter.resolvePath(parsedPath, workspaceHint)
				const workspaceRoots = adapter.getWorkspaceRoots()
				const root = workspaceRoots.find((r) => r.name === workspaceHint)
				return [{ absolutePath, workspaceName: workspaceHint, workspaceRoot: root?.path }]
			} else {
				// As a fallback, perform the search across all available workspaces.
				// Typically, models should provide explicit hints to target specific workspaces for searching.
				const allPaths = adapter.getAllPossiblePaths(parsedPath)
				const workspaceRoots = adapter.getWorkspaceRoots()
				return allPaths.map((absPath, index) => ({
					absolutePath: absPath,
					workspaceName: workspaceRoots[index]?.name || path.basename(workspaceRoots[index]?.path || absPath),
					workspaceRoot: workspaceRoots[index]?.path,
				}))
			}
		} else {
			// Single-workspace mode (backward compatible)
			const pathResult = resolveWorkspacePath(config, originalPath, "SearchFilesTool.execute")
			const absolutePath = typeof pathResult === "string" ? pathResult : pathResult.absolutePath
			return [{ absolutePath, workspaceRoot: config.cwd }]
		}
	}

	/**
	 * Executes a single search operation in a workspace
	 */
	private async executeSearch(
		config: TaskConfig,
		absolutePath: string,
		workspaceName: string | undefined,
		workspaceRoot: string | undefined,
		regex: string,
		filePattern: string | undefined,
	) {
		try {
			// Use workspace root for relative path calculation, fallback to cwd
			const basePathForRelative = workspaceRoot || config.cwd

			const workspaceResults = await regexSearchFiles(
				basePathForRelative,
				absolutePath,
				regex,
				filePattern,
				config.services.shuncodeIgnoreController,
			)

			// Parse the result count from the first line
			const firstLine = workspaceResults.split("\n")[0]
			const resultMatch = firstLine.match(/Found (\d+) result/)
			const resultCount = resultMatch ? parseInt(resultMatch[1], 10) : 0

			return {
				workspaceName,
				workspaceResults,
				resultCount,
				success: true,
				errorType: undefined as "timeout" | "error" | undefined,
			}
		} catch (error) {
			// If search fails in one workspace, return error info
			Logger.error(`Search failed in ${absolutePath}:`, error)
			const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
			return {
				workspaceName,
				workspaceResults: "",
				resultCount: 0,
				success: false,
				errorType: message.includes("timed out") ? ("timeout" as const) : ("error" as const),
			}
		}
	}

	/**
	 * Formats search results based on workspace configuration
	 */
	private formatSearchResults(
		config: TaskConfig,
		searchResults: Array<{
			workspaceName?: string
			workspaceResults: string
			resultCount: number
			success: boolean
		}>,
		searchPaths: Array<{ absolutePath: string; workspaceName?: string }>,
	): string {
		const allResults: string[] = []
		let totalResultCount = 0

		for (const { workspaceName, workspaceResults, resultCount, success } of searchResults) {
			if (!success || !workspaceResults) {
				continue
			}

			totalResultCount += resultCount

			// If multi-workspace and we have results, annotate with workspace name
			if (config.isMultiRootEnabled && searchPaths.length > 1 && workspaceName) {
				// Check if this workspace has results (resultCount > 0)
				if (resultCount > 0) {
					// Skip the "Found X results" line and add workspace annotation
					const lines = workspaceResults.split("\n")
					// Skip first two lines (count and empty line) if they exist
					const resultsWithoutHeader = lines.length > 2 ? lines.slice(2).join("\n") : workspaceResults

					if (resultsWithoutHeader.trim()) {
						allResults.push(`## Workspace: ${workspaceName}\n${resultsWithoutHeader}`)
					}
				}
				// Don't add anything for workspaces with 0 results in multi-workspace mode
			} else if (!config.isMultiRootEnabled || searchPaths.length === 1) {
				// Single workspace mode or single workspace search
				allResults.push(workspaceResults)
			}
		}

		// Combine results
		if (config.isMultiRootEnabled && searchPaths.length > 1) {
			// Multi-workspace search result
			if (totalResultCount === 0) {
				return "Found 0 results."
			} else {
				return `Found ${totalResultCount === 1 ? "1 result" : `${totalResultCount.toLocaleString()} results`} across ${searchPaths.length} workspace${searchPaths.length > 1 ? "s" : ""}.\n\n${allResults.join("\n\n")}`
			}
		} else {
			// Single workspace result
			return allResults[0] || "Found 0 results."
		}
	}

	private pathScope(
		config: TaskConfig,
		searchPaths: Array<{ absolutePath: string; workspaceRoot?: string }>,
	): "workspace_root" | "subdir" | "multi_root" {
		if (config.isMultiRootEnabled && searchPaths.length > 1) {
			return "multi_root"
		}
		const rootPath = searchPaths[0]?.workspaceRoot || config.cwd
		return searchPaths.some(({ absolutePath }) => arePathsEqual(absolutePath, rootPath)) ? "workspace_root" : "subdir"
	}

	private async buildIndexShortlistPaths(
		config: TaskConfig,
		searchPaths: Array<{ absolutePath: string; workspaceName?: string; workspaceRoot?: string }>,
		query: string,
	): Promise<Array<{ absolutePath: string; workspaceName?: string; workspaceRoot?: string }>> {
		// Index-based search removed - Fast Context now handles semantic search
		return []
	}

	private isBroadRegex(regex: string): boolean {
		const trimmed = regex.trim()
		if (!trimmed) return true
		if (trimmed.length < 3) return true
		// Simple literals without anchors/context are usually too broad on workspace root.
		const hasRegexMetachar = /[\\^$.|?*+()[\]{}]/.test(trimmed)
		return !hasRegexMetachar && trimmed.length < 6
	}

	private isWeakModel(config: TaskConfig): boolean {
		const modelId = config.api.getModel().id.toLowerCase()
		return (
			modelId.includes("xs") ||
			modelId.includes("compact") ||
			modelId.includes("glm") ||
			modelId.includes("hermes") ||
			modelId.includes("qwen2") ||
			modelId.includes("phi-")
		)
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path
		const regex = block.params.regex

		const config = uiHelpers.getConfig()

		// Create and show partial UI message
		const filePattern = block.params.file_pattern

		const sharedMessageProps = {
			tool: "searchFiles",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath)),
			content: "",
			regex: uiHelpers.removeClosingTag(block, "regex", regex),
			filePattern: uiHelpers.removeClosingTag(block, "file_pattern", filePattern),
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		} satisfies ShuncodeSayTool

		const partialMessage = JSON.stringify(sharedMessageProps)

		// [SHUNCODE-SHUNCODE] Cursor-style: always auto-execute, show as info (no ask)
		await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const relDirPath: string | undefined = block.params.path
		const regex: string | undefined = block.params.regex
		const filePattern: string | undefined = block.params.file_pattern

		// Extract provider information for telemetry
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		// Validate required parameters
		const pathValidation = this.validator.assertRequiredParams(block, "path")
		if (!pathValidation.ok) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "path")
		}

		if (!regex) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "regex")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Parse workspace hint from the path
		const { workspaceHint, relPath: parsedPath } = parseWorkspaceInlinePath(relDirPath!)

		// Determine which paths to search
		const searchPaths = this.determineSearchPaths(config, parsedPath, workspaceHint, relDirPath!)

		// Determine workspace context for telemetry
		const primaryWorkspaceRoot = searchPaths[0]?.workspaceRoot
		const resolvedToNonPrimary =
			searchPaths.length === 0
				? true
				: searchPaths.length > 1 || (primaryWorkspaceRoot ? !arePathsEqual(primaryWorkspaceRoot, config.cwd) : true)
		const workspaceContext = {
			isMultiRootEnabled: config.isMultiRootEnabled || false,
			usedWorkspaceHint: !!workspaceHint,
			resolvedToNonPrimary,
			resolutionMethod: (workspaceHint ? "hint" : searchPaths.length > 1 ? "path_detection" : "primary_fallback") as
				| "hint"
				| "primary_fallback"
				| "path_detection",
		}

		// Capture workspace path resolution telemetry
		if (config.isMultiRootEnabled && config.workspaceManager) {
			const resolutionType = workspaceHint
				? "hint_provided"
				: searchPaths.length > 1
					? "cross_workspace_search"
					: "fallback_to_primary"
			telemetryService.captureWorkspacePathResolved(
				config.ulid,
				"SearchFilesToolHandler",
				resolutionType,
				workspaceHint ? "workspace_name" : undefined,
				searchPaths.length > 0, // resolution success = found paths to search
				undefined, // TODO: could calculate primary workspace index
				true,
			)
		}

		let effectiveFilePattern = filePattern
		let guardrailPrefix = ""
		const missingPattern = !effectiveFilePattern || effectiveFilePattern.trim().length === 0
		const broadRegex = this.isBroadRegex(regex)
		const searchesWorkspaceRoot = searchPaths.some(({ absolutePath, workspaceRoot }) =>
			workspaceRoot ? arePathsEqual(absolutePath, workspaceRoot) : arePathsEqual(absolutePath, config.cwd),
		)
		const scope = this.pathScope(config, searchPaths)
		let effectiveSearchPaths = searchPaths
		let strategy: "index_first" | "regex_only" | "regex_first" = "regex_only"
		if (missingPattern && broadRegex && searchesWorkspaceRoot) {
			telemetryService.captureSearchGuardrailTriggered(
				config.ulid,
				"root_path_no_pattern_broad_regex",
				scope,
				true,
			)
			const shortlistPaths = await this.buildIndexShortlistPaths(config, searchPaths, regex)
			if (shortlistPaths.length > 0) {
				effectiveSearchPaths = shortlistPaths
				strategy = "index_first"
				guardrailPrefix =
					`[Guardrail] Wide search detected. Discover->inspect mode enabled with ${shortlistPaths.length} shortlist path(s).\n\n`
			}
			effectiveFilePattern = SearchFilesToolHandler.SAFE_FILE_PATTERN
			guardrailPrefix += `[Guardrail] Applied safe file pattern: ${effectiveFilePattern}\n\n`
			telemetryService.captureSearchFilesProfileApplied(
				config.ulid,
				"safe_code_files",
				effectiveFilePattern,
				"root_path_no_pattern_broad_regex",
			)
		}
		if (this.isWeakModel(config) && searchesWorkspaceRoot && missingPattern) {
			telemetryService.captureSearchGuardrailTriggered(config.ulid, "weak_model_root_path_missing_pattern_blocked", scope, false)
			telemetryService.captureSearchStrategyChosen(config.ulid, strategy, effectiveSearchPaths.length, !!workspaceHint)
			const blockedResults = `[Guardrail] Your search is too broad for the workspace root. Please:\n1. Use fast_context first to find relevant directories.\n2. Then call search_files with a specific path and file_pattern.\nExample: search_files with path="src/core" and file_pattern="*.ts"`
			const blockedMessage = JSON.stringify({
				tool: "searchFiles",
				path: getReadablePath(config.cwd, relDirPath!),
				content: blockedResults,
				regex: regex,
				filePattern: effectiveFilePattern,
				operationIsLocatedInWorkspace: await isLocatedInWorkspace(parsedPath),
			} satisfies ShuncodeSayTool)
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", blockedMessage, undefined, undefined, false)
			telemetryService.captureToolUsage(
				config.ulid,
				block.name,
				config.api.getModel().id,
				provider,
				true,
				true,
				workspaceContext,
				block.isNativeToolCall,
			)
			return blockedResults
		}
		telemetryService.captureSearchStrategyChosen(config.ulid, strategy, effectiveSearchPaths.length, !!workspaceHint)

		// Execute searches in all relevant workspaces in parallel
		const searchPromises = effectiveSearchPaths.map(({ absolutePath, workspaceName, workspaceRoot }) =>
			this.executeSearch(config, absolutePath, workspaceName, workspaceRoot, regex, effectiveFilePattern),
		)

		// Wait for all searches to complete
		const searchStartTime = performance.now()
		const searchResults = await Promise.all(searchPromises)
		const searchDurationMs = performance.now() - searchStartTime
		if (searchDurationMs > 5000) {
			Logger.warn(
				`[Search] Slow search_files: ${Math.round(searchDurationMs)}ms, regex="${regex}", path="${relDirPath}", pattern="${effectiveFilePattern || ""}"`,
			)
			telemetryService.captureSearchSlowQuery(config.ulid, searchDurationMs, scope, regex, effectiveFilePattern)
		}

		// Format and combine results
		const results = guardrailPrefix + this.formatSearchResults(config, searchResults, effectiveSearchPaths)
		if (searchResults.some((result) => result.errorType === "timeout")) {
			telemetryService.captureSearchFilesTimeout(config.ulid, searchDurationMs, scope)
		}

		// Capture workspace search pattern telemetry
		if (config.isMultiRootEnabled && config.workspaceManager) {
			const searchType = workspaceHint
				? "targeted"
				: effectiveSearchPaths.length > 1
					? "cross_workspace"
					: "primary_only"
			const resultsFound = searchResults.some((result) => result.resultCount > 0)

			telemetryService.captureWorkspaceSearchPattern(
				config.ulid,
				searchType,
				effectiveSearchPaths.length,
				!!workspaceHint,
				resultsFound,
				searchDurationMs,
			)
		}

		const sharedMessageProps = {
			tool: "searchFiles",
			path: getReadablePath(config.cwd, relDirPath!),
			content: results,
			regex: regex,
			filePattern: effectiveFilePattern,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(parsedPath),
		} satisfies ShuncodeSayTool

		const completeMessage = JSON.stringify(sharedMessageProps)

		// [SHUNCODE-SHUNCODE] Cursor-style: always auto-execute (no ask)
		await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await config.callbacks.say("tool", completeMessage, undefined, undefined, false)

		telemetryService.captureToolUsage(
			config.ulid,
			block.name,
			config.api.getModel().id,
			provider,
			true,
			true,
			workspaceContext,
			block.isNativeToolCall,
		)

		// Run PreToolUse hook after approval but before execution
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

		return results
	}
}
