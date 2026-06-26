import { ShuncodeDefaultTool } from "@shared/tools"
import {
	TASK_EVALUATION_SCHEMA_VERSION,
	TaskEvaluation,
	TaskEvaluationFeedback,
	TaskEvaluationFinding,
	TaskEvaluationGrade,
	TaskEvaluationSignals,
	TaskEvaluationSummary,
	TaskVerificationCommand,
	ToolEvaluationStatus,
} from "./types"

const EDIT_TOOLS = new Set<string>([
	ShuncodeDefaultTool.FILE_EDIT,
	ShuncodeDefaultTool.FILE_NEW,
	ShuncodeDefaultTool.FILE_APPEND,
	ShuncodeDefaultTool.APPLY_PATCH,
	ShuncodeDefaultTool.EDIT_NOTEBOOK,
	ShuncodeDefaultTool.DELETE_BLOCK,
	ShuncodeDefaultTool.REPLACE_TEXT,
	ShuncodeDefaultTool.FILE_DELETE,
])

/**
 * Read-only tools whose results embed file paths AND file content snippets.
 * When the model uses these, it has effectively "seen" the content of the
 * referenced files — so a subsequent edit to those files should NOT be counted
 * as an "edit without prior read". We parse the result text to recover the
 * file paths that were surfaced to the model.
 */
const CONTENT_BEARING_SEARCH_TOOLS = new Set<string>([
	ShuncodeDefaultTool.SEARCH,
	ShuncodeDefaultTool.FAST_CONTEXT,
	ShuncodeDefaultTool.LIST_CODE_DEF,
	ShuncodeDefaultTool.GO_TO_DEFINITION,
])

const VERIFICATION_COMMAND_PATTERNS: Array<[TaskVerificationCommand["category"], RegExp]> = [
	["test", /\b(test|vitest|jest|mocha|playwright|pytest|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle\s+test)\b/i],
	["lint", /\b(lint|eslint|biome\s+lint|ruff|golangci-lint|stylelint|oxlint)\b/i],
	["typecheck", /\b(typecheck|check-types|tsc\b|npx\s+tsc|mypy|pyright|vue-tsc)\b/i],
	["build", /\b(build|compile|webpack|vite\s+build|next\s+build|rollup|dotnet\s+build|mvn\s+compile|gradle\s+build|cargo\s+build)\b/i],
]

function createInitialSignals(): TaskEvaluationSignals {
	return {
		completionAttempts: 0,
		toolCallCount: 0,
		failedToolCallCount: 0,
		rejectedToolCallCount: 0,
		editToolCallCount: 0,
		commandToolCallCount: 0,
		hasVerificationEvidence: false,
		verificationCommands: [],
		readDiagnosticsCount: 0,
		modeViolationCount: 0,
		missingParamCount: 0,
		permissionDeniedCount: 0,
		sessionBudgetExhausted: false,
		consecutiveExplorationWarnings: 0,
		repeatedFailureLoopCount: 0,
		userProvidedFeedbackAfterCompletion: false,
	}
}

function clampScore(score: number): number {
	return Math.max(0, Math.min(100, Math.round(score)))
}

function gradeForScore(score: number): TaskEvaluationGrade {
	if (score >= 90) {
		return "excellent"
	}
	if (score >= 75) {
		return "good"
	}
	if (score >= 50) {
		return "needs_attention"
	}
	return "failed"
}

function taskNeedsFollowup(score: number, signals: TaskEvaluationSignals): boolean {
	return (
		score < 75 ||
		signals.userFeedback === "thumbs_down" ||
		signals.userProvidedFeedbackAfterCompletion ||
		signals.sessionBudgetExhausted ||
		signals.modeViolationCount > 0
	)
}

function commandCategory(command: string): TaskVerificationCommand["category"] | undefined {
	for (const [category, regex] of VERIFICATION_COMMAND_PATTERNS) {
		if (regex.test(command)) {
			return category
		}
	}
	return undefined
}

function stringifyToolResult(result: unknown): string {
	if (typeof result === "string") {
		return result
	}
	if (result === undefined || result === null) {
		return ""
	}
	try {
		return JSON.stringify(result) ?? ""
	} catch {
		return String(result)
	}
}

