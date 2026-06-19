import { isGLMModelFamily, isLocalModel, isNextGenModelFamily, isNextGenModelProvider } from "@utils/model-utils"
import { ModelFamily } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"
import { ShuncodeDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { baseTemplate, genericComponentOverrides } from "./template"

export const config = createVariant(ModelFamily.GENERIC)
	.description("The fallback prompt for generic use cases and models.")
	.version(1)
	.tags("fallback", "stable")
	.labels({
		stable: 1,
		fallback: 1,
		use_native_tools: 1,
	})
	// Generic matcher - fallback for everything that doesn't match other variants
	// This will match anything that doesn't match the other specific variants
	.matcher((context) => {
		const providerInfo = context.providerInfo
		if (!providerInfo.providerId || !providerInfo.model.id) {
			return true
		}
		const modelId = providerInfo.model.id.toLowerCase()
		return (
			// Not a local model with compact prompt enabled
			!(providerInfo.customPrompt === "compact" && isLocalModel(providerInfo)) &&
			// Not a next-gen model
			!(isNextGenModelProvider(providerInfo) && isNextGenModelFamily(modelId)) &&
			// Not a GLM model
			!isGLMModelFamily(modelId)
		)
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
	.overrideComponent(SystemPromptSection.AGENT_ROLE, genericComponentOverrides[SystemPromptSection.AGENT_ROLE])
	.overrideComponent(SystemPromptSection.TOOL_USE, genericComponentOverrides[SystemPromptSection.TOOL_USE])
	.overrideComponent(SystemPromptSection.RULES, genericComponentOverrides[SystemPromptSection.RULES])
	.overrideComponent(SystemPromptSection.SYSTEM_INFO, genericComponentOverrides[SystemPromptSection.SYSTEM_INFO])
	.tools(
		// Priority 1: File operations (main work)
		ShuncodeDefaultTool.FILE_READ,
		ShuncodeDefaultTool.FILE_NEW,
		ShuncodeDefaultTool.FILE_APPEND,
		ShuncodeDefaultTool.FILE_EDIT,
		// Priority 2: Search & exploration
		ShuncodeDefaultTool.FAST_CONTEXT,
		ShuncodeDefaultTool.SEARCH,
		ShuncodeDefaultTool.LIST_FILES,
		ShuncodeDefaultTool.GLOB,
		ShuncodeDefaultTool.LIST_CODE_DEF,
		ShuncodeDefaultTool.GO_TO_DEFINITION,
		ShuncodeDefaultTool.FIND_REFERENCES,
		ShuncodeDefaultTool.GET_HOVER,
		ShuncodeDefaultTool.READ_DIAGNOSTICS,
		// Priority 3: External sources
		ShuncodeDefaultTool.WEB_SEARCH,
		ShuncodeDefaultTool.MCP_USE,
		ShuncodeDefaultTool.MCP_ACCESS,
		ShuncodeDefaultTool.MCP_DOCS,
		ShuncodeDefaultTool.BROWSER,
		// Priority 4: Shell (lower priority for generic �?weak models abuse it)
		ShuncodeDefaultTool.BASH,
		// Priority 5: Auxiliary
		ShuncodeDefaultTool.TODO,
		ShuncodeDefaultTool.MEMORY,
		ShuncodeDefaultTool.GENERATE_EXPLANATION,
		ShuncodeDefaultTool.GENERATE_IMAGE,
		ShuncodeDefaultTool.USE_SKILL,
		// Priority 6: Flow control (lowest �?model should DO work, not ask/switch)
		ShuncodeDefaultTool.ATTEMPT,
		ShuncodeDefaultTool.PLAN_MODE,
		ShuncodeDefaultTool.ASK,
	)
	.placeholders({
		MODEL_FAMILY: "generic",
	})
	.config({})
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: "generic" }, { strict: true })
if (!validationResult.isValid) {
	Logger.error("Generic variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid generic variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	Logger.warn("Generic variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type GenericVariantConfig = typeof config
