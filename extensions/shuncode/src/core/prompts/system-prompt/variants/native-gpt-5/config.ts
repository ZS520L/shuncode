import { isGPT5ModelFamily, isGPT51Model, isGPT52Model, isNextGenModelProvider } from "@utils/model-utils"
import { ModelFamily } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"
import { ShuncodeDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { GPT_5_TEMPLATE_OVERRIDES } from "./template"
import { GENERIC_SYSTEM_INFO } from "../generic/template"

// Type-safe variant configuration using the builder pattern
export const config = createVariant(ModelFamily.NATIVE_GPT_5)
	.description("Prompt tailored to GPT-5 with native tool use support with less strict rules than GPT-5.1 variant")
	.version(1)
	.tags("gpt", "gpt-5", "advanced", "production", "native_tools")
	.labels({
		stable: 1,
		production: 1,
		advanced: 1,
		use_native_tools: 1,
	})
	// Match GPT-5 models from providers that support native tools
	.matcher((context) => {
		if (!context.enableNativeToolCalls) {
			return false
		}
		const providerInfo = context.providerInfo
		const modelId = providerInfo.model.id
		if (!isNextGenModelProvider(providerInfo)) {
			return false
		}
		if (modelId.includes("gpt-oss")) {
			return true
		}
		return (
			isGPT5ModelFamily(modelId) &&
			// Exclude gpt-5.1 and gpt-5.2 models (including codex variants)
			// GPT-5.1 and GPT-5.2 use extended reasoning and need the native-gpt-5-1 variant
			!isGPT51Model(modelId) &&
			!isGPT52Model(modelId) &&
			// gpt-5-chat models do not support native tool use
			!modelId.includes("chat") &&
			isNextGenModelProvider(providerInfo)
		)
	})
	.template(GPT_5_TEMPLATE_OVERRIDES.BASE)
	.components(
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.TOOL_USE,
		SystemPromptSection.TASK_PROGRESS,
		SystemPromptSection.ACT_VS_PLAN,
		SystemPromptSection.CLI_SUBAGENTS,
		SystemPromptSection.CAPABILITIES,
		SystemPromptSection.FEEDBACK,
		SystemPromptSection.RULES,
		SystemPromptSection.SYSTEM_INFO,
		SystemPromptSection.OBJECTIVE,
		SystemPromptSection.USER_INSTRUCTIONS,
		SystemPromptSection.SKILLS,
	)
	.tools(
		ShuncodeDefaultTool.BASH,
		ShuncodeDefaultTool.FILE_READ,
		ShuncodeDefaultTool.APPLY_PATCH,
		ShuncodeDefaultTool.FILE_APPEND,
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
		MODEL_FAMILY: ModelFamily.NATIVE_GPT_5,
	})
	.config({})
	// Override the RULES component with custom template
	.overrideComponent(SystemPromptSection.RULES, {
		template: GPT_5_TEMPLATE_OVERRIDES.RULES,
	})
	.overrideComponent(SystemPromptSection.TOOL_USE, {
		template: GPT_5_TEMPLATE_OVERRIDES.TOOL_USE,
	})
	.overrideComponent(SystemPromptSection.ACT_VS_PLAN, {
		template: GPT_5_TEMPLATE_OVERRIDES.ACT_VS_PLAN,
	})
	.overrideComponent(SystemPromptSection.OBJECTIVE, {
		template: GPT_5_TEMPLATE_OVERRIDES.OBJECTIVE,
	})
	.overrideComponent(SystemPromptSection.FEEDBACK, {
		template: GPT_5_TEMPLATE_OVERRIDES.FEEDBACK,
	})
	.overrideComponent(SystemPromptSection.EDITING_FILES, {
		enabled: false,
	})
	.overrideComponent(SystemPromptSection.SYSTEM_INFO, {
		template: GENERIC_SYSTEM_INFO,
	})
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: ModelFamily.NATIVE_GPT_5 }, { strict: true })
if (!validationResult.isValid) {
	Logger.error("GPT-5 variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid GPT-5 variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	Logger.warn("GPT-5 variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type GPT5VariantConfig = typeof config
