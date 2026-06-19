import { SystemPromptSection } from "../../templates/placeholders"
import { SystemPromptContext } from "../../types"

export const DEVSTRAL_AGENT_ROLE_TEMPLATE = (context: SystemPromptContext) => {
	const thinkLanguageInstruction = context.alwaysThinkInPreferredLanguage
		? `\nIMPORTANT: You must always THINK and REASON in ${context.preferredLanguage || "the user's preferred"} language within the <thinking> tags. However, when writing code or technical terms, keep them in English. The final response to the user should be in the language they prefer.`
		: ""

	return `You are Shuncode AI, a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.${thinkLanguageInstruction}
`
}

export const devstralComponentOverrides = {
	[SystemPromptSection.AGENT_ROLE]: {
		template: DEVSTRAL_AGENT_ROLE_TEMPLATE,
	},
}
