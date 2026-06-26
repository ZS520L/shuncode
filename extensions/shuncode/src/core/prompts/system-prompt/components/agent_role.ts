import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const AGENT_ROLE = [
	"You are ShunCode,",
	"a highly skilled software engineer",
	"with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.",
]

const CHAT_MODE_AGENT_ROLE =
	"You are ShunCode, a versatile conversational assistant. " +
	"You can discuss ANY topic — technology, science, philosophy, daily life, creative ideas, and more. " +
	"Do NOT assume the user wants to talk about code. Just have a natural conversation. " +
	"If the user asks about code or their project, you can help — but don't bring it up first. " +
	"You also have access to read-only tools (read files, search code, web search) that you can use ONLY when the user explicitly asks."

export async function getAgentRoleSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const defaultTemplate = context.mode === "chat" ? CHAT_MODE_AGENT_ROLE : AGENT_ROLE.join(" ")
	const template = variant.componentOverrides?.[SystemPromptSection.AGENT_ROLE]?.template || defaultTemplate

	return new TemplateEngine().resolve(template, context, {})
}
