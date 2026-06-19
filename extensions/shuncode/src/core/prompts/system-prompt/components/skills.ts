import { discoverSkills, getAvailableSkills } from "@core/context/instructions/user-instructions/skills"
import type { SkillMetadata } from "@shared/skills"
import type { PromptVariant, SystemPromptContext } from "../types"

/**
 * Generate the skills section for the system prompt.
 */
export async function getSkillsSection(_variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	let skills: SkillMetadata[] = context.skills ?? []

	// context.skills can be empty in the System Prompt preview even when global skills are installed.
	// Fall back to the same discovery path used by the runtime use_skill tool.
	if (skills.length === 0) {
		const discoveredSkills = await discoverSkills(context.cwd || process.cwd())
		skills = getAvailableSkills(discoveredSkills)
	}

	if (skills.length === 0) return undefined

	const skillsList = skills
		.map((skill) => {
			const description = skill.description ? ` — ${skill.description}` : ""
			return `  - ${skill.name}${description}`
		})
		.join("\n")

	return `SKILLS

Available skills:
${skillsList}

Use a skill only when the user's request clearly matches its purpose. To load full skill instructions, call the use_skill tool with the exact skill name before handling specialized document, presentation, PDF, coding workflow, or skill-management tasks.`
}
