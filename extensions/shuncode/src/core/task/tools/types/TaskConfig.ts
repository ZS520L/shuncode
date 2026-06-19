import type { ApiHandler } from "@core/api"
import type { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import type { ShuncodeIgnoreController } from "@core/ignore/ShuncodeIgnoreController"
import type { CommandPermissionController } from "@core/permissions"
import type { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import type { BrowserSession } from "@services/browser/BrowserSession"
import type { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import type { McpHub } from "@services/mcp/McpHub"
import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import type { BrowserSettings } from "@shared/BrowserSettings"
import type { ShuncodeAsk, ShuncodeSay } from "@shared/ExtensionMessage"
import type { FocusChainSettings } from "@shared/FocusChainSettings"
import type { ShuncodeContent } from "@shared/messages/content"
import type { Mode } from "@shared/storage/types"
import type { ShuncodeDefaultTool } from "@shared/tools"
import type { ShuncodeAskResponse } from "@shared/WebviewMessage"
import * as vscode from "vscode"
import { WorkspaceRootManager } from "@/core/workspace"
import type { ContextManager } from "../../../context/context-management/ContextManager"
import type { StateManager } from "../../../storage/StateManager"
import type { DiffSystem } from "../../../diff-v2"
import type { MessageStateHandler } from "../../message-state"
import type { TaskState } from "../../TaskState"
import type { AutoApprove } from "../../tools/autoApprove"
import type { HookExecution } from "../../types/HookExecution"
import type { ToolExecutorCoordinator } from "../ToolExecutorCoordinator"
import { TASK_CALLBACKS_KEYS, TASK_CONFIG_KEYS, TASK_SERVICES_KEYS } from "../utils/ToolConstants"

/**
 * Strongly-typed configuration object passed to tool handlers
 */
export interface TaskConfig {
	// Core identifiers
	taskId: string
	ulid: string
	cwd: string
	mode: Mode
	strictPlanModeEnabled: boolean
	yoloModeToggled: boolean
	vscodeTerminalExecutionMode: "vscodeTerminal" | "backgroundExec"
	enableParallelToolCalling: boolean
	context: vscode.ExtensionContext

	// Multi-workspace support (optional for backward compatibility)
	workspaceManager?: WorkspaceRootManager
	isMultiRootEnabled?: boolean

	// State management
	taskState: TaskState
	messageState: MessageStateHandler

	// API and services
	api: ApiHandler
	services: TaskServices

	// Settings
	autoApprovalSettings: AutoApprovalSettings
	autoApprover: AutoApprove
	browserSettings: BrowserSettings
	focusChainSettings: FocusChainSettings

	// Callbacks (strongly typed)
	callbacks: TaskCallbacks

	// Tool coordination
	coordinator: ToolExecutorCoordinator
}

/**
 * All services available to tool handlers
 */
export interface TaskServices {
	mcpHub: McpHub
	browserSession: BrowserSession
	urlContentFetcher: UrlContentFetcher
	diffViewProvider: DiffViewProvider
	fileContextTracker: FileContextTracker
	shuncodeIgnoreController: ShuncodeIgnoreController
	commandPermissionController: CommandPermissionController
	contextManager: ContextManager
	stateManager: StateManager
	diffSystem: DiffSystem | null // DiffSystem V2 (Proposed API)
}

/**
 * All callback functions available to tool handlers
 */
export interface TaskCallbacks {
	say: (type: ShuncodeSay, text?: string, images?: string[], files?: string[], partial?: boolean) => Promise<number | undefined>

	ask: (
		type: ShuncodeAsk,
		text?: string,
		partial?: boolean,
	) => Promise<{
		response: ShuncodeAskResponse
		text?: string
		images?: string[]
		files?: string[]
	}>

	saveCheckpoint: (isAttemptCompletionMessage?: boolean, completionMessageTs?: number) => Promise<void>

	sayAndCreateMissingParamError: (toolName: ShuncodeDefaultTool, paramName: string, relPath?: string) => Promise<any>

	removeLastPartialMessageIfExistsWithType: (type: "ask" | "say", askOrSay: ShuncodeAsk | ShuncodeSay) => Promise<void>

	executeCommandTool: (command: string, timeoutSeconds: number | undefined) => Promise<[boolean, any]>

	doesLatestTaskCompletionHaveNewChanges: () => Promise<boolean>

	updateFCListFromToolResponse: (taskProgress: string | undefined) => Promise<void>

	shouldAutoApproveTool: (toolName: ShuncodeDefaultTool) => boolean | [boolean, boolean]
	shouldAutoApproveToolWithPath: (toolName: ShuncodeDefaultTool, path?: string) => Promise<boolean>

	// Additional callbacks for task management
	postStateToWebview: () => Promise<void>
	reinitExistingTaskFromId: (taskId: string) => Promise<void>
	cancelTask: () => Promise<void>
	updateTaskHistory: (update: any) => Promise<any[]>

	applyLatestBrowserSettings: () => Promise<BrowserSession>

	switchToActMode: () => Promise<boolean>

	// Hook execution callbacks
	setActiveHookExecution: (hookExecution: HookExecution) => Promise<void>
	clearActiveHookExecution: () => Promise<void>
	getActiveHookExecution: () => Promise<HookExecution | undefined>

	// User prompt hook callback
	runUserPromptSubmitHook: (
		userContent: ShuncodeContent[],
		context: "initial_task" | "resume" | "feedback",
	) => Promise<{ cancel?: boolean; wasCancelled?: boolean; contextModification?: string; errorMessage?: string }>
}

/**
 * Runtime validation function to ensure config has all required properties
 * Automatically derives expected keys from the interface definitions
 */
export function validateTaskConfig(config: any): asserts config is TaskConfig {
	if (!config) {
		throw new Error("TaskConfig is null or undefined")
	}

	// Validate all expected keys exist
	for (const key of TASK_CONFIG_KEYS) {
		if (!(key in config)) {
			throw new Error(`Missing ${key} in TaskConfig`)
		}
	}

	// Special validation for boolean type
	if (typeof config.strictPlanModeEnabled !== "boolean") {
		throw new Error("strictPlanModeEnabled must be a boolean in TaskConfig")
	}

	// Validate services object
	if (config.services) {
		for (const key of TASK_SERVICES_KEYS) {
			if (!(key in config.services)) {
				throw new Error(`Missing services.${key} in TaskConfig`)
			}
		}
	}

	// Validate callbacks object
	if (config.callbacks) {
		for (const key of TASK_CALLBACKS_KEYS) {
			if (typeof config.callbacks[key] !== "function") {
				throw new Error(`Missing or invalid callbacks.${key} in TaskConfig (must be a function)`)
			}
		}
	}
}
