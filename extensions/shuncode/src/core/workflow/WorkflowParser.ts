import * as yaml from "js-yaml"
import fs from "fs/promises"
import type { WorkflowDefinition, WorkflowStep } from "./types"

/**
 * Parse a .yaml workflow file into a WorkflowDefinition.
 * Validates structure and throws on invalid format.
 */
export async function parseWorkflowFile(filePath: string): Promise<WorkflowDefinition> {
	const content = await fs.readFile(filePath, "utf8")
	const parsed = yaml.load(content) as Record<string, unknown>

	if (!parsed || typeof parsed !== "object") {
		throw new Error(`Workflow file ${filePath}: invalid YAML`)
	}
	if (!parsed.name || typeof parsed.name !== "string") {
		throw new Error(`Workflow file ${filePath}: missing or invalid "name"`)
	}
	if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
		throw new Error(`Workflow file ${filePath}: missing or empty "steps"`)
	}

	const steps: WorkflowStep[] = (parsed.steps as any[]).map((step: any, index: number) => {
		if (!step.name || typeof step.name !== "string") {
			throw new Error(`Workflow file ${filePath}: step ${index} missing "name"`)
		}
		if (!step.prompt || typeof step.prompt !== "string") {
			throw new Error(`Workflow file ${filePath}: step ${index} missing "prompt"`)
		}
		return {
			name: step.name,
			prompt: step.prompt.trim(),
			enabled: step.enabled !== false,
			visible: step.visible !== false,
		}
	})

	return {
		name: parsed.name as string,
		description: (parsed.description as string) || undefined,
		icon: (parsed.icon as string) || undefined,
		version: (parsed.version as number) || 1,
		requiresInput: parsed.requiresInput !== false,
		steps,
	}
}

/**
 * Serialize a WorkflowDefinition to YAML and write to file.
 */
export async function saveWorkflowFile(filePath: string, definition: WorkflowDefinition): Promise<void> {
	const content = yaml.dump(definition, {
		lineWidth: -1,
		noRefs: true,
		quotingType: '"',
		forceQuotes: false,
	})
	await fs.writeFile(filePath, content, "utf8")
}

/**
 * Check if a file is a multi-step workflow (.yaml/.yml) vs legacy (.md).
 */
export function isMultiStepWorkflow(filePath: string): boolean {
	return filePath.endsWith(".yaml") || filePath.endsWith(".yml")
}

/**
 * Generate a YAML template for a new workflow.
 */
export function generateWorkflowTemplate(name: string): string {
	const definition: WorkflowDefinition = {
		name,
		description: "",
		version: 1,
		requiresInput: true,
		steps: [
			{
				name: "Step 1",
				enabled: true,
				visible: true,
				prompt: "Describe what the agent should do in this step.\n",
			},
			{
				name: "Step 2",
				enabled: true,
				visible: true,
				prompt: "Describe what the agent should do in this step.\n",
			},
		],
	}
	return yaml.dump(definition, {
		lineWidth: -1,
		noRefs: true,
		quotingType: '"',
		forceQuotes: false,
	})
}
