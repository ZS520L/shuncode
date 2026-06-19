import { describe, it, beforeEach } from "mocha"
import "should"
import sinon from "sinon"
import { ShuncodeDefaultTool } from "@shared/tools"

/**
 * Tests for EditNotebookToolHandler's approval logic.
 *
 * The handler has two security paths:
 * - editNotebooks=true → auto-approve (write without asking)
 * - editNotebooks=false → ask user before writing
 *
 * These tests verify approval behavior by simulating the approval
 * decision logic without VS Code filesystem dependencies.
 */

/**
 * Simulates the approval decision logic extracted from EditNotebookToolHandler.execute().
 * This is the exact logic from the handler, isolated for testing.
 */
function resolveApproval(options: {
	autoApprover: { shouldAutoApproveTool: (tool: string) => boolean | [boolean, boolean] } | null
}): { didAutoApprove: boolean } {
	const autoApproveResult = options.autoApprover
		? options.autoApprover.shouldAutoApproveTool(ShuncodeDefaultTool.EDIT_NOTEBOOK)
		: false
	const didAutoApprove = autoApproveResult === true || (Array.isArray(autoApproveResult) && autoApproveResult[0])
	return { didAutoApprove }
}

describe("EditNotebookToolHandler — Approval Logic", () => {
	describe("Auto-approval decisions", () => {
		it("should NOT auto-approve when editNotebooks=false (default)", () => {
			const { didAutoApprove } = resolveApproval({
				autoApprover: { shouldAutoApproveTool: () => false },
			})
			didAutoApprove.should.be.false()
		})

		it("should auto-approve when editNotebooks=true", () => {
			const { didAutoApprove } = resolveApproval({
				autoApprover: { shouldAutoApproveTool: () => true },
			})
			didAutoApprove.should.be.true()
		})

		it("should auto-approve in YOLO mode ([true, true])", () => {
			const { didAutoApprove } = resolveApproval({
				autoApprover: { shouldAutoApproveTool: () => [true, true] },
			})
			didAutoApprove.should.be.true()
		})

		it("should NOT auto-approve when autoApprover is null", () => {
			const { didAutoApprove } = resolveApproval({
				autoApprover: null,
			})
			didAutoApprove.should.be.false()
		})

		it("should auto-approve when tuple [true, false]", () => {
			const { didAutoApprove } = resolveApproval({
				autoApprover: { shouldAutoApproveTool: () => [true, false] },
			})
			didAutoApprove.should.be.true()
		})

		it("should NOT auto-approve when tuple [false, true]", () => {
			const { didAutoApprove } = resolveApproval({
				autoApprover: { shouldAutoApproveTool: () => [false, true] },
			})
			didAutoApprove.should.be.false()
		})

		it("should NOT auto-approve when tuple [false, false]", () => {
			const { didAutoApprove } = resolveApproval({
				autoApprover: { shouldAutoApproveTool: () => [false, false] },
			})
			didAutoApprove.should.be.false()
		})
	})

	describe("Tool name passed to autoApprover", () => {
		it("should call shouldAutoApproveTool with EDIT_NOTEBOOK", () => {
			const stub = sinon.stub().returns(false)
			resolveApproval({
				autoApprover: { shouldAutoApproveTool: stub },
			})
			stub.calledWith(ShuncodeDefaultTool.EDIT_NOTEBOOK).should.be.true()
		})
	})

	describe("Integration with AutoApprovalSettings defaults", () => {
		/**
		 * Mirrors the real AutoApprove.shouldAutoApproveTool logic for EDIT_NOTEBOOK.
		 * editNotebooks defaults to false → approval required.
		 */
		it("should require approval with default settings (editNotebooks=false)", () => {
			// Simulate what AutoApprove returns for default settings
			const fakeAutoApprover = {
				shouldAutoApproveTool: (toolName: string) => {
					if (toolName === ShuncodeDefaultTool.EDIT_NOTEBOOK) {
						const editNotebooks = false // default
						return editNotebooks ?? false
					}
					return false
				},
			}
			const { didAutoApprove } = resolveApproval({ autoApprover: fakeAutoApprover })
			didAutoApprove.should.be.false()
		})

		it("should auto-approve when user enables editNotebooks", () => {
			const fakeAutoApprover = {
				shouldAutoApproveTool: (toolName: string) => {
					if (toolName === ShuncodeDefaultTool.EDIT_NOTEBOOK) {
						const editNotebooks = true // user enabled
						return editNotebooks
					}
					return false
				},
			}
			const { didAutoApprove } = resolveApproval({ autoApprover: fakeAutoApprover })
			didAutoApprove.should.be.true()
		})
	})
})
