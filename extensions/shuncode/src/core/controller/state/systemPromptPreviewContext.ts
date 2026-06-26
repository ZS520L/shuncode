import { buildApiHandler } from "@core/api"
import { getGlobalShuncodeRules, refreshShuncodeRulesToggles } from "@core/context/instructions/user-instructions/shuncode-rules"
import { discoverSkills, getAvailableSkills } from "@core/context/instructions/user-instructions/skills"
import type { SystemPromptContext } from "@core/prompts/system-prompt"
import { ensureRulesDirectoryExists } from "@core/storage/disk"
import { getApiSettingsMode, type Mode } from "@shared/storage/types"
import { normalizeToolCustomizationSettings } from "@shared/ToolCustomizationSettings"
import { HostProvider } from "@/hosts/host-provider"
import { AuthService } from "@/services/auth/AuthService"
import { getGitStatusCompact } from "@/utils/git"
import { getWorkspacePath } from "@/utils/path"
import osName from "os-name"
import { machineId } from "node-machine-id"
import type { Controller } from ".."

export async function buildSystemPromptPreviewContext(
	controller: Controller,
	customSystemPromptTemplate?: string,
): Promise<SystemPromptContext> {
	const mode = controller.stateManager.getGlobalSettingsKey("mode") as Mode
	const apiConfiguration = controller.stateManager.getApiConfiguration()
	const api = controller.task?.api ?? buildApiHandler(apiConfiguration, mode)
	const model = api.getModel()
	const isPlan = getApiSettingsMode(mode) === "plan"
	const providerId = (isPlan ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider) as string
	const cwd = await getWorkspacePath(process.cwd())
	const workspacePaths = (await HostProvider.workspace.getWorkspacePaths({})).paths
	const workspaceRoots = workspacePaths.map((workspacePath) => ({
		path: workspacePath,
		name: workspacePath.split(/[\\/]/).filter(Boolean).pop() || workspacePath,
	}))
	const openTabPaths = (await HostProvider.window.getOpenTabs({})).paths || []
	const visibleTabPaths = (await HostProvider.window.getVisibleTabs({})).paths || []
	const gitStatusRaw = await getGitStatusCompact(cwd)
	const { globalToggles } = await refreshShuncodeRulesToggles(controller, cwd)
	const globalShuncodeRulesFilePath = await ensureRulesDirectoryExists()
	const globalRules = await getGlobalShuncodeRules(globalShuncodeRulesFilePath, globalToggles)
	const skillsEnabled = controller.stateManager.getGlobalSettingsKey("skillsEnabled") ?? false
	const allSkills = skillsEnabled ? await discoverSkills(cwd) : []
	const resolvedSkills = getAvailableSkills(allSkills)
	const globalSkillsToggles = controller.stateManager.getGlobalSettingsKey("globalSkillsToggles") ?? {}
	const availableSkills = resolvedSkills.filter((skill) => globalSkillsToggles[skill.path] !== false)

	// Preferred language instruction (mirrors core/task/index.ts)
	const preferredLanguageRaw = controller.stateManager.getGlobalSettingsKey("preferredLanguage")
	const alwaysThink = controller.stateManager.getGlobalSettingsKey("alwaysThinkInPreferredLanguage")
	const preferredLanguageInstructions = preferredLanguageRaw
		? `# Preferred Language\n\nSpeak in ${preferredLanguageRaw}.${
				alwaysThink ? `\n\n重要：始终在 <thinking> 标签内用 ${preferredLanguageRaw} 思考。不要用其他语言。` : ""
			}`
		: ""

	return {
		cwd,
		ide: "Shuncode",
		providerInfo: {
			providerId,
			model,
			mode,
			customPrompt: controller.stateManager.getGlobalSettingsKey("customPrompt"),
			autoCondenseThreshold: controller.stateManager.getGlobalSettingsKey("autoCondenseThreshold"),
		},
		editorTabs: {
			open: openTabPaths.slice(0, 50),
			visible: visibleTabPaths.slice(0, 50),
		},
		gitStatus: gitStatusRaw
			? {
					branch: gitStatusRaw.branch,
					hasChanges: gitStatusRaw.hasChanges,
					summary: gitStatusRaw.summary,
				}
			: undefined,
		focusChainSettings: controller.stateManager.getGlobalSettingsKey("focusChainSettings"),
		browserSettings: controller.stateManager.getGlobalSettingsKey("browserSettings"),
		mcpHub: controller.mcpHub,
		skills: availableSkills,
		mcpSettingsPath: await controller.mcpHub.getMcpSettingsFilePath(),
		osName: osName(),
		machineId: await machineId().catch(() => undefined),
		globalShuncodeRulesFileInstructions: globalRules.instructions,
		pinnedMemory: globalRules.content,
		supportsBrowserUse: false, // preview: not in a real task context
		preferredLanguage: preferredLanguageRaw,
		alwaysThinkInPreferredLanguage: alwaysThink,
		preferredLanguageInstructions,
		yoloModeToggled: controller.stateManager.getGlobalSettingsKey("yoloModeToggled"),
		shuncodeWebToolsEnabled: controller.stateManager.getGlobalSettingsKey("shuncodeWebToolsEnabled"),
		isAuthenticated: !!(await AuthService.getInstance().getAuthToken()),
		workspaceRoots,
		enableNativeToolCalls: true,
		enableParallelToolCalling: controller.stateManager.getGlobalSettingsKey("enableParallelToolCalling"),
		lightweightMode: controller.stateManager.getGlobalSettingsKey("lightweightMode"),
		useSimplifiedEditTools: controller.stateManager.getGlobalSettingsKey("lightweightMode") === true,
		mode: mode as SystemPromptContext["mode"],
		customSystemPromptTemplate,
		toolCustomizationSettings: normalizeToolCustomizationSettings(
			controller.stateManager.getGlobalSettingsKey("toolCustomizationSettings"),
		),
	}
}
