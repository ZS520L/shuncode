import { describe, it, beforeEach, afterEach } from "mocha"
import "should"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { parseWorkflowFile, saveWorkflowFile, isMultiStepWorkflow, generateWorkflowTemplate } from "../WorkflowParser"
import type { WorkflowDefinition } from "../types"

describe("WorkflowParser", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = path.join(os.tmpdir(), `workflow-parser-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir, { recursive: true })
	})

	afterEach(async () => {
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch {}
	})

	describe("parseWorkflowFile", () => {
		it("should parse a valid workflow YAML", async () => {
			const filePath = path.join(tempDir, "test.yaml")
			await fs.writeFile(
				filePath,
				`name: Deploy
description: Deployment workflow
version: 2
requiresInput: false
steps:
  - name: Build
    prompt: Run the build
    enabled: true
    visible: true
  - name: Test
    prompt: Run tests
    enabled: false
    visible: false
`,
			)

			const def = await parseWorkflowFile(filePath)

			def.name.should.equal("Deploy")
			def.description!.should.equal("Deployment workflow")
			def.version.should.equal(2)
			def.requiresInput.should.be.false()
			def.steps.should.have.length(2)

			def.steps[0].name.should.equal("Build")
			def.steps[0].prompt.should.equal("Run the build")
			def.steps[0].enabled.should.be.true()
			def.steps[0].visible.should.be.true()

			def.steps[1].name.should.equal("Test")
			def.steps[1].prompt.should.equal("Run tests")
			def.steps[1].enabled.should.be.false()
			def.steps[1].visible.should.be.false()
		})

		it("should default enabled and visible to true when omitted", async () => {
			const filePath = path.join(tempDir, "defaults.yaml")
			await fs.writeFile(
				filePath,
				`name: Minimal
steps:
  - name: Only step
    prompt: Do something
`,
			)

			const def = await parseWorkflowFile(filePath)

			def.steps[0].enabled.should.be.true()
			def.steps[0].visible.should.be.true()
			def.requiresInput.should.be.true()
			def.version.should.equal(1)
		})

		it("should trim step prompts", async () => {
			const filePath = path.join(tempDir, "trim.yaml")
			await fs.writeFile(
				filePath,
				`name: Trim
steps:
  - name: Step
    prompt: "  lots of whitespace   "
`,
			)

			const def = await parseWorkflowFile(filePath)
			def.steps[0].prompt.should.equal("lots of whitespace")
		})

		it("should support Cyrillic names", async () => {
			const filePath = path.join(tempDir, "cyrillic.yaml")
			await fs.writeFile(
				filePath,
				`name: Деплой
description: Рабочий процесс
steps:
  - name: Сборка
    prompt: Собери проект
`,
			)

			const def = await parseWorkflowFile(filePath)
			def.name.should.equal("Деплой")
			def.steps[0].name.should.equal("Сборка")
		})

		it("should throw on invalid YAML content", async () => {
			const filePath = path.join(tempDir, "bad.yaml")
			await fs.writeFile(filePath, "not: [valid: yaml: content")

			try {
				await parseWorkflowFile(filePath)
				throw new Error("Should have thrown")
			} catch (err: any) {
				err.message.should.be.a.String()
				err.message.length.should.be.greaterThan(0)
			}
		})

		it("should throw when name is missing", async () => {
			const filePath = path.join(tempDir, "noname.yaml")
			await fs.writeFile(
				filePath,
				`steps:
  - name: A
    prompt: Do A
`,
			)

			try {
				await parseWorkflowFile(filePath)
				throw new Error("Should have thrown")
			} catch (err: any) {
				err.message.should.match(/missing or invalid "name"/)
			}
		})

		it("should throw when steps is empty", async () => {
			const filePath = path.join(tempDir, "empty-steps.yaml")
			await fs.writeFile(
				filePath,
				`name: Empty
steps: []
`,
			)

			try {
				await parseWorkflowFile(filePath)
				throw new Error("Should have thrown")
			} catch (err: any) {
				err.message.should.match(/missing or empty "steps"/)
			}
		})

		it("should throw when steps is missing", async () => {
			const filePath = path.join(tempDir, "no-steps.yaml")
			await fs.writeFile(filePath, `name: NoSteps\n`)

			try {
				await parseWorkflowFile(filePath)
				throw new Error("Should have thrown")
			} catch (err: any) {
				err.message.should.match(/missing or empty "steps"/)
			}
		})

		it("should throw when a step is missing name", async () => {
			const filePath = path.join(tempDir, "no-step-name.yaml")
			await fs.writeFile(
				filePath,
				`name: Bad
steps:
  - prompt: Do something
`,
			)

			try {
				await parseWorkflowFile(filePath)
				throw new Error("Should have thrown")
			} catch (err: any) {
				err.message.should.match(/step 0 missing "name"/)
			}
		})

		it("should throw when a step is missing prompt", async () => {
			const filePath = path.join(tempDir, "no-step-prompt.yaml")
			await fs.writeFile(
				filePath,
				`name: Bad
steps:
  - name: Step1
`,
			)

			try {
				await parseWorkflowFile(filePath)
				throw new Error("Should have thrown")
			} catch (err: any) {
				err.message.should.match(/step 0 missing "prompt"/)
			}
		})
	})

	describe("saveWorkflowFile", () => {
		it("should write a valid YAML file that can be re-parsed", async () => {
			const filePath = path.join(tempDir, "roundtrip.yaml")
			const definition: WorkflowDefinition = {
				name: "Roundtrip",
				description: "Test roundtrip",
				version: 1,
				requiresInput: true,
				steps: [
					{ name: "Alpha", prompt: "Do alpha", enabled: true, visible: true },
					{ name: "Beta", prompt: "Do beta", enabled: false, visible: false },
				],
			}

			await saveWorkflowFile(filePath, definition)
			const reparsed = await parseWorkflowFile(filePath)

			reparsed.name.should.equal("Roundtrip")
			reparsed.description!.should.equal("Test roundtrip")
			reparsed.steps.should.have.length(2)
			reparsed.steps[0].name.should.equal("Alpha")
			reparsed.steps[0].enabled.should.be.true()
			reparsed.steps[1].name.should.equal("Beta")
			reparsed.steps[1].enabled.should.be.false()
		})

		it("should overwrite an existing file", async () => {
			const filePath = path.join(tempDir, "overwrite.yaml")
			const def1: WorkflowDefinition = {
				name: "V1",
				version: 1,
				requiresInput: true,
				steps: [{ name: "S1", prompt: "P1", enabled: true, visible: true }],
			}
			const def2: WorkflowDefinition = {
				name: "V2",
				version: 2,
				requiresInput: false,
				steps: [{ name: "S2", prompt: "P2", enabled: true, visible: true }],
			}

			await saveWorkflowFile(filePath, def1)
			await saveWorkflowFile(filePath, def2)
			const reparsed = await parseWorkflowFile(filePath)

			reparsed.name.should.equal("V2")
			reparsed.version.should.equal(2)
		})
	})

	describe("isMultiStepWorkflow", () => {
		it("should return true for .yaml files", () => {
			isMultiStepWorkflow("deploy.yaml").should.be.true()
		})

		it("should return true for .yml files", () => {
			isMultiStepWorkflow("deploy.yml").should.be.true()
		})

		it("should return false for .md files", () => {
			isMultiStepWorkflow("workflow.md").should.be.false()
		})

		it("should return false for .txt files", () => {
			isMultiStepWorkflow("workflow.txt").should.be.false()
		})

		it("should handle full paths", () => {
			isMultiStepWorkflow("/home/user/.shuncoderules/workflows/deploy.yaml").should.be.true()
			isMultiStepWorkflow("C:\\Users\\test\\.shuncoderules\\workflows\\old.md").should.be.false()
		})
	})

	describe("generateWorkflowTemplate", () => {
		it("should produce valid YAML that can be parsed", async () => {
			const yamlContent = generateWorkflowTemplate("My Workflow")
			const filePath = path.join(tempDir, "template.yaml")
			await fs.writeFile(filePath, yamlContent)

			const def = await parseWorkflowFile(filePath)
			def.name.should.equal("My Workflow")
			def.steps.should.have.length(2)
			def.steps[0].name.should.equal("Step 1")
			def.steps[1].name.should.equal("Step 2")
			def.requiresInput.should.be.true()
		})

		it("should support Cyrillic workflow names", async () => {
			const yamlContent = generateWorkflowTemplate("Деплой")
			const filePath = path.join(tempDir, "cyrillic-template.yaml")
			await fs.writeFile(filePath, yamlContent)

			const def = await parseWorkflowFile(filePath)
			def.name.should.equal("Деплой")
		})
	})
})
