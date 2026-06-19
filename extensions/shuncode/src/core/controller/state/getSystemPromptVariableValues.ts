import { PromptRegistry } from "@core/prompts/system-prompt"
import { String as StringResponse, EmptyRequest } from "@shared/proto/shuncode/common"
import { SYSTEM_PROMPT_VARIABLES } from "@shared/SystemPromptSettings"
import type { Controller } from ".."
import { buildSystemPromptPreviewContext } from "./systemPromptPreviewContext"

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
	return path.split(".").reduce<unknown>((current, key) => {
		return current && typeof current === "object" && current !== null ? (current as Record<string, unknown>)[key] : undefined
	}, obj)
}

function formatValue(value: unknown): string {
	if (value === undefined || value === null) {
		return ""
	}
	if (typeof value === "string") {
		return value
	}
	return JSON.stringify(value, null, 2)
}

export async function getSystemPromptVariableValues(controller: Controller, _request: EmptyRequest): Promise<StringResponse> {
	const context = await buildSystemPromptPreviewContext(controller)
	const now = new Date()
	const registry = PromptRegistry.getInstance()
	const values: Record<string, unknown> = {
		...context,
		agentName: "ShunCode AI",
		userName: "User",
		workspace: context.cwd,
		currentDateTime: now.toLocaleString(),
		currentDate: now.toLocaleDateString(),
		currentTime: now.toLocaleTimeString(),
		provider: context.providerInfo?.providerId,
		model: context.providerInfo?.model?.id,
		pinnedMemory: context.pinnedMemory || "",
		memory: context.pinnedMemory || "",
		mcpSettingsPath: context.mcpSettingsPath || "",
		supportsBrowser: context.supportsBrowserUse,
		modelFamily: registry.getModelFamily(context),
	}
	const result: Record<string, string> = {}

	for (const variable of SYSTEM_PROMPT_VARIABLES) {
		result[variable.name] = formatValue(getNestedValue(values, variable.name))
	}

	return StringResponse.create({ value: JSON.stringify(result) })
}
