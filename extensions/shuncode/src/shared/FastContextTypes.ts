/**
 * Shared types for the Fast Context sub-agent system.
 * Used by both the extension backend and the webview UI.
 *
 * Fast Context is an agentic search sub-agent that uses an LLM to perform
 * multi-turn parallel code search (grep, read, glob) in an isolated context
 * window, replacing traditional embedding-based retrieval.
 */

/** Fast Context sub-agent configuration */
export interface FastContextConfig {
	/** Whether Fast Context is enabled */
	enabled: boolean
	/** LLM endpoint URL (OpenAI-compatible) */
	apiUrl: string
	/** API key for the LLM endpoint */
	apiKey: string
	/** Model ID to use for the search sub-agent */
	modelId: string
	/** Maximum serial turns the sub-agent can take (1-8, default 4) */
	maxTurns: number
	/** Maximum parallel tool calls per turn (1-16, default 8) */
	maxParallelCalls: number
	/** Timeout in seconds for the entire search operation */
	timeoutSeconds: number
	/** Custom system prompt override (optional) */
	systemPrompt?: string
	/** File patterns to exclude from search */
	excludePatterns: string[]
	/** Maximum file size to read in bytes */
	maxReadFileSize: number
	/** Whether to stream intermediate steps to UI */
	showProgress: boolean
}

/** Default Fast Context configuration */
export const DEFAULT_FAST_CONTEXT_CONFIG: FastContextConfig = {
	enabled: false,
	apiUrl: "",
	apiKey: "",
	modelId: "",
	maxTurns: 4,
	maxParallelCalls: 8,
	timeoutSeconds: 30,
	systemPrompt: undefined,
	excludePatterns: [
		"node_modules",
		".git",
		"dist",
		"build",
		"out",
		".next",
		"__pycache__",
		".venv",
		"*.min.js",
		"*.min.css",
		"*.map",
		"*.lock",
	],
	maxReadFileSize: 65536, // 64KB
	showProgress: true,
}

/** A single tool call made by the sub-agent */
export interface FastContextToolCall {
	id: string
	tool: "grep" | "read_file" | "find_files"
	args: Record<string, any>
	result?: string
	durationMs?: number
}

/** A single turn in the sub-agent's search loop */
export interface FastContextTurn {
	turnNumber: number
	toolCalls: FastContextToolCall[]
	reasoning?: string
	durationMs: number
}

/** Result of a Fast Context search */
export interface FastContextResult {
	/** Whether the search completed successfully */
	success: boolean
	/** The search query that was executed */
	query: string
	/** Relevant file contexts found */
	contexts: FastContextFileContext[]
	/** All turns taken during search */
	turns: FastContextTurn[]
	/** Total time taken in ms */
	totalDurationMs: number
	/** Error message if failed */
	error?: string
	/** Tokens used by the sub-agent */
	tokensUsed?: number
}

/** A file context result from Fast Context */
export interface FastContextFileContext {
	/** Absolute file path */
	filePath: string
	/** Start line (1-indexed) */
	startLine: number
	/** End line (1-indexed) */
	endLine: number
	/** The actual content of the lines */
	content: string
	/** Why this context is relevant */
	relevance?: string
}

/** Progress update emitted during search */
export interface FastContextProgress {
	status: "searching" | "executing" | "complete" | "error"
	currentTurn: number
	maxTurns: number
	toolCallsInProgress: number
	message?: string
	/** Sub-agent reasoning text (from LLM response) */
	reasoning?: string
	/** Individual tool operations with their status */
	operations?: Array<{
		type: "grep" | "read_file" | "find_files"
		args: string
		status: "running" | "done"
		duration?: number
	}>
}
