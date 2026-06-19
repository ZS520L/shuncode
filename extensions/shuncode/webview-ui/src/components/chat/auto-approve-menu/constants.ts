import { ActionMetadata } from "./types"

// [SHUNCODE] readFiles and editFiles removed from UI.
// Backend code in autoApprove.ts still handles these settings (dead code for now).
// Reason: files are always auto-read, and edits go through DiffSystem (inline diffs
// with Accept/Reject), so these toggles were non-functional ("пустышки").
// The settings remain in AutoApprovalSettings interface for backward compatibility.
// If we ever need per-file approval back, re-add these entries here.
//
// Removed entries:
//   { id: "readFiles", ... subAction: { id: "readFilesExternally" } }
//   { id: "editFiles", ... subAction: { id: "editFilesExternally" } }

export const ACTION_METADATA: ActionMetadata[] = [
	{
		id: "executeSafeCommands",
		labelKey: "permissions.executeSafeCommands",
		shortNameKey: "permissions.executeSafeCommandsShort",
		icon: "codicon-terminal",
		subAction: {
			id: "executeAllCommands",
			labelKey: "permissions.executeAllCommands",
			shortNameKey: "permissions.executeAllCommandsShort",
			icon: "codicon-terminal-bash",
			parentActionId: "executeSafeCommands",
		},
	},
	{
		id: "autoRespondToPrompts",
		labelKey: "permissions.autoRespondToPrompts",
		shortNameKey: "permissions.autoRespondToPromptsShort",
		icon: "codicon-reply",
	},
	{
		id: "deleteFiles",
		labelKey: "permissions.deleteFiles",
		shortNameKey: "permissions.deleteFilesShort",
		icon: "codicon-trash",
	},
	{
		id: "editNotebooks",
		labelKey: "permissions.editNotebooks",
		shortNameKey: "permissions.editNotebooksShort",
		icon: "codicon-notebook",
	},
	{
		id: "useBrowser",
		labelKey: "permissions.useBrowser",
		shortNameKey: "permissions.useBrowserShort",
		icon: "codicon-globe",
	},
	{
		id: "useMcp",
		labelKey: "permissions.useMcp",
		shortNameKey: "permissions.useMcpShort",
		icon: "codicon-server",
	},
]

export const NOTIFICATIONS_SETTING: ActionMetadata = {
	id: "enableNotifications",
	labelKey: "permissions.enableNotifications",
	shortNameKey: "permissions.enableNotificationsShort",
	icon: "codicon-bell",
}
