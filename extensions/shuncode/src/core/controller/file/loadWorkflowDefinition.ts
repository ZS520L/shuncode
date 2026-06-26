import { StringRequest } from "@shared/proto/shuncode/common"
import { WorkflowDefinitionResponse } from "@shared/proto/shuncode/file"
import { parseWorkflowFile } from "@core/workflow/WorkflowParser"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

export async function loadWorkflowDefinition(
	_controller: Controller,
	request: StringRequest,
): Promise<WorkflowDefinitionResponse> {
	const filePath = request.value
	if (!filePath) {
		throw new Error("Missing file path")
	}

	try {
		const def = await parseWorkflowFile(filePath)
		return WorkflowDefinitionResponse.create({
			name: def.name,
			description: def.description || "",
			version: def.version,
			requiresInput: def.requiresInput,
			filePath,
			steps: def.steps.map((s) => ({
				name: s.name,
				prompt: s.prompt,
				enabled: s.enabled,
				visible: s.visible,
			})),
		})
	} catch (error) {
		Logger.error(`Failed to load workflow definition from ${filePath}:`, error)
		throw new Error(`Failed to load workflow: ${error instanceof Error ? error.message : String(error)}`)
	}
}
