import { ModelFamily } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"
import { ShuncodeDefaultTool } from "@/shared/tools"
import { isQwenModelFamily } from "@/utils/model-utils"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { qwenComponentOverrides } from "./overrides"
import { baseTemplate } from "./template"
import { GENERIC_SYSTEM_INFO } from "../generic/template"

export const config = createVariant(ModelFamily.QWEN)
	.description("Prompt optimized for Qwen models with clear, compact instructions.")
	.version(1)
	.tags("qwen", "stable")
	.labels({
		stable: 1,
		production: 1,
	})
	.matcher((context) => {
		return isQwenModelFamily(context.providerInfo.model.id)
	})
	.template(baseTemplate)
	.components(
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.TOOL_USE,
		SystemPromptSection.RULES,
		SystemPromptSection.ACT_VS_PLAN,
		SystemPromptSection.CLI_SUBAGENTS,
		SystemPromptSection.CAPABILITIES,
		SystemPromptSection.EDITING_FILES,
		SystemPromptSection.TODO,
		SystemPromptSection.MCP,
		SystemPromptSection.TASK_PROGRESS,
		SystemPromptSection.SYSTEM_INFO,
		SystemPromptSection.OBJECTIVE,
		SystemPromptSection.USER_INSTRUCTIONS,
		SystemPromptSection.SKILLS,
	)
	.tools(
		// Essential tools
		ShuncodeDefaultTool.FILE_READ,
		ShuncodeDefaultTool.FILE_NEW,
		ShuncodeDefaultTool.FILE_APPEND,
		ShuncodeDefaultTool.FILE_EDIT,
		ShuncodeDefaultTool.BASH,
		ShuncodeDefaultTool.ATTEMPT,
		ShuncodeDefaultTool.ASK,
		ShuncodeDefaultTool.PLAN_MODE,
		ShuncodeDefaultTool.MEMORY,
		// Search tools
		ShuncodeDefaultTool.FAST_CONTEXT,
		ShuncodeDefaultTool.SEARCH,
		ShuncodeDefaultTool.LIST_FILES,
		ShuncodeDefaultTool.GLOB,
		ShuncodeDefaultTool.LIST_CODE_DEF,
		ShuncodeDefaultTool.GO_TO_DEFINITION,
		ShuncodeDefaultTool.FIND_REFERENCES,
		ShuncodeDefaultTool.GET_HOVER,
		ShuncodeDefaultTool.READ_DIAGNOSTICS,
		// MCP (kept for compatibility)
		ShuncodeDefaultTool.MCP_USE,
	)
	.placeholders({
		MODEL_FAMILY: "qwen",
	})
	.config({})
	.overrideComponent(SystemPromptSection.AGENT_ROLE, qwenComponentOverrides[SystemPromptSection.AGENT_ROLE])
	.overrideComponent(SystemPromptSection.TOOL_USE, qwenComponentOverrides[SystemPromptSection.TOOL_USE])
	.overrideComponent(SystemPromptSection.OBJECTIVE, qwenComponentOverrides[SystemPromptSection.OBJECTIVE])
	.overrideComponent(SystemPromptSection.RULES, qwenComponentOverrides[SystemPromptSection.RULES])
	.overrideComponent(SystemPromptSection.TASK_PROGRESS, qwenComponentOverrides[SystemPromptSection.TASK_PROGRESS])
	.overrideComponent(SystemPromptSection.MCP, qwenComponentOverrides[SystemPromptSection.MCP])
	.overrideComponent(SystemPromptSection.EDITING_FILES, qwenComponentOverrides[SystemPromptSection.EDITING_FILES])
	.overrideComponent(SystemPromptSection.SYSTEM_INFO, {
		template: GENERIC_SYSTEM_INFO,
	})
	.build()

const validationResult = validateVariant({ ...config, id: "qwen" }, { strict: true })
if (!validationResult.isValid) {
	Logger.error("Qwen variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid Qwen variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	Logger.warn("Qwen variant configuration warnings:", validationResult.warnings)
}

export type QwenVariantConfig = typeof config
