import { Controller } from "@core/controller"
import { Empty, StringRequest } from "@shared/proto/shuncode/common"
import * as pathUtils from "@utils/path"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { Logger } from "@/shared/services/Logger"
import { openFileRelativePath } from "../openFileRelativePath"

describe("openFileRelativePath", () => {
	let sandbox: sinon.SinonSandbox
	let mockController: Controller
	let getWorkspacePathStub: sinon.SinonStub
	let consoleErrorStub: sinon.SinonStub

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		mockController = {} as any
		getWorkspacePathStub = sandbox.stub(pathUtils, "getWorkspacePath")
		consoleErrorStub = sandbox.stub(Logger, "error")
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should return Empty response on successful execution", async () => {
		getWorkspacePathStub.resolves("/workspace")

		const request = StringRequest.create({
			value: "src/test.ts",
		})

		const result = await openFileRelativePath(mockController, request)
		expect(result).to.deep.equal(Empty.create())
	})

	it("should not crash when relative path is provided", async () => {
		getWorkspacePathStub.resolves("/workspace")

		const request = StringRequest.create({
			value: "src/components/Test.tsx",
		})

		// Should not throw — function uses vscode.window.showTextDocument internally
		const result = await openFileRelativePath(mockController, request)
		expect(result).to.deep.equal(Empty.create())
	})

	it("should not call anything when path is invalid", async () => {
		getWorkspacePathStub.resolves("/workspace")

		const invalidPaths = ["", undefined]

		for (const invalidPath of invalidPaths) {
			const request = StringRequest.create({
				value: invalidPath,
			})

			const result = await openFileRelativePath(mockController, request)
			expect(result).to.deep.equal(Empty.create())
		}
	})

	it("should return Empty and log error when no workspace path is available", async () => {
		const noWorkspaceScenarios = [null, undefined]

		for (const workspaceValue of noWorkspaceScenarios) {
			getWorkspacePathStub.resolves(workspaceValue)
			consoleErrorStub.resetHistory()

			const request = StringRequest.create({
				value: "src/test.ts",
			})

			const result = await openFileRelativePath(mockController, request)

			expect(result).to.deep.equal(Empty.create())
			expect(consoleErrorStub.called).to.be.true
		}
	})

	it("should handle nested directory paths without error", async () => {
		getWorkspacePathStub.resolves("/workspace")

		const request = StringRequest.create({
			value: "src/components/ui/Button/Button.tsx",
		})

		const result = await openFileRelativePath(mockController, request)
		expect(result).to.deep.equal(Empty.create())
	})

	it("should handle path:lineNumber format", async () => {
		getWorkspacePathStub.resolves("/workspace")

		const request = StringRequest.create({
			value: "src/file.ts:42",
		})

		const result = await openFileRelativePath(mockController, request)
		expect(result).to.deep.equal(Empty.create())
	})
})