/**
 * Extract file paths surfaced in the result text of content-bearing search
 * tools (search_files, fast_context, list_code_definition_names,
 * go_to_definition). These tools embed file paths in a few recognizable forms:
 *   - search_files header:    `relative/path/file.ts (3 matches)`
 *   - fast_context segment:   `// relative/path/file.ts:1-17 — description`
 *   - generic XML attribute:  `path="relative/path/file.ts"` or `<file path="...">`
 *   - go_to_definition / list_code_def lines referencing a path
 * We collect every plausible path so a later edit to one of them is treated as
 * having been read beforehand.
 */
function extractPathsFromSearchResult(resultText: string): string[] {
	if (!resultText) {
		return []
	}

	const paths = new Set<string>()

	// path="..." or path='...' (XML-style attributes used by several tools)
	for (const match of resultText.matchAll(/path\s*=\s*["']([^"']+)["']/g)) {
		paths.add(match[1])
	}

	// fast_context style: `// path/to/file.ext:12-34` (optionally leading `//`)
	for (const match of resultText.matchAll(/(?:^|\s|\/\/\s*)([\w./\\-]+\.[A-Za-z0-9]+):\d+/gm)) {
		paths.add(match[1])
	}

	// search_files header style: `path/to/file.ext (1 match)` / `(3 matches)`
	for (const match of resultText.matchAll(/([\w./\\-]+\.[A-Za-z0-9]+)\s*\(\d+\s+match(?:es)?\)/g)) {
		paths.add(match[1])
	}

	return Array.from(paths)
}

function resultLooksRejected(resultText: string): boolean {
	return /\b(denied|rejected|cancelled by user|user rejected)\b/i.test(resultText)
}

function resultLooksFailed(resultText: string): boolean {
	const trimmed = resultText.trim()
	return (
		/^error\b/i.test(trimmed) ||
		/\b(tool execution failed|missing value for required parameter|command failed|failed with|compilation failed|tests failed)\b/i.test(
			trimmed,
		) ||
		/\b(ENOENT|EACCES|EISDIR|MODULE_NOT_FOUND|Cannot find module|ERR!|SyntaxError|TypeError|ReferenceError)\b/.test(
			trimmed,
		) ||
		/\bexit code\s*:?'?\s*[1-9]\d*\b/i.test(trimmed)
	)
}

function resultLooksPermissionDenied(resultText: string): boolean {
	return /\b(permission denied|denied by SHUNCODE_COMMAND_PERMISSIONS|command_permission_denied)\b/i.test(resultText)
}

function parseTaskProgress(text: string | undefined): Pick<TaskEvaluationSignals, "taskProgressTotal" | "taskProgressCompleted"> {
	if (!text) {
		return {}
	}

	let total = 0
	let completed = 0
	for (const line of text.split("\n")) {
		const match = /^\s*-\s+\[([ xX])\]/.exec(line)
		if (!match) {
			continue
		}
		total++
		if (match[1].toLowerCase() === "x") {
			completed++
		}
	}

	return total > 0 ? { taskProgressTotal: total, taskProgressCompleted: completed } : {}
}

