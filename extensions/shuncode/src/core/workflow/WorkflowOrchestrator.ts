import type { WorkflowDefinition, WorkflowExecutionState, WorkflowStepStatus } from "./types"

/**
 * Orchestrates sequential execution of multi-step workflow.
 *
 * Works as a wrapper around the existing agent loop:
 * for each enabled step, it injects the step prompt as a user message
 * and runs one iteration of the agent loop via task.initiateStepLoop().
 *
 * Conversation history is shared across steps — the agent sees
 * what it did on previous steps naturally.
 */
export class WorkflowOrchestrator {
	private executionState: WorkflowExecutionState

	constructor(
		private task: WorkflowCapableTask,
		private definition: WorkflowDefinition,
		userInput: string,
		filePath: string,
	) {
		this.executionState = {
			executionId: this.task.getUlid(),
			definition,
			filePath,
			currentStepIndex: 0,
			stepStatuses: definition.steps.map((s) => (s.enabled ? "pending" : "skipped")),
			overallStatus: "running",
			startedAt: Date.now(),
			stepTimings: definition.steps.map(() => ({})),
			userInput,
		}
	}

	getExecutionState(): WorkflowExecutionState {
		return this.executionState
	}

	/**
	 * Run the workflow: iterate over enabled steps, call agent loop for each.
	 */
	async execute(): Promise<void> {
		await this.emitProgress()

		const enabledSteps = this.definition.steps
			.map((step, index) => ({ step, index }))
			.filter(({ step }) => step.enabled)

		if (enabledSteps.length === 0) {
			this.executionState.overallStatus = "completed"
			await this.emitProgress()
			return
		}

		for (const { step, index } of enabledSteps) {
			if (this.task.isAborted()) {
				this.executionState.overallStatus = "cancelled"
				break
			}

			this.executionState.currentStepIndex = index
			this.executionState.stepStatuses[index] = "running"
			this.executionState.stepTimings[index].startedAt = Date.now()
			await this.emitProgress()

			await this.task.sayWorkflowStepStart({
				stepName: step.name,
				stepIndex: index,
				totalSteps: enabledSteps.length,
				silent: !step.visible,
			})
			this.task.setSilentStep(!step.visible)
			const stepPrompt = this.buildStepPrompt(step.name, step.prompt, index, enabledSteps.length)

			try {
				await this.task.initiateStepLoop([{ type: "text", text: stepPrompt }])

				if (this.task.isAborted()) {
					this.executionState.stepStatuses[index] = "failed"
					this.executionState.overallStatus = "cancelled"
					break
				}

				this.executionState.stepStatuses[index] = "completed"
			} catch (_error) {
				this.executionState.stepStatuses[index] = "failed"
				this.executionState.overallStatus = "failed"
				break
			} finally {
				this.task.setSilentStep(false)
			}

			this.executionState.stepTimings[index].completedAt = Date.now()
			await this.emitProgress()
		}

		if (this.executionState.overallStatus === "running") {
			this.executionState.overallStatus = "completed"
		}
		await this.emitProgress()
	}

	private buildStepPrompt(stepName: string, stepPrompt: string, stepIndex: number, totalEnabled: number): string {
		const lines = [
			`<workflow_step step="${stepIndex + 1}" total="${totalEnabled}" name="${stepName}">`,
			stepPrompt,
			`</workflow_step>`,
			``,
			`<workflow_context>`,
			`You are executing step ${stepIndex + 1} of ${totalEnabled} in the "${this.definition.name}" workflow.`,
			`Current step: "${stepName}"`,
		]

		if (this.executionState.userInput) {
			lines.push(`User's original request: "${this.executionState.userInput}"`)
		}

		lines.push(
			``,
			`IMPORTANT: Focus ONLY on the current step's instructions. Do NOT skip ahead to later steps.`,
			`When you have completed this step, call attempt_completion to signal that you are done with this step.`,
			`</workflow_context>`,
		)

		return lines.join("\n")
	}

	/**
	 * Emit progress as a FocusChain-compatible checklist via task_progress message.
	 */
	private async emitProgress(): Promise<void> {
		const text = this.buildProgressText()
		await this.task.sayTaskProgress(text)
	}

	private buildProgressText(): string {
		return this.definition.steps
			.map((step, i) => {
				const status = this.executionState.stepStatuses[i]
				const timing = this.executionState.stepTimings[i]
				const elapsed =
					timing.startedAt && timing.completedAt
						? ` (${((timing.completedAt - timing.startedAt) / 1000).toFixed(1)}s)`
						: ""

				switch (status) {
					case "completed":
						return `- [x] ${step.name}${elapsed}`
					case "skipped":
						return `- [x] ~${step.name}~ (skipped)`
					case "running":
						return `- [ ] ${step.name} ← current`
					case "failed":
						return `- [ ] ${step.name} ❌`
					default:
						return `- [ ] ${step.name}`
				}
			})
			.join("\n")
	}
}

/**
 * Minimal interface that Task must implement for the orchestrator.
 * Keeps the module loosely coupled — orchestrator doesn't import Task directly.
 */
export interface WorkflowCapableTask {
	getUlid(): string
	isAborted(): boolean
	initiateStepLoop(userContent: Array<{ type: "text"; text: string }>): Promise<void>
	sayTaskProgress(text: string): Promise<void>
	sayWorkflowStepStart(data: { stepName: string; stepIndex: number; totalSteps: number; silent: boolean }): Promise<void>
	setSilentStep(silent: boolean): void
}
