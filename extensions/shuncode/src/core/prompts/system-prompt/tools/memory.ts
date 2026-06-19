import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"

const id = ShuncodeDefaultTool.MEMORY

const GENERIC: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "memory",
	description:
		"List, read, create/update, or delete pinned memory items. Use this when the user asks to inspect, manage, update, remove, or remember persistent preferences/facts. Memories are global markdown files loaded into future system prompts via {{memory}} / {{pinnedMemory}}.",
	parameters: [
		{
			name: "action",
			required: true,
			instruction: "One of: list, read, write, delete. Use list before edit/delete if you need to identify the exact memory file.",
			usage: "list",
		},
		{
			name: "path",
			required: false,
			instruction:
				"Memory filename or absolute path. For write, prefer a short filename ending in .md. For read/delete/write existing memory, use a path returned by list when available.",
			usage: "preferred-search-tool.md",
		},
		{
			name: "content",
			required: false,
			instruction:
				"Markdown content for action=write. Keep it short and focused. Omit for list/read/delete.",
			usage: "- Prefer Exa for web search and fetching webpages.",
		},
	],
}

export const memory_variants = [GENERIC]