export function scoreTaskEvaluation(signals: TaskEvaluationSignals): Pick<TaskEvaluation, "score" | "grade" | "needsFollowup" | "findings"> {
	let score = 100
	const findings: TaskEvaluationFinding[] = []

	if (signals.completionAttempts === 0) {
		score -= 20
		findings.push({
			code: "missing_completion",
			severity: "error",
			message: "任务没有通过 attempt_completion 形成明确完成闭环。",
		})
	} else if (signals.completionAttempts > 1) {
		const penalty = Math.min(15, (signals.completionAttempts - 1) * 5)
		score -= penalty
		findings.push({
			code: "multiple_completion_attempts",
			severity: "warning",
			message: `任务调用了 ${signals.completionAttempts} 次 attempt_completion，可能存在完成判断反复。`,
		})
	}

	const taskChangedWorkspace = signals.editToolCallCount > 0 || signals.commandToolCallCount > 0
	if (taskChangedWorkspace && !signals.hasVerificationEvidence) {
		score -= 20
		findings.push({
			code: "missing_verification",
			severity: "warning",
			message: "检测到编辑或命令操作，但没有测试、构建、lint、typecheck 或 diagnostics 证据。",
		})
	}

	if (signals.readDiagnosticsCount > 0 && signals.hasVerificationEvidence) {
		score += 5
		findings.push({
			code: "diagnostics_checked",
			severity: "info",
			message: "任务中读取了 IDE diagnostics，可作为静态验证信号。",
		})
	}

	if (signals.failedToolCallCount > 0) {
		score -= Math.min(20, signals.failedToolCallCount * 5)
		findings.push({
			code: "tool_failures",
			severity: signals.failedToolCallCount > 2 ? "error" : "warning",
			message: `检测到 ${signals.failedToolCallCount} 次工具失败或错误结果。`,
		})
	}

	if (signals.rejectedToolCallCount > 0) {
		score -= Math.min(15, signals.rejectedToolCallCount * 5)
		findings.push({
			code: "tool_rejections",
			severity: "warning",
			message: `检测到 ${signals.rejectedToolCallCount} 次工具被拒绝或取消。`,
		})
	}

	if (signals.missingParamCount > 0) {
		score -= Math.min(15, signals.missingParamCount * 5)
		findings.push({
			code: "missing_tool_parameters",
			severity: "warning",
			message: `检测到 ${signals.missingParamCount} 次工具必填参数缺失。`,
		})
	}

	if (signals.modeViolationCount > 0) {
		score -= Math.min(24, signals.modeViolationCount * 8)
		findings.push({
			code: "mode_violations",
			severity: "error",
			message: `检测到 ${signals.modeViolationCount} 次模式权限违规。`,
		})
	}

	if (signals.permissionDeniedCount > 0) {
		score -= Math.min(15, signals.permissionDeniedCount * 5)
		findings.push({
			code: "permission_denied",
			severity: "warning",
			message: `检测到 ${signals.permissionDeniedCount} 次权限拒绝。`,
		})
	}

	if (signals.sessionBudgetExhausted) {
		score -= 10
		findings.push({
			code: "session_budget_exhausted",
			severity: "warning",
			message: "任务触发了 session budget hard limit，说明执行过程可能过长或陷入循环。",
		})
	}

	if (signals.consecutiveExplorationWarnings > 0) {
		score -= Math.min(15, signals.consecutiveExplorationWarnings * 5)
		findings.push({
			code: "exploration_loop_warning",
			severity: "warning",
			message: `检测到 ${signals.consecutiveExplorationWarnings} 次连续探索工具告警。`,
		})
	}

	if (signals.repeatedFailureLoopCount > 0) {
		score -= Math.min(20, signals.repeatedFailureLoopCount * 8)
		findings.push({
			code: "repeated_failure_loops",
			severity: signals.repeatedFailureLoopCount > 2 ? "error" : "warning",
			message: `检测到 ${signals.repeatedFailureLoopCount} 次重复失败循环（同一工具+目标连续失败 2+ 次）。`,
		})
	}

	if (signals.editToolCallCount > 8 && !signals.hasVerificationEvidence) {
		score -= 5
		findings.push({
			code: "large_edit_without_verification",
			severity: "warning",
			message: "编辑工具调用较多但缺少验证证据，修改范围风险较高。",
		})
	}

	if (signals.editWithoutPriorReadCount && signals.editWithoutPriorReadCount > 0) {
		const penalty = Math.min(10, signals.editWithoutPriorReadCount * 3)
		score -= penalty
		findings.push({
			code: "edit_without_prior_read",
			severity: "warning",
			message: `检测到 ${signals.editWithoutPriorReadCount} 次编辑操作之前没有先读取目标文件，可能导致基于过时信息的修改。`,
		})
	}

	if (
		signals.taskProgressTotal !== undefined &&
		signals.taskProgressCompleted !== undefined &&
		signals.taskProgressCompleted < signals.taskProgressTotal
	) {
		score -= 10
		findings.push({
			code: "incomplete_task_progress",
			severity: "warning",
			message: `任务进度未全部完成：${signals.taskProgressCompleted}/${signals.taskProgressTotal}。`,
		})
	}

	if (signals.userProvidedFeedbackAfterCompletion) {
		score -= 15
		findings.push({
			code: "user_followup_after_completion",
			severity: "warning",
			message: "用户在任务完成后继续提供反馈，说明完成判断可能过早或结果仍需修正。",
		})
	}

	if (signals.userFeedback === "thumbs_down") {
		score -= 25
		findings.push({
			code: "negative_user_feedback",
			severity: "error",
			message: "用户对任务结果给出负向反馈。",
		})
	} else if (signals.userFeedback === "thumbs_up") {
		score += 5
		findings.push({
			code: "positive_user_feedback",
			severity: "info",
			message: "用户对任务结果给出正向反馈。",
		})
	}

	const finalScore = clampScore(score)
	return {
		score: finalScore,
		grade: gradeForScore(finalScore),
		needsFollowup: taskNeedsFollowup(finalScore, signals),
		findings,
	}
}

