import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ShuncodeDefaultTool.DELETE_BLOCK

/**
 * delete_block - simplified tool for deleting code blocks
 *
 * Model specifies only the START of the block (query), and the system:
 * - Finds the line by text
 * - Determines block boundaries (by indentation, tags, brackets)
 * - Deletes correctly
 *
 * This solves the line counting problem for weaker models.
 */

const generic: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "delete_block",
	// Show only when simplified edit tools are enabled
	contextRequirements: (context) => context.useSimplifiedEditTools === true,
	description: `Delete a code block from a file. Specify only the beginning of the block - the system will automatically find its boundaries.

WHEN TO USE:
- Deleting functions, classes, methods
- Deleting JSX/HTML elements
- Deleting code blocks (if, for, try, etc.)

ADVANTAGES:
- No need to count line numbers
- System automatically determines where the block ends
- Fewer errors when deleting`,
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `File path (relative to {{CWD}})`,
			usage: "src/components/Example.tsx",
		},
		{
			name: "query",
			required: true,
			instruction: `Text to find the start of the block. Specify the first line or a unique fragment of the block to delete.

Examples:
- For a function: "function handleClick"
- For JSX element: "<div className=\\"modal\\">"
- For import: "import { useState }"

IMPORTANT: query must be unique in the file. If multiple matches found - provide more context.`,
			usage: "function handleClick",
		},
		{
			name: "startLine",
			required: false,
			instruction: `(Optional) Line number to disambiguate if query appears multiple times`,
			usage: "45",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const delete_block_variants = [generic]
