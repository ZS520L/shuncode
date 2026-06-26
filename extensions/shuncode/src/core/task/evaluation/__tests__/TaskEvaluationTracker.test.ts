import { beforeEach, describe, it } from "mocha"
import "should"
import { TaskEvaluationTracker, scoreTaskEvaluation } from "../TaskEvaluationTracker"
import type { TaskEvaluationFinding, TaskEvaluationSignals } from "../types"

function createMinimalSignals(overrides: Partial<TaskEvaluationSignals> = {}): TaskEvaluationSignals {
	return {
		completionAttempts: 1,
		toolCallCount: 5,
		failedToolCallCount: 0,
		rejectedToolCallCount: 0,
		editToolCallCount: 2,
		commandToolCallCount: 1,
		hasVerificationEvidence: true,
		verificationCommands: [{ command: "npm run test", category: "test", success: true }],
		readDiagnosticsCount: 0,
		modeViolationCount: 0,
		missingParamCount: 0,
		permissionDeniedCount: 0,
		sessionBudgetExhausted: false,
		consecutiveExplorationWarnings: 0,
		repeatedFailureLoopCount: 0,
		userProvidedFeedbackAfterCompletion: false,
		...overrides,
	}
}

describe("TaskEvaluationTracker", () => {
	let tracker: TaskEvaluationTracker

	beforeEach(() => {
		tracker = new TaskEvaluationTracker()
		tracker.start({ taskId: "test-task-1", ulid: "ulid-1" })
	})

	describe("initial state", () => {
		it("should finalize with missing_completion finding when no completion recorded", () => {
			const evaluation = tracker.finalize()
			evaluation.signals.completionAttempts.should.equal(0)
			evaluation.findings.some((f: TaskEvaluationFinding) => f.code === "missing_completion").should.be.true()
			evaluation.score.should.be.below(100)
		})
	})

	describe("recordToolUse", () => {
		it("should count tool calls", () => {
			tracker.recordToolUse({ toolName: "read_file", status: "success" })
			tracker.recordToolUse({ toolName: "write_to_file", status: "success" })
			tracker.recordCompletionAttempt()
			const evaluation = tracker.finalize()
			evaluation.signals.toolCallCount.should.equal(2)
			evaluation.signals.editToolCallCount.should.equal(1)
		})

		it("should detect verification commands", () => {
			tracker.recordToolUse({
				toolName: "execute_command",
				status: "success",
				params: { command: "npm run test" },
				result: "Tests passed",
			})
			tracker.recordCompletionAttempt()
			const evaluation = tracker.finalize()
			evaluation.signals.hasVerificationEvidence.should.be.true()
			evaluation.signals.verificationCommands.length.should.equal(1)
			evaluation.signals.verificationCommands[0].category.should.equal("test")
		})

		it("should not count attempt_completion as a tool call", () => {
			tracker.recordToolUse({ toolName: "attempt_completion", status: "success" })
			const evaluation = tracker.finalize()
			evaluation.signals.toolCallCount.should.equal(0)
		})

		it("should detect failed tool calls from result text", () => {
			tracker.recordToolUse({
				toolName: "execute_command",
				status: "success",
				params: { command: "npm run build" },
				result: "Error: compilation failed with 3 errors",
			})
			tracker.recordCompletionAttempt()
			const evaluation = tracker.finalize()
			evaluation.signals.failedToolCallCount.should.equal(1)
		})

		it("should detect permission denied", () => {
			tracker.recordToolUse({
				toolName: "execute_command",
				status: "error",
				params: { command: "rm -rf /" },
				result: "denied by SHUNCODE_COMMAND_PERMISSIONS",
			})
			tracker.recordCompletionAttempt()
			const evaluation = tracker.finalize()
			evaluation.signals.permissionDeniedCount.should.equal(1)
		})

		it("should flag edit without prior read", () => {
			tracker.recordToolUse({ toolName: "replace_text", status: "success", params: { path: "src/never-read.ts" } })
			tracker.recordCompletionAttempt()
			const evaluation = tracker.finalize()
			evaluation.signals.editWithoutPriorReadCount!.should.equal(1)
		})

		it("should NOT flag edit after read_file of the same path", () => {
			tracker.recordToolUse({ toolName: "read_file", status: "success", params: { path: "src/foo.ts" } })
			tracker.recordToolUse({ toolName: "replace_text", status: "success", params: { path: "src/foo.ts" } })
			tracker.recordCompletionAttempt()
			const evaluation = tracker.finalize()
				; (evaluation.signals.editWithoutPriorReadCount ?? 0).should.equal(0)
		})

		it("should NOT flag edit after search_files surfaced the path", () => {
			tracker.recordToolUse({
				toolName: "search_files",
				status: "success",
				params: { path: "src", regex: "foo" },
				result: "src/foo.ts (2 matches)\n│----\n│const foo = 1\n",
			})
			tracker.recordToolUse({ toolName: "replace_text", status: "success", params: { path: "src/foo.ts" } })
			tracker.recordCompletionAttempt()
			const evaluation = tracker.finalize()
				; (evaluation.signals.editWithoutPriorReadCount ?? 0).should.equal(0)
		})

		it("should NOT flag edit after fast_context surfaced the path", () => {
			tracker.recordToolUse({
				toolName: "fast_context",
				status: "success",
				params: { query: "where is foo" },
				result: "// src/foo.ts:1-17 — defines foo\nexport const foo = 1\n",
			})
			tracker.recordToolUse({ toolName: "write_to_file", status: "success", params: { absolutePath: "src/foo.ts", content: "x" } })
			tracker.recordCompletionAttempt()
			const evaluation = tracker.finalize()
				; (evaluation.signals.editWithoutPriorReadCount ?? 0).should.equal(0)
		})
	})

	describe("recordModeViolation", () => {
		it("should track mode violations", () => {
			tracker.recordModeViolation("write_to_file", "ask")
			tracker.recordCompletionAttempt()
			const evaluation = tracker.finalize()
			evaluation.signals.modeViolationCount.should.equal(1)
			evaluation.findings.some((f: TaskEvaluationFinding) => f.code === "mode_violations").should.be.true()
		})
	})

	describe("recordMissingParam", () => {
		it("should track missing params", () => {
			tracker.recordMissingParam("read_file", "path")
			tracker.recordCompletionAttempt()
			const evaluation = tracker.finalize()
			evaluation.signals.missingParamCount.should.equal(1)
		})
	})

	describe("recordSessionGuardrail", () => {
		it("should track exploration loops", () => {
			tracker.recordSessionGuardrail("exploration_loop")
			tracker.recordSessionGuardrail("exploration_loop")
			tracker.recordCompletionAttempt()
			const evaluation = tracker.finalize()
			evaluation.signals.consecutiveExplorationWarnings.should.equal(2)
		})

		it("should track budget exhaustion", () => {
			tracker.recordSessionGuardrail("budget_exhausted")
			tracker.recordCompletionAttempt()
			const evaluation = tracker.finalize()
			evaluation.signals.sessionBudgetExhausted.should.be.true()
		})
	})

	describe("recordCompletionAttempt", () => {
		it("should parse task progress", () => {
			tracker.recordCompletionAttempt("- [x] Step 1\n- [x] Step 2\n- [ ] Step 3")
			const evaluation = tracker.finalize()
			evaluation.signals.taskProgressTotal!.should.equal(3)
			evaluation.signals.taskProgressCompleted!.should.equal(2)
		})
	})

	describe("recordTaskFeedback", () => {
		it("should record thumbs_up feedback", () => {
			tracker.recordCompletionAttempt()
			tracker.recordTaskFeedback("thumbs_up")
			const evaluation = tracker.finalize()
			evaluation.signals.userFeedback!.should.equal("thumbs_up")
			evaluation.findings.some((f: TaskEvaluationFinding) => f.code === "positive_user_feedback").should.be.true()
		})

		it("should record thumbs_down feedback and penalize score", () => {
			tracker.recordCompletionAttempt()
			tracker.recordTaskFeedback("thumbs_down")
			const evaluation = tracker.finalize()
			evaluation.signals.userFeedback!.should.equal("thumbs_down")
			evaluation.findings.some((f: TaskEvaluationFinding) => f.code === "negative_user_feedback").should.be.true()
			evaluation.needsFollowup.should.be.true()
		})
	})

	describe("recordUserFeedbackAfterCompletion", () => {
		it("should flag followup needed", () => {
			tracker.recordCompletionAttempt()
			tracker.recordUserFeedbackAfterCompletion()
			const evaluation = tracker.finalize()
			evaluation.signals.userProvidedFeedbackAfterCompletion.should.be.true()
			evaluation.needsFollowup.should.be.true()
		})
	})

	describe("finalize", () => {
		it("should produce correct metadata", () => {
			tracker.recordCompletionAttempt()
			const evaluation = tracker.finalize({ taskId: "t1", ulid: "u1", completedAt: 12345 })
			evaluation.taskId.should.equal("t1")
			evaluation.ulid!.should.equal("u1")
			evaluation.completedAt!.should.equal(12345)
			evaluation.schemaVersion.should.equal(1)
		})

		it("should produce summary via getSummary", () => {
			tracker.recordCompletionAttempt()
			tracker.finalize()
			const summary = tracker.getSummary()!
			summary.should.have.property("score")
			summary.should.have.property("grade")
			summary.should.have.property("needsFollowup")
			summary.should.have.property("hasVerificationEvidence")
			summary.schemaVersion.should.equal(1)
		})
	})

	describe("hydrate", () => {
		it("should restore state from a previous evaluation", () => {
			tracker.recordCompletionAttempt()
			tracker.recordToolUse({ toolName: "write_to_file", status: "success" })
			const firstEval = tracker.finalize()

			const tracker2 = new TaskEvaluationTracker()
			tracker2.start({ taskId: "test-task-1", ulid: "ulid-1" })
			tracker2.hydrate(firstEval)
			tracker2.recordTaskFeedback("thumbs_down")
			const secondEval = tracker2.finalize()

			secondEval.signals.editToolCallCount.should.equal(1)
			secondEval.signals.userFeedback!.should.equal("thumbs_down")
		})
	})
})

