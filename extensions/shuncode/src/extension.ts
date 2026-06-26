// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below

import assert from "node:assert"
import { initDiffSystem, DiffSystem } from "./core/diff-v2"
import { getPendingChangesStorage } from "./core/diff-v2/storage/PendingChangesStorage"
import { DIFF_VIEW_URI_SCHEME } from "@hosts/vscode/VscodeDiffViewProvider"
import * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"
import { sendAccountButtonClickedEvent } from "./core/controller/ui/subscribeToAccountButtonClicked"
import { sendChatButtonClickedEvent } from "./core/controller/ui/subscribeToChatButtonClicked"
import { sendHistoryButtonClickedEvent } from "./core/controller/ui/subscribeToHistoryButtonClicked"
import { sendMcpButtonClickedEvent } from "./core/controller/ui/subscribeToMcpButtonClicked"
import { sendSettingsButtonClickedEvent } from "./core/controller/ui/subscribeToSettingsButtonClicked"
import { sendWorktreesButtonClickedEvent } from "./core/controller/ui/subscribeToWorktreesButtonClicked"
import { WebviewProvider } from "./core/webview"
import { createShuncodeAPI } from "./exports"
import { cleanupTestMode, initializeTestMode } from "./services/test/TestMode"
import "./utils/path" // necessary to have access to String.prototype.toPosix

