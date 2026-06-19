// Import all tool variants
import { ShuncodeToolSet } from "../registry/ShuncodeToolSet"
import { access_mcp_resource_variants } from "./access_mcp_resource"
import { act_mode_respond_variants } from "./act_mode_respond"
import { append_to_file_variants } from "./append_to_file"
import { apply_patch_variants } from "./apply_patch"
import { ask_followup_question_variants } from "./ask_followup_question"
import { attempt_completion_variants } from "./attempt_completion"
import { browser_action_variants } from "./browser_action"
import { fast_context_variants } from "./codebase_search"
import { delete_block_variants } from "./delete_block"
import { edit_notebook_variants } from "./edit_notebook"
import { execute_command_variants } from "./execute_command"
import { focus_chain_variants } from "./focus_chain"
import { generate_explanation_variants } from "./generate_explanation"
import { generate_image_variants } from "./generate_image"
import { glob_variants } from "./glob"
import { list_code_definition_names_variants } from "./list_code_definition_names"
import { list_files_variants } from "./list_files"
import { find_references_variants, get_hover_variants, go_to_definition_variants } from "./lsp_navigation"
import { load_mcp_documentation_variants } from "./load_mcp_documentation"
import { memory_variants } from "./memory"
import { new_task_variants } from "./new_task"
import { plan_mode_respond_variants } from "./plan_mode_respond"
import { read_file_variants } from "./read_file"
import { read_diagnostics_variants } from "./read_diagnostics"
import { replace_in_file_variants } from "./replace_in_file"
import { replace_text_variants } from "./replace_text"
import { search_files_variants } from "./search_files"
import { use_mcp_tool_variants } from "./use_mcp_tool"
import { use_skill_variants } from "./use_skill"
import { web_fetch_variants } from "./web_fetch"
import { web_search_variants } from "./web_search"
import { write_to_file_variants } from "./write_to_file"

/**
 * Registers all tool variants with the ShuncodeToolSet provider.
 * This function must be called at prompt registry
 * to allow all tool sets be available at build time.
 */
export function registerShuncodeToolSets(): void {
	// Collect all variants from all tools
	const allToolVariants = [
		...access_mcp_resource_variants,
		...act_mode_respond_variants,
		...ask_followup_question_variants,
		...attempt_completion_variants,
		...browser_action_variants,
		...fast_context_variants,
		...delete_block_variants,
		...edit_notebook_variants,
		...execute_command_variants,
		...focus_chain_variants,
		...generate_explanation_variants,
		...generate_image_variants,
		...glob_variants,
		...list_code_definition_names_variants,
		...go_to_definition_variants,
		...find_references_variants,
		...get_hover_variants,
		...list_files_variants,
		...load_mcp_documentation_variants,
		...memory_variants,
		...new_task_variants,
		...plan_mode_respond_variants,
		...read_file_variants,
		...read_diagnostics_variants,
		...replace_in_file_variants,
		...replace_text_variants,
		...search_files_variants,
		...use_mcp_tool_variants,
		...use_skill_variants,
		...web_fetch_variants,
		...web_search_variants,
		...write_to_file_variants,
		...apply_patch_variants,
		...append_to_file_variants,
	]

	// Register each variant
	allToolVariants.forEach((v) => {
		ShuncodeToolSet.register(v)
	})
}
