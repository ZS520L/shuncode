import { SHUNCODE_MCP_TOOL_IDENTIFIER, McpServer } from "@/shared/mcp"
import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import { type ShuncodeToolSpec, toolSpecFunctionDeclarations, toolSpecFunctionDefinition, toolSpecInputSchema } from "../spec"
import { PromptVariant, SystemPromptContext } from "../types"

/**
 * Tools that must be hidden from the system prompt in Ask mode (read-only).
 * If the model doesn't see them, it won't try to call them.
 */
const ASK_MODE_HIDDEN_TOOLS: ReadonlySet<string> = new Set([
	ShuncodeDefaultTool.FILE_NEW,
	ShuncodeDefaultTool.FILE_EDIT,
	ShuncodeDefaultTool.NEW_RULE,
	ShuncodeDefaultTool.APPLY_PATCH,
	ShuncodeDefaultTool.EDIT_NOTEBOOK,
	ShuncodeDefaultTool.BASH,
	ShuncodeDefaultTool.BROWSER,
	ShuncodeDefaultTool.MCP_USE,
	ShuncodeDefaultTool.MCP_ACCESS,
	ShuncodeDefaultTool.MCP_DOCS,
	ShuncodeDefaultTool.FILE_DELETE,
])

export class ShuncodeToolSet {
	// A list of tools mapped by model group
	private static variants: Map<ModelFamily, Set<ShuncodeToolSet>> = new Map()

	private constructor(
		public readonly id: string,
		public readonly config: ShuncodeToolSpec,
	) {
		this._register()
	}

	public static register(config: ShuncodeToolSpec): ShuncodeToolSet {
		return new ShuncodeToolSet(config.id, config)
	}

	private _register(): void {
		const existingTools = ShuncodeToolSet.variants.get(this.config.variant) || new Set()
		if (!Array.from(existingTools).some((t) => t.config.id === this.config.id)) {
			existingTools.add(this)
			ShuncodeToolSet.variants.set(this.config.variant, existingTools)
		}
	}

	public static getTools(variant: ModelFamily): ShuncodeToolSet[] {
		const toolsSet = ShuncodeToolSet.variants.get(variant) || new Set()
		const defaultSet = ShuncodeToolSet.variants.get(ModelFamily.GENERIC) || new Set()

		return toolsSet ? Array.from(toolsSet) : Array.from(defaultSet)
	}

	public static getAllTools(): ShuncodeToolSet[] {
		const byId = new Map<string, ShuncodeToolSet>()
		for (const tools of ShuncodeToolSet.variants.values()) {
			for (const tool of tools) {
				byId.set(tool.config.id, tool)
			}
		}
		return Array.from(byId.values())
	}

	public static getRegisteredModelIds(): string[] {
		return Array.from(ShuncodeToolSet.variants.keys())
	}

	public static getToolByName(toolName: string, variant: ModelFamily): ShuncodeToolSet | undefined {
		const tools = ShuncodeToolSet.getTools(variant)
		return tools.find((tool) => tool.config.id === toolName)
	}

	// Return a tool by name with fallback to GENERIC and then any other variant where it exists
	public static getToolByNameWithFallback(toolName: string, variant: ModelFamily): ShuncodeToolSet | undefined {
		// Try exact variant first
		const exact = ShuncodeToolSet.getToolByName(toolName, variant)
		if (exact) {
			return exact
		}

		// Fallback to GENERIC
		const generic = ShuncodeToolSet.getToolByName(toolName, ModelFamily.GENERIC)
		if (generic) {
			return generic
		}

		// Final fallback: search across all registered variants
		for (const [, tools] of ShuncodeToolSet.variants) {
			const found = Array.from(tools).find((t) => t.config.id === toolName)
			if (found) {
				return found
			}
		}

		return undefined
	}

	// Build a list of tools for a variant using requested ids, falling back to GENERIC when missing
	public static getToolsForVariantWithFallback(variant: ModelFamily, requestedIds: string[]): ShuncodeToolSet[] {
		const resolved: ShuncodeToolSet[] = []
		for (const id of requestedIds) {
			const tool = ShuncodeToolSet.getToolByNameWithFallback(id, variant)
			if (tool) {
				// Avoid duplicates by id
				if (!resolved.some((t) => t.config.id === tool.config.id)) {
					resolved.push(tool)
				}
			}
		}
		return resolved
	}

