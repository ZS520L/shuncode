import * as vscode from "vscode"
import { buildApiHandler } from "@core/api"
import { Empty } from "@shared/proto/shuncode/common"
import {
	PlanActMode,
	McpDisplayMode as ProtoMcpDisplayMode,
	OpenaiReasoningEffort as ProtoOpenaiReasoningEffort,
	UpdateSettingsRequest,
} from "@shared/proto/shuncode/state"
import { getBackendLocaleForPreferredLanguage, setBackendLocale } from "../../../i18n/backend-i18n"
import { convertProtoToApiProvider } from "@shared/proto-conversions/models/api-configuration-conversion"
import { OpenaiReasoningEffort } from "@shared/storage/types"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import { normalizeSystemPromptSettings } from "@shared/SystemPromptSettings"
import { normalizeToolCustomizationSettings } from "@shared/ToolCustomizationSettings"
import { ShuncodeEnv } from "@/config"
import { fetchRemoteConfig } from "@/core/storage/remote-config/fetch"
import { clearRemoteConfig } from "@/core/storage/remote-config/utils"
import { HostProvider } from "@/hosts/host-provider"
import { McpDisplayMode } from "@/shared/McpDisplayMode"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { telemetryService } from "../../../services/telemetry"
import { BrowserSettings as SharedBrowserSettings } from "../../../shared/BrowserSettings"
import { Controller } from ".."
import { accountLogoutClicked } from "../account/accountLogoutClicked"

/**
 * Updates multiple extension settings in a single request
 * @param controller The controller instance
 * @param request The request containing the settings to update
 * @returns An empty response
 */
