// type that represents json data that is sent from extension to webview, called ExtensionMessage and has 'type' enum which can be 'plusButtonClicked' or 'settingsButtonClicked' or 'hello'

import { WorkspaceRoot } from "@shared/multi-root/types"
import { RemoteConfigFields } from "@shared/storage/state-keys"
import type { Environment } from "../config"
import { AutoApprovalSettings } from "./AutoApprovalSettings"
import { ApiConfiguration } from "./api"
import { BrowserSettings } from "./BrowserSettings"
import { ShuncodeFeatureSetting } from "./ShuncodeFeatureSetting"
import { FastContextConfig } from "./FastContextTypes"
import { BannerCardData } from "./shuncode/banner"
import { ShuncodeRulesToggles } from "./shuncode-rules"
import { DictationSettings } from "./DictationSettings"
import { FocusChainSettings } from "./FocusChainSettings"
import { HistoryItem } from "./HistoryItem"
import { McpDisplayMode } from "./McpDisplayMode"
import { ShuncodeMessageModelInfo } from "./messages"
import { OnboardingModelGroup } from "./proto/shuncode/state"
import { Mode, OpenaiReasoningEffort } from "./storage/types"
import { TelemetrySetting } from "./TelemetrySetting"
import type { SystemPromptSettings } from "./SystemPromptSettings"
import type { ToolCustomizationSettings } from "./ToolCustomizationSettings"
import { UserInfo } from "./UserInfo"
// webview will hold state
export interface ExtensionMessage {
	type: "grpc_response" // New type for gRPC responses
	grpc_response?: GrpcResponse
}

export type GrpcResponse = {
	message?: any // JSON serialized protobuf message
	request_id: string // Same ID as the request
	error?: string // Optional error message
	is_streaming?: boolean // Whether this is part of a streaming response
	sequence_number?: number // For ordering chunks in streaming responses
}

export type Platform = "aix" | "darwin" | "freebsd" | "linux" | "openbsd" | "sunos" | "win32" | "unknown"

export const DEFAULT_PLATFORM = "unknown"

export const COMMAND_CANCEL_TOKEN = "__shuncode_command_cancel__"

/**
 * Info about pending change for webview display
 */
export interface PendingChangeInfo {
	id: string
	fileName: string
	fsPath: string
	addedCount: number
	removedCount: number
}

export interface ExtensionState {
	isNewUser: boolean
	welcomeViewCompleted: boolean
	onboardingModels: OnboardingModelGroup | undefined
	apiConfiguration?: ApiConfiguration
	autoApprovalSettings: AutoApprovalSettings
	browserSettings: BrowserSettings
	remoteBrowserHost?: string
	preferredLanguage?: string
	alwaysThinkInPreferredLanguage?: boolean
	openaiReasoningEffort?: OpenaiReasoningEffort
	mode: Mode
	checkpointManagerErrorMessage?: string
	shuncodeMessages: ShuncodeMessage[]
	/** ID текущей сессии (для подписки через SessionService) */
	currentSessionId?: string
	currentTaskItem?: HistoryItem
	currentFocusChainChecklist?: string | null
	mcpMarketplaceEnabled?: boolean
	mcpDisplayMode: McpDisplayMode
	planActSeparateModelsSetting: boolean
	enableCheckpointsSetting?: boolean
	platform: Platform
	environment?: Environment
	shouldShowAnnouncement: boolean
	taskHistory: HistoryItem[]
	telemetrySetting: TelemetrySetting
	shellIntegrationTimeout: number
	terminalReuseEnabled?: boolean
	terminalOutputLineLimit: number
	maxConsecutiveMistakes: number
	subagentTerminalOutputLineLimit: number
	defaultTerminalProfile?: string
	vscodeTerminalExecutionMode: string
	backgroundCommandRunning?: boolean
	backgroundCommandTaskId?: string
	lastCompletedCommandTs?: number
	userInfo?: UserInfo
	version: string
	distinctId: string
	globalShuncodeRulesToggles: ShuncodeRulesToggles
	localShuncodeRulesToggles: ShuncodeRulesToggles
	localWorkflowToggles: ShuncodeRulesToggles
	globalWorkflowToggles: ShuncodeRulesToggles
	localCursorRulesToggles: ShuncodeRulesToggles
	localWindsurfRulesToggles: ShuncodeRulesToggles
	remoteRulesToggles?: ShuncodeRulesToggles
	remoteWorkflowToggles?: ShuncodeRulesToggles
	localAgentsRulesToggles: ShuncodeRulesToggles
	mcpResponsesCollapsed?: boolean
	strictPlanModeEnabled?: boolean
	yoloModeToggled?: boolean
	useAutoCondense?: boolean
	shuncodeWebToolsEnabled?: ShuncodeFeatureSetting
	worktreesEnabled?: ShuncodeFeatureSetting
	focusChainSettings: FocusChainSettings
	dictationSettings: DictationSettings
	customPrompt?: string
	systemPromptSettings?: SystemPromptSettings
	toolCustomizationSettings?: ToolCustomizationSettings
	autoCondenseThreshold?: number
	favoritedModelIds: string[]
	// NEW: Add workspace information
	workspaceRoots: WorkspaceRoot[]
	primaryRootIndex: number
	isMultiRootWorkspace: boolean
	multiRootSetting: ShuncodeFeatureSetting
	lastDismissedInfoBannerVersion: number
	lastDismissedModelBannerVersion: number
	lastDismissedCliBannerVersion: number
	hooksEnabled?: boolean
	remoteConfigSettings?: Partial<RemoteConfigFields>
	subagentsEnabled?: boolean
	skillsEnabled?: boolean
	globalSkillsToggles?: Record<string, boolean>
	localSkillsToggles?: Record<string, boolean>
	nativeToolCallSetting?: boolean
	enableParallelToolCalling?: boolean
	// Shuncode AI: Lightweight mode for weak models
	lightweightMode?: boolean
	// Shuncode AI: Active prompt profile info (computed, read-only in UI)
	promptProfile?: { variant: string; tier: string; maxToolCalls: number; maxReadOnly: number; compactEvery: number }
	// Shuncode AI: Edit tools settings
	useSimplifiedEditTools?: boolean
	validateSyntaxBeforeApply?: boolean
	blockOnSyntaxErrors?: boolean
	backgroundEditEnabled?: boolean
	// Image generation endpoint configuration
	imageGenerationBaseUrl?: string
	imageGenerationApiKey?: string
	imageGenerationModelId?: string
	// Shuncode AI: Fast Context sub-agent
	fastContextConfig?: FastContextConfig
	// Shuncode AI: Pending changes for inline diffs
	pendingChanges?: PendingChangeInfo[]
	optOutOfRemoteConfig?: boolean
	banners?: BannerCardData[]
	openAiCodexIsAuthenticated?: boolean
	// Free-trial gate
	freeRequestCount?: number
	freeRequestLimit?: number
	// Multi-step workflow
	activeWorkflowName?: string
}

