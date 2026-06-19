import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

/**
 * ## fast_context
 * Description: A powerful agentic code search sub-agent that explores the codebase using parallel grep, read_file, and find_files calls over multiple turns.
 * Parameters:
 * - query: (required) A targeted natural language query describing what you are looking for.
 * Usage:
 * <fast_context>
 * <query>Find where authentication requests are handled in the Express routes</query>
 * </fast_context>
 */

const id = ShuncodeDefaultTool.FAST_CONTEXT

const generic: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "fast_context",
	description:
		"A powerful agentic code search sub-agent that explores the codebase using parallel grep, read_file, and find_files calls over multiple turns to locate relevant code. ALWAYS use this tool FIRST for any code exploration — whether searching for how something works, where a class/function is defined, or understanding control flow. Much faster and more thorough than manual grep. Only fall back to search_files for simple regex patterns (TODO tags, exact literals).",
	parameters: [
		{
			name: "query",
			required: true,
			instruction: "A targeted natural language query based on what you are trying to find. Be specific — e.g. 'Find where authentication requests are handled' or 'How does IndexingService handle pause/resume'.",
			usage: "Search query here",
		},
		{
			name: "scope",
			required: false,
			instruction: "Optional relative directory path to narrow the search scope. Use this when you can infer the likely location — e.g. 'extensions/shuncode/src' or 'src/vs/editor'. Dramatically improves search speed and accuracy.",
			usage: "relative/path/to/search/within",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ShuncodeToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "fast_context",
	description:
		"A powerful agentic code search sub-agent that explores the codebase using parallel grep, read_file, and find_files calls over multiple turns. ALWAYS use this tool FIRST for any code exploration — it handles both semantic questions and specific class/function lookups far more efficiently than manual search_files + read_file sequences.",
	parameters: [
		{
			name: "query",
			required: true,
			instruction: "A targeted natural language query based on what you are trying to find. Be specific — e.g. 'Find where authentication requests are handled' or 'How does IndexingService handle pause/resume'.",
			usage: "Search query here",
		},
		{
			name: "scope",
			required: false,
			instruction: "Optional relative directory path to narrow the search scope. Use this when you can infer the likely location — e.g. 'extensions/shuncode/src' or 'src/vs/editor'. Dramatically improves search speed and accuracy.",
			usage: "relative/path/to/search/within",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ShuncodeToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const fast_context_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN]