import path from "node:path"
import type { ExtensionContext } from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { vscodeHostBridgeClient } from "@/hosts/vscode/hostbridge/client/host-grpc-client"
import { readTextFromClipboard, writeTextToClipboard } from "@/utils/env"
import { initialize, tearDown } from "./common"
import { setNotificationIconPath, setNotificationAppId } from "@integrations/notifications"
import { addToShuncode } from "./core/controller/commands/addToShuncode"
import { explainWithShuncode } from "./core/controller/commands/explainWithShuncode"
import { fixWithShuncode } from "./core/controller/commands/fixWithShuncode"
import { improveWithShuncode } from "./core/controller/commands/improveWithShuncode"
import { clearOnboardingModelsCache } from "./core/controller/models/getShuncodeOnboardingModels"
import { sendAddToInputEvent } from "./core/controller/ui/subscribeToAddToInput"
import { sendShowWebviewEvent } from "./core/controller/ui/subscribeToShowWebview"
import { HookDiscoveryCache } from "./core/hooks/HookDiscoveryCache"
import { HookProcessRegistry } from "./core/hooks/HookProcessRegistry"
import { workspaceResolver } from "./core/workspace"
import { findMatchingNotebookCell, getContextForCommand, showWebview } from "./hosts/vscode/commandUtils"
import { abortCommitGeneration, generateCommitMsg } from "./hosts/vscode/commit-message-generator"
import { executeInlineEdit } from "./core/inline-edit/InlineEditController"
import { StateManager } from "./core/storage/StateManager"
import {
	disposeVscodeCommentReviewController,
	getVscodeCommentReviewController,
} from "./hosts/vscode/review/VscodeCommentReviewController"
import { VscodeTerminalManager } from "./hosts/vscode/terminal/VscodeTerminalManager"
import { VscodeDiffViewProvider } from "./hosts/vscode/VscodeDiffViewProvider"
import { VscodeWebviewProvider } from "./hosts/vscode/VscodeWebviewProvider"
import { ExtensionRegistryInfo } from "./registry"
import { AuthService } from "./services/auth/AuthService"
import { LogoutReason } from "./services/auth/types"
import { telemetryService } from "./services/telemetry"
import { ShuncodeTempManager } from "./services/temp"
import { SharedUriHandler } from "./services/uri/SharedUriHandler"
import { AuthHandler } from "./hosts/external/AuthHandler"
import { ShowMessageType } from "./shared/proto/host/window"
import { fileExistsAtPath } from "./utils/fs"
import { ensureSkillsDirectoryExists } from "./core/storage/disk"
/*
Built using https://github.com/microsoft/vscode-webview-ui-toolkit

Inspired by
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/default/weather-webview
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/frameworks/hello-world-react-cra

*/

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	setupHostProvider(context)
	setNotificationIconPath(path.join(context.extensionPath, "assets", "icons", "icon.png"))

	try {
		await ensureSkillsDirectoryExists()
	} catch (error) {
		Logger.warn("Failed to initialize global skills directory:", error)
	}

	// Set Windows AppId for toast notifications with icon support.
	// Toast images only work with a registered AppUserModelId.
	// In production builds, Electron registers win32AppUserModelId from product.json.
	// In dev mode, the app runs under VS Code's registered AppId.
	if (process.platform === "win32") {
		const productJsonPath = path.join(vscode.env.appRoot, "product.json")
		try {
			const productJson = JSON.parse(require("fs").readFileSync(productJsonPath, "utf-8"))
			const appId = productJson.win32AppUserModelId
			// "Microsoft.CodeOSS" is not registered by Windows — use VS Code's AppId as fallback
			if (appId && appId !== "Microsoft.CodeOSS") {
				setNotificationAppId(appId)
			} else {
				setNotificationAppId("Microsoft.VisualStudioCode")
			}
		} catch {
			setNotificationAppId("Microsoft.VisualStudioCode")
		}
	}

	// Initialize hook discovery cache for performance optimization
	HookDiscoveryCache.getInstance().initialize(
		context as any, // Adapt VSCode ExtensionContext to generic interface
		(dir: string) => {
			try {
				const pattern = new vscode.RelativePattern(dir, "*")
				const watcher = vscode.workspace.createFileSystemWatcher(pattern)
				// Adapt VSCode FileSystemWatcher to generic interface
				return {
					onDidCreate: (listener: () => void) => watcher.onDidCreate(listener),
					onDidChange: (listener: () => void) => watcher.onDidChange(listener),
					onDidDelete: (listener: () => void) => watcher.onDidDelete(listener),
					dispose: () => watcher.dispose(),
				}
			} catch {
				return null
			}
		},
		(callback: () => void) => {
			// Adapt VSCode Disposable to generic interface
			return vscode.workspace.onDidChangeWorkspaceFolders(callback)
		},
	)

	let diffSystemV2: DiffSystem | null = null;
	try {
		diffSystemV2 = await initDiffSystem(context, false);
		console.log('[Shuncode] DiffSystem V2 initialized successfully (cleared old diffs)');
	} catch (error) {
		console.warn('[Shuncode] DiffSystem V2 failed to initialize (Proposed API may not be available):', error);
	}

	const webview = (await initialize(context)) as VscodeWebviewProvider

	// Sync pending changes count to webview when Accept/Reject happens in editor
	if (diffSystemV2) {
		context.subscriptions.push(
			getPendingChangesStorage().onDidChange(() => {
				webview.controller.postStateToWebview();
			})
		);
	}

	// Clean up old temp files in background (non-blocking) and start periodic cleanup every 24 hours
	ShuncodeTempManager.startPeriodicCleanup()

	Logger.log("Shuncode extension activated")

	const testModeWatchers = await initializeTestMode(webview)
	// Initialize test mode and add disposables to context
	context.subscriptions.push(...testModeWatchers)

	vscode.commands.executeCommand("setContext", "shuncode.isDevMode", IS_DEV && IS_DEV === "true")

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VscodeWebviewProvider.SIDEBAR_ID, webview, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	)

	// --- SHUNCODE_FORK_BEGIN: auto-open Shuncode panel on first launch ---
	try {
		const panelShownKey = "shuncode.panelAutoShown"
		if (!context.globalState.get<boolean>(panelShownKey)) {
			// Small delay to let the workbench finish layout
			setTimeout(() => {
				vscode.commands.executeCommand(`${ExtensionRegistryInfo.views.Sidebar}.focus`)
			}, 1500)
			context.globalState.update(panelShownKey, true)
		}
	} catch { /* ignore */ }
	// --- SHUNCODE_FORK_END ---

	const { commands } = ExtensionRegistryInfo

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.PlusButton, async () => {
			Logger.log("[DEBUG] plusButtonClicked → createSession")

			const sidebarInstance = WebviewProvider.getInstance()
			const controller = sidebarInstance.controller

			// Multi-tab: suspend current task, create new session, switch to it
			await controller.suspendCurrentTask()
			const session = controller.sessionManager.create()
			controller.sessionManager.switchTo(session.id)
			Logger.log(`[DEBUG] New session created: ${session.id}, total: ${controller.sessionManager.size}`)

			await controller.postStateToWebview()
			await sendChatButtonClickedEvent()
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.McpButton, () => {
			sendMcpButtonClickedEvent()
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.SettingsButton, () => {
			sendSettingsButtonClickedEvent()
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.HistoryButton, async () => {
			// Send event to all subscribers using the gRPC streaming method
			await sendHistoryButtonClickedEvent()
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.AccountButton, () => {
			// Send event to all subscribers using the gRPC streaming method
			sendAccountButtonClickedEvent()
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.WorktreesButton, () => {
			// Send event to all subscribers using the gRPC streaming method
			sendWorktreesButtonClickedEvent()
		}),
	)

	/*
	We use the text document content provider API to show the left side for diff view by creating a
	virtual document for the original content. This makes it readonly so users know to edit the right
	side if they want to keep their changes.

	- This API allows you to create readonly documents in VSCode from arbitrary sources, and works by
	claiming an uri-scheme for which your provider then returns text contents. The scheme must be
	provided when registering a provider and cannot change afterwards.
	- Note how the provider doesn't create uris for virtual documents - its role is to provide contents
	 given such an uri. In return, content providers are wired into the open document logic so that
	 providers are always considered.
	https://code.visualstudio.com/api/extension-guides/virtual-documents
	*/
	const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
		provideTextDocumentContent(uri: vscode.Uri): string {
			return Buffer.from(uri.query, "base64").toString("utf-8")
		}
	})()
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider))

	const handleUri = async (uri: vscode.Uri) => {
		const url = decodeURIComponent(uri.toString())
		const success = await SharedUriHandler.handleUri(url)
		if (!success) {
			Logger.warn("Extension URI handler: Failed to process URI:", uri.toString())
		}
	}
	context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }))

	// Register size testing commands in development mode
	if (IS_DEV && IS_DEV === "true") {
		// Use dynamic import to avoid loading the module in production
		import("./dev/commands/tasks")
			.then((module) => {
				const devTaskCommands = module.registerTaskCommands(webview.controller)
				context.subscriptions.push(...devTaskCommands)
				Logger.log("Shuncode dev task commands registered")
			})
			.catch((error) => {
				Logger.log("Failed to register dev task commands: " + error)
			})
	}

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.TerminalOutput, async () => {
			const terminal = vscode.window.activeTerminal
			if (!terminal) {
				return
			}

			// Save current clipboard content
			const tempCopyBuffer = await readTextFromClipboard()

			try {
				// Copy the *existing* terminal selection (without selecting all)
				await vscode.commands.executeCommand("workbench.action.terminal.copySelection")

				// Get copied content
				const terminalContents = (await readTextFromClipboard()).trim()

				// Restore original clipboard content
				await writeTextToClipboard(tempCopyBuffer)

				if (!terminalContents) {
					// No terminal content was copied (either nothing selected or some error)
					return
				}
				// Ensure the sidebar view is visible but preserve editor focus
				await showWebview(true)

				await sendAddToInputEvent(`Terminal output:\n\`\`\`\n${terminalContents}\n\`\`\``)

				Logger.log("addSelectedTerminalOutputToChat", terminalContents, terminal.name)
			} catch (error) {
				// Ensure clipboard is restored even if an error occurs
				await writeTextToClipboard(tempCopyBuffer)
				Logger.error("Error getting terminal contents:", error)
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "Failed to get terminal contents",
				})
			}
		}),
	)

	// Register code action provider
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			"*",
			new (class implements vscode.CodeActionProvider {
				public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Refactor]

				provideCodeActions(
					document: vscode.TextDocument,
					range: vscode.Range,
					context: vscode.CodeActionContext,
				): vscode.CodeAction[] {
					const CONTEXT_LINES_TO_EXPAND = 3
					const START_OF_LINE_CHAR_INDEX = 0
					const LINE_COUNT_ADJUSTMENT_FOR_ZERO_INDEXING = 1

					const actions: vscode.CodeAction[] = []
					const editor = vscode.window.activeTextEditor // Get active editor for selection check

					// Expand range to include surrounding 3 lines or use selection if broader
					const selection = editor?.selection
					let expandedRange = range
					if (
						editor &&
						selection &&
						!selection.isEmpty &&
						selection.contains(range.start) &&
						selection.contains(range.end)
					) {
						expandedRange = selection
					} else {
						expandedRange = new vscode.Range(
							Math.max(0, range.start.line - CONTEXT_LINES_TO_EXPAND),
							START_OF_LINE_CHAR_INDEX,
							Math.min(
								document.lineCount - LINE_COUNT_ADJUSTMENT_FOR_ZERO_INDEXING,
								range.end.line + CONTEXT_LINES_TO_EXPAND,
							),
							document.lineAt(
								Math.min(
									document.lineCount - LINE_COUNT_ADJUSTMENT_FOR_ZERO_INDEXING,
									range.end.line + CONTEXT_LINES_TO_EXPAND,
								),
							).text.length,
						)
					}

					// Add to ShunCode (Always available)
					const addAction = new vscode.CodeAction("Add to ShunCode", vscode.CodeActionKind.QuickFix)
					addAction.command = {
						command: commands.AddToChat,
						title: "Add to ShunCode",
						arguments: [expandedRange, context.diagnostics],
					}
					actions.push(addAction)

					// Explain with ShunCode (Always available)
					const explainAction = new vscode.CodeAction("Explain with ShunCode", vscode.CodeActionKind.RefactorExtract) // Using a refactor kind
					explainAction.command = {
						command: commands.ExplainCode,
						title: "Explain with ShunCode",
						arguments: [expandedRange],
					}
					actions.push(explainAction)

					// Improve with ShunCode (Always available)
					const improveAction = new vscode.CodeAction("Improve with ShunCode", vscode.CodeActionKind.RefactorRewrite) // Using a refactor kind
					improveAction.command = {
						command: commands.ImproveCode,
						title: "Improve with ShunCode",
						arguments: [expandedRange],
					}
					actions.push(improveAction)

					// Fix with ShunCode (Only if diagnostics exist)
					if (context.diagnostics.length > 0) {
						const fixAction = new vscode.CodeAction("Fix with ShunCode", vscode.CodeActionKind.QuickFix)
						fixAction.isPreferred = true
						fixAction.command = {
							command: commands.FixWithShuncode,
							title: "Fix with ShunCode",
							arguments: [expandedRange, context.diagnostics],
						}
						actions.push(fixAction)
					}
					return actions
				}
			})(),
			{
				providedCodeActionKinds: [
					vscode.CodeActionKind.QuickFix,
					vscode.CodeActionKind.RefactorExtract,
					vscode.CodeActionKind.RefactorRewrite,
				],
			},
		),
	)

	// Register the command handlers
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.AddToChat, async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
			const context = await getContextForCommand(range, diagnostics)
			if (!context) {
				return
			}
			await addToShuncode(context.controller, context.commandContext)
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.FixWithShuncode, async (range: vscode.Range, diagnostics: vscode.Diagnostic[]) => {
			const context = await getContextForCommand(range, diagnostics)
			if (!context) {
				return
			}
			await fixWithShuncode(context.controller, context.commandContext)
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.ExplainCode, async (range: vscode.Range) => {
			const context = await getContextForCommand(range)
			if (!context) {
				return
			}
			await explainWithShuncode(context.controller, context.commandContext)
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.ImproveCode, async (range: vscode.Range) => {
			const context = await getContextForCommand(range)
			if (!context) {
				return
			}
			await improveWithShuncode(context.controller, context.commandContext)
		}),
	)

	// Inline Edit (Ctrl+Shift+K)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.InlineEdit, async () => {
			await executeInlineEdit(StateManager.get())
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.FocusChatInput, async (preserveEditorFocus: boolean = false) => {
			const webview = WebviewProvider.getInstance() as VscodeWebviewProvider

			// Show the webview
			const webviewView = webview.getWebview()
			if (webviewView) {
				if (preserveEditorFocus) {
					// Only make webview visible without forcing focus
					webviewView.show(false)
				} else {
					// Show and force focus (default behavior for explicit focus actions)
					webviewView.show(true)
				}
			}

			// Send show webview event with preserveEditorFocus flag
			sendShowWebviewEvent(preserveEditorFocus)
			telemetryService.captureButtonClick("command_focusChatInput", webview.controller?.task?.ulid)
		}),
	)

	// Register Jupyter Notebook command handlers
	const NOTEBOOK_EDIT_INSTRUCTIONS = `Special considerations for using replace_in_file on *.ipynb files:
* Jupyter notebook files are JSON format with specific structure for source code cells
* Source code in cells is stored as JSON string arrays ending with explicit \\n characters and commas
* Always match the exact JSON format including quotes, commas, and escaped newlines.`

	// Helper to get notebook context for Jupyter commands
	async function getNotebookCommandContext(range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) {
		const activeNotebook = vscode.window.activeNotebookEditor
		if (!activeNotebook) {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "No active Jupyter notebook found. Please open a .ipynb file first.",
			})
			return null
		}

		const ctx = await getContextForCommand(range, diagnostics)
		if (!ctx) {
			return null
		}

		const filePath = ctx.commandContext.filePath || ""
		let cellJson: string | null = null
		if (activeNotebook.notebook.cellCount > 0) {
			const cellIndex = activeNotebook.notebook.cellAt(activeNotebook.selection.start).index
			cellJson = await findMatchingNotebookCell(filePath, cellIndex)
		}

		return { ...ctx, cellJson }
	}

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.JupyterGenerateCell,
			async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
				const userPrompt = await showJupyterPromptInput(
					"Generate Notebook Cell",
					"Enter your prompt for generating notebook cell (press Enter to confirm & Esc to cancel)",
				)
				if (!userPrompt) return

				const ctx = await getNotebookCommandContext(range, diagnostics)
				if (!ctx) return

				const notebookContext = `User prompt: ${userPrompt}
Insert a new Jupyter notebook cell above or below the current cell based on user prompt.
${NOTEBOOK_EDIT_INSTRUCTIONS}

Current Notebook Cell Context (JSON, sanitized of image data):
\`\`\`json
${ctx.cellJson || "{}"}
\`\`\``

				await addToShuncode(ctx.controller, ctx.commandContext, notebookContext)
			},
		),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.JupyterExplainCell,
			async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
				const ctx = await getNotebookCommandContext(range, diagnostics)
				if (!ctx) return

				const notebookContext = ctx.cellJson
					? `\n\nCurrent Notebook Cell Context (JSON, sanitized of image data):\n\`\`\`json\n${ctx.cellJson}\n\`\`\``
					: undefined

				await explainWithShuncode(ctx.controller, ctx.commandContext, notebookContext)
			},
		),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.JupyterImproveCell,
			async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
				const userPrompt = await showJupyterPromptInput(
					"Improve Notebook Cell",
					"Enter your prompt for improving the current notebook cell (press Enter to confirm & Esc to cancel)",
				)
				if (!userPrompt) return

				const ctx = await getNotebookCommandContext(range, diagnostics)
				if (!ctx) return

				const notebookContext = `User prompt: ${userPrompt}
${NOTEBOOK_EDIT_INSTRUCTIONS}

Current Notebook Cell Context (JSON, sanitized of image data):
\`\`\`json
${ctx.cellJson || "{}"}
\`\`\``

				await improveWithShuncode(ctx.controller, ctx.commandContext, notebookContext)
			},
		),
	)

	// Pending changes commands (TreeView stubs + real handlers)
	context.subscriptions.push(
		vscode.commands.registerCommand("shuncode.pendingChanges.refresh", () => { }),
		vscode.commands.registerCommand("shuncode.pendingChanges.openFile", () => { }),
		vscode.commands.registerCommand("shuncode.pendingChanges.acceptAll", async () => {
			await vscode.commands.executeCommand("shuncode.diff.clearAll")
		}),
		vscode.commands.registerCommand("shuncode.pendingChanges.rejectAll", async () => {
			const diffSystem = (await import("./core/diff-v2")).getDiffSystem()
			if (diffSystem) {
				await diffSystem.rejectAll()
			}
		}),
		vscode.commands.registerCommand("shuncode.pendingChanges.acceptFile", () => {
			vscode.commands.executeCommand("shuncode.diff.acceptAllInFile")
		}),
		vscode.commands.registerCommand("shuncode.pendingChanges.rejectFile", () => {
			vscode.commands.executeCommand("shuncode.diff.rejectAllInFile")
		}),
		vscode.commands.registerCommand("shuncode.clearAllDiffs", async () => {
			await vscode.commands.executeCommand("shuncode.diff.clearAll")
		}),
	)

	// Register the openWalkthrough command handler
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.Walkthrough, async () => {
			await vscode.commands.executeCommand("workbench.action.openWalkthrough", `${context.extension.id}#ShunCodeWalkthrough`)
			telemetryService.captureButtonClick("command_openWalkthrough")
		}),
	)

	// Register the reconstructTaskHistory command handler
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.ReconstructTaskHistory, async () => {
			const { reconstructTaskHistory } = await import("./core/commands/reconstructTaskHistory")
			await reconstructTaskHistory()
			telemetryService.captureButtonClick("command_reconstructTaskHistory")
		}),
	)

	// Register the generateGitCommitMessage command handler
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.GenerateCommit, async (scm) => {
			generateCommitMsg(webview.controller.stateManager, scm)
		}),
		vscode.commands.registerCommand(commands.AbortCommit, () => {
			abortCommitGeneration()
		}),
	)

	context.subscriptions.push(
		context.secrets.onDidChange(async (event) => {
			if (event.key === "shuncode:shuncodeAccountId") {
				// Check if the secret was removed (logout) or added/updated (login)
				const secretValue = await context.secrets.get(event.key)
				const activeWebview = WebviewProvider.getVisibleInstance()
				const controller = activeWebview?.controller

				const authService = AuthService.getInstance(controller)
				if (secretValue) {
					// Secret was added or updated - restore auth info (login from another window)
					authService?.restoreRefreshTokenAndRetrieveAuthInfo()
				} else {
					// Secret was removed - handle logout for all windows
					authService?.handleDeauth(LogoutReason.CROSS_WINDOW_SYNC)
				}
			}
		}),
	)

	return createShuncodeAPI(webview.controller)
}

