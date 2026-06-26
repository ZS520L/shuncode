import { describe, it, beforeEach, afterEach } from "mocha"
import "should"
import sinon from "sinon"
import { ShuncodeDefaultTool } from "@shared/tools"
import * as fsUtils from "@utils/fs"
import { DeleteFileToolHandler } from "../DeleteFileToolHandler"

/**
 * Tests for DeleteFileToolHandler's approval logic.
 *
 * We stub fileExistsAtPath to avoid real filesystem checks.
 * All 5 failing scenarios from v1 are fixed by mocking FS.
 *
 * Verifies:
 * - Auto-approval when deleteFiles=true (autoApprover returns true)
 * - Manual approval when deleteFiles=false (autoApprover returns false)
 * - User rejection returns toolDenied
 * - YOLO mode auto-approves ([true, true] from autoApprover)
 * - No autoApprover (null) always asks
 * - autoApprover is called with correct tool name
 */
describe("DeleteFileToolHandler", () => {
	let handler: DeleteFileToolHandler
	let fileExistsStub: sinon.SinonStub

	beforeEach(() => {
		handler = new DeleteFileToolHandler({
			assertRequiredParams: () => ({ ok: true }),
			checkShuncodeIgnorePath: () => ({ ok: true }),
		} as any)

		// Stub fileExistsAtPath to always return true (file exists)
		fileExistsStub = sinon.stub(fsUtils, "fileExistsAtPath").resolves(true)
	})

	afterEach(() => {
		sinon.restore()
	})

	function createMockConfig(options: {
		autoApproveResult: boolean | [boolean, boolean]
		userApproves?: boolean
	}) {
		const { autoApproveResult, userApproves = true } = options

		let askCalled = false
		let sayCalled = false

		const config: any = {
			ulid: "test-ulid",
			cwd: "/test",
			isMultiRootEnabled: false,
			autoApprover: {
				shouldAutoApproveTool: sinon.stub().returns(autoApproveResult),
			},
			autoApprovalSettings: {
				actions: {},
				enableNotifications: false,
			},
			api: {
				getModel: () => ({ id: "test-model" }),
			},
			services: {
				stateManager: {
					getApiConfiguration: () => ({ actModeApiProvider: "test-provider" }),
					getGlobalSettingsKey: (key: string) => {
						if (key === "mode") return "act"
						return undefined
					},
				},
			},
			taskState: {
				consecutiveMistakeCount: 0,
				userMessageContent: [],
			},
			callbacks: {
				say: async (type: string, message: string) => {
					sayCalled = true
				},
				ask: async (type: string, message: string) => {
					askCalled = true
					return {
						response: userApproves ? "yesButtonClicked" : "noButtonClicked",
					}
				},
				sayAndCreateMissingParamError: async () => "error",
				removeLastPartialMessageIfExistsWithType: async () => {},
			},
		}

		return {
			config,
			getAskCalled: () => askCalled,
			getSayCalled: () => sayCalled,
		}
	}

	function createBlock(filePath: string) {
		return {
			name: ShuncodeDefaultTool.FILE_DELETE,
			params: { path: filePath },
			partial: false,
			isNativeToolCall: false,
		} as any
	}

	describe("Approval Logic", () => {
		it("should auto-approve when deleteFiles=true (autoApprover returns true)", async () => {
			const { config, getAskCalled, getSayCalled } = createMockConfig({
				autoApproveResult: true,
			})

			await handler.execute(config, createBlock("test.txt"))
			getAskCalled().should.be.false()
			getSayCalled().should.be.true()
		})

		it("should ask for approval when deleteFiles=false (autoApprover returns false)", async () => {
			const { config, getAskCalled } = createMockConfig({
				autoApproveResult: false,
			})

			await handler.execute(config, createBlock("test.txt"))
			getAskCalled().should.be.true()
		})

		it("should auto-approve in YOLO mode (autoApprover returns [true, true])", async () => {
			const { config, getAskCalled, getSayCalled } = createMockConfig({
				autoApproveResult: [true, true],
			})

			await handler.execute(config, createBlock("test.txt"))
			getAskCalled().should.be.false()
			getSayCalled().should.be.true()
		})

		it("should ask when autoApprover is null", async () => {
			const { config, getAskCalled } = createMockConfig({
				autoApproveResult: false,
			})
			config.autoApprover = null

			await handler.execute(config, createBlock("test.txt"))
			getAskCalled().should.be.true()
		})
	})

	describe("User Rejection", () => {
		it("should return toolDenied when user rejects deletion", async () => {
			const { config } = createMockConfig({
				autoApproveResult: false,
				userApproves: false,
			})

			const result = await handler.execute(config, createBlock("important-file.ts"))
			String(result).should.equal("The user denied this operation.")
		})

		it("should handle user providing feedback with rejection", async () => {
			const { config } = createMockConfig({
				autoApproveResult: false,
			})
			config.taskState.userMessageContent = []
			config.callbacks.ask = async () => ({
				response: "messageResponse",
				text: "Don't delete that file",
			})

			const result = await handler.execute(config, createBlock("important-file.ts"))
			String(result).should.equal("The user denied this operation.")
		})
	})

	describe("Missing Parameters", () => {
		it("should return error when path is missing", async () => {
			const { config } = createMockConfig({ autoApproveResult: false })

			const block = {
				name: ShuncodeDefaultTool.FILE_DELETE,
				params: {},
				partial: false,
			} as any

			await handler.execute(config, block)
			config.taskState.consecutiveMistakeCount.should.equal(1)
		})
	})

	describe("autoApprover called correctly", () => {
		it("should call shouldAutoApproveTool with FILE_DELETE", async () => {
			const { config } = createMockConfig({ autoApproveResult: true })

			await handler.execute(config, createBlock("test.txt"))
			config.autoApprover.shouldAutoApproveTool.calledWith(ShuncodeDefaultTool.FILE_DELETE).should.be.true()
		})
	})

	describe("File does not exist", () => {
		it("should return error when file does not exist", async () => {
			fileExistsStub.resolves(false)

			const { config } = createMockConfig({ autoApproveResult: true })
			const result = await handler.execute(config, createBlock("nonexistent.txt"))
			String(result).should.containEql("File does not exist")
		})
	})
})
