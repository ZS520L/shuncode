import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ShuncodeDefaultTool.REPLACE_TEXT

/**
 * replace_text - simplified tool for text replacement
 *
 * Model specifies text to find (query) and replacement text (replace).
 * The system:
 * - Finds text (with whitespace normalization)
 * - Automatically removes line numbers from copy-paste (e.g. "31 | <li>...")
 * - Performs replacement
 *
 * This simplifies work compared to SEARCH/REPLACE blocks.
 */

const generic: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "replace_text",
	// Show only when simplified edit tools are enabled
	contextRequirements: (context) => context.useSimplifiedEditTools === true,
	description: `Replace text in a file. Specify what to find and what to replace with.

WHEN TO USE:
- Changing variable values
- Replacing strings, text
- Renaming (if single occurrence)
- Fixing typos

ADVANTAGES:
- Automatic whitespace and indentation normalization
- Removes line numbers if you copied from readFile output
- Helpful error messages when search fails

FOR DELETION: specify empty replace`,
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
			instruction: `Text to find. Copy exact text from the file.

The system automatically:
- Normalizes whitespace and indentation
- Removes line numbers (if you copied "45 | const x = 1")

IMPORTANT: query must be unique. If multiple matches - add more context or specify startLine.`,
			usage: "const oldValue = 123",
		},
		{
			name: "replace",
			required: true,
			instruction: `Replacement text.

- For normal replacement: specify new text
- For DELETION: leave empty

Examples:
- Replace: query="value: 1" replace="value: 2"
- Delete: query="<li>to delete</li>" replace=""`,
			usage: "const newValue = 456",
		},
		{
			name: "startLine",
			required: false,
			instruction: `(Optional) Line number to disambiguate when multiple matches exist`,
			usage: "45",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const replace_text_variants = [generic]
