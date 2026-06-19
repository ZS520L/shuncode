import { describe, it, beforeEach } from "mocha"
import "should"
import sinon from "sinon"
import { WorkflowOrchestrator, type WorkflowCapableTask } from "../WorkflowOrchestrator"
import type { WorkflowDefinition } from "../types"

function makeTask(overrides: Partial<WorkflowCapableTask> = {}): WorkflowCapableTask {
	return {
		getUlid: () => "test-ulid-001",
		isAborted: () => false,
		initiateStepLoop: sinon.stub().resolves(),
		sayTaskProgress: sinon.stub().resolves(),
		sayWorkflowStepStart: sinon.stub().resolves(),
		setSilentStep: sinon.stub(),
		...overrides,
	}
}

function makeDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
	return {
		name: "Test Workflow",
		version: 1,
		requiresInput: true,
		steps: [
			{ name: "Step A", prompt: "Do A", enabled: true, visible: true },
			{ name: "Step B", prompt: "Do B", enabled: true, visible: true },
		],
		...overrides,
	}
}

describe("WorkflowOrchestrator", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("execute", () => {
		it("should execute all enabled steps sequentially", async () => {
			const task = makeTask()
			const def = makeDefinition()
			const orchestrator = new WorkflowOrchestrator(task, def, "user input", "/path/to/wf.yaml")

			await orchestrator.execute()

			const state = orchestrator.getExecutionState()
			state.overallStatus.should.equal("completed")
			state.stepStatuses.should.deepEqual(["completed", "completed"])
			;(task.initiateStepLoop as sinon.SinonStub).callCount.should.equal(2)
		})

		it("should pass step prompts with workflow context", async () => {
			const task = makeTask()
			const def = makeDefinition()
			const orchestrator = new WorkflowOrchestrator(task, def, "deploy everything", "/wf.yaml")

			await orchestrator.execute()

			const stub = task.initiateStepLoop as sinon.SinonStub
			const firstCallArg = stub.firstCall.args[0][0].text as string
			firstCallArg.should.match(/workflow_step/)
			firstCallArg.should.match(/Do A/)
			firstCallArg.should.match(/step="1"/)
			firstCallArg.should.match(/deploy everything/)
		})

		it("should emit workflow_step_start for each step", async () => {
			const task = makeTask()
			const def = makeDefinition()
			const orchestrator = new WorkflowOrchestrator(task, def, "", "")

			await orchestrator.execute()

			const stub = task.sayWorkflowStepStart as sinon.SinonStub
			stub.callCount.should.equal(2)

			stub.firstCall.args[0].stepName.should.equal("Step A")
			stub.firstCall.args[0].stepIndex.should.equal(0)
			stub.firstCall.args[0].totalSteps.should.equal(2)

			stub.secondCall.args[0].stepName.should.equal("Step B")
			stub.secondCall.args[0].stepIndex.should.equal(1)
		})

		it("should emit progress updates", async () => {
			const task = makeTask()
			const def = makeDefinition()
			const orchestrator = new WorkflowOrchestrator(task, def, "", "")

			await orchestrator.execute()

			const stub = task.sayTaskProgress as sinon.SinonStub
			// Initial + per-step-start + per-step-end + final
			stub.callCount.should.be.greaterThan(3)
		})

		it("should set silent mode for invisible steps", async () => {
			const task = makeTask()
			const def = makeDefinition({
				steps: [
					{ name: "Loud", prompt: "P1", enabled: true, visible: true },
					{ name: "Quiet", prompt: "P2", enabled: true, visible: false },
				],
			})
			const orchestrator = new WorkflowOrchestrator(task, def, "", "")

			await orchestrator.execute()

			const stub = task.setSilentStep as sinon.SinonStub
			// Step 1: setSilentStep(false) before, then setSilentStep(false) in finally
			// Step 2: setSilentStep(true) before, then setSilentStep(false) in finally
			const calls = stub.getCalls().map((c) => c.args[0])
			calls.should.containEql(true)

			// Last call should always reset to false
			calls[calls.length - 1].should.be.false()
		})
	})

	describe("skip disabled steps", () => {
		it("should skip disabled steps and mark them as skipped", async () => {
			const task = makeTask()
			const def = makeDefinition({
				steps: [
					{ name: "Active", prompt: "Do it", enabled: true, visible: true },
					{ name: "Disabled", prompt: "Skip me", enabled: false, visible: true },
					{ name: "Also Active", prompt: "Do it too", enabled: true, visible: true },
				],
			})
			const orchestrator = new WorkflowOrchestrator(task, def, "", "")

			await orchestrator.execute()

			const state = orchestrator.getExecutionState()
			state.overallStatus.should.equal("completed")
			state.stepStatuses.should.deepEqual(["completed", "skipped", "completed"])
			;(task.initiateStepLoop as sinon.SinonStub).callCount.should.equal(2)
		})

		it("should complete immediately when all steps are disabled", async () => {
			const task = makeTask()
			const def = makeDefinition({
				steps: [
					{ name: "Off1", prompt: "P1", enabled: false, visible: true },
					{ name: "Off2", prompt: "P2", enabled: false, visible: true },
				],
			})
			const orchestrator = new WorkflowOrchestrator(task, def, "", "")

			await orchestrator.execute()

			const state = orchestrator.getExecutionState()
			state.overallStatus.should.equal("completed")
			;(task.initiateStepLoop as sinon.SinonStub).callCount.should.equal(0)
		})
	})

	describe("abort handling", () => {
		it("should stop execution when task is aborted mid-workflow", async () => {
			let callCount = 0
			const task = makeTask({
				isAborted: () => callCount > 0,
				initiateStepLoop: sinon.stub().callsFake(async () => {
					callCount++
				}),
			})
			const def = makeDefinition({
				steps: [
					{ name: "S1", prompt: "P1", enabled: true, visible: true },
					{ name: "S2", prompt: "P2", enabled: true, visible: true },
					{ name: "S3", prompt: "P3", enabled: true, visible: true },
				],
			})
			const orchestrator = new WorkflowOrchestrator(task, def, "", "")

			await orchestrator.execute()

			const state = orchestrator.getExecutionState()
			state.overallStatus.should.equal("cancelled")
			// S1 ran, abort detected after initiateStepLoop → marked failed
			state.stepStatuses[0].should.equal("failed")
		})

		it("should cancel if aborted before first step runs", async () => {
			const task = makeTask({ isAborted: () => true })
			const def = makeDefinition()
			const orchestrator = new WorkflowOrchestrator(task, def, "", "")

			await orchestrator.execute()

			const state = orchestrator.getExecutionState()
			state.overallStatus.should.equal("cancelled")
			;(task.initiateStepLoop as sinon.SinonStub).callCount.should.equal(0)
		})
	})

	describe("error handling", () => {
		it("should mark step as failed and stop on error", async () => {
			const task = makeTask({
				initiateStepLoop: sinon
					.stub()
					.onFirstCall()
					.resolves()
					.onSecondCall()
					.rejects(new Error("Agent crashed")),
			})
			const def = makeDefinition({
				steps: [
					{ name: "OK", prompt: "Fine", enabled: true, visible: true },
					{ name: "Bad", prompt: "Crash", enabled: true, visible: true },
					{ name: "Never", prompt: "Unreachable", enabled: true, visible: true },
				],
			})
			const orchestrator = new WorkflowOrchestrator(task, def, "", "")

			await orchestrator.execute()

			const state = orchestrator.getExecutionState()
			state.overallStatus.should.equal("failed")
			state.stepStatuses[0].should.equal("completed")
			state.stepStatuses[1].should.equal("failed")
			state.stepStatuses[2].should.equal("pending")
		})

		it("should reset silent mode even when step fails", async () => {
			const task = makeTask({
				initiateStepLoop: sinon.stub().rejects(new Error("Boom")),
			})
			const def = makeDefinition({
				steps: [{ name: "Failing", prompt: "Fail", enabled: true, visible: false }],
			})
			const orchestrator = new WorkflowOrchestrator(task, def, "", "")

			await orchestrator.execute()

			const stub = task.setSilentStep as sinon.SinonStub
			const lastCall = stub.lastCall.args[0]
			lastCall.should.be.false()
		})
	})

	describe("execution state", () => {
		it("should initialize with correct state", () => {
			const task = makeTask()
			const def = makeDefinition()
			const orchestrator = new WorkflowOrchestrator(task, def, "input text", "/wf.yaml")

			const state = orchestrator.getExecutionState()
			state.executionId.should.equal("test-ulid-001")
			state.definition.should.equal(def)
			state.userInput.should.equal("input text")
			state.overallStatus.should.equal("running")
			state.currentStepIndex.should.equal(0)
			state.stepStatuses.should.deepEqual(["pending", "pending"])
		})

		it("should track step timings", async () => {
			const task = makeTask({
				initiateStepLoop: sinon.stub().callsFake(async () => {
					await new Promise((r) => setTimeout(r, 10))
				}),
			})
			const def = makeDefinition({
				steps: [{ name: "Timed", prompt: "P", enabled: true, visible: true }],
			})
			const orchestrator = new WorkflowOrchestrator(task, def, "", "")

			await orchestrator.execute()

			const state = orchestrator.getExecutionState()
			const timing = state.stepTimings[0]
			timing.startedAt!.should.be.a.Number()
			timing.completedAt!.should.be.a.Number()
			;(timing.completedAt! - timing.startedAt!).should.be.greaterThanOrEqual(5)
		})
	})

	describe("progress text", () => {
		it("should produce checklist-format progress", async () => {
			const progressTexts: string[] = []
			const task = makeTask({
				sayTaskProgress: sinon.stub().callsFake(async (text: string) => {
					progressTexts.push(text)
				}),
			})
			const def = makeDefinition()
			const orchestrator = new WorkflowOrchestrator(task, def, "", "")

			await orchestrator.execute()

			const lastProgress = progressTexts[progressTexts.length - 1]
			lastProgress.should.match(/\[x\] Step A/)
			lastProgress.should.match(/\[x\] Step B/)
		})
	})
})
