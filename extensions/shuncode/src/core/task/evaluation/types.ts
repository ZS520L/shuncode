export { TASK_EVALUATION_SCHEMA_VERSION, type TaskEvaluationGrade, type TaskEvaluationFeedback, type TaskEvaluationSummary } from "@shared/evaluation-types"

export type TaskEvaluationFindingSeverity = "info" | "warning" | "error"

export type TaskEvaluationFinding = {
	code: string
	severity: TaskEvaluationFindingSeverity
	message: string
	evidence?: string
}

export type TaskVerificationCommand = {
	command: string
	category: "test" | "lint" | "typecheck" | "build" | "diagnostics" | "other"
	success?: boolean
}

export type TaskEvaluationSignals = {
	completionAttempts: number
	toolCallCount: number
	failedToolCallCount: number
	rejectedToolCallCount: number
	editToolCallCount: number
	commandToolCallCount: number
	hasVerificationEvidence: boolean
	verificationCommands: TaskVerificationCommand[]
	readDiagnosticsCount: number
	modeViolationCount: number
	missingParamCount: number
	permissionDeniedCount: number
	sessionBudgetExhausted: boolean
	consecutiveExplorationWarnings: number
	repeatedFailureLoopCount: number
	userProvidedFeedbackAfterCompletion: boolean
	userFeedback?: TaskEvaluationFeedback
	taskProgressTotal?: number
	taskProgressCompleted?: number
	/** Number of file edits where the file was NOT read beforehand */
	editWithoutPriorReadCount?: number
}

export type TaskEvaluation = TaskEvaluationSummary & {
	taskId: string
	ulid?: string
	updatedAt: number
	signals: TaskEvaluationSignals
	findings: TaskEvaluationFinding[]
}

export type ToolEvaluationStatus = "success" | "error" | "rejected" | "skipped"
