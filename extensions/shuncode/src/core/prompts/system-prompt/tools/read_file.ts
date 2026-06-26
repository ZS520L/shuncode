import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ShuncodeDefaultTool.FILE_READ

const generic: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "read_file",
	description:
		"Request to read the contents of a file at the specified path. Use this when you need to examine the contents of an existing file you do not know the contents of, for example to analyze code, review text files, or extract information from configuration files. Automatically extracts raw text from PDF and DOCX files. May not be suitable for other types of binary files, as it returns the raw content as a string. Do NOT use this tool to list the contents of a directory. Only use this tool on files. For large files, use start_line and end_line to read specific sections.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `The path of the file to read (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}}`,
			usage: "File path here",
		},
		{
			name: "start_line",
			required: false,
			instruction: "The 1-indexed line number to start reading from (inclusive). If not provided, reads from the beginning of the file.",
			usage: "1",
		},
		{
			name: "end_line",
			required: false,
			instruction: "The 1-indexed line number to stop reading at (inclusive). If not provided, reads to the end of the file. Use with start_line to read specific portions of large files.",
			usage: "100",
		},
		{
			name: "hashline",
			required: false,
			instruction: "Set to 'true' to enable hashline mode. Each line will be annotated with a content hash (format: LINE:HASH|content). Use hashline mode when you plan to edit the file with hashline_edit — the hash anchors enable precise, whitespace-tolerant editing.",
			usage: "true",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ShuncodeToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "read_file",
	description:
		"Request to read the contents of a file at the specified path. Use this when you need to examine the contents of an existing file you do not know the contents of, for example to analyze code, review text files, or extract information from configuration files. Automatically extracts raw text from PDF and DOCX files. May not be suitable for other types of binary files, as it returns the raw content as a string. Do NOT use this tool to list the contents of a directory. Only use this tool on files. For large files, use start_line and end_line to read specific sections.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `The path of the file to read (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}}`,
			usage: "File path here",
		},
		{
			name: "start_line",
			required: false,
			instruction: "The 1-indexed line number to start reading from (inclusive). If not provided, reads from the beginning of the file.",
			usage: "1",
		},
		{
			name: "end_line",
			required: false,
			instruction: "The 1-indexed line number to stop reading at (inclusive). If not provided, reads to the end of the file. Use with start_line to read specific portions of large files.",
			usage: "100",
		},
		{
			name: "hashline",
			required: false,
			instruction: "Set to 'true' to enable hashline mode. Each line will be annotated with a content hash (format: LINE:HASH|content). Use hashline mode when you plan to edit the file with hashline_edit — the hash anchors enable precise, whitespace-tolerant editing.",
			usage: "true",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ShuncodeToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const read_file_variants = [generic, NATIVE_NEXT_GEN, NATIVE_GPT_5]
