import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"

const id = ShuncodeDefaultTool.HASHLINE_EDIT

const generic: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "hashline_edit",
	description:
		"Hash-anchored file editing. Use this tool ONLY after reading a file with hashline=true mode. " +
		"Each line in hashline read output has a reference like `LINE:HASH|content` (e.g. `5:VR|  const x = 1`). " +
		"You edit by referencing the LINE:HASH anchor — no need to reproduce old text. " +
		"If the file changed since your last read, the hash won't match and the edit is safely rejected. " +
		"This tool is more reliable than replace_in_file for complex edits because you only need to remember a 2-character hash, not reproduce exact whitespace. " +
		"Operations: replace (single line or range), insert_after, insert_before, delete.",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: "The file path (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}} to edit.",
			usage: "src/index.ts",
		},
		{
			name: "edits",
			required: true,
			instruction:
				"JSON array of edit operations. Each operation has:\n" +
				'- "operation": one of "replace", "insert_after", "insert_before", "delete"\n' +
				'- "anchor": a LINE:HASH reference from your hashline read (e.g. "5:VR" for single line, "5:VR-10:KN" for a range)\n' +
				'- "content": the new content (not needed for delete)\n\n' +
				"Examples:\n" +
				'  Replace line 5: [{"operation":"replace","anchor":"5:VR","content":"  const x = 2"}]\n' +
				'  Replace lines 5-10: [{"operation":"replace","anchor":"5:VR-10:KN","content":"new\\nmultiline\\ncontent"}]\n' +
				'  Insert after line 3: [{"operation":"insert_after","anchor":"3:SW","content":"  // new comment"}]\n' +
				'  Delete line 7: [{"operation":"delete","anchor":"7:MQ"}]\n\n' +
				"Multiple edits can be batched. All anchors are validated atomically before any edit is applied.",
			usage: '[{"operation":"replace","anchor":"5:VR","content":"  const x = 2"}]',
		},
	],
}

const NATIVE_GPT_5: ShuncodeToolSpec = {
	...generic,
	variant: ModelFamily.NATIVE_GPT_5,
}

const NATIVE_NEXT_GEN: ShuncodeToolSpec = {
	...generic,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const hashline_edit_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN]
