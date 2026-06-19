import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ShuncodeDefaultTool.EDIT_NOTEBOOK

const GENERIC: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "edit_notebook",
	description:
		"Use this tool to edit a Jupyter notebook (.ipynb) cell. Supports editing existing cells via search & replace and creating new cells.\n" +
		"- If you need to edit an existing cell, set 'is_new_cell' to false and provide both 'old_string' and 'new_string'.\n" +
		"  The tool will replace ONE occurrence of 'old_string' with 'new_string' in the specified cell.\n" +
		"- If you need to create a new cell, set 'is_new_cell' to true and provide 'new_string' (keep 'old_string' empty).\n" +
		"- Cell indices are 0-based.\n" +
		"- The old_string MUST uniquely identify the text you want to change within the cell.\n" +
		"- If you need to create a new notebook, just set 'is_new_cell' to true and cell_idx to 0.\n" +
		"- ALWAYS provide ALL required parameters.",
	parameters: [
		{
			name: "target_notebook",
			required: true,
			instruction: `The path to the notebook file (.ipynb) to edit (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}}`,
			usage: "path/to/notebook.ipynb",
		},
		{
			name: "cell_idx",
			required: true,
			instruction: "The 0-based index of the cell to edit or the position to insert a new cell.",
			usage: "0",
		},
		{
			name: "is_new_cell",
			required: true,
			instruction:
				"If 'true', a new cell will be created at the specified cell index. If 'false', the existing cell at that index will be edited via search & replace.",
			usage: "false",
		},
		{
			name: "cell_language",
			required: true,
			instruction:
				"The language of the cell. Must be one of: 'python', 'markdown', 'javascript', 'typescript', 'r', 'sql', 'shell', 'raw', or 'other'.",
			usage: "python",
		},
		{
			name: "old_string",
			required: false,
			instruction:
				"The text to replace in the existing cell (must match exactly). Required when is_new_cell is 'false'. Leave empty when creating a new cell.",
			usage: "",
		},
		{
			name: "new_string",
			required: true,
			instruction:
				"The replacement text (when editing) or the full content for a new cell (when creating).",
			usage: "print('hello world')",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ShuncodeToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "edit_notebook",
	description:
		"Edit a Jupyter notebook (.ipynb) cell. Set is_new_cell to true to insert a new cell, or false to edit an existing cell via search & replace (old_string → new_string). Cell indices are 0-based.",
	parameters: [
		{
			name: "target_notebook",
			required: true,
			instruction: "The absolute or relative path to the .ipynb notebook file.",
		},
		{
			name: "cell_idx",
			required: true,
			instruction: "0-based index of the cell to edit or insert position for new cells.",
		},
		{
			name: "is_new_cell",
			required: true,
			instruction: "'true' to insert a new cell, 'false' to edit an existing cell.",
		},
		{
			name: "cell_language",
			required: true,
			instruction: "Cell language: python, markdown, javascript, typescript, r, sql, shell, raw, or other.",
		},
		{
			name: "old_string",
			required: false,
			instruction: "Text to find and replace in the cell. Required when is_new_cell is false.",
		},
		{
			name: "new_string",
			required: true,
			instruction: "Replacement text or new cell content.",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ShuncodeToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const edit_notebook_variants = [GENERIC, NATIVE_NEXT_GEN, NATIVE_GPT_5]