export interface ShuncodeMessage {
	ts: number
	type: "ask" | "say"
	ask?: ShuncodeAsk
	say?: ShuncodeSay
	text?: string
	reasoning?: string
	images?: string[]
	files?: string[]
	partial?: boolean
	commandCompleted?: boolean
	lastCheckpointHash?: string
	isCheckpointCheckedOut?: boolean
	isOperationOutsideWorkspace?: boolean
	conversationHistoryIndex?: number
	conversationHistoryDeletedRange?: [number, number] // for when conversation history is truncated for API requests
	modelInfo?: ShuncodeMessageModelInfo
}

export type ShuncodeAsk =
	| "followup"
	| "plan_mode_respond"
	| "act_mode_respond"
	| "command"
	| "command_output"
	| "completion_result"
	| "tool"
	| "api_req_failed"
	| "resume_task"
	| "resume_completed_task"
	| "mistake_limit_reached"
	| "browser_action_launch"
	| "use_mcp_server"
	| "new_task"
	| "condense"
	| "summarize_task"
	| "report_bug"

export type ShuncodeSay =
	| "task"
	| "error"
	| "error_retry"
	| "api_req_started"
	| "api_req_finished"
	| "text"
	| "reasoning"
	| "completion_result"
	| "user_feedback"
	| "user_feedback_diff"
	| "api_req_retried"
	| "command"
	| "command_output"
	| "tool"
	| "shell_integration_warning"
	| "shell_integration_warning_with_suggestion"
	| "browser_action_launch"
	| "browser_action"
	| "browser_action_result"
	| "mcp_server_request_started"
	| "mcp_server_response"
	| "mcp_notification"
	| "use_mcp_server"
	| "diff_error"
	| "deleted_api_reqs"
	| "shuncodeignore_error"
	| "command_permission_denied"
	| "checkpoint_created"
	| "load_mcp_documentation"
	| "generate_explanation"
	| "info" // Added for general informational messages like retry status
	| "task_progress"
	| "hook_status"
	| "hook_output_stream"
	| "conditional_rules_applied"
	| "workflow_step_start"

