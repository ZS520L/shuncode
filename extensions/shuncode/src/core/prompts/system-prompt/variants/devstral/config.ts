import { ModelFamily } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"
import { ShuncodeDefaultTool } from "@/shared/tools"
import { isDevstralModelFamily } from "@/utils/model-utils"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { DEVSTRAL_AGENT_ROLE_TEMPLATE } from "./overrides"
import { baseTemplate } from "./template"
import { GENERIC_SYSTEM_INFO } from "../generic/template"

export const config = createVariant(ModelFamily.DEVSTRAL)
	.description("Baseline prompt for Devstral family models")
	.version(1)
	.tags("devstral", "stable")
	.labels({
		stable: 1,
		production: 1,
	})
	.matcher((context) => {
		return isDevstralModelFamily(context.providerInfo.model.id)
	})
	.template(baseTemplate)
	.components(
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.TOOL_USE,
		SystemPromptSection.TASK_PROGRESS,
		SystemPromptSection.MCP,
		SystemPromptSection.EDITING_FILES,
		SystemPromptSection.ACT_VS_PLAN,
		SystemPromptSection.CLI_SUBAGENTS,
		SystemPromptSection.CAPABILITIES,
		SystemPromptSection.RULES,
		SystemPromptSection.SYSTEM_INFO,
		SystemPromptSection.OBJECTIVE,
		SystemPromptSection.USER_INSTRUCTIONS,
		SystemPromptSection.SKILLS,
	)
	.tools(
		ShuncodeDefaultTool.BASH,
		ShuncodeDefaultTool.FILE_READ,
		ShuncodeDefaultTool.FILE_NEW,
		ShuncodeDefaultTool.FILE_APPEND,
		ShuncodeDefaultTool.FILE_EDIT,
		ShuncodeDefaultTool.EDIT_NOTEBOOK,
		ShuncodeDefaultTool.FAST_CONTEXT,
		ShuncodeDefaultTool.SEARCH,
		ShuncodeDefaultTool.LIST_FILES,
		ShuncodeDefaultTool.GLOB,
		ShuncodeDefaultTool.LIST_CODE_DEF,
		ShuncodeDefaultTool.GO_TO_DEFINITION,
		ShuncodeDefaultTool.FIND_REFERENCES,
		ShuncodeDefaultTool.GET_HOVER,
		ShuncodeDefaultTool.READ_DIAGNOSTICS,
		ShuncodeDefaultTool.BROWSER,
		ShuncodeDefaultTool.WEB_FETCH,
		ShuncodeDefaultTool.WEB_SEARCH,
		ShuncodeDefaultTool.MCP_USE,
		ShuncodeDefaultTool.MCP_ACCESS,
		ShuncodeDefaultTool.MCP_DOCS,
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
		MODEL_FAMILY: "devstral",
	})
	.config({})
	.overrideComponent(SystemPromptSection.AGENT_ROLE, {
		template: DEVSTRAL_AGENT_ROLE_TEMPLATE,
	})
	.overrideComponent(SystemPromptSection.SYSTEM_INFO, {
		template: GENERIC_SYSTEM_INFO,
	})
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: "devstral" }, { strict: true })
if (!validationResult.isValid) {
	Logger.error("Devstral variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid Devstral variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	Logger.warn("Devstral variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type DevstralVariantConfig = typeof config
