import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ShuncodeDefaultTool.READ_FILES

const generic: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "read_files",
	description:
		"Read multiple files in a single request. Use this instead of multiple read_file calls when you need to examine several files at once (e.g., during initial exploration, reviewing related files, or checking imports). This saves round-trips and is much faster than reading files one by one. Each file's content is returned with its path and line numbers. Files that don't exist or can't be read will show an error message instead of content.",
	parameters: [
		{
			name: "paths",
			required: true,
			instruction: `A JSON array of file paths (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}} to read. Example: ["src/index.ts", "src/utils.ts", "package.json"]. Maximum 10 files per call.`,
			usage: '["src/index.ts", "src/utils.ts"]',
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ShuncodeToolSpec = {
	...generic,
	variant: ModelFamily.NATIVE_GPT_5,
}

const NATIVE_NEXT_GEN: ShuncodeToolSpec = {
	...generic,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const read_files_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN]
