import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

function createLspToolVariants(
	id: ShuncodeDefaultTool,
	name: string,
	description: string,
	extraParameters: ShuncodeToolSpec["parameters"] = [],
): ShuncodeToolSpec[] {
	const parameters: ShuncodeToolSpec["parameters"] = [
		{
			name: "path",
			required: true,
			instruction: `The file path, relative to the current working directory {{CWD}}{{MULTI_ROOT_HINT}}, containing the symbol or code position.`,
			usage: "src/index.ts",
		},
		{
			name: "line",
			required: true,
			instruction: "The 1-based line number containing the target symbol or code position.",
			usage: "42",
			type: "integer",
		},
		{
			name: "character",
			required: true,
			instruction: "The 1-based character/column number on the target line. Use a position inside the symbol when possible.",
			usage: "17",
			type: "integer",
		},
		...extraParameters,
		TASK_PROGRESS_PARAMETER,
	]

	const generic: ShuncodeToolSpec = {
		variant: ModelFamily.GENERIC,
		id,
		name,
		description,
		parameters,
	}

	const NATIVE_GPT_5: ShuncodeToolSpec = {
		...generic,
		variant: ModelFamily.NATIVE_GPT_5,
	}

	const NATIVE_NEXT_GEN: ShuncodeToolSpec = {
		...NATIVE_GPT_5,
		variant: ModelFamily.NATIVE_NEXT_GEN,
	}

	return [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN]
}

export const go_to_definition_variants = createLspToolVariants(
	ShuncodeDefaultTool.GO_TO_DEFINITION,
	"go_to_definition",
	"Use VS Code language services to jump from a symbol usage to its definition. Prefer this over broad text search when you need precise API origin, implementation location, or declaration context.",
)

export const find_references_variants = createLspToolVariants(
	ShuncodeDefaultTool.FIND_REFERENCES,
	"find_references",
	"Use VS Code language services to find references to the symbol at a file position. Prefer this before broad regex search when assessing call sites, impact, or safe refactors.",
	[
		{
			name: "include_declaration",
			required: false,
			instruction: "Whether to include the symbol declaration in returned references. Defaults to true.",
			usage: "true",
			type: "boolean",
		},
		{
			name: "max_results",
			required: false,
			instruction: "Maximum number of references to return. Defaults to 50.",
			usage: "50",
			type: "integer",
		},
	],
)

export const get_hover_variants = createLspToolVariants(
	ShuncodeDefaultTool.GET_HOVER,
	"get_hover",
	"Use VS Code language services to read hover/type information for the symbol at a file position. Use this to inspect inferred types, signatures, and documentation without opening broad files.",
)

