import type { ToolUse } from "@core/assistant-message"
import { ShuncodeDefaultTool } from "@/shared/tools"
import { FastContextAgent } from "@/core/fast-context"
import { DEFAULT_FAST_CONTEXT_CONFIG, type FastContextConfig } from "@/shared/FastContextTypes"
import * as vscode from "vscode"
import * as fs from "node:fs"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

/**
 * Tool handler for the Fast Context agentic code search sub-agent.
 * Uses an LLM sub-agent with parallel grep/read/find_files to search the codebase.
 */
export class FastContextToolHandler implements IFullyManagedTool {
	readonly name = ShuncodeDefaultTool.FAST_CONTEXT

	getDescription(block: ToolUse): string {
		const query = block.params.query || "(empty query)"
		return `[fast context search for '${query}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const query = block.params.query

		// If query is missing and block is still streaming, show a neutral loading state.
		// If block is finalized without query, don't display an error in the UI —
		// the execute() method will return the error to the LLM internally.
		if (!query) {
			if (block.partial) {
				// Still streaming — show a neutral "preparing" message, not an error
				const preparingProps = {
					tool: "fastContext",
					content: "Preparing search...",
				}
				await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await uiHelpers.say("tool", JSON.stringify(preparingProps), undefined, undefined, true)
			} else {
				// Finalized without query — clean up any leftover partial message
				await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
			}
			return
		}

		const sharedMessageProps = {
			tool: "fastContext",
			content: `Searching for: ${uiHelpers.removeClosingTag(block, "query", query)}`,
		}

		await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await uiHelpers.say("tool", JSON.stringify(sharedMessageProps), undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const query: string | undefined = block.params.query

		if (!query) {
			return "Error: Missing required parameter 'query'."
		}

		const fcConfig = this.getFastContextConfig()
		if (!fcConfig.enabled || !fcConfig.apiUrl || !fcConfig.modelId) {
			return "Error: Fast Context is not configured. Please enable it in Settings > Fast Context and provide API URL, API Key, and Model ID."
		}

		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (!workspaceRoot) {
			return "Error: No workspace folder open."
		}

		// Accumulated turns for the UI (Windsurf-style: grouped by turn with reasoning)
		const turns: Array<{
			turnNumber: number
			reasoning?: string
			operations: Array<{ type: "grep" | "read_file" | "find_files"; args: string; status: "running" | "done"; duration?: number }>
		}> = []

		// Extract optional scope parameter (the main agent can hint where to search)
		const scope: string | undefined = (block.params as Record<string, string | undefined>).scope

		// Build lightweight directory hints (top-level dirs only, ~500 chars)
		const directoryHints = this.getDirectoryHints(workspaceRoot)

		try {
			const agent = new FastContextAgent(workspaceRoot, fcConfig)
			const result = await agent.search(query, (progress) => {
				const turnIdx = (progress.currentTurn || 1) - 1

				// Ensure turn entry exists
				if (!turns[turnIdx]) {
					turns[turnIdx] = { turnNumber: progress.currentTurn || 1, operations: [] }
				}

				// Update reasoning for this turn
				if (progress.reasoning) {
					turns[turnIdx].reasoning = progress.reasoning
				}

				// Update operations for this turn
				if (progress.operations) {
					for (const op of progress.operations) {
						const existing = turns[turnIdx].operations.find(
							(o) => o.type === op.type && o.args === op.args && o.status === "running",
						)
						if (existing && op.status === "done") {
							existing.status = "done"
							existing.duration = op.duration
						} else if (!existing) {
							turns[turnIdx].operations.push({ ...op })
						}
					}
				}

				const msg = JSON.stringify({
					tool: "fastContext",
					query,
					status: progress.status,
					currentTurn: progress.currentTurn,
					maxTurns: progress.maxTurns,
					turns,  // Windsurf-style: send grouped turns
					content: progress.message || `Turn ${progress.currentTurn}/${progress.maxTurns}`,
				})
				config.callbacks.say("tool", msg, undefined, undefined, true)
			}, { scope, directoryHints })

			if (!result.success) {
				const errorMsg = JSON.stringify({
					tool: "fastContext",
					query,
					status: "error",
					content: `Error: ${result.error}`,
					turns,
				})
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", errorMsg, undefined, undefined, false)
				return `Error during Fast Context search: ${result.error}`
			}

			if (result.contexts.length === 0) {
				const emptyMsg = JSON.stringify({
					tool: "fastContext",
					query,
					status: "complete",
					content: "No relevant code found.",
					turns,
					resultCount: 0,
					durationMs: result.totalDurationMs,
				})
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", emptyMsg, undefined, undefined, false)
				return "No relevant code found for this query."
			}

			// Format results for LLM context
			const formatted = result.contexts.map((ctx) => {
				const header = ctx.relevance
					? `// ${ctx.filePath}:${ctx.startLine}-${ctx.endLine} — ${ctx.relevance}`
					: `// ${ctx.filePath}:${ctx.startLine}-${ctx.endLine}`
				return `${header}\n${ctx.content}`
			}).join("\n\n---\n\n")

			// Build found files list for UI (Windsurf-style display)
			const foundFiles = result.contexts.map((ctx) => ({
				filePath: ctx.filePath,
				startLine: ctx.startLine,
				endLine: ctx.endLine,
				relevance: ctx.relevance || "",
			}))

			// Show completion in UI with found files (Windsurf-style)
			const completeMessage = JSON.stringify({
				tool: "fastContext",
				query,
				status: "complete",
				content: `Found ${result.contexts.length} relevant sections`,
				turns,  // Windsurf-style: grouped by turn
				foundFiles,
				resultCount: result.contexts.length,
				durationMs: result.totalDurationMs,
				currentTurn: result.turns.length,
				maxTurns: fcConfig.maxTurns,
			})
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)

			return formatted
		} catch (error: any) {
			const errorMsg = JSON.stringify({
				tool: "fastContext",
				query,
				status: "error",
				content: `Error: ${error.message}`,
				turns,
			})
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", errorMsg, undefined, undefined, false)
			return `Error during Fast Context search: ${error.message}`
		}
	}

	/**
	 * Get a 2-level deep directory tree as a hint for the sub-agent.
	 * Provides enough structure for the sub-agent to know where to search
	 * without flooding the context. Max ~80 lines.
	 */
	private getDirectoryHints(workspaceRoot: string): string {
		const IGNORE = new Set([
			"node_modules", ".git", "dist", "build", "out", ".next",
			"__pycache__", ".venv", ".cache", "tmp", "temp", "coverage",
			".turbo", ".parcel-cache", ".svelte-kit",
		])
		const MAX_LINES = 80
		const lines: string[] = []

		try {
			const topEntries = fs.readdirSync(workspaceRoot, { withFileTypes: true })
			for (const entry of topEntries) {
				if (lines.length >= MAX_LINES) break
				if (IGNORE.has(entry.name)) continue
				if (entry.name.startsWith(".") && entry.name !== ".github") continue

				if (entry.isDirectory()) {
					lines.push(`${entry.name}/`)
					// Read second level for directories
					try {
						const subPath = `${workspaceRoot}/${entry.name}`
						const subEntries = fs.readdirSync(subPath, { withFileTypes: true })
						let subCount = 0
						for (const sub of subEntries) {
							if (subCount >= 8 || lines.length >= MAX_LINES) break
							if (IGNORE.has(sub.name)) continue
							if (sub.name.startsWith(".")) continue
							if (sub.isDirectory()) {
								lines.push(`  ${sub.name}/`)
								subCount++
							}
						}
					} catch { /* can't read subdirectory */ }
				}
			}
			return lines.join("\n")
		} catch {
			return ""
		}
	}

	/**
	 * Read Fast Context config from VS Code settings
	 */
	private getFastContextConfig(): FastContextConfig {
		const cfg = vscode.workspace.getConfiguration("shuncode.fastContext")
		return {
			enabled: cfg.get("enabled", DEFAULT_FAST_CONTEXT_CONFIG.enabled),
			apiUrl: cfg.get("apiUrl", DEFAULT_FAST_CONTEXT_CONFIG.apiUrl),
			apiKey: cfg.get("apiKey", DEFAULT_FAST_CONTEXT_CONFIG.apiKey),
			modelId: cfg.get("modelId", DEFAULT_FAST_CONTEXT_CONFIG.modelId),
			maxTurns: cfg.get("maxTurns", DEFAULT_FAST_CONTEXT_CONFIG.maxTurns),
			maxParallelCalls: cfg.get("maxParallelCalls", DEFAULT_FAST_CONTEXT_CONFIG.maxParallelCalls),
			timeoutSeconds: cfg.get("timeoutSeconds", DEFAULT_FAST_CONTEXT_CONFIG.timeoutSeconds),
			systemPrompt: cfg.get("systemPrompt", DEFAULT_FAST_CONTEXT_CONFIG.systemPrompt) || undefined,
			excludePatterns: cfg.get("excludePatterns", DEFAULT_FAST_CONTEXT_CONFIG.excludePatterns),
			maxReadFileSize: cfg.get("maxReadFileSize", DEFAULT_FAST_CONTEXT_CONFIG.maxReadFileSize),
			showProgress: cfg.get("showProgress", DEFAULT_FAST_CONTEXT_CONFIG.showProgress),
		}
	}
}
