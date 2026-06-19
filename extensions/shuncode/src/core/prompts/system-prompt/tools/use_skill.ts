import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"

const id = ShuncodeDefaultTool.USE_SKILL

const generic: ShuncodeToolSpec = {
	id,
	variant: ModelFamily.GENERIC,
	name: "use_skill",
	description:
		"Load and activate a skill by name. Skills provide specialized instructions for specific tasks. Use this tool ONCE when a user's request matches one of the available skill descriptions shown in the SKILLS section of your system prompt. After activation, follow the skill's instructions directly - do not call use_skill again.",
	// Keep this tool available even when context.skills is not pre-populated.
	// The handler performs on-demand skill discovery from the active cwd and returns a clear error if none are available.
	contextRequirements: () => true,
	parameters: [
		{
			name: "skill_name",
			required: true,
			instruction: "The name of the skill to activate (must match exactly one of the available skill names)",
		},
	],
}

export const use_skill_variants = [generic]
