import { ModelFamily } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"
import { ShuncodeDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { TEMPLATE_OVERRIDES, SYSTEM_INFO } from "./template"

/**
 * Universal variant configuration — single variant for all models.
 * All providers use native function calling (OpenAI-compatible tool format).
 * Tool visibility is controlled by mode-based filtering and user customization,
 * not by model-specific variant selection.
 */
export const config = createVariant(ModelFamily.NATIVE_NEXT_GEN)
	.description("Universal variant for all models with native tool calling")
	.version(2)
	.tags("universal", "production", "native_tools")
	.labels({
		stable: 1,
		production: 1,
		universal: 1,
		use_native_tools: 1,
	})
	// Always match — this is the only variant
	.matcher((_context) => true)
	.template(TEMPLATE_OVERRIDES.BASE)
	.components(
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.TOOL_USE,
		SystemPromptSection.TODO,
		SystemPromptSection.ACT_VS_PLAN,
		SystemPromptSection.TASK_PROGRESS,
		SystemPromptSection.CAPABILITIES,
		SystemPromptSection.FEEDBACK,
		SystemPromptSection.RULES,
		SystemPromptSection.SYSTEM_INFO,
		SystemPromptSection.OBJECTIVE,
		SystemPromptSection.USER_INSTRUCTIONS,
		SystemPromptSection.SKILLS,
	)
	.tools(
		// Execution
		ShuncodeDefaultTool.BASH,
		ShuncodeDefaultTool.READ_TERMINAL,
		// File reading
		ShuncodeDefaultTool.FILE_READ,
		ShuncodeDefaultTool.READ_FILES,
		// File writing
		ShuncodeDefaultTool.FILE_NEW,
		ShuncodeDefaultTool.FILE_APPEND,
		ShuncodeDefaultTool.FILE_EDIT,
		ShuncodeDefaultTool.APPLY_PATCH,
		ShuncodeDefaultTool.HASHLINE_EDIT,
		ShuncodeDefaultTool.EDIT_NOTEBOOK,
		ShuncodeDefaultTool.FILE_DELETE,
		ShuncodeDefaultTool.DELETE_BLOCK,
		ShuncodeDefaultTool.REPLACE_TEXT,
		// Code search & navigation
		ShuncodeDefaultTool.FAST_CONTEXT,
		ShuncodeDefaultTool.SEARCH,
		ShuncodeDefaultTool.LIST_FILES,
		ShuncodeDefaultTool.GLOB,
		ShuncodeDefaultTool.LIST_CODE_DEF,
		ShuncodeDefaultTool.GO_TO_DEFINITION,
		ShuncodeDefaultTool.FIND_REFERENCES,
		ShuncodeDefaultTool.GET_HOVER,
		ShuncodeDefaultTool.READ_DIAGNOSTICS,
		// Web & browser
		ShuncodeDefaultTool.BROWSER,
		ShuncodeDefaultTool.WEB_FETCH,
		ShuncodeDefaultTool.WEB_SEARCH,
		// MCP
		ShuncodeDefaultTool.MCP_USE,
		ShuncodeDefaultTool.MCP_ACCESS,
		ShuncodeDefaultTool.MCP_DOCS,
		// Workflow
		ShuncodeDefaultTool.TODO,
		ShuncodeDefaultTool.MEMORY,
		ShuncodeDefaultTool.NEW_TASK,
		ShuncodeDefaultTool.GENERATE_EXPLANATION,
		ShuncodeDefaultTool.GENERATE_IMAGE,
		ShuncodeDefaultTool.USE_SKILL,
		ShuncodeDefaultTool.EVALUATE_TASK,
		// Flow control
		ShuncodeDefaultTool.ATTEMPT,
		ShuncodeDefaultTool.PLAN_MODE,
		ShuncodeDefaultTool.ACT_MODE,
		ShuncodeDefaultTool.ASK,
	)
	.placeholders({
		MODEL_FAMILY: ModelFamily.NATIVE_NEXT_GEN,
	})
	.config({})
	.overrideComponent(SystemPromptSection.RULES, {
		template: TEMPLATE_OVERRIDES.RULES,
	})
	.overrideComponent(SystemPromptSection.TOOL_USE, {
		template: TEMPLATE_OVERRIDES.TOOL_USE,
	})
	.overrideComponent(SystemPromptSection.OBJECTIVE, {
		template: TEMPLATE_OVERRIDES.OBJECTIVE,
	})
	.overrideComponent(SystemPromptSection.ACT_VS_PLAN, {
		template: TEMPLATE_OVERRIDES.ACT_VS_PLAN,
	})
	.overrideComponent(SystemPromptSection.FEEDBACK, {
		template: TEMPLATE_OVERRIDES.FEEDBACK,
	})
	.overrideComponent(SystemPromptSection.SYSTEM_INFO, {
		template: SYSTEM_INFO,
	})
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: ModelFamily.NATIVE_NEXT_GEN }, { strict: true })
if (!validationResult.isValid) {
	Logger.error("Universal variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid universal variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	Logger.warn("Universal variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type NativeNextGenVariantConfig = typeof config
