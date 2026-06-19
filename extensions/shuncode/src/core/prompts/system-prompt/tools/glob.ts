import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ShuncodeDefaultTool.GLOB

const generic: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "glob",
	description:
		"Find files matching a glob pattern in the project directory. Returns matching file paths sorted by modification time (newest first). Use this to discover files by name pattern — e.g., find all TypeScript files, all test files, all config files, etc.",
	parameters: [
		{
			name: "pattern",
			required: true,
			instruction:
				'The glob pattern to match files against. Supports standard glob syntax: "*" matches any filename, "**" matches directories recursively, "{ts,tsx}" matches alternatives. Examples: "**/*.ts", "**/test/**/*.test.ts", "src/**/*.{ts,tsx}".',
			usage: "**/*.ts",
		},
		{
			name: "path",
			required: false,
			instruction:
				"Directory to search in, relative to the project root. Defaults to the project root if not provided.{{MULTI_ROOT_HINT}}",
			usage: "src",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ShuncodeToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "glob",
	description:
		"Find files matching a glob pattern in the project directory. Returns matching file paths sorted by modification time (newest first).",
	parameters: [
		{
			name: "pattern",
			required: true,
			instruction:
				'The glob pattern to match files against. Examples: "**/*.ts", "**/test/**/*.test.ts", "src/**/*.{ts,tsx}".',
		},
		{
			name: "path",
			required: false,
			instruction: "Directory to search in, relative to the project root.",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ShuncodeToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const glob_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN]
