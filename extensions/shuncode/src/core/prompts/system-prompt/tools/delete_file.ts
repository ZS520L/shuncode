import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ShuncodeDefaultTool.FILE_DELETE

const GENERIC: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "delete_file",
	description:
		"Request to delete a file at the specified path. The operation will fail gracefully if the file doesn't exist or cannot be deleted. Use this tool when you need to remove files that are no longer needed.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `The path of the file to delete (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}}`,
			usage: "File path here",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ShuncodeToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "delete_file",
	description:
		"[IMPORTANT: Always output the absolutePath first] Request to delete a file at the specified path. The operation will fail gracefully if the file doesn't exist or cannot be deleted.",
	parameters: [
		{
			name: "absolutePath",
			required: true,
			instruction: "The absolute path to the file to delete.",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ShuncodeToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const delete_file_variants = [GENERIC, NATIVE_NEXT_GEN, NATIVE_GPT_5]
