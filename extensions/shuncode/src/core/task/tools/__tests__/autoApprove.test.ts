import { describe, it } from "mocha"
import "should"
import { AutoApprove } from "../autoApprove"
import { ShuncodeDefaultTool } from "@shared/tools"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"

/**
 * Tests for AutoApprove.shouldAutoApproveTool().
 *
 * Verifies:
 * - YOLO mode returns [true, true] or true for every tool
 * - FILE_DELETE returns boolean (not tuple) based on deleteFiles setting
 * - EDIT_NOTEBOOK returns boolean (not tuple) based on editNotebooks setting
 * - BASH returns [executeSafeCommands, executeAllCommands] tuple
 * - Other tools return expected types and values
 * - Default settings produce expected behavior
 */
describe("AutoApprove.shouldAutoApproveTool", () => {
	function createAutoApprove(options: {
		yoloMode?: boolean
		settings?: Partial<typeof DEFAULT_AUTO_APPROVAL_SETTINGS.actions>
	}): AutoApprove {
		const { yoloMode = false, settings = {} } = options

		const mergedActions = { ...DEFAULT_AUTO_APPROVAL_SETTINGS.actions, ...settings }

		const fakeStateManager = {
			getGlobalSettingsKey: (key: string) => {
				if (key === "yoloModeToggled") return yoloMode
				if (key === "autoApprovalSettings") {
					return {
						...DEFAULT_AUTO_APPROVAL_SETTINGS,
						actions: mergedActions,
					}
				}
				return undefined
			},
		} as any

		return new AutoApprove(fakeStateManager)
	}

	// ==================== YOLO mode ====================

	describe("YOLO mode", () => {
		it("should return [true, true] for FILE_DELETE in YOLO mode", () => {
			const aa = createAutoApprove({ yoloMode: true })
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.FILE_DELETE)
			result.should.deepEqual([true, true])
		})

		it("should return [true, true] for EDIT_NOTEBOOK in YOLO mode", () => {
			const aa = createAutoApprove({ yoloMode: true })
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.EDIT_NOTEBOOK)
			result.should.deepEqual([true, true])
		})

		it("should return [true, true] for BASH in YOLO mode", () => {
			const aa = createAutoApprove({ yoloMode: true })
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.BASH)
			result.should.deepEqual([true, true])
		})

		it("should return true for BROWSER in YOLO mode", () => {
			const aa = createAutoApprove({ yoloMode: true })
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.BROWSER)
			result.should.equal(true)
		})

		it("should return true for MCP_USE in YOLO mode", () => {
			const aa = createAutoApprove({ yoloMode: true })
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.MCP_USE)
			result.should.equal(true)
		})

		it("should return [true, true] for FILE_READ in YOLO mode", () => {
			const aa = createAutoApprove({ yoloMode: true })
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.FILE_READ)
			result.should.deepEqual([true, true])
		})
	})

	// ==================== FILE_DELETE ====================

	describe("FILE_DELETE", () => {
		it("should return false when deleteFiles is false (default)", () => {
			const aa = createAutoApprove({ settings: { deleteFiles: false } })
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.FILE_DELETE)
			result.should.equal(false)
		})

		it("should return true when deleteFiles is true", () => {
			const aa = createAutoApprove({ settings: { deleteFiles: true } })
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.FILE_DELETE)
			result.should.equal(true)
		})

		it("should return false when deleteFiles is undefined", () => {
			const aa = createAutoApprove({ settings: {} })
			// Default is false
			const fakeStateManager = {
				getGlobalSettingsKey: (key: string) => {
					if (key === "yoloModeToggled") return false
					if (key === "autoApprovalSettings") {
						return {
							...DEFAULT_AUTO_APPROVAL_SETTINGS,
							actions: {
								...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
								deleteFiles: undefined,
							},
						}
					}
					return undefined
				},
			} as any
			const aa2 = new AutoApprove(fakeStateManager)
			const result = aa2.shouldAutoApproveTool(ShuncodeDefaultTool.FILE_DELETE)
			result.should.equal(false)
		})

		it("should return boolean, not tuple", () => {
			const aa = createAutoApprove({ settings: { deleteFiles: true } })
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.FILE_DELETE)
			// Must be boolean, not array
			Array.isArray(result).should.be.false()
		})
	})

	// ==================== EDIT_NOTEBOOK ====================

	describe("EDIT_NOTEBOOK", () => {
		it("should return false when editNotebooks is false (default)", () => {
			const aa = createAutoApprove({ settings: { editNotebooks: false } })
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.EDIT_NOTEBOOK)
			result.should.equal(false)
		})

		it("should return true when editNotebooks is true", () => {
			const aa = createAutoApprove({ settings: { editNotebooks: true } })
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.EDIT_NOTEBOOK)
			result.should.equal(true)
		})

		it("should return false when editNotebooks is undefined", () => {
			const fakeStateManager = {
				getGlobalSettingsKey: (key: string) => {
					if (key === "yoloModeToggled") return false
					if (key === "autoApprovalSettings") {
						return {
							...DEFAULT_AUTO_APPROVAL_SETTINGS,
							actions: {
								...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
								editNotebooks: undefined,
							},
						}
					}
					return undefined
				},
			} as any
			const aa = new AutoApprove(fakeStateManager)
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.EDIT_NOTEBOOK)
			result.should.equal(false)
		})

		it("should return boolean, not tuple", () => {
			const aa = createAutoApprove({ settings: { editNotebooks: true } })
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.EDIT_NOTEBOOK)
			Array.isArray(result).should.be.false()
		})

		it("should NOT be grouped with FILE_EDIT anymore", () => {
			// editNotebooks=false but editFiles=true — EDIT_NOTEBOOK must still be false
			const aa = createAutoApprove({ settings: { editFiles: true, editNotebooks: false } })
			const notebookResult = aa.shouldAutoApproveTool(ShuncodeDefaultTool.EDIT_NOTEBOOK)
			notebookResult.should.equal(false)

			// FILE_EDIT should be true (separate setting)
			const editResult = aa.shouldAutoApproveTool(ShuncodeDefaultTool.FILE_EDIT)
			Array.isArray(editResult).should.be.true()
			;(editResult as [boolean, boolean])[0].should.equal(true)
		})
	})

	// ==================== BASH ====================

	describe("BASH", () => {
		it("should return [false, false] when both settings off", () => {
			const aa = createAutoApprove({
				settings: { executeSafeCommands: false, executeAllCommands: false },
			})
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.BASH)
			result.should.deepEqual([false, false])
		})

		it("should return [true, false] when only executeSafeCommands on", () => {
			const aa = createAutoApprove({
				settings: { executeSafeCommands: true, executeAllCommands: false },
			})
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.BASH)
			result.should.deepEqual([true, false])
		})

		it("should return [true, true] when both settings on", () => {
			const aa = createAutoApprove({
				settings: { executeSafeCommands: true, executeAllCommands: true },
			})
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.BASH)
			result.should.deepEqual([true, true])
		})

		it("should always return tuple", () => {
			const aa = createAutoApprove({ settings: {} })
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.BASH)
			Array.isArray(result).should.be.true()
		})
	})

	// ==================== Other tools (sanity checks) ====================

	describe("Other tools", () => {
		it("should return tuple for FILE_READ", () => {
			const aa = createAutoApprove({})
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.FILE_READ)
			Array.isArray(result).should.be.true()
		})

		it("should return tuple for APPLY_PATCH", () => {
			const aa = createAutoApprove({})
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.APPLY_PATCH)
			Array.isArray(result).should.be.true()
		})

		it("should return boolean for BROWSER", () => {
			const aa = createAutoApprove({})
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.BROWSER)
			;(typeof result === "boolean").should.be.true()
		})

		it("should return boolean for MCP_USE", () => {
			const aa = createAutoApprove({})
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.MCP_USE)
			;(typeof result === "boolean").should.be.true()
		})
	})

	// ==================== Default settings ====================

	describe("Default settings behavior", () => {
		it("deleteFiles defaults to false — deletion requires approval", () => {
			const aa = createAutoApprove({})
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.FILE_DELETE)
			result.should.equal(false)
		})

		it("editNotebooks defaults to false — notebook editing requires approval", () => {
			const aa = createAutoApprove({})
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.EDIT_NOTEBOOK)
			result.should.equal(false)
		})

		it("executeSafeCommands defaults to true — safe commands auto-approved", () => {
			const aa = createAutoApprove({})
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.BASH)
			;(result as [boolean, boolean])[0].should.equal(true)
		})

		it("executeAllCommands defaults to false — unsafe commands require approval", () => {
			const aa = createAutoApprove({})
			const result = aa.shouldAutoApproveTool(ShuncodeDefaultTool.BASH)
			;(result as [boolean, boolean])[1].should.equal(false)
		})

		it("useBrowser defaults to true", () => {
			const aa = createAutoApprove({})
			aa.shouldAutoApproveTool(ShuncodeDefaultTool.BROWSER).should.equal(true)
		})

		it("useMcp defaults to true", () => {
			const aa = createAutoApprove({})
			aa.shouldAutoApproveTool(ShuncodeDefaultTool.MCP_USE).should.equal(true)
		})
	})
})
