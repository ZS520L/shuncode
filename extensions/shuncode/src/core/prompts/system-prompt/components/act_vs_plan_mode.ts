import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const ACT_MODE_SHORT = `ACT MODE V.S. PLAN MODE

There are five modes: ACT, PLAN, ASK, DEBUG, CHAT. You are in ACT MODE — use available tools to accomplish the task, then provide a concise completion summary. The user may switch you to PLAN MODE to plan before implementing.`

const PLAN_MODE_SHORT = `ACT MODE V.S. PLAN MODE

There are five modes: ACT, PLAN, ASK, DEBUG, CHAT. You are in PLAN MODE — gather context and create a detailed plan. The user will review and switch you to ACT MODE to implement.`

const ASK_MODE_SHORT = `You are in ASK MODE (read-only). Explore code, search, and answer questions. Do NOT modify files or run commands unless explicitly asked.`

const DEBUG_MODE_SHORT = `You are in DEBUG MODE. Follow a systematic process: gather evidence → form hypotheses → test → identify root cause → propose fix → implement → verify. Gather evidence BEFORE making changes.`

const CHAT_MODE_SHORT = `You are in CHAT MODE (conversational). Answer questions from your knowledge. Do NOT use tools unless explicitly asked.`

export async function getActVsPlanModeSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const overrideTemplate = variant.componentOverrides?.[SystemPromptSection.ACT_VS_PLAN]?.template

	// Use override if present
	if (overrideTemplate) {
		return new TemplateEngine().resolve(overrideTemplate, context, {})
	}

	// Context-aware mode description — only output relevant mode info
	switch (context.mode) {
		case "plan":
			return PLAN_MODE_SHORT
		case "ask":
			return ASK_MODE_SHORT
		case "debug":
			return DEBUG_MODE_SHORT
		case "chat":
			return CHAT_MODE_SHORT
		default:
			return ACT_MODE_SHORT
	}
}