export class TaskEvaluationTracker {
	private taskId?: string
	private ulid?: string
	private completedAt?: number
	private readonly signals: TaskEvaluationSignals = createInitialSignals()
	private lastEvaluation?: TaskEvaluation
	/** Tracks file paths that have been read during this task */
	private readonly filesRead = new Set<string>()

	start(metadata: { taskId: string; ulid?: string }): void {
		this.taskId = metadata.taskId
		this.ulid = metadata.ulid
	}

	hydrate(evaluation: TaskEvaluation | TaskEvaluationSummary | undefined): void {
		if (!evaluation) {
			return
		}

		this.completedAt = evaluation.completedAt
		if ("signals" in evaluation) {
			Object.assign(this.signals, evaluation.signals)
			this.lastEvaluation = evaluation
		} else {
			this.signals.hasVerificationEvidence = evaluation.hasVerificationEvidence
			this.signals.userFeedback = evaluation.userFeedback
		}
	}

	recordToolUse(args: {
		toolName: string
		status: ToolEvaluationStatus
		executionTimeMs?: number
		params?: Record<string, unknown>
		result?: unknown
	}): void {
		const { toolName, status, params, result } = args
		if (toolName === ShuncodeDefaultTool.ATTEMPT) {
			return
		}

		this.signals.toolCallCount++

		// Track file reads (single file)
		if (toolName === ShuncodeDefaultTool.FILE_READ) {
			const filePath = typeof params?.path === "string" ? params.path : undefined
			if (filePath) {
				this.filesRead.add(this.normalizePath(filePath))
			}
		}

		// Track file reads (batch read_files)
		if (toolName === ShuncodeDefaultTool.READ_FILES) {
			const paths = params?.paths
			if (typeof paths === "string") {
				try {
					const parsed = JSON.parse(paths)
					if (Array.isArray(parsed)) {
						for (const p of parsed) {
							if (typeof p === "string") {
								this.filesRead.add(this.normalizePath(p))
							}
						}
					}
				} catch { /* ignore parse errors */ }
			} else if (Array.isArray(paths)) {
				for (const p of paths) {
					if (typeof p === "string") {
						this.filesRead.add(this.normalizePath(p))
					}
				}
			}
		}

		// Track files surfaced by content-bearing search tools (search_files,
		// fast_context, etc.). The model has seen these files' content, so a
		// later edit to them should not be flagged as "edit without prior read".
		if (CONTENT_BEARING_SEARCH_TOOLS.has(toolName) && status === "success") {
			for (const p of extractPathsFromSearchResult(stringifyToolResult(result))) {
				this.filesRead.add(this.normalizePath(p))
			}
		}

		if (EDIT_TOOLS.has(toolName)) {
			this.signals.editToolCallCount++
			// Check if the edited file was read beforehand
			const editPath = this.extractEditPath(toolName, params)
			if (editPath && !this.filesRead.has(this.normalizePath(editPath))) {
				this.signals.editWithoutPriorReadCount = (this.signals.editWithoutPriorReadCount ?? 0) + 1
			}
			// After a successful edit, the system returns final_file_content,
			// so subsequent edits to the same file should not be penalized
			if (editPath && status === "success") {
				this.filesRead.add(this.normalizePath(editPath))
			}
		}

		if (toolName === ShuncodeDefaultTool.BASH) {
			this.signals.commandToolCallCount++
			const command = typeof params?.command === "string" ? params.command : undefined
			if (command) {
				this.recordVerificationCommand(command, result)
			}
		}

		if (toolName === ShuncodeDefaultTool.READ_DIAGNOSTICS) {
			this.signals.readDiagnosticsCount++
			this.signals.hasVerificationEvidence = true
			this.signals.verificationCommands.push({ command: "read_diagnostics", category: "diagnostics", success: status === "success" })
		}

		const resultText = stringifyToolResult(result)
		if (status === "error" || resultLooksFailed(resultText)) {
			this.signals.failedToolCallCount++
		}

		if (status === "rejected" || resultLooksRejected(resultText)) {
			this.signals.rejectedToolCallCount++
		}

		if (resultLooksPermissionDenied(resultText)) {
			this.signals.permissionDeniedCount++
		}
	}

