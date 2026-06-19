import { isGPT5ModelFamily, isNextGenModelFamily, isNextGenModelProvider } from "@utils/model-utils"
import { ModelFamily } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"
import { ShuncodeDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { TEMPLATE_OVERRIDES } from "./template"
import { GENERIC_SYSTEM_INFO } from "../generic/template"

// Type-safe variant configuration using the builder pattern
export const config = createVariant(ModelFamily.NATIVE_NEXT_GEN)
	.description("Next gen models with native tool calling")
	.version(1)
	.tags("advanced", "production", "native_tools")
	.labels({
		stable: 1,
		production: 1,
		advanced: 1,
		use_native_tools: 1,
	})
	.matcher((context) => {
		if (!context.enableNativeToolCalls) {
			return false
		}
		const providerInfo = context.providerInfo
		if (!isNextGenModelProvider(providerInfo)) {
			return false
		}
		const modelId = providerInfo.model.id.toLowerCase()
		return !isGPT5ModelFamily(modelId) && isNextGenModelFamily(modelId)
	})
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
		// Strong model (native tool calling): BASH high priority
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
		MODEL_FAMILY: ModelFamily.NATIVE_NEXT_GEN,
	})
	.config({})
	// Override the RULES component with custom template
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
		template: GENERIC_SYSTEM_INFO,
	})
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: ModelFamily.NATIVE_NEXT_GEN }, { strict: true })
if (!validationResult.isValid) {
	Logger.error("Native Next Gen variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid Native Next Gen variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	Logger.warn("Native Next Gen variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type NativeNextGenVariantConfig = typeof config
