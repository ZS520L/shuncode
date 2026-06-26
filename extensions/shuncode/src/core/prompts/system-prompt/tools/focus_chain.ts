import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"

// HACK: Placeholder to act as tool dependency
const generic: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ShuncodeDefaultTool.TODO,
	name: "focus_chain",
	description: "",
	contextRequirements: (context) => context.focusChainSettings?.enabled === true,
}

export const focus_chain_variants = [generic]
