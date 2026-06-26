/**
 * FastContextAgent — the agentic search sub-agent.
 *
 * Architecture:
 * 1. Receives a natural-language search query
 * 2. Sends the query + tool definitions to a fast LLM (user-configured endpoint)
 * 3. LLM responds with parallel tool calls (grep, read_file, find_files)
 * 4. Executes tools in parallel, feeds results back to LLM
 * 5. Repeats for up to maxTurns
 * 6. LLM returns final answer with relevant file contexts
 *
 * The entire operation runs in an isolated context window — results are
 * returned to the main agent without polluting its context.
 */
import type {
	FastContextConfig,
	FastContextResult,
	FastContextFileContext,
	FastContextTurn,
	FastContextToolCall,
	FastContextProgress,
} from "@shared/FastContextTypes"
import { ToolExecutor, type ToolCallInput } from "./ToolExecutor"

/** Tool definitions sent to the LLM (OpenAI-compatible function calling format) */
const TOOL_DEFINITIONS = [
	{
		type: "function" as const,
		function: {
			name: "grep",
			description: "Search for a regex or fixed-string pattern across files in the codebase using ripgrep. Returns matching lines with file paths and line numbers.",
			parameters: {
				type: "object",
				properties: {
					pattern: {
						type: "string",
						description: "The search pattern (regex by default, or fixed string if fixed_string=true)",
					},
					path: {
						type: "string",
						description: "Relative path to search within (default: entire workspace)",
					},
					include: {
						type: "array",
						items: { type: "string" },
						description: "Glob patterns to include (e.g. ['*.ts', '*.tsx'])",
					},
					fixed_string: {
						type: "boolean",
						description: "Treat pattern as a literal string instead of regex",
					},
				},
				required: ["pattern"],
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: "read_file",
			description: "Read the contents of a file, optionally a specific line range. Returns numbered lines.",
			parameters: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: "Relative file path to read",
					},
					start_line: {
						type: "number",
						description: "Start line number (1-indexed, inclusive)",
					},
					end_line: {
						type: "number",
						description: "End line number (1-indexed, inclusive)",
					},
				},
				required: ["path"],
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: "find_files",
			description: "Find files matching a glob/regex pattern. Returns file paths.",
			parameters: {
				type: "object",
				properties: {
					pattern: {
						type: "string",
						description: "Pattern to search for in file names (glob or regex)",
					},
					path: {
						type: "string",
						description: "Relative directory to search within (default: entire workspace)",
					},
					type: {
						type: "string",
						enum: ["file", "directory"],
						description: "Filter by type (default: both)",
					},
				},
				required: ["pattern"],
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: "ls",
			description: "List the immediate (non-recursive) contents of a directory. Directories are suffixed with '/'. Use this to explore an unfamiliar directory before grepping or reading files.",
			parameters: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: "Relative directory path to list (default: workspace root)",
					},
				},
				required: [],
			},
		},
	},
]

