import { describe, it } from "mocha"
import "should"
import { EvaluateTaskHandler } from "../EvaluateTaskHandler"
import { TaskEvaluationTracker } from "../../../evaluation/TaskEvaluationTracker"
import type { ToolUse } from "@core/assistant-message"

function createMockConfig(tracker: TaskEvaluationTracker): any {
	return {
		taskState: {
			evaluationTracker: tracker,
		},
	}
}

function createMockBlock(): ToolUse {
	return {
		type: "tool_use",
		name: "evaluate_task",
		id: "test-id",
		params: {},
		partial: false,
	}
}

describe("EvaluateTaskHandler", () => {
	let handler: EvaluateTaskHandler
	let tracker: TaskEvaluationTracker

	beforeEach(() => {
		handler = new EvaluateTaskHandler()
		tracker = new TaskEvaluationTracker()
		tracker.start({ taskId: "test-task-1", ulid: "ulid-1" })
	})

	it("should return error message when no evaluation available", async () => {
		const config = createMockConfig(tracker)
		const result = await handler.execute(config, createMockBlock())
			; (typeof result).should.equal("string")
			; (result as string).should.containEql("No evaluation data available")
	})

	it("should return evaluation report for a perfect task", async () => {
		tracker.recordToolUse({ toolName: "read_file", status: "success", result: "" })
		tracker.recordToolUse({ toolName: "write_to_file", status: "success", result: "" })
		tracker.recordToolUse({
			toolName: "execute_command",
			status: "success",
			params: { command: "npm run test" },
			result: "All tests passed",
		})
		tracker.recordCompletionAttempt()
		tracker.finalize()

		const config = createMockConfig(tracker)
		const result = await handler.execute(config, createMockBlock())

		const report = result as string
		report.should.containEql("TASK EVALUATION REPORT")
		report.should.containEql("Score:")
		report.should.containEql("/100")
		report.should.containEql("EXCELLENT")
		report.should.containEql("优秀")
	})

	it("should show findings for task with tool failures", async () => {
		tracker.recordToolUse({
			toolName: "write_to_file",
			status: "error",
			result: "Error: file not found",
		})
		tracker.recordToolUse({
			toolName: "write_to_file",
			status: "error",
			result: "Error: permission denied",
		})
		tracker.recordToolUse({
			toolName: "write_to_file",
			status: "error",
			result: "Error: still failing",
		})
		tracker.recordCompletionAttempt()
		tracker.finalize()

		const config = createMockConfig(tracker)
		const result = await handler.execute(config, createMockBlock())

		const report = result as string
		report.should.containEql("tool_failures")
		report.should.containEql("Failed: 3")
		report.should.containEql("missing_verification")
	})

	it("should show low score for heavily penalized task", async () => {
		tracker.recordToolUse({
			toolName: "write_to_file",
			status: "error",
			result: "Tool execution failed: error",
		})
		tracker.recordToolUse({
			toolName: "write_to_file",
			status: "error",
			result: "Tool execution failed: error",
		})
		tracker.recordModeViolation("write_to_file", "ask")
		tracker.recordModeViolation("execute_command", "ask")
		tracker.recordRepeatedFailureLoop()
		tracker.recordCompletionAttempt()
		tracker.recordCompletionAttempt()
		tracker.recordUserFeedbackAfterCompletion()
		tracker.finalize()

		const config = createMockConfig(tracker)
		const result = await handler.execute(config, createMockBlock())

		const report = result as string
		report.should.containEql("Needs Followup: YES")
		report.should.containEql("mode_violations")
		report.should.containEql("repeated_failure_loops")
		report.should.containEql("user_followup_after_completion")
		// Score should be low
		const scoreMatch = report.match(/Score: (\d+)\/100/)
		scoreMatch!.should.not.be.null()
		parseInt(scoreMatch![1]).should.be.below(60)
	})

	it("should include verification evidence section", async () => {
		tracker.recordToolUse({
			toolName: "execute_command",
			status: "success",
			params: { command: "npm run test" },
			result: "All 42 tests passed",
		})
		tracker.recordToolUse({
			toolName: "execute_command",
			status: "success",
			params: { command: "npm run lint" },
			result: "No errors",
		})
		tracker.recordCompletionAttempt()
		tracker.finalize()

		const config = createMockConfig(tracker)
		const result = await handler.execute(config, createMockBlock())

		const report = result as string
		report.should.containEql("Verification Evidence")
		report.should.containEql("[test]")
		report.should.containEql("[lint]")
		report.should.containEql("npm run test")
		report.should.containEql("✓")
	})

	it("should include optimization suggestion prompts", async () => {
		tracker.recordCompletionAttempt()
		tracker.finalize()

		const config = createMockConfig(tracker)
		const result = await handler.execute(config, createMockBlock())

		const report = result as string
		report.should.containEql("System Prompt 优化建议")
		report.should.containEql("Tool Handler 优化建议")
		report.should.containEql("工作流程建议")
		report.should.containEql("SystemPromptSettings.ts")
	})

	it("should have correct tool name", () => {
		handler.name.should.equal("evaluate_task")
	})

	it("should return correct description", () => {
		const desc = handler.getDescription(createMockBlock())
		desc.should.equal("[evaluate_task]")
	})
})