	public static getEnabledTools(variant: PromptVariant, context: SystemPromptContext): ShuncodeToolSet[] {
		const resolved: ShuncodeToolSet[] = []
		const requestedIds = variant.tools ? [...variant.tools] : []
		for (const id of requestedIds) {
			// In Ask/Chat mode, skip tools that are not allowed (read-only mode)
			if ((context.mode === "ask" || context.mode === "chat") && ASK_MODE_HIDDEN_TOOLS.has(id)) {
				continue
			}
			// Check tool customization: if user explicitly disabled this tool, skip it
			const customization = context.toolCustomizationSettings?.tools?.[id]
			if (customization?.enabled === false) {
				continue
			}
			const tool = ShuncodeToolSet.getToolByNameWithFallback(id, variant.family)
			if (tool) {
				// Avoid duplicates by id
				if (!resolved.some((t) => t.config.id === tool.config.id)) {
					resolved.push(tool)
				}
			}
		}

		// Filter by context requirements
		const enabledTools = resolved.filter(
			(tool) => !tool.config.contextRequirements || tool.config.contextRequirements(context),
		)

		return enabledTools
	}

	/**
	 * Get the appropriate native tool converter for the given provider
	 */
	public static getNativeConverter(providerId: string, modelId?: string) {
		switch (providerId) {
			case "minimax":
			case "anthropic":
				return toolSpecInputSchema
			case "gemini":
				return toolSpecFunctionDeclarations
			case "vertex":
				if (modelId?.includes("gemini")) {
					return toolSpecFunctionDeclarations
				}
				return toolSpecInputSchema
			default:
				// Default to OpenAI Compatible converter
				return toolSpecFunctionDefinition
		}
	}

	public static getNativeTools(variant: PromptVariant, context: SystemPromptContext) {
		if (!context.enableNativeToolCalls) {
			return undefined
		}

		// Base set
		const toolsets = ShuncodeToolSet.getEnabledTools(variant, context)
		const toolConfigs = toolsets.map((tool) => tool.config)

		// MCP tools (hidden in Ask/Chat mode — read-only, no side-effects allowed)
		const mcpTools = (context.mode === "ask" || context.mode === "chat")
			? []
			: (context.mcpHub?.getServers()?.filter((s) => s.disabled !== true) || [])
				.flatMap((server) => mcpToolToShuncodeToolSpec(variant.family, server))
				.filter((spec) => context.toolCustomizationSettings?.tools?.[spec.id]?.enabled !== false)

		const enabledTools = [...toolConfigs, ...mcpTools]
		const converter = ShuncodeToolSet.getNativeConverter(context.providerInfo.providerId, context.providerInfo.model.id)

		return enabledTools.map((tool) => converter(tool, context))
	}
}

/**
 * Convert an MCP server's tools to ShuncodeToolSpec format
 */
export function mcpToolToShuncodeToolSpec(family: ModelFamily, server: McpServer): ShuncodeToolSpec[] {
	const tools = server.tools || []
	return tools
		.map((mcpTool) => {
			let parameters: any[] = []

			if (mcpTool.inputSchema && "properties" in mcpTool.inputSchema) {
				const schema = mcpTool.inputSchema as any
				const requiredFields = new Set(schema.required || [])

				parameters = Object.entries(schema.properties as Record<string, any>).map(([name, propSchema]) => {
					// Preserve the full schema, not just basic fields
					const param: any = {
						name,
						instruction: propSchema.description || "",
						type: propSchema.type || "string",
						required: requiredFields.has(name),
					}

					// Preserve items for array types
					if (propSchema.items) {
						param.items = propSchema.items
					}

					// Preserve properties for object types
					if (propSchema.properties) {
						param.properties = propSchema.properties
					}

					// Preserve other JSON Schema fields (enum, format, minimum, maximum, etc.)
					for (const key in propSchema) {
						if (!["type", "description", "items", "properties"].includes(key)) {
							param[key] = propSchema[key]
						}
					}

					return param
				})
			}

			const mcpToolName = server.uid + SHUNCODE_MCP_TOOL_IDENTIFIER + mcpTool.name

			// NOTE: When the name is too long, the provider API will reject the tool registration with the following error:
			// `Invalid 'tools[n].name': string too long. Expected a string with maximum length 64, but got a string with length n instead.`
			// To avoid this, we skip registering tools with names that are too long.
			if (mcpToolName?.length <= 64) {
				return {
					variant: family,
					id: ShuncodeDefaultTool.MCP_USE,
					// We will use the identifier to reconstruct the MCP server and tool name later
					name: mcpToolName,
					description: `${server.name}: ${mcpTool.description || mcpTool.name}`,
					parameters,
				}
			}

			return undefined
		})
		.filter((t) => t !== undefined)
}