const DEFAULT_SYSTEM_PROMPT = `You are a code search sub-agent. Your task is to find relevant code in the codebase based on the user's query.

STRATEGY:
- Start NARROW, not broad. Always use the \`path\` parameter in grep and find_files to restrict scope.
- If a search scope is provided, search within that directory first.
- Use the directory structure hints to identify the most likely subdirectory before searching.
- In monorepos, extensions/, packages/, or apps/ often contain the actual application code — check those first, not the top-level src/.
- Prefer specific identifiers (class names, function names, file names) over generic terms.
- One precise grep with a targeted path beats three broad ones across the whole project.
- You have a maximum of {maxTurns} turns — use them wisely. Aim to finish in 1-2 turns.
- When grep finds relevant files, read the specific sections instead of re-grepping.
- Stop as soon as you have enough context to answer. Do not exhaustively search.
- If a tool returns "(no matches)", try a different path or a broader/different pattern — do NOT repeat the same failing call.

SCOPE ESCAPE (CRITICAL):
- If your first turn within the provided scope produces NO strong matches or only tangentially related results, DO NOT keep searching the same scope with different patterns.
- Instead, on the NEXT turn, expand your search to the workspace root or other top-level directories from the directory hints.
- A "strong match" means the code directly implements or controls the behavior described in the query.
- Weak/tangential matches (e.g., finding a UI component when asked about platform behavior) are NOT strong — expand scope immediately.

FIRST TURN TIPS:
- If you don't know where code lives, use find_files with a distinctive filename pattern first.
- Combine find_files (to locate files) with grep (to search content) in parallel on your first turn.
- Use grep with fixed_string=true for exact identifiers (faster, no regex escaping needed).

PARALLELISM (CRITICAL):
- You MUST make at least 4-6 parallel tool calls EVERY turn. Never make just 1 or 2 calls when you could make more.
- On the first turn, fire off multiple grep/find_files calls simultaneously targeting different likely paths or patterns.
- Think: "What are 4-6 different angles I can search from at once?" — then do all of them in one turn.
- More parallel calls per turn = fewer turns needed = faster results.
- A single turn with 6 parallel calls is FAR better than 3 turns with 2 calls each.

RULES:
- Use the available tools (grep, read_file, find_files, ls) to locate relevant code
- Use ls to inspect the immediate contents of an unfamiliar directory when the directory hints are not detailed enough to decide where to grep next
- Make multiple parallel tool calls each turn to search efficiently — aim for 4-8 calls per turn
- ALWAYS use the \`path\` parameter to narrow scope when you can infer the likely location
- When you have found the relevant code, respond with your findings immediately
- If a tool returns an error message, adapt your strategy (try different tool or parameters)

OUTPUT FORMAT:
When you have found relevant code, respond with a JSON object (and ONLY this JSON, no extra text):
\`\`\`json
{
  "contexts": [
    {
      "filePath": "relative/path/to/file.ts",
      "startLine": 10,
      "endLine": 25,
      "content": "the actual code lines",
      "relevance": "Why this code is relevant"
    }
  ],
  "confidence": "high",
  "summary": "Brief summary of what was found"
}
\`\`\`

The "confidence" field is REQUIRED and must be one of:
- "high": Found code that directly implements/controls the behavior in the query.
- "medium": Found related code, but may not fully answer the query.
- "low": Could not find a strong match in the searched scope. Caller should retry with a wider scope.

If you cannot find relevant code after exhausting your turns, respond with:
\`\`\`json
{
  "contexts": [],
  "confidence": "low",
  "summary": "Explanation of what was tried and why nothing was found"
}
\`\`\``

export type ProgressCallback = (progress: FastContextProgress) => void

export class FastContextAgent {
	private readonly config: FastContextConfig
	private readonly toolExecutor: ToolExecutor
	private readonly workspaceRoot: string

	constructor(workspaceRoot: string, config: FastContextConfig) {
		this.workspaceRoot = workspaceRoot
		this.config = config
		this.toolExecutor = new ToolExecutor(workspaceRoot, config)
	}

	/**
	 * Execute a Fast Context search.
	 *
	 * @param query Natural language search query
	 * @param onProgress Optional callback for progress updates
	 * @param options Optional search options (scope, directory hints)
	 * @returns Search results with relevant file contexts
	 */
	async search(query: string, onProgress?: ProgressCallback, options?: { scope?: string; directoryHints?: string }): Promise<FastContextResult> {
		const startTime = Date.now()
		const turns: FastContextTurn[] = []

		const systemPrompt = (this.config.systemPrompt || DEFAULT_SYSTEM_PROMPT)
			.replace("{maxTurns}", String(this.config.maxTurns))

		// Build user message with scope and directory hints
		let userContent = `Search the codebase for: ${query}`
		if (options?.scope) {
			userContent += `\n\nSearch scope (start here): ${options.scope}`
		}
		if (options?.directoryHints) {
			userContent += `\n\nProject directory structure (use to guide your search):\n${options.directoryHints}`
		}

		// Build initial messages
		const messages: Array<{ role: string; content?: string; tool_calls?: any[]; tool_call_id?: string; name?: string }> = [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userContent },
		]

