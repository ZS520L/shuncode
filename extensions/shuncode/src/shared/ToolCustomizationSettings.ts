export interface ToolParameterCustomization {
	description?: string
}

export interface ToolCustomizationEntry {
	enabled?: boolean
	description?: string
	parameters?: Record<string, ToolParameterCustomization>
}

export interface ToolCustomizationSettings {
	tools: Record<string, ToolCustomizationEntry>
}

export const DEFAULT_TOOL_CUSTOMIZATION_SETTINGS: ToolCustomizationSettings = {
	tools: {},
}

export interface CustomizableToolParameterInfo {
	name: string
	description: string
	required: boolean
}

export interface CustomizableToolInfo {
	key: string
	name: string
	id: string
	type: "builtin" | "mcp"
	serverName?: string
	description: string
	parameters: CustomizableToolParameterInfo[]
}

export interface ToolCustomizationData {
	settings: ToolCustomizationSettings
	tools: CustomizableToolInfo[]
}

export function normalizeToolCustomizationSettings(value: unknown): ToolCustomizationSettings {
	let parsed: Partial<ToolCustomizationSettings> | undefined

	if (typeof value === "string" && value.trim()) {
		try {
			parsed = JSON.parse(value)
		} catch {
			parsed = undefined
		}
	} else if (value && typeof value === "object") {
		parsed = value as Partial<ToolCustomizationSettings>
	}

	const tools: Record<string, ToolCustomizationEntry> = {}
	if (parsed?.tools && typeof parsed.tools === "object") {
		for (const [key, entry] of Object.entries(parsed.tools)) {
			if (!entry || typeof entry !== "object") continue
			const normalizedEntry: ToolCustomizationEntry = {}
			if (entry.enabled !== undefined) {
				normalizedEntry.enabled = entry.enabled !== false
			}
			if (typeof entry.description === "string") {
				normalizedEntry.description = entry.description
			}
			if (entry.parameters && typeof entry.parameters === "object") {
				normalizedEntry.parameters = {}
				for (const [paramName, param] of Object.entries(entry.parameters)) {
					if (!param || typeof param !== "object") continue
					if (typeof param.description === "string") {
						normalizedEntry.parameters[paramName] = { description: param.description }
					}
				}
			}
			tools[key] = normalizedEntry
		}
	}

	return { tools }
}

export function serializeToolCustomizationSettings(settings: ToolCustomizationSettings): string {
	return JSON.stringify(normalizeToolCustomizationSettings(settings))
}

export function getToolCustomizationEntry(
	settings: ToolCustomizationSettings | undefined,
	toolKey: string,
): ToolCustomizationEntry | undefined {
	return settings?.tools?.[toolKey]
}
