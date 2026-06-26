import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import * as vscode from "vscode"
import * as path from "path"
import pWaitFor from "p-wait-for"
import { getContextWindowInfo } from "@core/context/context-management/context-window-utils"
import { extractChangelog } from "@core/context/SessionChangelog"
import { isMultiRootEnabled } from "@core/workspace/multi-root-utils"
import type { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { formatResponse } from "@core/prompts/responses"
import { getSavedShuncodeMessages, GlobalFileNames } from "@core/storage/disk"
import type { ShuncodeIgnoreController } from "@core/ignore/ShuncodeIgnoreController"
import type { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import type { ITerminalManager } from "@integrations/terminal/types"
import { listFiles } from "@services/glob/list-files"
import { findLast } from "@shared/array"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import type { ShuncodeMessage } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import { isClaude4PlusModelFamily, isGPT5ModelFamily } from "@utils/model-utils"
import { arePathsEqual, getDesktopDir } from "@utils/path"
import { filterExistingFiles } from "@utils/tabFiltering"
import { HostProvider } from "@/hosts/host-provider"
import type { ApiHandler } from "@core/api"
import type { StateManager } from "@core/storage/StateManager"
import type { MessageStateHandler } from "./message-state"
import { detectAvailableCliTools } from "./utils"

export interface EnvironmentDetailsContext {
	cwd: string
	taskId: string
	taskState: { didEditFile: boolean }
	stateManager: StateManager
	terminalManager: ITerminalManager
	shuncodeIgnoreController: ShuncodeIgnoreController
	fileContextTracker: FileContextTracker
	workspaceManager?: WorkspaceRootManager
	messageStateHandler: MessageStateHandler
	api: ApiHandler
}

function formatWorkspaceRootsSection(ctx: EnvironmentDetailsContext): string {
	const multiRootEnabled = isMultiRootEnabled(ctx.stateManager)
	const roots = ctx.workspaceManager?.getRoots() ?? []

	if (!multiRootEnabled || roots.length <= 1) {
		return ""
	}

	let section = "\n\n# Workspace Roots"
	for (const root of roots) {
		const name = root.name || path.basename(root.path)
		const vcs = root.vcs ? ` (${String(root.vcs)})` : ""
		section += `\n- ${name}: ${root.path}${vcs}`
	}

	const primary = ctx.workspaceManager!.getPrimaryRoot()
	const primaryName = getPrimaryWorkspaceName(ctx, primary)
	section += `\n\nPrimary workspace: ${primaryName}`
	return section
}

function getPrimaryWorkspaceName(
	ctx: EnvironmentDetailsContext,
	primary?: ReturnType<WorkspaceRootManager["getRoots"]>[0],
): string {
	if (primary?.name) return primary.name
	if (primary?.path) return path.basename(primary.path)
	return path.basename(ctx.cwd)
}

function formatFileDetailsHeader(ctx: EnvironmentDetailsContext): string {
	const multiRootEnabled = isMultiRootEnabled(ctx.stateManager)
	const roots = ctx.workspaceManager?.getRoots() || []

	if (multiRootEnabled && roots.length > 1) {
		const primary = ctx.workspaceManager?.getPrimaryRoot()
		const primaryName = getPrimaryWorkspaceName(ctx, primary)
		return `\n\n# Current Working Directory (Primary: ${primaryName}) Files\n`
	}
	return `\n\n# Current Working Directory (${ctx.cwd.toPosix()}) Files\n`
}

export async function buildEnvironmentDetails(
	ctx: EnvironmentDetailsContext,
	includeFileDetails: boolean = false,
): Promise<string> {
	const host = await HostProvider.env.getHostVersion({})
	let details = ""

	const currentMode = ctx.stateManager.getGlobalSettingsKey("mode")
	if (currentMode === "chat") {
		const now = new Date()
		const formatter = new Intl.DateTimeFormat(undefined, {
			year: "numeric",
			month: "numeric",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
			second: "numeric",
			hour12: true,
		})
		const timeZone = formatter.resolvedOptions().timeZone
		const timeZoneOffset = -now.getTimezoneOffset() / 60
		const timeZoneOffsetStr = `${timeZoneOffset >= 0 ? "+" : ""}${timeZoneOffset}:00`
		details += `# Current Time\n${formatter.format(now)} (${timeZone}, UTC${timeZoneOffsetStr})`
		details += "\n\n# Current Mode"
		details += "\nCHAT MODE (conversational - answer from knowledge, use tools ONLY if user explicitly asks)"
		return `<environment_details>\n${details.trim()}\n</environment_details>`
	}

	details += formatWorkspaceRootsSection(ctx)

	details += `\n\n# ${host.platform} Visible Files`
	const rawVisiblePaths = (await HostProvider.window.getVisibleTabs({})).paths
	const filteredVisiblePaths = await filterExistingFiles(rawVisiblePaths)
	const visibleFilePaths = filteredVisiblePaths.map((absolutePath) => path.relative(ctx.cwd, absolutePath))
	const allowedVisibleFiles = ctx.shuncodeIgnoreController
		.filterPaths(visibleFilePaths)
		.map((p) => p.toPosix())
		.join("\n")
	details += allowedVisibleFiles ? `\n${allowedVisibleFiles}` : "\n(No visible files)"

	details += `\n\n# ${host.platform} Open Tabs`
	const rawOpenTabPaths = (await HostProvider.window.getOpenTabs({})).paths
	const filteredOpenTabPaths = await filterExistingFiles(rawOpenTabPaths)
	const openTabPaths = filteredOpenTabPaths.map((absolutePath) => path.relative(ctx.cwd, absolutePath))
	const allowedOpenTabs = ctx.shuncodeIgnoreController
		.filterPaths(openTabPaths)
		.map((p) => p.toPosix())
		.join("\n")
	details += allowedOpenTabs ? `\n${allowedOpenTabs}` : "\n(No open tabs)"

	const busyTerminals = ctx.terminalManager.getTerminals(true)
	const inactiveTerminals = ctx.terminalManager.getTerminals(false)

	if (busyTerminals.length > 0 && ctx.taskState.didEditFile) {
		await setTimeoutPromise(300)
	}
	if (busyTerminals.length > 0) {
		await pWaitFor(() => busyTerminals.every((t) => !ctx.terminalManager.isProcessHot(t.id)), {
			interval: 100,
			timeout: 15_000,
		}).catch(() => {})
	}

	ctx.taskState.didEditFile = false

	let terminalDetails = ""
	if (busyTerminals.length > 0) {
		terminalDetails += "\n\n# Actively Running Terminals"
		for (const busyTerminal of busyTerminals) {
			terminalDetails += `\n## Original command: \`${busyTerminal.lastCommand}\``
			const newOutput = ctx.terminalManager.getUnretrievedOutput(busyTerminal.id)
			if (newOutput) {
				terminalDetails += `\n### New Output\n${newOutput}`
			}
		}
	}
	if (inactiveTerminals.length > 0) {
		const inactiveTerminalOutputs = new Map<number, string>()
		for (const inactiveTerminal of inactiveTerminals) {
			const newOutput = ctx.terminalManager.getUnretrievedOutput(inactiveTerminal.id)
			if (newOutput) {
				inactiveTerminalOutputs.set(inactiveTerminal.id, newOutput)
			}
		}
		if (inactiveTerminalOutputs.size > 0) {
			terminalDetails += "\n\n# Inactive Terminals"
			for (const [terminalId, newOutput] of inactiveTerminalOutputs) {
				const inactiveTerminal = inactiveTerminals.find((t) => t.id === terminalId)
				if (inactiveTerminal) {
					terminalDetails += `\n## ${inactiveTerminal.lastCommand}`
					terminalDetails += `\n### New Output\n${newOutput}`
				}
			}
		}
	}

	try {
		const allVscodeTerminals = vscode.window.terminals
		const userTerminals = allVscodeTerminals.filter((t) => {
			const creationOptions = t.creationOptions as vscode.TerminalOptions | undefined
			return !creationOptions?.env?.SHUNCODE_ACTIVE
		})
		if (userTerminals.length > 0) {
			terminalDetails += "\n\n# User Terminals"
			for (const terminal of userTerminals) {
				const name = terminal.name || "Terminal"
				const cwd = (terminal as any).shellIntegration?.cwd?.fsPath
				const cwdInfo = cwd ? ` (cwd: ${path.relative(ctx.cwd, cwd) || "."})` : ""
				terminalDetails += `\n- ${name}${cwdInfo}`
			}
		}
	} catch {
		// Silently ignore errors accessing user terminals
	}

	if (terminalDetails) {
		details += terminalDetails
	}

	const recentlyModifiedFiles = ctx.fileContextTracker.getAndClearRecentlyModifiedFiles()
	if (recentlyModifiedFiles.length > 0) {
		details +=
			"\n\n# Recently Modified Files\nThese files have been modified since you last accessed them (file was just edited so you may need to re-read it before editing):"
		for (const filePath of recentlyModifiedFiles) {
			details += `\n${filePath}`
		}
	}

	const now = new Date()
	const formatter = new Intl.DateTimeFormat(undefined, {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
		hour12: true,
	})
	const timeZone = formatter.resolvedOptions().timeZone
	const timeZoneOffset = -now.getTimezoneOffset() / 60
	const timeZoneOffsetStr = `${timeZoneOffset >= 0 ? "+" : ""}${timeZoneOffset}:00`
	details += `\n\n# Current Time\n${formatter.format(now)} (${timeZone}, UTC${timeZoneOffsetStr})`

	if (includeFileDetails) {
		try {
			const taskHistory = ctx.stateManager.getGlobalStateKey("taskHistory")
			if (taskHistory && taskHistory.length > 0) {
				const previousTask = taskHistory.find((t: HistoryItem) => t.id !== ctx.taskId)
				if (previousTask) {
					const previousMessages = await getSavedShuncodeMessages(previousTask.id)
					if (previousMessages.length > 0) {
						const changelog = extractChangelog(previousMessages)
						if (changelog) {
							details += changelog
						}
					}
				}
			}
		} catch {
			// Silently ignore changelog loading errors
		}
	}

	if (includeFileDetails) {
		details += formatFileDetailsHeader(ctx)
		const isDesktop = arePathsEqual(ctx.cwd, getDesktopDir())
		if (isDesktop) {
			details += "(Desktop files not shown automatically. Use list_files to explore if needed.)"
		} else {
			const [files, didHitLimit] = await listFiles(ctx.cwd, true, 200)
			const result = formatResponse.formatFilesList(ctx.cwd, files, didHitLimit, ctx.shuncodeIgnoreController)
			details += result
		}

		if (ctx.workspaceManager) {
			const workspacesJson = await ctx.workspaceManager.buildWorkspacesJson()
			if (workspacesJson) {
				details += `\n\n# Workspace Configuration\n${workspacesJson}`
			}
		}

		const availableCliTools = await detectAvailableCliTools()
		if (availableCliTools.length > 0) {
			details += `\n\n# Detected CLI Tools\nThese are some of the tools on the user's machine, and may be useful if needed to accomplish the task: ${availableCliTools.join(", ")}. This list is not exhaustive, and other tools may be available.`
		}
	}

	const { contextWindow } = getContextWindowInfo(ctx.api)

	const getTotalTokensFromApiReqMessage = (msg: ShuncodeMessage) => {
		if (!msg.text) return 0
		try {
			const { tokensIn, tokensOut, cacheWrites, cacheReads } = JSON.parse(msg.text)
			return (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
		} catch (_e) {
			return 0
		}
	}

	const shuncodeMessages = ctx.messageStateHandler.getShuncodeMessages()
	const modifiedMessages = combineApiRequests(combineCommandSequences(shuncodeMessages.slice(1)))
	const lastApiReqMessage = findLast(modifiedMessages, (msg) => {
		if (msg.say !== "api_req_started") return false
		return getTotalTokensFromApiReqMessage(msg) > 0
	})

	const lastApiReqTotalTokens = lastApiReqMessage ? getTotalTokensFromApiReqMessage(lastApiReqMessage) : 0
	const usagePercentage = Math.round((lastApiReqTotalTokens / contextWindow) * 100)

	const currentModelId = ctx.api.getModel().id
	const isNextGenModel = isClaude4PlusModelFamily(currentModelId) || isGPT5ModelFamily(currentModelId)

	let shouldShowContextWindow = true
	if (isNextGenModel) {
		const autoCondenseThreshold =
			(ctx.stateManager.getGlobalSettingsKey("autoCondenseThreshold") as number | undefined) ?? 0.75
		const displayThreshold = autoCondenseThreshold - 0.15
		const currentUsageRatio = lastApiReqTotalTokens / contextWindow
		shouldShowContextWindow = currentUsageRatio >= displayThreshold
	}

	if (shouldShowContextWindow) {
		details += "\n\n# Context Window Usage"
		details += `\n${lastApiReqTotalTokens.toLocaleString()} / ${(contextWindow / 1000).toLocaleString()}K tokens used (${usagePercentage}%)`
	}

	details += "\n\n# Current Mode"
	const mode = ctx.stateManager.getGlobalSettingsKey("mode")
	switch (mode) {
		case "plan":
			details += "\nPLAN MODE\n" + formatResponse.planModeInstructions()
			break
		case "ask":
			details += "\nASK MODE (read-only - no file modifications or commands allowed)"
			break
		case "debug":
			details += "\nDEBUG MODE (systematic debugging: gather evidence → hypothesize → test → fix)"
			break
		case "chat":
			details += "\nCHAT MODE (conversational - answer from knowledge, use tools ONLY if user explicitly asks)"
			break
		default:
			details += "\nACT MODE"
			break
	}

	return `<environment_details>\n${details.trim()}\n</environment_details>`
}