		try {
			for (let turn = 0; turn < this.config.maxTurns; turn++) {
				onProgress?.({
					status: "searching",
					currentTurn: turn + 1,
					maxTurns: this.config.maxTurns,
					toolCallsInProgress: 0,
					message: `Turn ${turn + 1}/${this.config.maxTurns} — calling LLM...`,
				})

				const turnStart = Date.now()

				// Fix 2: On the last allowed turn, hint the LLM to wrap up
				const isLastTurn = turn === this.config.maxTurns - 1
				if (isLastTurn && turn > 0) {
					messages.push({
						role: "user",
						content: "This is your LAST turn. If you have gathered enough information, provide your final JSON answer now instead of making more tool calls.",
					})
				}

				// Call LLM
				const response = await this.callLLM(messages)

				// Check if LLM wants to finish (no tool calls)
				if (!response.tool_calls || response.tool_calls.length === 0) {
					// Final answer
					turns.push({
						turnNumber: turn + 1,
						toolCalls: [],
						reasoning: response.content,
						durationMs: Date.now() - turnStart,
					})

					let contexts = this.parseContextsFromResponse(response.content || "")
					// Fix 5: If parsing returned nothing, try building from tool history
					if (contexts.length === 0) {
						contexts = this.buildContextsFromToolHistory(turns)
					}
					onProgress?.({
						status: "complete",
						currentTurn: turn + 1,
						maxTurns: this.config.maxTurns,
						toolCallsInProgress: 0,
						reasoning: response.content?.substring(0, 200),
					})

					return {
						success: true,
						query,
						contexts,
						turns,
						totalDurationMs: Date.now() - startTime,
						tokensUsed: response.usage?.total_tokens,
						confidence: this.parseConfidenceFromResponse(response.content || ""),
					}
				}

				// Parse tool calls (skip any with malformed JSON arguments)
				const toolCalls: FastContextToolCall[] = []
				const inputs: ToolCallInput[] = []
				const validToolCalls: any[] = [] // Original tool_call objects that parsed successfully
				for (const tc of response.tool_calls) {
					try {
						const args = typeof tc.function.arguments === "string"
							? JSON.parse(tc.function.arguments)
							: tc.function.arguments
						inputs.push({ tool: tc.function.name, args })
						validToolCalls.push(tc)
					} catch {
						// LLM produced malformed JSON for this tool call — skip it
					}
				}

				// If ALL tool calls had invalid JSON, treat as final answer
				if (inputs.length === 0) {
					turns.push({
						turnNumber: turn + 1,
						toolCalls: [],
						reasoning: response.content,
						durationMs: Date.now() - turnStart,
					})
					let contexts = this.parseContextsFromResponse(response.content || "")
					if (contexts.length === 0) {
						contexts = this.buildContextsFromToolHistory(turns)
					}
					return {
						success: true,
						query,
						contexts,
						turns,
						totalDurationMs: Date.now() - startTime,
						tokensUsed: response.usage?.total_tokens,
						confidence: this.parseConfidenceFromResponse(response.content || ""),
					}
				}

				// Build operation descriptions for UI
				const operations = inputs.map((inp) => {
					let argsStr = ""
					if (inp.tool === "grep") {
						argsStr = `${inp.args.pattern}${inp.args.path ? ` in ${inp.args.path}` : ""}`
					} else if (inp.tool === "read_file") {
						argsStr = inp.args.path + (inp.args.start_line ? `:${inp.args.start_line}-${inp.args.end_line || ""}` : "")
					} else if (inp.tool === "find_files") {
						argsStr = `${inp.args.pattern}${inp.args.path ? ` in ${inp.args.path}` : ""}`
					} else if (inp.tool === "ls") {
						argsStr = inp.args.path || "."
					}
					return {
						type: inp.tool as "grep" | "read_file" | "find_files" | "ls",
						args: argsStr,
						status: "running" as const,
					}
				})

				// Emit progress: operations starting
				onProgress?.({
					status: "executing",
					currentTurn: turn + 1,
					maxTurns: this.config.maxTurns,
					toolCallsInProgress: inputs.length,
					message: `Executing ${inputs.length} tool calls...`,
					reasoning: response.content?.substring(0, 200) || undefined,
					operations,
				})

				const results = await this.toolExecutor.executeParallel(inputs)

				// Mark operations as done
				const doneOperations = operations.map((op, i) => ({
					...op,
					status: "done" as const,
					duration: results[i].durationMs,
				}))

				// Emit progress: operations completed
				onProgress?.({
					status: "searching",
					currentTurn: turn + 1,
					maxTurns: this.config.maxTurns,
					toolCallsInProgress: 0,
					message: `Turn ${turn + 1} complete`,
					operations: doneOperations,
				})

				// Build tool call records and messages
				messages.push({ role: "assistant", content: response.content || undefined, tool_calls: validToolCalls })

				for (let i = 0; i < validToolCalls.length; i++) {
					const tc = validToolCalls[i]
					const result = results[i]
					toolCalls.push({
						id: tc.id,
						tool: inputs[i].tool as any,
						args: inputs[i].args,
						result: result.output,
						durationMs: result.durationMs,
					})
					messages.push({
						role: "tool",
						tool_call_id: tc.id,
						content: result.output,
					})
				}

				turns.push({
					turnNumber: turn + 1,
					toolCalls,
					durationMs: Date.now() - turnStart,
				})
			}

			// Max turns reached — ask for final answer with noTools + jsonResponse
			messages.push({
				role: "user",
				content: "You have reached the maximum number of turns. Please provide your final answer now as a JSON object with the relevant file contexts you found. Use the exact format: {\"contexts\": [...], \"summary\": \"...\"}",
			})

			const finalResponse = await this.callLLM(messages, { noTools: true, jsonResponse: true })
			let contexts = this.parseContextsFromResponse(finalResponse.content || "")

			// Fix 5: If parsing still returned nothing, build from tool history
			if (contexts.length === 0) {
				contexts = this.buildContextsFromToolHistory(turns)
			}

			onProgress?.({
				status: "complete",
				currentTurn: this.config.maxTurns,
				maxTurns: this.config.maxTurns,
				toolCallsInProgress: 0,
			})

			return {
				success: true,
				query,
				contexts,
				turns,
				totalDurationMs: Date.now() - startTime,
				tokensUsed: finalResponse.usage?.total_tokens,
				confidence: this.parseConfidenceFromResponse(finalResponse.content || ""),
			}
		} catch (err: any) {
			// Fix 5: Even on error, try to salvage results from tool history
			const salvaged = this.buildContextsFromToolHistory(turns)

			onProgress?.({
				status: salvaged.length > 0 ? "complete" : "error",
				currentTurn: turns.length,
				maxTurns: this.config.maxTurns,
				toolCallsInProgress: 0,
				message: salvaged.length > 0 ? `Recovered ${salvaged.length} results from tool history` : err.message,
			})

			if (salvaged.length > 0) {
				return {
					success: true,
					query,
					contexts: salvaged,
					turns,
					totalDurationMs: Date.now() - startTime,
				}
			}

			return {
				success: false,
				query,
				contexts: [],
				turns,
				totalDurationMs: Date.now() - startTime,
				error: err.message,
			}
		}
	}

	// ── LLM Communication ──────────────────────────────────────────

	private async callLLM(messages: any[], options?: { noTools?: boolean; jsonResponse?: boolean }): Promise<any> {
		const url = this.config.apiUrl.replace(/\/$/, "") + "/chat/completions"

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		}
		if (this.config.apiKey) {
			headers["Authorization"] = `Bearer ${this.config.apiKey}`
		}

		const body: Record<string, any> = {
			model: this.config.modelId,
			messages,
			temperature: 0,
			max_tokens: 4096,
		}

		if (!options?.noTools) {
			body.tools = TOOL_DEFINITIONS
			body.tool_choice = "auto"
			body.parallel_tool_calls = true
		}

		// Fix 4: Request JSON output for final answer calls
		if (options?.jsonResponse) {
			body.response_format = { type: "json_object" }
		}

		// Fix 6: Per-call timeout — use 60s for final calls, configured value for tool calls
		const timeoutMs = options?.noTools
			? Math.max(this.config.timeoutSeconds * 1000, 60000)
			: this.config.timeoutSeconds * 1000

		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), timeoutMs)

		try {
			const response = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal: controller.signal,
			})

			if (!response.ok) {
				const text = await response.text()
				throw new Error(`LLM API error ${response.status}: ${text.slice(0, 200)}`)
			}

			const text = await response.text()
			let data: any
			try {
				data = JSON.parse(text)
			} catch (parseErr: any) {
				throw new Error(`LLM returned invalid JSON: ${parseErr.message}. Response (first 200 chars): ${text.slice(0, 200)}`)
			}

			const choice = data.choices?.[0]
			if (!choice) {
				throw new Error("LLM returned no choices")
			}

			return {
				content: choice.message?.content,
				tool_calls: choice.message?.tool_calls,
				usage: data.usage,
			}
		} finally {
			clearTimeout(timeout)
		}
	}

	// ── Response Parsing ──────────────────────────────────────────

	/**
	 * Extract the confidence field from the sub-agent's JSON response.
	 * Returns 'medium' as default if not found (preserves backward compatibility).
	 */
	private parseConfidenceFromResponse(content: string): "high" | "medium" | "low" {
		if (!content) return "medium"
		try {
			// Try fenced JSON first
			const fencedMatch = content.match(/```(?:json)?\s*\n([\s\S]+?)\n\s*```/)
			if (fencedMatch) {
				const parsed = JSON.parse(fencedMatch[1])
				if (parsed.confidence && ["high", "medium", "low"].includes(parsed.confidence)) {
					return parsed.confidence
				}
			}
			// Try raw JSON
			const parsed = JSON.parse(content.trim())
			if (parsed.confidence && ["high", "medium", "low"].includes(parsed.confidence)) {
				return parsed.confidence
			}
		} catch { /* ignore */ }

		// Heuristic: if content mentions "no matches" or "could not find", assume low
		const lower = content.toLowerCase()
		if (lower.includes("no relevant code found") || lower.includes("could not find") || lower.includes("no matches")) {
			return "low"
		}
		return "medium"
	}

	private parseContextsFromResponse(content: string): FastContextFileContext[] {
		if (!content || content.trim().length === 0) return []

		// Strategy 1: Look for JSON inside markdown code fences (greedy inner match)
		try {
			const fencedMatch = content.match(/```(?:json)?\s*\n([\s\S]+?)\n\s*```/)
			if (fencedMatch) {
				const parsed = JSON.parse(fencedMatch[1])
				if (Array.isArray(parsed.contexts)) {
					return this.mapContextArray(parsed.contexts)
				}
			}
		} catch { /* try next strategy */ }

		// Strategy 2: Try parsing the entire content as JSON (works when response_format is json_object)
		try {
			const parsed = JSON.parse(content.trim())
			if (Array.isArray(parsed.contexts)) {
				return this.mapContextArray(parsed.contexts)
			}
			if (Array.isArray(parsed)) {
				return this.mapContextArray(parsed)
			}
		} catch { /* try next strategy */ }

		// Strategy 3: Bracket-matching extraction — find the outermost { } containing "contexts"
		try {
			const jsonStr = this.extractJsonByBracketMatching(content)
			if (jsonStr) {
				const parsed = JSON.parse(jsonStr)
				if (Array.isArray(parsed.contexts)) {
					return this.mapContextArray(parsed.contexts)
				}
			}
		} catch { /* try next strategy */ }

		// Strategy 4: Try to find and parse just the contexts array
		try {
			const arrMatch = content.match(/"contexts"\s*:\s*(\[[\s\S]*\])/)
			if (arrMatch) {
				const arrStr = this.extractJsonByBracketMatching("[" + arrMatch[1].slice(1), "[", "]")
				if (arrStr) {
					const parsed = JSON.parse(arrStr)
					if (Array.isArray(parsed)) {
						return this.mapContextArray(parsed)
					}
				}
			}
		} catch { /* try next strategy */ }

		// Fallback: extract file references from text (e.g. "path/to/file.ts:10-25")
		const contexts: FastContextFileContext[] = []
		const fileRefPattern = /([a-zA-Z0-9_\-./\\]+\.[a-zA-Z]{1,10}):(\d+)(?:-(\d+))?/g
		let match: RegExpExecArray | null
		while ((match = fileRefPattern.exec(content)) !== null) {
			// Skip common false positives like "http:" or single-char extensions
			if (match[1].includes("http") || match[1].length < 3) continue
			contexts.push({
				filePath: match[1],
				startLine: parseInt(match[2], 10),
				endLine: match[3] ? parseInt(match[3], 10) : parseInt(match[2], 10) + 10,
				content: "",
				relevance: "",
			})
		}
		return contexts
	}

	/**
	 * Extract a balanced JSON object/array from text using bracket matching.
	 * More reliable than regex for nested structures.
	 */
	private extractJsonByBracketMatching(content: string, openChar = "{", closeChar = "}"): string | null {
		const startIdx = content.indexOf(openChar)
		if (startIdx === -1) return null

		let depth = 0
		let inString = false
		let escape = false

		for (let i = startIdx; i < content.length; i++) {
			const ch = content[i]

			if (escape) {
				escape = false
				continue
			}

			if (ch === "\\") {
				escape = true
				continue
			}

			if (ch === '"') {
				inString = !inString
				continue
			}

			if (inString) continue

			if (ch === openChar) depth++
			else if (ch === closeChar) {
				depth--
				if (depth === 0) {
					return content.slice(startIdx, i + 1)
				}
			}
		}
		return null
	}

	// ── Fix 5: Build contexts from tool call history ──────────────

	/**
	 * When LLM response parsing fails, reconstruct results from successful
	 * read_file tool calls in the turn history. This ensures that files which
	 * were actually read are not lost even if the LLM's final answer is malformed.
	 */
	private buildContextsFromToolHistory(turns: FastContextTurn[]): FastContextFileContext[] {
		const contexts: FastContextFileContext[] = []
		const seen = new Set<string>()

		for (const turn of turns) {
			for (const tc of turn.toolCalls) {
				// Only use successful read_file calls that returned actual content
				if (tc.tool !== "read_file") continue
				if (!tc.result || tc.result.startsWith("Error:") || tc.result === "(no matches)") continue

				const filePath = tc.args.path
				if (!filePath || seen.has(filePath)) continue
				seen.add(filePath)

				const startLine = tc.args.start_line || 1
				const lines = tc.result.split("\n")
				const endLine = tc.args.end_line || (startLine + lines.length - 1)

				// Take only the first 50 lines to avoid bloating context
				const truncatedContent = lines.slice(0, 50).join("\n")

				contexts.push({
					filePath,
					startLine,
					endLine: Math.min(endLine, startLine + 49),
					content: truncatedContent,
					relevance: "Retrieved from tool history (LLM response parsing failed)",
				})
			}
		}

		return contexts
	}

	private mapContextArray(arr: any[]): FastContextFileContext[] {
		return arr
			.filter((ctx: any) => ctx && (ctx.filePath || ctx.file || ctx.path))
			.map((ctx: any) => ({
				filePath: ctx.filePath || ctx.file || ctx.path || "",
				startLine: ctx.startLine || ctx.start_line || ctx.line || 1,
				endLine: ctx.endLine || ctx.end_line || (ctx.startLine || ctx.start_line || 1) + 20,
				content: ctx.content || ctx.code || ctx.snippet || "",
				relevance: ctx.relevance || ctx.reason || ctx.description || "",
			}))
	}
}