export async function updateSettings(controller: Controller, request: UpdateSettingsRequest): Promise<Empty> {
	try {
		let shouldRebuildTaskApiHandler = false

		if (request.shuncodeEnv !== undefined) {
			ShuncodeEnv.setEnvironment(request.shuncodeEnv)
			await accountLogoutClicked(controller, Empty.create())
		}

		if (request.apiConfiguration) {
			const protoApiConfiguration = request.apiConfiguration

			const convertedApiConfigurationFromProto = {
				...protoApiConfiguration,
				// Convert proto ApiProvider enums to native string types
				planModeApiProvider: protoApiConfiguration.planModeApiProvider
					? convertProtoToApiProvider(protoApiConfiguration.planModeApiProvider)
					: undefined,
				actModeApiProvider: protoApiConfiguration.actModeApiProvider
					? convertProtoToApiProvider(protoApiConfiguration.actModeApiProvider)
					: undefined,
			}

			controller.stateManager.setApiConfiguration(convertedApiConfigurationFromProto)
			shouldRebuildTaskApiHandler = true
		}

		// Update telemetry setting
		if (request.telemetrySetting) {
			await controller.updateTelemetrySetting(request.telemetrySetting as TelemetrySetting)
		}

		// Update plan/act separate models setting
		if (request.planActSeparateModelsSetting !== undefined) {
			controller.stateManager.setGlobalState("planActSeparateModelsSetting", request.planActSeparateModelsSetting)
		}

		// Update checkpoints setting
		if (request.enableCheckpointsSetting !== undefined) {
			controller.stateManager.setGlobalState("enableCheckpointsSetting", request.enableCheckpointsSetting)
		}

		// Update MCP responses collapsed setting
		if (request.mcpResponsesCollapsed !== undefined) {
			controller.stateManager.setGlobalState("mcpResponsesCollapsed", request.mcpResponsesCollapsed)
		}

		// Update MCP display mode setting
		if (request.mcpDisplayMode !== undefined) {
			// Convert proto enum to string type
			let displayMode: McpDisplayMode
			switch (request.mcpDisplayMode) {
				case ProtoMcpDisplayMode.RICH:
					displayMode = "rich"
					break
				case ProtoMcpDisplayMode.PLAIN:
					displayMode = "plain"
					break
				case ProtoMcpDisplayMode.MARKDOWN:
					displayMode = "markdown"
					break
				default:
					throw new Error(`Invalid MCP display mode value: ${request.mcpDisplayMode}`)
			}
			controller.stateManager.setGlobalState("mcpDisplayMode", displayMode)
		}

		if (request.mode !== undefined) {
			let mode: import("@shared/storage/types").Mode
			switch (request.mode) {
				case PlanActMode.PLAN:
					mode = "plan"
					break
				case PlanActMode.ACT:
					mode = "act"
					break
				case PlanActMode.PAM_ASK:
					mode = "ask"
					break
				case PlanActMode.DEBUG:
					mode = "debug"
					break
				case PlanActMode.CHAT:
					mode = "chat"
					break
				default:
					mode = "act"
			}
			controller.stateManager.setGlobalState("mode", mode)
			shouldRebuildTaskApiHandler = true
		}

		if (request.openaiReasoningEffort !== undefined) {
			// Convert proto enum to string type
			let reasoningEffort: OpenaiReasoningEffort
			switch (request.openaiReasoningEffort) {
				case ProtoOpenaiReasoningEffort.LOW:
					reasoningEffort = "low"
					break
				case ProtoOpenaiReasoningEffort.MEDIUM:
					reasoningEffort = "medium"
					break
				case ProtoOpenaiReasoningEffort.HIGH:
					reasoningEffort = "high"
					break
				case ProtoOpenaiReasoningEffort.XHIGH:
					reasoningEffort = "xhigh"
					break
				case ProtoOpenaiReasoningEffort.MINIMAL:
					reasoningEffort = "low"
					break
				default:
					throw new Error(`Invalid OpenAI reasoning effort value: ${request.openaiReasoningEffort}`)
			}

			controller.stateManager.setGlobalState("openaiReasoningEffort", reasoningEffort)
			shouldRebuildTaskApiHandler = true
		}

		if (request.preferredLanguage !== undefined) {
			controller.stateManager.setGlobalState("preferredLanguage", request.preferredLanguage)
			// Sync backend i18n locale based on preferred language selection.
			setBackendLocale(getBackendLocaleForPreferredLanguage(request.preferredLanguage))
		}

		if (request.alwaysThinkInPreferredLanguage !== undefined) {
			controller.stateManager.setGlobalState("alwaysThinkInPreferredLanguage", request.alwaysThinkInPreferredLanguage)
		}

		// Update terminal timeout setting
		if (request.shellIntegrationTimeout !== undefined) {
			controller.stateManager.setGlobalState("shellIntegrationTimeout", Number(request.shellIntegrationTimeout))
		}

		// Update terminal reuse setting
		if (request.terminalReuseEnabled !== undefined) {
			controller.stateManager.setGlobalState("terminalReuseEnabled", request.terminalReuseEnabled)
		}

		// Update terminal output line limit
		if (request.terminalOutputLineLimit !== undefined) {
			controller.stateManager.setGlobalState("terminalOutputLineLimit", Number(request.terminalOutputLineLimit))
		}

		if (request.vscodeTerminalExecutionMode !== undefined && request.vscodeTerminalExecutionMode !== "") {
			controller.stateManager.setGlobalState(
				"vscodeTerminalExecutionMode",
				request.vscodeTerminalExecutionMode === "backgroundExec" ? "backgroundExec" : "vscodeTerminal",
			)
		}

		// Update subagent terminal output line limit
		if (request.subagentTerminalOutputLineLimit !== undefined) {
			controller.stateManager.setGlobalState(
				"subagentTerminalOutputLineLimit",
				Number(request.subagentTerminalOutputLineLimit),
			)
		}

		// Update subagent terminal output line limit
		if (request.subagentTerminalOutputLineLimit !== undefined) {
			controller.stateManager.setGlobalState(
				"subagentTerminalOutputLineLimit",
				Number(request.subagentTerminalOutputLineLimit),
			)
		}

		// Update max consecutive mistakes
		if (request.maxConsecutiveMistakes !== undefined) {
			controller.stateManager.setGlobalState("maxConsecutiveMistakes", Number(request.maxConsecutiveMistakes))
		}

		// Update strict plan mode setting
		if (request.strictPlanModeEnabled !== undefined) {
			controller.stateManager.setGlobalState("strictPlanModeEnabled", request.strictPlanModeEnabled)
		}
		// Update yolo mode setting
		if (request.yoloModeToggled !== undefined) {
			if (controller.task) {
				telemetryService.captureYoloModeToggle(controller.task.ulid, request.yoloModeToggled)
			}
			controller.stateManager.setGlobalState("yoloModeToggled", request.yoloModeToggled)
		}

		// Update shuncode web tools setting
		if (request.shuncodeWebToolsEnabled !== undefined) {
			if (controller.task) {
				telemetryService.captureShuncodeWebToolsToggle(controller.task.ulid, request.shuncodeWebToolsEnabled)
			}
			controller.stateManager.setGlobalState("shuncodeWebToolsEnabled", request.shuncodeWebToolsEnabled)

			if (request.shuncodeWebToolsEnabled) {
				preloadChromiumIfNeeded()
			}
		}

		// Update worktrees setting
		if (request.worktreesEnabled !== undefined) {
			controller.stateManager.setGlobalState("worktreesEnabled", request.worktreesEnabled)
		}

		// Update auto-condense setting
		if (request.useAutoCondense !== undefined) {
			if (controller.task) {
				telemetryService.captureAutoCondenseToggle(
					controller.task.ulid,
					request.useAutoCondense,
					controller.task.api.getModel().id,
				)
			}
			controller.stateManager.setGlobalState("useAutoCondense", request.useAutoCondense)
		}

		// Update focus chain settings
		if (request.focusChainSettings !== undefined) {
			{
				const currentSettings = controller.stateManager.getGlobalSettingsKey("focusChainSettings")
				const wasEnabled = currentSettings?.enabled ?? false
				const isEnabled = request.focusChainSettings.enabled

				const focusChainSettings = {
					enabled: isEnabled,
					remindShuncodeInterval: request.focusChainSettings.remindShuncodeInterval,
				}
				controller.stateManager.setGlobalState("focusChainSettings", focusChainSettings)

				// Capture telemetry when setting changes
				if (wasEnabled !== isEnabled) {
					telemetryService.captureFocusChainToggle(isEnabled)
				}
			}
		}

		// Update custom prompt choice
		if (request.customPrompt !== undefined) {
			const value = request.customPrompt === "compact" ? "compact" : undefined
			controller.stateManager.setGlobalState("customPrompt", value)
		}

		if (request.systemPromptSettings !== undefined) {
			controller.stateManager.setGlobalState(
				"systemPromptSettings",
				normalizeSystemPromptSettings(request.systemPromptSettings),
			)
		}

		if (request.toolCustomizationSettings !== undefined) {
			controller.stateManager.setGlobalState(
				"toolCustomizationSettings",
				normalizeToolCustomizationSettings(request.toolCustomizationSettings),
			)
		}

		// Image generation endpoint configuration
		if (request.imageGenerationBaseUrl !== undefined) {
			controller.stateManager.setGlobalState("imageGenerationBaseUrl", request.imageGenerationBaseUrl || undefined)
		}
		if (request.imageGenerationApiKey !== undefined) {
			controller.stateManager.setGlobalState("imageGenerationApiKey", request.imageGenerationApiKey || undefined)
		}
		if (request.imageGenerationModelId !== undefined) {
			controller.stateManager.setGlobalState("imageGenerationModelId", request.imageGenerationModelId || undefined)
		}

		// Update browser settings
		if (request.browserSettings !== undefined) {
			// Get current browser settings to preserve fields not in the request
			const currentSettings = controller.stateManager.getGlobalSettingsKey("browserSettings")

			// Convert from protobuf format to shared format, merging with existing settings
			const newBrowserSettings: SharedBrowserSettings = {
				...currentSettings, // Start with existing settings (and defaults)
				viewport: {
					// Apply updates from request
					width: request.browserSettings.viewport?.width || currentSettings.viewport.width,
					height: request.browserSettings.viewport?.height || currentSettings.viewport.height,
				},
				// Explicitly handle optional boolean and string fields from the request
				remoteBrowserEnabled:
					request.browserSettings.remoteBrowserEnabled === undefined
						? currentSettings.remoteBrowserEnabled
						: request.browserSettings.remoteBrowserEnabled,
				remoteBrowserHost:
					request.browserSettings.remoteBrowserHost === undefined
						? currentSettings.remoteBrowserHost
						: request.browserSettings.remoteBrowserHost,
				chromeExecutablePath:
					// If chromeExecutablePath is explicitly in the request (even as ""), use it.
					// Otherwise, fall back to mergedWithDefaults.
					"chromeExecutablePath" in request.browserSettings
						? request.browserSettings.chromeExecutablePath
						: currentSettings.chromeExecutablePath,
				disableToolUse:
					request.browserSettings.disableToolUse === undefined
						? currentSettings.disableToolUse
						: request.browserSettings.disableToolUse,
				customArgs:
					"customArgs" in request.browserSettings ? request.browserSettings.customArgs : currentSettings.customArgs,
			}

			// Update global state with new settings
			controller.stateManager.setGlobalState("browserSettings", newBrowserSettings)
		}

		// Update default terminal profile
		if (request.defaultTerminalProfile !== undefined) {
			const profileId = request.defaultTerminalProfile

			// Update the terminal profile in the state
			controller.stateManager.setGlobalState("defaultTerminalProfile", profileId)

			let closedCount = 0
			let busyTerminalsCount = 0

			// Update the terminal manager of the current task if it exists
			if (controller.task) {
				// Call the updated setDefaultTerminalProfile method that returns closed terminal info
				// Use `as any` to handle type incompatibility between VSCode's TerminalInfo and standalone TerminalInfo
				const result = controller.task.terminalManager.setDefaultTerminalProfile(profileId) as any
				closedCount = result.closedCount
				busyTerminalsCount = result.busyTerminals?.length ?? 0

				// Show information message if terminals were closed
				if (closedCount > 0) {
					const message = `Closed ${closedCount} ${closedCount === 1 ? "terminal" : "terminals"} with different profile.`
					HostProvider.window.showMessage({
						type: ShowMessageType.INFORMATION,
						message,
					})
				}

				// Show warning if there are busy terminals that couldn't be closed
				if (busyTerminalsCount > 0) {
					const message =
						`${busyTerminalsCount} busy ${busyTerminalsCount === 1 ? "terminal has" : "terminals have"} a different profile. ` +
						`Close ${busyTerminalsCount === 1 ? "it" : "them"} to use the new profile for all commands.`
					HostProvider.window.showMessage({
						type: ShowMessageType.WARNING,
						message,
					})
				}
			}
		}

		if (request.backgroundEditEnabled !== undefined) {
			controller.stateManager.setGlobalState("backgroundEditEnabled", !!request.backgroundEditEnabled)
		}

		if (request.autoCondenseThreshold !== undefined) {
			const threshold = Math.min(1, Math.max(0, request.autoCondenseThreshold)) // Clamp to 0-1 range
			controller.stateManager.setGlobalState("autoCondenseThreshold", threshold)
		}

		if (request.multiRootEnabled !== undefined) {
			controller.stateManager.setGlobalState("multiRootEnabled", !!request.multiRootEnabled)
		}

		if (request.subagentsEnabled !== undefined) {
			const currentSettings = controller.stateManager.getGlobalSettingsKey("subagentsEnabled")
			const wasEnabled = currentSettings ?? false
			const isEnabled = !!request.subagentsEnabled

			// Platform validation: Only allow enabling subagents on macOS and Linux
			if (isEnabled && process.platform !== "darwin" && process.platform !== "linux") {
				throw new Error("CLI subagents are only supported on macOS and Linux platforms")
			}

			controller.stateManager.setGlobalState("subagentsEnabled", isEnabled)

			// Capture telemetry when setting changes
			if (wasEnabled !== isEnabled) {
				telemetryService.captureSubagentToggle(isEnabled)
			}
			controller.stateManager.setGlobalState("subagentsEnabled", !!request.subagentsEnabled)
		}

		if (request.skillsEnabled !== undefined) {
			controller.stateManager.setGlobalState("skillsEnabled", !!request.skillsEnabled)
		}

		if (request.nativeToolCallEnabled !== undefined) {
			controller.stateManager.setGlobalState("nativeToolCallEnabled", !!request.nativeToolCallEnabled)
			if (controller.task) {
				telemetryService.captureFeatureToggle(
					controller.task.ulid,
					"native-tool-call",
					request.nativeToolCallEnabled,
					controller.task.api.getModel().id,
				)
			}
		}

		if (request.enableParallelToolCalling !== undefined) {
			controller.stateManager.setGlobalState("enableParallelToolCalling", !!request.enableParallelToolCalling)
		}

		if (request.lightweightMode !== undefined) {
			controller.stateManager.setGlobalState("lightweightMode", !!request.lightweightMode)
		}

		if (request.optOutOfRemoteConfig !== undefined) {
			const hadOptedOut = controller.stateManager.getGlobalSettingsKey("optOutOfRemoteConfig")
			const isOptingOut = !!request.optOutOfRemoteConfig
			const isReenablingRemoteConfig = !isOptingOut && hadOptedOut

			// Update now so any subsequent function can access the updated value
			controller.stateManager.setGlobalState("optOutOfRemoteConfig", isOptingOut)

			if (isOptingOut && !hadOptedOut) {
				clearRemoteConfig()
			} else if (isReenablingRemoteConfig) {
				// Fire-and-forget: We don't need to await here
				// The function catches any errors and posts the updated state to the webview
				// The immediate state update below shows the user's intent (opted-in),
				// and we apply the actual config afterwards without blocking the settings update
				fetchRemoteConfig(controller)
			}
		}

		// Shuncode AI: Simplified edit tools settings (stored in VS Code configuration)
		const shuncodeConfig = vscode.workspace.getConfiguration("shuncode")
		if (request.useSimplifiedEditTools !== undefined) {
			await shuncodeConfig.update(
				"useSimplifiedEditTools",
				!!request.useSimplifiedEditTools,
				vscode.ConfigurationTarget.Global,
			)
		}
		if (request.validateSyntaxBeforeApply !== undefined) {
			await shuncodeConfig.update(
				"validateSyntaxBeforeApply",
				!!request.validateSyntaxBeforeApply,
				vscode.ConfigurationTarget.Global,
			)
		}
		if (request.blockOnSyntaxErrors !== undefined) {
			await shuncodeConfig.update("blockOnSyntaxErrors", !!request.blockOnSyntaxErrors, vscode.ConfigurationTarget.Global)
		}

		if (shouldRebuildTaskApiHandler) {
			controller.rebuildTaskApiHandler()
		}

		// Post updated state to webview
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		Logger.error("Failed to update settings:", error)
		throw error
	}
}

function preloadChromiumIfNeeded(): void {
	vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: "Chromium",
			cancellable: false,
		},
		async (progress) => {
			try {
				progress.report({ message: "Downloading... 0%", increment: 0 })
				const { ensureChromiumExists } = await import("@/services/browser/utils")
				let lastPercent = 0
				await ensureChromiumExists((percent) => {
					const increment = percent - lastPercent
					lastPercent = percent
					if (percent < 100) {
						progress.report({ message: `Downloading... ${percent}%`, increment })
					} else {
						progress.report({ message: "Extracting...", increment })
					}
				})
				progress.report({ message: "Ready!", increment: 0 })
				Logger.info("Chromium preloaded successfully for web tools")
			} catch (error) {
				Logger.error("Failed to preload Chromium:", error)
				vscode.window.showErrorMessage(`Failed to download Chromium: ${(error as Error).message}`)
			}
		},
	)
}
