import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"

const id = ShuncodeDefaultTool.READ_DIAGNOSTICS

const generic: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "read_diagnostics",
	description:
		"Read linter errors, compiler warnings, and other diagnostics from VS Code. IMPORTANT: Always use this tool instead of running eslint/tsc manually - it's faster and more reliable. Use after making code changes to check for syntax errors, type errors, or other issues. Returns errors and warnings with file paths, line numbers, and messages.",
	parameters: [
		{
			name: "paths",
			required: false,
			instruction: `Optional. Comma-separated list of file or directory paths to filter diagnostics. If not provided, returns diagnostics for all files in the workspace. Example: "src/index.ts,src/utils/"`,
			usage: "src/index.ts",
		},
	],
}

const NATIVE_GPT_5: ShuncodeToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "read_diagnostics",
	description:
		"Read linter/compiler errors from VS Code. ALWAYS use instead of running eslint/tsc manually. Returns errors with file paths and line numbers.",
	parameters: [
		{
			name: "paths",
			required: false,
			instruction: `Optional. Comma-separated file/directory paths to filter. If empty, returns all diagnostics.`,
			usage: "src/index.ts",
		},
	],
}

const NATIVE_NEXT_GEN: ShuncodeToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const read_diagnostics_variants = [generic, NATIVE_NEXT_GEN, NATIVE_GPT_5]