export interface ShuncodeSayTool {
	tool:
	| "editedExistingFile"
	| "newFileCreated"
	| "fileDeleted"
	| "readFile"
	| "readDiagnostics"
	| "listFilesTopLevel"
	| "listFilesRecursive"
	| "listCodeDefinitionNames"
	| "goToDefinition"
	| "findReferences"
	| "getHover"
	| "searchFiles"
	| "glob"
	| "webFetch"
	| "webSearch"
	| "summarizeTask"
	| "useSkill"
	| "memory"
	| "command"
	| "fastContext"
	| "generateImage"
	action?: string
	status?: string
	path?: string
	/** Line range for readFile: "startLine-endLine" (e.g. "1-100") */
	lineRange?: string
	diff?: string
	content?: string
	regex?: string
	filePattern?: string
	operationIsLocatedInWorkspace?: boolean
	/** Starting line numbers in the original file where each SEARCH block matched */
	startLineNumbers?: number[]
	/** Hunk ID in DiffStore — used to resolve current line after subsequent edits */
	hunkId?: string
	/** Fast Context sub-agent operations (for live progress display) */
	operations?: Array<{
		type: "grep" | "read_file" | "find_files"
		args: string
		status: "running" | "done"
		duration?: number
	}>
	/** Fast Context turns (Windsurf-style: grouped by turn with reasoning) */
	turns?: Array<{
		turnNumber: number
		reasoning?: string
		operations: Array<{
			type: "grep" | "read_file" | "find_files"
			args: string
			status: "running" | "done"
			duration?: number
		}>
	}>
	/** Fast Context query */
	query?: string
	/** Fast Context sub-agent reasoning */
	reasoning?: string
	/** Fast Context current turn */
	currentTurn?: number
	/** Fast Context max turns */
	maxTurns?: number
	/** Fast Context result count */
	resultCount?: number
	/** Fast Context total duration in ms */
	durationMs?: number
	/** Fast Context found files list (Windsurf-style result display) */
	foundFiles?: Array<{
		filePath: string
		startLine: number
		endLine: number
		relevance?: string
	}>
}

export interface ShuncodeSayHook {
	hookName: string // Name of the hook (e.g., "PreToolUse", "PostToolUse")
	toolName?: string // Tool name if applicable (for PreToolUse/PostToolUse)
	status: "running" | "completed" | "failed" | "cancelled" // Execution status
	exitCode?: number // Exit code when completed
	hasJsonResponse?: boolean // Whether a JSON response was parsed
	// Pending tool information (only present during PreToolUse "running" status)
	pendingToolInfo?: {
		tool: string // Tool name (e.g., "write_to_file", "execute_command")
		path?: string // File path for file operations
		command?: string // Command for execute_command
		content?: string // Content preview (first 200 chars)
		diff?: string // Diff preview (first 200 chars)
		regex?: string // Regex pattern for search_files
		url?: string // URL for web_fetch or browser_action
		mcpTool?: string // MCP tool name
		mcpServer?: string // MCP server name
		resourceUri?: string // MCP resource URI
	}
	// Structured error information (only present when status is "failed")
	error?: {
		type: "timeout" | "validation" | "execution" | "cancellation" // Type of error
		message: string // User-friendly error message
		details?: string // Technical details for expansion
		scriptPath?: string // Path to the hook script
	}
}

export type HookOutputStreamMeta = {
	/** Which hook configuration the script originated from (global vs workspace). */
	source: "global" | "workspace"
	/** Full path to the hook script that emitted the output. */
	scriptPath: string
}

// must keep in sync with system prompt
export const browserActions = ["launch", "click", "type", "scroll_down", "scroll_up", "close"] as const
export type BrowserAction = (typeof browserActions)[number]

export interface ShuncodeSayBrowserAction {
	action: BrowserAction
	coordinate?: string
	text?: string
}

export interface ShuncodeSayGenerateExplanation {
	title: string
	fromRef: string
	toRef: string
	status: "generating" | "complete" | "error"
	error?: string
}

export type BrowserActionResult = {
	screenshot?: string
	logs?: string
	currentUrl?: string
	currentMousePosition?: string
}

export interface ShuncodeAskUseMcpServer {
	serverName: string
	type: "use_mcp_tool" | "access_mcp_resource"
	toolName?: string
	arguments?: string
	uri?: string
}

export interface ShuncodePlanModeResponse {
	response: string
	options?: string[]
	selected?: string
}

export interface ShuncodeAskQuestion {
	question: string
	options?: string[]
	selected?: string
}

export interface ShuncodeAskNewTask {
	context: string
}

export interface ShuncodeApiReqInfo {
	request?: string
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	cost?: number
	cancelReason?: ShuncodeApiReqCancelReason
	streamingFailedMessage?: string
	retryStatus?: {
		attempt: number
		maxAttempts: number
		delaySec: number
		errorSnippet?: string
	}
}

export type ShuncodeApiReqCancelReason = "streaming_failed" | "user_cancelled" | "retries_exhausted"

export const COMPLETION_RESULT_CHANGES_FLAG = "HAS_CHANGES"
