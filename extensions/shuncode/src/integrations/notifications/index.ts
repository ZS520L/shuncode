import { execa } from "execa"
import { platform } from "os"
import * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"

let iconPath: string | undefined
let windowsAppId: string | undefined

export function setNotificationIconPath(path: string): void {
	iconPath = path
}

export function setNotificationAppId(appId: string): void {
	windowsAppId = appId
}

interface NotificationOptions {
	title?: string
	subtitle?: string
	message: string
}

async function showMacOSNotification(options: NotificationOptions): Promise<void> {
	const { title, subtitle = "", message } = options

	const script = `display notification "${message}" with title "${title}" subtitle "${subtitle}" sound name "Tink"`

	try {
		await execa("osascript", ["-e", script])
	} catch (error) {
		throw new Error(`Failed to show macOS notification: ${error}`)
	}
}

async function showWindowsNotification(options: NotificationOptions): Promise<void> {
	const { subtitle, message } = options

	const appId = windowsAppId || "Shuncode"
	const iconFile = iconPath ? iconPath.replaceAll("\\", "/") : ""
	const imageTag = iconFile
		? `<image placement="appLogoOverride" src="${iconFile}" />`
		: ""

	// Build XML as a single string — avoids here-string quoting issues
	const xml = `<toast><visual><binding template="ToastGeneric"><text>${subtitle}</text><text>${message}</text>${imageTag}</binding></visual></toast>`

	const script = [
		`[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null`,
		`[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null`,
		`$x = New-Object Windows.Data.Xml.Dom.XmlDocument`,
		`$x.LoadXml('${xml.replaceAll("'", "''")}')`,
		`$t = [Windows.UI.Notifications.ToastNotification]::new($x)`,
		`[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${appId}').Show($t)`,
	].join("; ")

	try {
		await execa("powershell", ["-Command", script])
	} catch (error) {
		throw new Error(`Failed to show Windows notification: ${error}`)
	}
}

async function showLinuxNotification(options: NotificationOptions): Promise<void> {
	const { title = "", subtitle = "", message } = options

	// Combine subtitle and message if subtitle exists
	const fullMessage = subtitle ? `${subtitle}\n${message}` : message

	const args = [title, fullMessage]
	// Add icon if available
	if (iconPath) {
		args.unshift("-i", iconPath)
	}

	try {
		await execa("notify-send", args)
	} catch (error) {
		throw new Error(`Failed to show Linux notification: ${error}`)
	}
}

export async function showSystemNotification(options: NotificationOptions): Promise<void> {
	try {
		// Skip system notifications when the window is focused —
		// user already sees everything in the UI
		if (vscode.window.state.focused) {
			return
		}

		const { title = "Shuncode", message } = options

		if (!message) {
			throw new Error("Message is required")
		}

		const escapedOptions = {
			...options,
			title: title.replaceAll('"', '\\"'),
			message: message.replaceAll('"', '\\"'),
			subtitle: options.subtitle?.replaceAll('"', '\\"') || "",
		}

		switch (platform()) {
			case "darwin":
				await showMacOSNotification(escapedOptions)
				break
			case "win32":
				await showWindowsNotification(escapedOptions)
				break
			case "linux":
				await showLinuxNotification(escapedOptions)
				break
			default:
				throw new Error("Unsupported platform")
		}
	} catch (error) {
		Logger.error("Could not show system notification", error)
	}
}
