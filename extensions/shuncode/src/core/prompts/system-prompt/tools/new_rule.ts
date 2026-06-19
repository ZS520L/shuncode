import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"

const id = ShuncodeDefaultTool.NEW_RULE

const GENERIC: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "new_rule",
	description:
		"Deprecated memory creation tool. Prefer the memory tool with action=write for saving, updating, listing, or deleting pinned memories. Only use new_rule if the memory tool is unavailable.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction:
				"The filename for the memory file (just the name, no directory). Must end with '.md'. Use a short descriptive name, e.g. 'os-environment.md', 'coding-style.md', 'preferred-language.md'.",
			usage: "memory-name.md",
		},
		{
			name: "content",
			required: true,
			instruction:
				"The markdown content of the memory. Keep it SHORT and focused — one key fact or preference per file. Use a brief heading and 1-3 bullet points max. Do NOT dump large amounts of text.",
			usage: "# Heading\n\n- Key fact",
		},
	],
}

export const new_rule_variants = [GENERIC]
