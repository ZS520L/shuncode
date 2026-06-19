import { ModelFamily } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"
import { ShuncodeDefaultTool } from "@/shared/tools"
import { isHermesModelFamily } from "@/utils/model-utils"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { hermesComponentOverrides } from "./overrides"
import { baseTemplate } from "./template"
import { GENERIC_SYSTEM_INFO } from "../generic/template"

export const config = createVariant(ModelFamily.HERMES)
	.description("Prompt optimized for Hermes-4 model with advanced agentic capabilities.")
	.version(1)
	.tags("hermes", "stable")
	.labels({
		stable: 1,
		production: 1,
	})
	.matcher((context) => {
		const modelId = context.providerInfo.model.id
		return isHermesModelFamily(modelId)
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
		ShuncodeDefaultTool.FILE_READ,
		ShuncodeDefaultTool.FILE_NEW,
		ShuncodeDefaultTool.FILE_APPEND,
		ShuncodeDefaultTool.FILE_EDIT,
		ShuncodeDefaultTool.FAST_CONTEXT,
		ShuncodeDefaultTool.SEARCH,
		ShuncodeDefaultTool.LIST_FILES,
		ShuncodeDefaultTool.GLOB,
		ShuncodeDefaultTool.LIST_CODE_DEF,
		ShuncodeDefaultTool.GO_TO_DEFINITION,
		ShuncodeDefaultTool.FIND_REFERENCES,
		ShuncodeDefaultTool.GET_HOVER,
		ShuncodeDefaultTool.READ_DIAGNOSTICS,
		ShuncodeDefaultTool.WEB_SEARCH,
		ShuncodeDefaultTool.MCP_USE,
		ShuncodeDefaultTool.MCP_ACCESS,
		ShuncodeDefaultTool.MCP_DOCS,
		ShuncodeDefaultTool.BROWSER,
		ShuncodeDefaultTool.BASH,
		ShuncodeDefaultTool.TODO,
		ShuncodeDefaultTool.MEMORY,
		ShuncodeDefaultTool.GENERATE_EXPLANATION,
		ShuncodeDefaultTool.GENERATE_IMAGE,
		ShuncodeDefaultTool.USE_SKILL,
		ShuncodeDefaultTool.ATTEMPT,
		ShuncodeDefaultTool.PLAN_MODE,
		ShuncodeDefaultTool.ASK,
	)
	.placeholders({
		MODEL_FAMILY: "hermes",
	})
	.config({})
	// Apply Hermes-specific component overrides
	.overrideComponent(SystemPromptSection.AGENT_ROLE, hermesComponentOverrides[SystemPromptSection.AGENT_ROLE])
	.overrideComponent(SystemPromptSection.TOOL_USE, hermesComponentOverrides[SystemPromptSection.TOOL_USE])
	.overrideComponent(SystemPromptSection.OBJECTIVE, hermesComponentOverrides[SystemPromptSection.OBJECTIVE])
	.overrideComponent(SystemPromptSection.RULES, hermesComponentOverrides[SystemPromptSection.RULES])
	.overrideComponent(SystemPromptSection.TASK_PROGRESS, hermesComponentOverrides[SystemPromptSection.TASK_PROGRESS])
	.overrideComponent(SystemPromptSection.MCP, hermesComponentOverrides[SystemPromptSection.MCP])
	.overrideComponent(SystemPromptSection.SYSTEM_INFO, {
		template: GENERIC_SYSTEM_INFO,
	})
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: "hermes" }, { strict: true })
if (!validationResult.isValid) {
	Logger.error("Hermes variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid Hermes variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	Logger.warn("Hermes variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type HermesVariantConfig = typeof config
