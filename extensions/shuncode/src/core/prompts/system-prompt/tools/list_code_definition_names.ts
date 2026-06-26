import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ShuncodeDefaultTool.LIST_CODE_DEF

const generic: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "list_code_definition_names",
	description:
		"Request to list definition names (classes, functions, methods, etc.) with their line numbers. Works on both files and directories. For a file: returns all definitions in that file with line numbers so you can target specific sections with read_file. For a directory: lists top-level definitions from all source files. This is the fastest way to understand code structure before reading full content.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `The path of the file or directory (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}} to list source code definitions for.`,
			usage: "File or directory path here",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ShuncodeToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "list_code_definition_names",
	description:
		"Request to list definition names (classes, functions, methods, etc.) with their line numbers. Works on both files and directories. For a file: returns all definitions in that file with line numbers so you can target specific sections with read_file. For a directory: lists top-level definitions from all source files. This is the fastest way to understand code structure before reading full content.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `The path of the file or directory (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}} to list source code definitions for.`,
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ShuncodeToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const list_code_definition_names_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN]
