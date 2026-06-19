import { resolveWorkspacePath } from "@core/workspace"
import { isMultiRootEnabled } from "@core/workspace/multi-root-utils"
import { ShuncodeDefaultTool } from "@shared/tools"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { getCwd, getDesktopDir, isLocatedInPath, isLocatedInWorkspace } from "@/utils/path"

export class AutoApprove {
	private stateManager: StateManager
	// Cache for workspace paths - populated on first access and reused for the task lifetime
	// NOTE: This assumes that the task has a fixed set of workspace roots(which is currently true).
	private workspacePathsCache: { paths: string[] } | null = null
	private isMultiRootScenarioCache: boolean | null = null

	constructor(stateManager: StateManager) {
		this.stateManager = stateManager
	}

	/**
	 * Get workspace information with caching to avoid repeated API calls
	 * Cache is task-scoped since each task gets a new AutoApprove instance
	 */
	private async getWorkspaceInfo(): Promise<{
		workspacePaths: { paths: string[] }
		isMultiRootScenario: boolean
	}> {
		// Check if we already have cached values
		if (this.workspacePathsCache === null || this.isMultiRootScenarioCache === null) {
			// First time - fetch and cache for the lifetime of this task
			this.workspacePathsCache = await HostProvider.workspace.getWorkspacePaths({})
			this.isMultiRootScenarioCache = isMultiRootEnabled(this.stateManager) && this.workspacePathsCache.paths.length > 1
		}

		return {
			workspacePaths: this.workspacePathsCache,
			isMultiRootScenario: this.isMultiRootScenarioCache,
		}
	}

	// Check if the tool should be auto-approved based on the settings
	// Returns bool for most tools, and tuple for tools with nested settings
	shouldAutoApproveTool(toolName: ShuncodeDefaultTool): boolean | [boolean, boolean] {
		if (this.stateManager.getGlobalSettingsKey("yoloModeToggled")) {
			switch (toolName) {
			case ShuncodeDefaultTool.FILE_READ:
			case ShuncodeDefaultTool.LIST_FILES:
			case ShuncodeDefaultTool.LIST_CODE_DEF:
			case ShuncodeDefaultTool.SEARCH:
			case ShuncodeDefaultTool.NEW_RULE:
			case ShuncodeDefaultTool.FILE_NEW:
			case ShuncodeDefaultTool.FILE_EDIT:
			case ShuncodeDefaultTool.APPLY_PATCH:
			case ShuncodeDefaultTool.EDIT_NOTEBOOK:
			case ShuncodeDefaultTool.FILE_DELETE:
			case ShuncodeDefaultTool.BASH:
				return [true, true]

			case ShuncodeDefaultTool.BROWSER:
			case ShuncodeDefaultTool.WEB_FETCH:
			case ShuncodeDefaultTool.WEB_SEARCH:
			case ShuncodeDefaultTool.MCP_ACCESS:
			case ShuncodeDefaultTool.MCP_USE:
				return true
			}
		}

		const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")

		switch (toolName) {
		case ShuncodeDefaultTool.FILE_READ:
		case ShuncodeDefaultTool.LIST_FILES:
		case ShuncodeDefaultTool.LIST_CODE_DEF:
		case ShuncodeDefaultTool.SEARCH:
			return [autoApprovalSettings.actions.readFiles, autoApprovalSettings.actions.readFilesExternally ?? false]
		case ShuncodeDefaultTool.NEW_RULE:
		case ShuncodeDefaultTool.FILE_NEW:
		case ShuncodeDefaultTool.FILE_EDIT:
		case ShuncodeDefaultTool.APPLY_PATCH:
			return [autoApprovalSettings.actions.editFiles, autoApprovalSettings.actions.editFilesExternally ?? false]
		case ShuncodeDefaultTool.EDIT_NOTEBOOK:
			return autoApprovalSettings.actions.editNotebooks ?? false
		case ShuncodeDefaultTool.FILE_DELETE:
			return autoApprovalSettings.actions.deleteFiles ?? false
		case ShuncodeDefaultTool.BASH:
			return [
				autoApprovalSettings.actions.executeSafeCommands ?? false,
				autoApprovalSettings.actions.executeAllCommands ?? false,
			]
		case ShuncodeDefaultTool.BROWSER:
		case ShuncodeDefaultTool.WEB_FETCH:
		case ShuncodeDefaultTool.WEB_SEARCH:
			return autoApprovalSettings.actions.useBrowser
		case ShuncodeDefaultTool.MCP_ACCESS:
		case ShuncodeDefaultTool.MCP_USE:
			return autoApprovalSettings.actions.useMcp
	}
		return false
	}

	// Check if the tool should be auto-approved based on the settings
	// and the path of the action. Returns true if the tool should be auto-approved
	// based on the user's settings and the path of the action.
	async shouldAutoApproveToolWithPath(
		blockname: ShuncodeDefaultTool,
		autoApproveActionpath: string | undefined,
	): Promise<boolean> {
		if (this.stateManager.getGlobalSettingsKey("yoloModeToggled")) {
			return true
		}

		let isLocalRead: boolean = false
		if (autoApproveActionpath) {
			// Use cached workspace info instead of fetching every time
			const { isMultiRootScenario } = await this.getWorkspaceInfo()

			if (isMultiRootScenario) {
				// Multi-root: check if file is in ANY workspace
				isLocalRead = await isLocatedInWorkspace(autoApproveActionpath)
			} else {
				// Single-root: use existing logic
				const cwd = await getCwd(getDesktopDir())
				// When called with a string cwd, resolveWorkspacePath returns a string
				const absolutePath = resolveWorkspacePath(
					cwd,
					autoApproveActionpath,
					"AutoApprove.shouldAutoApproveToolWithPath",
				) as string
				isLocalRead = isLocatedInPath(cwd, absolutePath)
			}
		} else {
			// If we do not get a path for some reason, default to a (safer) false return
			isLocalRead = false
		}

		// Get auto-approve settings for local and external edits
		const autoApproveResult = this.shouldAutoApproveTool(blockname)
		const [autoApproveLocal, autoApproveExternal] = Array.isArray(autoApproveResult)
			? autoApproveResult
			: [autoApproveResult, false]

		if ((isLocalRead && autoApproveLocal) || (!isLocalRead && autoApproveLocal && autoApproveExternal)) {
			return true
		} else {
			return false
		}
	}
}
