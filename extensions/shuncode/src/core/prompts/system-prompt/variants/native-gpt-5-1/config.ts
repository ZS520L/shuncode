import { isGPT51Model, isGPT52Model, isNextGenModelProvider } from "@utils/model-utils"
import { ModelFamily } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"
import { ShuncodeDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { gpt51ComponentOverrides } from "./overrides"
import { GPT_5_1_TEMPLATE_OVERRIDES } from "./template"
import { GENERIC_SYSTEM_INFO } from "../generic/template"

// Type-safe variant configuration using the builder pattern
export const config = createVariant(ModelFamily.NATIVE_GPT_5_1)
	.description("Prompt tailored to GPT-5.1 and GPT-5.2 with native tool use support")
	.version(1)
	.tags("gpt", "gpt-5-1", "gpt-5-2", "advanced", "production", "native_tools")
	.labels({
		stable: 1,
		production: 1,
		advanced: 1,
		use_native_tools: 1,
	})
	// Match GPT-5.1 and GPT-5.2 models from providers that support native tools
	.matcher((context) => {
		if (!context.enableNativeToolCalls) {
			return false
		}
		const providerInfo = context.providerInfo
		const modelId = providerInfo.model.id

		// Chat variants do not support native tool use
		if (modelId.includes("chat")) {
			return false
		}

		// GPT-5.1 and GPT-5.2 models (including codex variants) use extended reasoning
		// and require reasoning blocks before function calls
		return (isGPT51Model(modelId) || isGPT52Model(modelId)) && isNextGenModelProvider(providerInfo)
	})
	.template(GPT_5_1_TEMPLATE_OVERRIDES.BASE)
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
		ShuncodeDefaultTool.NEW_TASK,
		ShuncodeDefaultTool.PLAN_MODE,
		ShuncodeDefaultTool.ACT_MODE,
		ShuncodeDefaultTool.ASK,
	)
	.placeholders({
		MODEL_FAMILY: ModelFamily.NATIVE_GPT_5_1,
	})
	.config({})
	// Override components with custom templates from overrides.ts
	.overrideComponent(SystemPromptSection.AGENT_ROLE, gpt51ComponentOverrides[SystemPromptSection.AGENT_ROLE]!)
	.overrideComponent(SystemPromptSection.RULES, gpt51ComponentOverrides[SystemPromptSection.RULES]!)
	.overrideComponent(SystemPromptSection.TOOL_USE, gpt51ComponentOverrides[SystemPromptSection.TOOL_USE]!)
	.overrideComponent(SystemPromptSection.ACT_VS_PLAN, gpt51ComponentOverrides[SystemPromptSection.ACT_VS_PLAN]!)
	.overrideComponent(SystemPromptSection.OBJECTIVE, gpt51ComponentOverrides[SystemPromptSection.OBJECTIVE]!)
	.overrideComponent(SystemPromptSection.FEEDBACK, gpt51ComponentOverrides[SystemPromptSection.FEEDBACK]!)
	.overrideComponent(SystemPromptSection.SYSTEM_INFO, {
		template: GENERIC_SYSTEM_INFO,
	})
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: ModelFamily.NATIVE_GPT_5_1 }, { strict: true })
if (!validationResult.isValid) {
	Logger.error("GPT-5-1 variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid GPT-5-1 variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	Logger.warn("GPT-5-1 variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type GPT51VariantConfig = typeof config
