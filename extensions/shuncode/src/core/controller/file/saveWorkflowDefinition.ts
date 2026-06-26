import { Empty } from "@shared/proto/shuncode/common"
import { SaveWorkflowDefinitionRequest } from "@shared/proto/shuncode/file"
import { saveWorkflowFile } from "@core/workflow/WorkflowParser"
import type { WorkflowDefinition } from "@core/workflow/types"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

export async function saveWorkflowDefinition(_controller: Controller, request: SaveWorkflowDefinitionRequest): Promise<Empty> {
	const filePath = request.filePath
	if (!filePath) {
		throw new Error("Missing file path")
	}

	const definition: WorkflowDefinition = {
		name: request.name,
		description: request.description || undefined,
		version: request.version || 1,
		requiresInput: request.requiresInput,
		steps: (request.steps || []).map((s) => ({
			name: s.name,
			prompt: s.prompt,
			enabled: s.enabled,
			visible: s.visible,
		})),
	}

	try {
		await saveWorkflowFile(filePath, definition)
	} catch (error) {
		Logger.error(`Failed to save workflow definition to ${filePath}:`, error)
		throw new Error(`Failed to save workflow: ${error instanceof Error ? error.message : String(error)}`)
	}

	return Empty.create()
}
