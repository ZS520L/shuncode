import { name, publisher, version } from "../package.json"

const prefix = name

/**
 * List of commands with the name of the extension they are registered under.
 * These should match the command IDs defined in package.json.
 * For Nightly build, the publish script has updated all the commands to use the extension name as prefix.
 * In production, all commands are registered under "shuncode" for consistency.
 */
const ShuncodeCommands = {
	PlusButton: prefix + ".plusButtonClicked",
	McpButton: prefix + ".mcpButtonClicked",
	SettingsButton: prefix + ".settingsButtonClicked",
	HistoryButton: prefix + ".historyButtonClicked",
	AccountButton: prefix + ".accountButtonClicked",
	WorktreesButton: prefix + ".worktreesButtonClicked",
	TerminalOutput: prefix + ".addTerminalOutputToChat",
	AddToChat: prefix + ".addToChat",
	FixWithShuncode: prefix + ".fixWithShuncode",
	ExplainCode: prefix + ".explainCode",
	ImproveCode: prefix + ".improveCode",
	FocusChatInput: prefix + ".focusChatInput",
	Walkthrough: prefix + ".openWalkthrough",
	GenerateCommit: prefix + ".generateGitCommitMessage",
	AbortCommit: prefix + ".abortGitCommitMessage",
	ReconstructTaskHistory: prefix + ".reconstructTaskHistory",
	// Inline Edit
	InlineEdit: prefix + ".inlineEdit",
	// Jupyter Notebook commands
	JupyterGenerateCell: prefix + ".jupyterGenerateCell",
	JupyterExplainCell: prefix + ".jupyterExplainCell",
	JupyterImproveCell: prefix + ".jupyterImproveCell",
}

/**
 * IDs for the views registered by the extension.
 * These should match the name + view IDs defined in package.json.
 */
const ShuncodeViewIds = {
	Sidebar: name + ".SidebarProvider",
}

/**
 * The registry info for the extension, including its ID, name, version, commands, and views
 * registered for the current host.
 */
export const ExtensionRegistryInfo = {
	id: publisher + "." + name,
	name,
	version,
	publisher,
	commands: ShuncodeCommands,
	views: ShuncodeViewIds,
}
