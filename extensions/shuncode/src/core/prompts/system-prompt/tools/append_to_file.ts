import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ShuncodeDefaultTool.FILE_APPEND

const GENERIC: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "append_to_file",
	description:
		"Append content to the end of an existing file, or create the file if it doesn't exist. This is ideal for writing large files in multiple chunks — call this tool repeatedly to build up file content piece by piece without needing to provide the entire file at once.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `The path of the file to append to (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}}`,
			usage: "File path here",
		},
		{
			name: "content",
			required: true,
			instruction:
				"The content to append to the end of the file. This will be added after the existing content (or become the initial content if the file doesn't exist).",
			usage: "Content to append here",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ShuncodeToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "append_to_file",
	description:
		"[IMPORTANT: Always output the absolutePath first] Append content to the end of an existing file, or create the file if it doesn't exist. Ideal for writing large files in multiple chunks.",
	parameters: [
		{
			name: "absolutePath",
			required: true,
			instruction: "The absolute path to the file to append to.",
		},
		{
			name: "content",
			required: true,
			instruction:
				"The content to append to the end of the file.",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ShuncodeToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const append_to_file_variants = [GENERIC, NATIVE_NEXT_GEN, NATIVE_GPT_5]
