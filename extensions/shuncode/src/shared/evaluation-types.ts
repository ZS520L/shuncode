export const TASK_EVALUATION_SCHEMA_VERSION = 1

export type TaskEvaluationGrade = "excellent" | "good" | "needs_attention" | "failed"

export type TaskEvaluationFeedback = "thumbs_up" | "thumbs_down"

export type TaskEvaluationSummary = {
	schemaVersion: typeof TASK_EVALUATION_SCHEMA_VERSION
	score: number
	grade: TaskEvaluationGrade
	completedAt?: number
	hasVerificationEvidence: boolean
	userFeedback?: TaskEvaluationFeedback
	needsFollowup: boolean
}