describe("scoreTaskEvaluation", () => {
	it("should give excellent score for clean task", () => {
		const result = scoreTaskEvaluation(createMinimalSignals())
		result.score.should.be.aboveOrEqual(90)
		result.grade.should.equal("excellent")
		result.needsFollowup.should.be.false()
	})

	it("should penalize missing verification for edit tasks", () => {
		const result = scoreTaskEvaluation(createMinimalSignals({
			hasVerificationEvidence: false,
			verificationCommands: [],
		}))
		result.score.should.be.below(90)
		result.findings.some((f: TaskEvaluationFinding) => f.code === "missing_verification").should.be.true()
	})

	it("should penalize multiple completion attempts", () => {
		const result = scoreTaskEvaluation(createMinimalSignals({ completionAttempts: 3 }))
		result.findings.some((f: TaskEvaluationFinding) => f.code === "multiple_completion_attempts").should.be.true()
	})

	it("should give failed grade for heavily penalized task", () => {
		const result = scoreTaskEvaluation(createMinimalSignals({
			completionAttempts: 0,
			hasVerificationEvidence: false,
			verificationCommands: [],
			failedToolCallCount: 5,
			modeViolationCount: 3,
			userFeedback: "thumbs_down",
			userProvidedFeedbackAfterCompletion: true,
		}))
		result.grade.should.equal("failed")
		result.needsFollowup.should.be.true()
	})

	it("should clamp score to 0-100 range", () => {
		const result = scoreTaskEvaluation(createMinimalSignals({
			completionAttempts: 0,
			hasVerificationEvidence: false,
			verificationCommands: [],
			failedToolCallCount: 10,
			rejectedToolCallCount: 10,
			modeViolationCount: 5,
			missingParamCount: 10,
			permissionDeniedCount: 10,
			sessionBudgetExhausted: true,
			consecutiveExplorationWarnings: 10,
			userProvidedFeedbackAfterCompletion: true,
			userFeedback: "thumbs_down",
			editToolCallCount: 20,
		}))
		result.score.should.be.aboveOrEqual(0)
		result.score.should.be.belowOrEqual(100)
	})
})

