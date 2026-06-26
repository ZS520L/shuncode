import { ShuncodeAsk as AppShuncodeAsk, ShuncodeMessage as AppShuncodeMessage, ShuncodeSay as AppShuncodeSay } from "@shared/ExtensionMessage"
import { ShuncodeAsk, ShuncodeMessageType, ShuncodeSay, ShuncodeMessage as ProtoShuncodeMessage } from "@shared/proto/shuncode/ui"

// Helper function to convert ShuncodeAsk string to enum
function convertShuncodeAskToProtoEnum(ask: AppShuncodeAsk | undefined): ShuncodeAsk | undefined {
	if (!ask) {
		return undefined
	}

	const mapping: Record<AppShuncodeAsk, ShuncodeAsk> = {
		followup: ShuncodeAsk.FOLLOWUP,
		plan_mode_respond: ShuncodeAsk.PLAN_MODE_RESPOND,
		act_mode_respond: ShuncodeAsk.ACT_MODE_RESPOND,
		command: ShuncodeAsk.COMMAND,
		command_output: ShuncodeAsk.COMMAND_OUTPUT,
		completion_result: ShuncodeAsk.COMPLETION_RESULT,
		tool: ShuncodeAsk.TOOL,
		api_req_failed: ShuncodeAsk.API_REQ_FAILED,
		resume_task: ShuncodeAsk.RESUME_TASK,
		resume_completed_task: ShuncodeAsk.RESUME_COMPLETED_TASK,
		mistake_limit_reached: ShuncodeAsk.MISTAKE_LIMIT_REACHED,
		browser_action_launch: ShuncodeAsk.BROWSER_ACTION_LAUNCH,
		use_mcp_server: ShuncodeAsk.USE_MCP_SERVER,
		new_task: ShuncodeAsk.NEW_TASK,
		condense: ShuncodeAsk.CONDENSE,
		summarize_task: ShuncodeAsk.SUMMARIZE_TASK,
		report_bug: ShuncodeAsk.REPORT_BUG,
	}

	const result = mapping[ask]
	if (result === undefined) {
	}
	return result
}

// Helper function to convert ShuncodeAsk enum to string
function convertProtoEnumToShuncodeAsk(ask: ShuncodeAsk): AppShuncodeAsk | undefined {
	if (ask === ShuncodeAsk.UNRECOGNIZED) {
		return undefined
	}

	const mapping: Record<Exclude<ShuncodeAsk, ShuncodeAsk.UNRECOGNIZED>, AppShuncodeAsk> = {
		[ShuncodeAsk.FOLLOWUP]: "followup",
		[ShuncodeAsk.PLAN_MODE_RESPOND]: "plan_mode_respond",
		[ShuncodeAsk.ACT_MODE_RESPOND]: "act_mode_respond",
		[ShuncodeAsk.COMMAND]: "command",
		[ShuncodeAsk.COMMAND_OUTPUT]: "command_output",
		[ShuncodeAsk.COMPLETION_RESULT]: "completion_result",
		[ShuncodeAsk.TOOL]: "tool",
		[ShuncodeAsk.API_REQ_FAILED]: "api_req_failed",
		[ShuncodeAsk.RESUME_TASK]: "resume_task",
		[ShuncodeAsk.RESUME_COMPLETED_TASK]: "resume_completed_task",
		[ShuncodeAsk.MISTAKE_LIMIT_REACHED]: "mistake_limit_reached",
		[ShuncodeAsk.BROWSER_ACTION_LAUNCH]: "browser_action_launch",
		[ShuncodeAsk.USE_MCP_SERVER]: "use_mcp_server",
		[ShuncodeAsk.NEW_TASK]: "new_task",
		[ShuncodeAsk.CONDENSE]: "condense",
		[ShuncodeAsk.SUMMARIZE_TASK]: "summarize_task",
		[ShuncodeAsk.REPORT_BUG]: "report_bug",
	}

	return mapping[ask]
}