	recordToolRejected(_toolName: string): void {
		this.signals.rejectedToolCallCount++
	}

	recordModeViolation(_toolName: string, _mode: string): void {
		this.signals.modeViolationCount++
	}

	recordMissingParam(_toolName: string, _paramName: string): void {
		this.signals.missingParamCount++
	}

	recordSessionGuardrail(kind: "exploration_loop" | "budget_exhausted"): void {
		if (kind === "budget_exhausted") {
			this.signals.sessionBudgetExhausted = true
			return
		}
		this.signals.consecutiveExplorationWarnings++
	}

	recordRepeatedFailureLoop(): void {
		this.signals.repeatedFailureLoopCount++
	}

	recordCompletionAttempt(taskProgress?: string): void {
		this.signals.completionAttempts++
		this.recordTaskProgress(taskProgress)
	}

	recordUserFeedbackAfterCompletion(): void {
		this.signals.userProvidedFeedbackAfterCompletion = true
	}

	recordTaskFeedback(feedback: TaskEvaluationFeedback): void {
		this.signals.userFeedback = feedback
	}

	recordTaskProgress(taskProgress?: string): void {
		Object.assign(this.signals, parseTaskProgress(taskProgress))
	}

	finalize(metadata?: { taskId?: string; ulid?: string; completedAt?: number }): TaskEvaluation {
		this.taskId = metadata?.taskId ?? this.taskId
		this.ulid = metadata?.ulid ?? this.ulid
		this.completedAt = metadata?.completedAt ?? this.completedAt ?? Date.now()

		const scored = scoreTaskEvaluation(this.signals)
		this.lastEvaluation = {
			schemaVersion: TASK_EVALUATION_SCHEMA_VERSION,
			taskId: this.taskId ?? "unknown",
			ulid: this.ulid,
			updatedAt: Date.now(),
			completedAt: this.completedAt,
			hasVerificationEvidence: this.signals.hasVerificationEvidence,
			userFeedback: this.signals.userFeedback,
			...scored,
			signals: { ...this.signals, verificationCommands: [...this.signals.verificationCommands] },
		}

		return this.lastEvaluation
	}

	getSummary(): TaskEvaluationSummary | undefined {
		if (!this.lastEvaluation) {
			return undefined
		}

		return {
			schemaVersion: TASK_EVALUATION_SCHEMA_VERSION,
			score: this.lastEvaluation.score,
			grade: this.lastEvaluation.grade,
			completedAt: this.lastEvaluation.completedAt,
			hasVerificationEvidence: this.lastEvaluation.hasVerificationEvidence,
			userFeedback: this.lastEvaluation.userFeedback,
			needsFollowup: this.lastEvaluation.needsFollowup,
		}
	}

	getEvaluation(): TaskEvaluation | undefined {
		return this.lastEvaluation
	}

	private recordVerificationCommand(command: string, result: unknown): void {
		const category = commandCategory(command)
		if (!category) {
			return
		}

		const resultText = stringifyToolResult(result)
		const success = resultText ? !resultLooksFailed(resultText) && !resultLooksRejected(resultText) : undefined
		this.signals.hasVerificationEvidence = true
		this.signals.verificationCommands.push({ command, category, success })
	}

	private normalizePath(filePath: string): string {
		return filePath.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase()
	}

	private extractEditPath(toolName: string, params?: Record<string, unknown>): string | undefined {
		if (!params) {
			return undefined
		}
		// Different edit tools use different parameter names for the file path
		if (typeof params.absolutePath === "string") {
			return params.absolutePath
		}
		if (typeof params.path === "string") {
			return params.path
		}
		if (typeof params.target_notebook === "string") {
			return params.target_notebook
		}
		return undefined
	}
}
