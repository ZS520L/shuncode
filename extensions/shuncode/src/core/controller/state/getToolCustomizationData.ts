import { PromptRegistry, ShuncodeToolSet } from "@core/prompts/system-prompt"
import { mcpToolToShuncodeToolSpec } from "@core/prompts/system-prompt/registry/ShuncodeToolSet"
import { resolveInstruction, type ShuncodeToolSpec } from "@core/prompts/system-prompt/spec"
import { EmptyRequest, String as StringResponse } from "@shared/proto/shuncode/common"
import type { CustomizableToolInfo, ToolCustomizationData } from "@shared/ToolCustomizationSettings"
import type { Controller } from ".."
import { buildSystemPromptPreviewContext } from "./systemPromptPreviewContext"

function toToolInfo(
	tool: ShuncodeToolSpec,
	type: "builtin" | "mcp",
	context: Parameters<typeof resolveInstruction>[1],
	serverName?: string,
): CustomizableToolInfo {
	return {
		key: tool.name,
		name: tool.name || tool.id,
		id: tool.id,
		type,
		serverName,
		description: tool.description || "",
		parameters:
			tool.parameters?.map((parameter) => ({
				name: parameter.name,
				description:
					typeof parameter.instruction === "function"
						? parameter.instruction(context)
						: (parameter.instruction ?? parameter.description ?? ""),
				required: parameter.required ?? false,
			})) ?? [],
	}
}

export async function getToolCustomizationData(controller: Controller, _request: EmptyRequest): Promise<StringResponse> {
	const context = await buildSystemPromptPreviewContext(controller)
	const registry = PromptRegistry.getInstance()
	// ensure loaded
	const family = registry.getModelFamily(context as any)
	const variant = (registry as any).variants?.get(family)

	const builtinTools = ShuncodeToolSet.getAllTools().map((tool) => toToolInfo(tool.config, "builtin", context))

	const mcpServers = context.mcpHub?.getServers()?.filter((server) => server.disabled !== true) ?? []

	const mcpTools = mcpServers.flatMap((server) => {
		const specs = mcpToolToShuncodeToolSpec(family, server)
		return specs.map((spec) => toToolInfo(spec, "mcp", context, server.name))
	})

	const data: ToolCustomizationData = {
		settings: context.toolCustomizationSettings ?? { tools: {} },
		tools: [...builtinTools, ...mcpTools],
	}

	return StringResponse.create({ value: JSON.stringify(data) })
}