async function showJupyterPromptInput(title: string, placeholder: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		const quickPick = vscode.window.createQuickPick()
		quickPick.title = title
		quickPick.placeholder = placeholder
		quickPick.ignoreFocusOut = true

		// Allow free text input
		quickPick.canSelectMany = false

		let userInput = ""

		quickPick.onDidChangeValue((value) => {
			userInput = value
			// Update items to show the current input
			if (value) {
				quickPick.items = [
					{
						label: "$(check) Use this prompt",
						detail: value,
						alwaysShow: true,
					},
				]
			} else {
				quickPick.items = []
			}
		})

		quickPick.onDidAccept(() => {
			if (userInput) {
				resolve(userInput)
				quickPick.hide()
			}
		})

		quickPick.onDidHide(() => {
			if (!userInput) {
				resolve(undefined)
			}
			quickPick.dispose()
		})

		quickPick.show()
	})
}

function setupHostProvider(context: ExtensionContext) {
	Logger.log("Setting up vscode host providers...")

	const createWebview = () => new VscodeWebviewProvider(context)
	const createDiffView = () => new VscodeDiffViewProvider()
	const createCommentReview = () => getVscodeCommentReviewController()
	const createTerminalManager = () => new VscodeTerminalManager()
	const outputChannel = vscode.window.createOutputChannel("ShunCode")
	context.subscriptions.push(outputChannel)

	// Use a local HTTP server for auth callbacks instead of the shuncode:// URI scheme.
	// The URI scheme launches a new Electron instance in dev mode which doesn't share
	// the single-instance lock with the running IDE, causing a second window to open.
	const getCallbackUrl = async () => {
		const authHandler = AuthHandler.getInstance()
		authHandler.setEnabled(true)
		return await authHandler.getCallbackUrl()
	}
	HostProvider.initialize(
		createWebview,
		createDiffView,
		createCommentReview,
		createTerminalManager,
		vscodeHostBridgeClient,
		outputChannel.appendLine,
		getCallbackUrl,
		getBinaryLocation,
		context.extensionUri.fsPath,
		context.globalStorageUri.fsPath,
	)
}