// Helper function to convert ShuncodeSay string to enum
function convertShuncodeSayToProtoEnum(say: AppShuncodeSay | undefined): ShuncodeSay | undefined {
	if (!say) {
		return undefined
	}

	const mapping: Record<AppShuncodeSay, ShuncodeSay> = {
		task: ShuncodeSay.TASK,
		error: ShuncodeSay.ERROR,
		api_req_started: ShuncodeSay.API_REQ_STARTED,
		api_req_finished: ShuncodeSay.API_REQ_FINISHED,
		text: ShuncodeSay.TEXT,
		reasoning: ShuncodeSay.REASONING,
		completion_result: ShuncodeSay.COMPLETION_RESULT_SAY,
		user_feedback: ShuncodeSay.USER_FEEDBACK,
		user_feedback_diff: ShuncodeSay.USER_FEEDBACK_DIFF,
		api_req_retried: ShuncodeSay.API_REQ_RETRIED,
		command: ShuncodeSay.COMMAND_SAY,
		command_output: ShuncodeSay.COMMAND_OUTPUT_SAY,
		tool: ShuncodeSay.TOOL_SAY,
		shell_integration_warning: ShuncodeSay.SHELL_INTEGRATION_WARNING,
		shell_integration_warning_with_suggestion: ShuncodeSay.SHELL_INTEGRATION_WARNING,
		browser_action_launch: ShuncodeSay.BROWSER_ACTION_LAUNCH_SAY,
		browser_action: ShuncodeSay.BROWSER_ACTION,
		browser_action_result: ShuncodeSay.BROWSER_ACTION_RESULT,
		mcp_server_request_started: ShuncodeSay.MCP_SERVER_REQUEST_STARTED,
		mcp_server_response: ShuncodeSay.MCP_SERVER_RESPONSE,
		mcp_notification: ShuncodeSay.MCP_NOTIFICATION,
		use_mcp_server: ShuncodeSay.USE_MCP_SERVER_SAY,
		diff_error: ShuncodeSay.DIFF_ERROR,
		deleted_api_reqs: ShuncodeSay.DELETED_API_REQS,
		shuncodeignore_error: ShuncodeSay.SHUNCODEIGNORE_ERROR,
		command_permission_denied: ShuncodeSay.COMMAND_PERMISSION_DENIED,
		checkpoint_created: ShuncodeSay.CHECKPOINT_CREATED,
		load_mcp_documentation: ShuncodeSay.LOAD_MCP_DOCUMENTATION,
		info: ShuncodeSay.INFO,
		task_progress: ShuncodeSay.TASK_PROGRESS,
		error_retry: ShuncodeSay.ERROR_RETRY,
		hook_status: ShuncodeSay.HOOK_STATUS,
		hook_output_stream: ShuncodeSay.HOOK_OUTPUT_STREAM,
		conditional_rules_applied: ShuncodeSay.CONDITIONAL_RULES_APPLIED,
		generate_explanation: ShuncodeSay.GENERATE_EXPLANATION,
		workflow_step_start: ShuncodeSay.WORKFLOW_STEP_START,
	}

	const result = mapping[say]

	return result
}

// Helper function to convert ShuncodeSay enum to string
function convertProtoEnumToShuncodeSay(say: ShuncodeSay): AppShuncodeSay | undefined {
	if (say === ShuncodeSay.UNRECOGNIZED) {
		return undefined
	}

	const mapping: Record<Exclude<ShuncodeSay, ShuncodeSay.UNRECOGNIZED>, AppShuncodeSay> = {
		[ShuncodeSay.TASK]: "task",
		[ShuncodeSay.ERROR]: "error",
		[ShuncodeSay.API_REQ_STARTED]: "api_req_started",
		[ShuncodeSay.API_REQ_FINISHED]: "api_req_finished",
		[ShuncodeSay.TEXT]: "text",
		[ShuncodeSay.REASONING]: "reasoning",
		[ShuncodeSay.COMPLETION_RESULT_SAY]: "completion_result",
		[ShuncodeSay.USER_FEEDBACK]: "user_feedback",
		[ShuncodeSay.USER_FEEDBACK_DIFF]: "user_feedback_diff",
		[ShuncodeSay.API_REQ_RETRIED]: "api_req_retried",
		[ShuncodeSay.COMMAND_SAY]: "command",
		[ShuncodeSay.COMMAND_OUTPUT_SAY]: "command_output",
		[ShuncodeSay.TOOL_SAY]: "tool",
		[ShuncodeSay.SHELL_INTEGRATION_WARNING]: "shell_integration_warning",
		[ShuncodeSay.BROWSER_ACTION_LAUNCH_SAY]: "browser_action_launch",
		[ShuncodeSay.BROWSER_ACTION]: "browser_action",
		[ShuncodeSay.BROWSER_ACTION_RESULT]: "browser_action_result",
		[ShuncodeSay.MCP_SERVER_REQUEST_STARTED]: "mcp_server_request_started",
		[ShuncodeSay.MCP_SERVER_RESPONSE]: "mcp_server_response",
		[ShuncodeSay.MCP_NOTIFICATION]: "mcp_notification",
		[ShuncodeSay.USE_MCP_SERVER_SAY]: "use_mcp_server",
		[ShuncodeSay.DIFF_ERROR]: "diff_error",
		[ShuncodeSay.DELETED_API_REQS]: "deleted_api_reqs",
		[ShuncodeSay.SHUNCODEIGNORE_ERROR]: "shuncodeignore_error",
		[ShuncodeSay.COMMAND_PERMISSION_DENIED]: "command_permission_denied",
		[ShuncodeSay.CHECKPOINT_CREATED]: "checkpoint_created",
		[ShuncodeSay.LOAD_MCP_DOCUMENTATION]: "load_mcp_documentation",
		[ShuncodeSay.INFO]: "info",
		[ShuncodeSay.TASK_PROGRESS]: "task_progress",
		[ShuncodeSay.ERROR_RETRY]: "error_retry",
		[ShuncodeSay.GENERATE_EXPLANATION]: "generate_explanation",
		[ShuncodeSay.HOOK_STATUS]: "hook_status",
		[ShuncodeSay.HOOK_OUTPUT_STREAM]: "hook_output_stream",
		[ShuncodeSay.CONDITIONAL_RULES_APPLIED]: "conditional_rules_applied",
		[ShuncodeSay.WORKFLOW_STEP_START]: "workflow_step_start",
	}

	return mapping[say]
}

