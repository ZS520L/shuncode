/**
 * Multi-step workflow types.
 *
 * A workflow is an ordered list of steps that the agent executes sequentially.
 * Each step has a prompt, can be enabled/disabled, and can run in silent mode.
 */

export interface WorkflowStep {
	name: string
	prompt: string
	enabled: boolean
	/** Show agent output in chat (false = silent mode, collapsed block) */
	visible: boolean
}

export interface WorkflowDefinition {
	name: string
	description?: string
	icon?: string
	version: number
	/** Whether the workflow requires user input before running */
	requiresInput: boolean
	steps: WorkflowStep[]
}

export type WorkflowStepStatus = "pending" | "running" | "completed" | "failed" | "skipped"

export type WorkflowOverallStatus = "running" | "completed" | "failed" | "cancelled"

export interface WorkflowStepTiming {
	startedAt?: number
	completedAt?: number
}

export interface WorkflowExecutionState {
	executionId: string
	definition: WorkflowDefinition
	filePath: string
	currentStepIndex: number
	stepStatuses: WorkflowStepStatus[]
	overallStatus: WorkflowOverallStatus
	startedAt: number
	stepTimings: WorkflowStepTiming[]
	userInput: string
}
