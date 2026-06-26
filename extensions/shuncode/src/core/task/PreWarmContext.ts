import {
	getGlobalShuncodeRules,
	getLocalShuncodeRules,
	refreshShuncodeRulesToggles,
} from "@core/context/instructions/user-instructions/shuncode-rules"
import {
	getLocalAgentsRules,
	getLocalCursorRules,
	getLocalWindsurfRules,
	refreshExternalRulesToggles,
} from "@core/context/instructions/user-instructions/external-rules"
import { RuleContextBuilder } from "@core/context/instructions/user-instructions/RuleContextBuilder"
import { ensureRulesDirectoryExists } from "@core/storage/disk"
import { discoverSkills } from "@core/context/instructions/user-instructions/skills"
import { isShuncodeCliInstalled } from "@/utils/cli-detector"
import { getGitStatusCompact } from "@/utils/git"
import { HostProvider } from "@/hosts/host-provider"
import { AuthService } from "@services/auth/AuthService"
import { McpHub } from "@services/mcp/McpHub"
import { StateManager } from "@core/storage/StateManager"
import { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { MessageStateHandler } from "./message-state"
import { Logger } from "@/shared/services/Logger"
import { machineId } from "node-machine-id"
import { getLanguageKey, LanguageDisplay } from "@shared/Languages"
import type { SkillMetadata } from "@shared/skills"
import pWaitFor from "p-wait-for"
import type { Controller } from "../controller"

/**
 * Pre-warmed context data that can be computed before the user sends their message.
 * This includes all expensive async operations that do NOT depend on user message content.
 */
export interface PreWarmedData {
	ide: string
	isSubagentsEnabledAndCliInstalled: boolean
	globalToggles: Record<string, boolean>
	localToggles: Record<string, boolean>
	windsurfLocalToggles: Record<string, boolean>
	cursorLocalToggles: Record<string, boolean>
	agentsLocalToggles: Record<string, boolean>
	evaluationContext: any
	globalShuncodeRulesFilePath: string
	allSkills: SkillMetadata[]
	openTabPaths: string[]
	visibleTabPaths: string[]
	gitStatusRaw: { branch?: string; hasChanges?: boolean; summary?: string } | null
	mcpSettingsPath: string
	machineIdValue: string | undefined
	authToken: string | undefined | null
	// Phase 2 results
	globalRules: { instructions?: string; content?: string; activatedConditionalRules: any[] }
	localRules: { instructions?: string; content?: string; activatedConditionalRules: any[] }
	localCursorRulesFileInstructions: string | undefined
	localCursorRulesDirInstructions: string | undefined
	localWindsurfRulesFileInstructions: string | undefined
	localAgentsRulesFileInstructions: string | undefined
	// Derived values
	preferredLanguageInstructions: string
	preferredLanguage: string | undefined
	alwaysThinkInPreferredLanguage: boolean
	// Timestamp for staleness check
	timestamp: number
	// MCP connected
	mcpReady: boolean
}

/**
 * Maximum age (ms) before pre-warmed data is considered stale and must be re-fetched.
 */
const MAX_PREWARM_AGE_MS = 30_000

/**
 * PreWarmContext handles eager pre-computation of expensive context data
 * that does NOT depend on user message content. It starts computing as soon as
 * a new Task is created, so by the time the user sends their message, most of
 * the preparation work is already done.
 */
export class PreWarmContext {
	private preWarmPromise: Promise<PreWarmedData> | null = null
	private preWarmedData: PreWarmedData | null = null

	constructor(
		private readonly cwd: string,
		private readonly mcpHub: McpHub,
		private readonly stateManager: StateManager,
		private readonly workspaceManager: WorkspaceRootManager | undefined,
		private readonly messageStateHandler: MessageStateHandler,
		private readonly controller: Controller,
	) { }

	/**
	 * Start pre-warming immediately. Call this from the Task constructor or right after.
	 * This is fire-and-forget — errors are logged but don't block anything.
	 */
	startPreWarm(): void {
		if (this.preWarmPromise) {
			return // already running
		}
		this.preWarmPromise = this.computePreWarmData().catch((error) => {
			Logger.error("[PreWarmContext] Pre-warm failed:", error)
			return null as any
		})
	}

	/**
	 * Get the pre-warmed data. If still computing, awaits completion.
	 * If data is stale (>30s old), re-computes.
	 * Returns null if pre-warming was never started or failed.
	 */
	async getPreWarmedData(): Promise<PreWarmedData | null> {
		if (this.preWarmedData && Date.now() - this.preWarmedData.timestamp < MAX_PREWARM_AGE_MS) {
			return this.preWarmedData
		}

		if (this.preWarmPromise) {
			const data = await this.preWarmPromise
			if (data && Date.now() - data.timestamp < MAX_PREWARM_AGE_MS) {
				this.preWarmedData = data
				return data
			}
		}

		// Data is stale or failed, re-compute
		this.preWarmPromise = this.computePreWarmData().catch((error) => {
			Logger.error("[PreWarmContext] Re-warm failed:", error)
			return null as any
		})
		const data = await this.preWarmPromise
		this.preWarmedData = data
		return data
	}

	/**
	 * Invalidate cached data (e.g. when settings change mid-task).
	 */
	invalidate(): void {
		this.preWarmedData = null
		this.preWarmPromise = null
	}

	private async computePreWarmData(): Promise<PreWarmedData> {
		// Wait for MCP servers to be connected (same as attemptApiRequest does)
		let mcpReady = true
		await pWaitFor(() => this.mcpHub.isConnecting !== true, {
			timeout: 10_000,
		}).catch(() => {
			Logger.error("[PreWarmContext] MCP servers failed to connect in time")
			mcpReady = false
		})

		const subagentsEnabled = this.stateManager.getGlobalSettingsKey("subagentsEnabled")
		const preferredLanguageRaw = this.stateManager.getGlobalSettingsKey("preferredLanguage")
		const preferredLanguage = getLanguageKey(preferredLanguageRaw as LanguageDisplay)
		const alwaysThinkInPreferredLanguage = this.stateManager.getGlobalSettingsKey("alwaysThinkInPreferredLanguage")
		const preferredLanguageInstructions = preferredLanguage
			? `# Preferred Language\n\nSpeak in ${preferredLanguageRaw}.${alwaysThinkInPreferredLanguage
				? `\n\n重要：始终在 <thinking> 标签内用 ${preferredLanguageRaw} 思考。不要用其他语言。`
				: ""
			}`
			: ""

		// Phase 1: Parallelize independent async operations
		const [
			ide,
			isSubagentsEnabledAndCliInstalled,
			{ globalToggles, localToggles },
			{ windsurfLocalToggles, cursorLocalToggles, agentsLocalToggles },
			evaluationContext,
			globalShuncodeRulesFilePath,
			allSkills,
			openTabPaths,
			visibleTabPaths,
			gitStatusRaw,
			mcpSettingsPath,
			machineIdValue,
			authToken,
		] = await Promise.all([
			HostProvider.env.getHostVersion({}).then((v) => v.platform || "Unknown"),
			subagentsEnabled ? isShuncodeCliInstalled().then((installed) => subagentsEnabled && installed) : Promise.resolve(false),
			refreshShuncodeRulesToggles(this.controller, this.cwd),
			refreshExternalRulesToggles(this.controller, this.cwd),
			RuleContextBuilder.buildEvaluationContext({
				cwd: this.cwd,
				messageStateHandler: this.messageStateHandler,
				workspaceManager: this.workspaceManager,
			}),
			ensureRulesDirectoryExists(),
			(this.stateManager.getGlobalSettingsKey("skillsEnabled") ?? false) ? discoverSkills(this.cwd) : Promise.resolve([]),
			HostProvider.window.getOpenTabs({}).then((r) => r.paths || []),
			HostProvider.window.getVisibleTabs({}).then((r) => r.paths || []),
			getGitStatusCompact(this.cwd),
			this.mcpHub.getMcpSettingsFilePath(),
			machineId().catch(() => undefined),
			AuthService.getInstance().getAuthToken(),
		])

		// Phase 2: Operations that depend on phase 1 results (rules loading)
		const [
			globalRules,
			localRules,
			[localCursorRulesFileInstructions, localCursorRulesDirInstructions],
			localWindsurfRulesFileInstructions,
			localAgentsRulesFileInstructions,
		] = await Promise.all([
			getGlobalShuncodeRules(globalShuncodeRulesFilePath, globalToggles, { evaluationContext }),
			getLocalShuncodeRules(this.cwd, localToggles, { evaluationContext }),
			getLocalCursorRules(this.cwd, cursorLocalToggles),
			getLocalWindsurfRules(this.cwd, windsurfLocalToggles),
			getLocalAgentsRules(this.cwd, agentsLocalToggles),
		])

		return {
			ide,
			isSubagentsEnabledAndCliInstalled,
			globalToggles,
			localToggles,
			windsurfLocalToggles,
			cursorLocalToggles,
			agentsLocalToggles,
			evaluationContext,
			globalShuncodeRulesFilePath,
			allSkills,
			openTabPaths,
			visibleTabPaths,
			gitStatusRaw,
			mcpSettingsPath,
			machineIdValue,
			authToken,
			globalRules,
			localRules,
			localCursorRulesFileInstructions,
			localCursorRulesDirInstructions,
			localWindsurfRulesFileInstructions,
			localAgentsRulesFileInstructions,
			preferredLanguageInstructions,
			preferredLanguage,
			alwaysThinkInPreferredLanguage,
			mcpReady,
			timestamp: Date.now(),
		}
	}
}