async function getBinaryLocation(name: string): Promise<string> {
	// The only binary currently supported is the rg binary from the VSCode installation.
	if (!name.startsWith("rg")) {
		throw new Error(`Binary '${name}' is not supported`)
	}

	const checkPath = async (pkgFolder: string) => {
		const fullPathResult = workspaceResolver.resolveWorkspacePath(
			vscode.env.appRoot,
			path.join(pkgFolder, name),
			"Services.ripgrep.getBinPath",
		)
		const fullPath = typeof fullPathResult === "string" ? fullPathResult : fullPathResult.absolutePath
		return (await fileExistsAtPath(fullPath)) ? fullPath : undefined
	}

	const binPath =
		(await checkPath("node_modules/@vscode/ripgrep/bin/")) ||
		(await checkPath("node_modules/vscode-ripgrep/bin")) ||
		(await checkPath("node_modules.asar.unpacked/vscode-ripgrep/bin/")) ||
		(await checkPath("node_modules.asar.unpacked/@vscode/ripgrep/bin/"))
	if (!binPath) {
		throw new Error("Could not find ripgrep binary")
	}
	return binPath
}

// This method is called when your extension is deactivated
export async function deactivate() {
	Logger.log("Shuncode extension deactivating, cleaning up resources...")

	// Stop periodic temp file cleanup
	ShuncodeTempManager.stopPeriodicCleanup()

	tearDown()

	// Clean up test mode
	cleanupTestMode()

	// Kill any running hook processes to prevent zombies
	await HookProcessRegistry.terminateAll()

	// Clean up hook discovery cache
	HookDiscoveryCache.getInstance().dispose()

	// Clean up comment review controller
	disposeVscodeCommentReviewController()

	clearOnboardingModelsCache()

	Logger.log("Shuncode extension deactivated")
}

// TODO: Find a solution for automatically removing DEV related content from production builds.
//  This type of code is fine in production to keep. We just will want to remove it from production builds
//  to bring down built asset sizes.
//
// This is a workaround to reload the extension when the source code changes
// since vscode doesn't support hot reload for extensions
const IS_DEV = process.env.IS_DEV
const DEV_WORKSPACE_FOLDER = process.env.DEV_WORKSPACE_FOLDER

// Set up development mode file watcher
if (IS_DEV && IS_DEV !== "false") {
	assert(DEV_WORKSPACE_FOLDER, "DEV_WORKSPACE_FOLDER must be set in development")
	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(DEV_WORKSPACE_FOLDER, "src/**/*"))

	watcher.onDidChange(({ scheme, path }) => {
		Logger.info(`${scheme} ${path} changed. Reloading VSCode...`)

		vscode.commands.executeCommand("workbench.action.reloadWindow")
	})
}
