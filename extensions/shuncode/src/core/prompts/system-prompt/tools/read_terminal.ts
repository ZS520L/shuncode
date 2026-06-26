import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"

const id = ShuncodeDefaultTool.READ_TERMINAL

const generic: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "read_terminal",
	description:
		"Read status and captured output from ShunCode-managed terminals. Use this after execute_command times out, after proceeding while a command is still running, or whenever you need to check whether a terminal command is running or completed. This is read-only and can return logs even while a command is still running.",
	parameters: [
		{
			name: "terminal_id",
			required: false,
			instruction: "Optional numeric terminal id. If omitted, returns all ShunCode-managed terminals.",
			usage: "1",
		},
		{
			name: "line_limit",
			required: false,
			instruction: "Optional maximum number of output lines to return per terminal. Defaults to 500 and caps at 2000.",
			usage: "500",
			type: "integer",
		},
	],
}

const NATIVE_GPT_5: ShuncodeToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "read_terminal",
	description:
		"Read terminal status and captured output from ShunCode-managed terminals. Use after execute_command times out or while a command is still running.",
	parameters: [
		{
			name: "terminal_id",
			required: false,
			instruction: "Optional numeric terminal id. If omitted, returns all terminals.",
			type: "integer",
		},
		{
			name: "line_limit",
			required: false,
			instruction: "Optional max output lines per terminal. Default 500, max 2000.",
			type: "integer",
		},
	],
}

const NATIVE_NEXT_GEN: ShuncodeToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const read_terminal_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN]
