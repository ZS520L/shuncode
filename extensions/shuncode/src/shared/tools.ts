import { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/index"
import { FunctionDeclaration as GoogleTool } from "@google/genai"
import { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"

export type ShuncodeTool = OpenAITool | AnthropicTool | GoogleTool

// Define available tool ids
export enum ShuncodeDefaultTool {
	ASK = "ask_followup_question",
	ATTEMPT = "attempt_completion",
	BASH = "execute_command",
	FILE_EDIT = "replace_in_file",
	FILE_READ = "read_file",
	FILE_NEW = "write_to_file",
	FILE_APPEND = "append_to_file",
	SEARCH = "search_files",
	LIST_FILES = "list_files",
	LIST_CODE_DEF = "list_code_definition_names",
	GO_TO_DEFINITION = "go_to_definition",
	FIND_REFERENCES = "find_references",
	GET_HOVER = "get_hover",
	BROWSER = "browser_action",
	MCP_USE = "use_mcp_tool",
	MCP_ACCESS = "access_mcp_resource",
	MCP_DOCS = "load_mcp_documentation",
	NEW_TASK = "new_task",
	PLAN_MODE = "plan_mode_respond",
	ACT_MODE = "act_mode_respond",
	TODO = "focus_chain",
	WEB_FETCH = "web_fetch",
	WEB_SEARCH = "web_search",
	CONDENSE = "condense",
	SUMMARIZE_TASK = "summarize_task",
	REPORT_BUG = "report_bug",
	NEW_RULE = "new_rule",
	APPLY_PATCH = "apply_patch",
	GENERATE_EXPLANATION = "generate_explanation",
	USE_SKILL = "use_skill",
	READ_DIAGNOSTICS = "read_diagnostics",
	FAST_CONTEXT = "fast_context",
	GLOB = "glob",
	MEMORY = "memory",
	// Jupyter notebook editing
	EDIT_NOTEBOOK = "edit_notebook",
	// Image generation
	GENERATE_IMAGE = "generate_image",
	// Упрощённые инструменты редактирования (для слабых моделей)
	DELETE_BLOCK = "delete_block",
	REPLACE_TEXT = "replace_text",
	FILE_DELETE = "delete_file",
}

// Array of all tool names for compatibility
// Automatically generated from the enum values
export const toolUseNames = Object.values(ShuncodeDefaultTool) as ShuncodeDefaultTool[]

// Tools that are safe to run in parallel with the initial checkpoint commit
// These are tools that do not modify the workspace state
export const READ_ONLY_TOOLS = [
	ShuncodeDefaultTool.LIST_FILES,
	ShuncodeDefaultTool.FILE_READ,
	ShuncodeDefaultTool.SEARCH,
	ShuncodeDefaultTool.LIST_CODE_DEF,
	ShuncodeDefaultTool.GO_TO_DEFINITION,
	ShuncodeDefaultTool.FIND_REFERENCES,
	ShuncodeDefaultTool.GET_HOVER,
	ShuncodeDefaultTool.BROWSER,
	ShuncodeDefaultTool.ASK,
	ShuncodeDefaultTool.WEB_SEARCH,
	ShuncodeDefaultTool.WEB_FETCH,
	ShuncodeDefaultTool.USE_SKILL,
	ShuncodeDefaultTool.READ_DIAGNOSTICS,
	ShuncodeDefaultTool.GLOB,
	ShuncodeDefaultTool.FAST_CONTEXT,
] as const

// Exploration-only tools — used for anti-loop detection in weak models.
// If the model calls only these tools N times in a row without any edits/commands,
// it's likely stuck in an investigation loop.
export const EXPLORATION_ONLY_TOOLS: readonly string[] = [
	ShuncodeDefaultTool.LIST_FILES,
	ShuncodeDefaultTool.FILE_READ,
	ShuncodeDefaultTool.SEARCH,
	ShuncodeDefaultTool.LIST_CODE_DEF,
	ShuncodeDefaultTool.GO_TO_DEFINITION,
	ShuncodeDefaultTool.FIND_REFERENCES,
	ShuncodeDefaultTool.GET_HOVER,
	ShuncodeDefaultTool.FAST_CONTEXT,
	ShuncodeDefaultTool.GLOB,
	ShuncodeDefaultTool.READ_DIAGNOSTICS,
] as const