/**
 * Convert application ShuncodeMessage to proto ShuncodeMessage
 */
export function convertShuncodeMessageToProto(message: AppShuncodeMessage): ProtoShuncodeMessage {
	// For sending messages, we need to provide values for required proto fields
	const askEnum = message.ask ? convertShuncodeAskToProtoEnum(message.ask) : undefined
	const sayEnum = message.say ? convertShuncodeSayToProtoEnum(message.say) : undefined

	// Determine appropriate enum values based on message type
	let finalAskEnum: ShuncodeAsk = ShuncodeAsk.FOLLOWUP // Proto default
	let finalSayEnum: ShuncodeSay = ShuncodeSay.TEXT // Proto default

	if (message.type === "ask") {
		finalAskEnum = askEnum ?? ShuncodeAsk.FOLLOWUP // Use FOLLOWUP as default for ask messages
	} else if (message.type === "say") {
		finalSayEnum = sayEnum ?? ShuncodeSay.TEXT // Use TEXT as default for say messages
	}

	const protoMessage: ProtoShuncodeMessage = {
		ts: message.ts,
		type: message.type === "ask" ? ShuncodeMessageType.ASK : ShuncodeMessageType.SAY,
		ask: finalAskEnum,
		say: finalSayEnum,
		text: message.text ?? "",
		reasoning: message.reasoning ?? "",
		images: message.images ?? [],
		files: message.files ?? [],
		partial: message.partial ?? false,
		lastCheckpointHash: message.lastCheckpointHash ?? "",
		isCheckpointCheckedOut: message.isCheckpointCheckedOut ?? false,
		isOperationOutsideWorkspace: message.isOperationOutsideWorkspace ?? false,
		conversationHistoryIndex: message.conversationHistoryIndex ?? 0,
		conversationHistoryDeletedRange: message.conversationHistoryDeletedRange
			? {
					startIndex: message.conversationHistoryDeletedRange[0],
					endIndex: message.conversationHistoryDeletedRange[1],
				}
			: undefined,
		// Additional optional fields for specific ask/say types
		sayTool: undefined,
		sayBrowserAction: undefined,
		browserActionResult: undefined,
		askUseMcpServer: undefined,
		planModeResponse: undefined,
		askQuestion: undefined,
		askNewTask: undefined,
		apiReqInfo: undefined,
		modelInfo: message.modelInfo ?? undefined,
	}

	return protoMessage
}

/**
 * Convert proto ShuncodeMessage to application ShuncodeMessage
 */
export function convertProtoToShuncodeMessage(protoMessage: ProtoShuncodeMessage): AppShuncodeMessage {
	const message: AppShuncodeMessage = {
		ts: protoMessage.ts,
		type: protoMessage.type === ShuncodeMessageType.ASK ? "ask" : "say",
	}

	// Convert ask enum to string
	if (protoMessage.type === ShuncodeMessageType.ASK) {
		const ask = convertProtoEnumToShuncodeAsk(protoMessage.ask)
		if (ask !== undefined) {
			message.ask = ask
		}
	}

	// Convert say enum to string
	if (protoMessage.type === ShuncodeMessageType.SAY) {
		const say = convertProtoEnumToShuncodeSay(protoMessage.say)
		if (say !== undefined) {
			message.say = say
		}
	}

	// Convert other fields - preserve empty strings as they may be intentional
	if (protoMessage.text !== "") {
		message.text = protoMessage.text
	}
	if (protoMessage.reasoning !== "") {
		message.reasoning = protoMessage.reasoning
	}
	if (protoMessage.images.length > 0) {
		message.images = protoMessage.images
	}
	if (protoMessage.files.length > 0) {
		message.files = protoMessage.files
	}
	if (protoMessage.partial) {
		message.partial = protoMessage.partial
	}
	if (protoMessage.lastCheckpointHash !== "") {
		message.lastCheckpointHash = protoMessage.lastCheckpointHash
	}
	if (protoMessage.isCheckpointCheckedOut) {
		message.isCheckpointCheckedOut = protoMessage.isCheckpointCheckedOut
	}
	if (protoMessage.isOperationOutsideWorkspace) {
		message.isOperationOutsideWorkspace = protoMessage.isOperationOutsideWorkspace
	}
	if (protoMessage.conversationHistoryIndex !== 0) {
		message.conversationHistoryIndex = protoMessage.conversationHistoryIndex
	}

	// Convert conversationHistoryDeletedRange from object to tuple
	if (protoMessage.conversationHistoryDeletedRange) {
		message.conversationHistoryDeletedRange = [
			protoMessage.conversationHistoryDeletedRange.startIndex,
			protoMessage.conversationHistoryDeletedRange.endIndex,
		]
	}

	return message
}
