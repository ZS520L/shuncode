import { Empty, EmptyRequest } from "@shared/proto/shuncode/common"
import { ShowMessageType } from "@shared/proto/host/window"
import { ExecuteCommandInTerminalRequest } from "@shared/proto/host/workspace"
import { HostProvider } from "@/hosts/host-provider"
import { t } from "@/i18n/backend-i18n"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Handles the installation of the Shuncode CLI tool
 * @param controller The controller instance
 * @param _request The empty request
 * @returns Empty response
 */
export async function installShuncodeCli(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	const installCommand = "npm install -g shuncode"

	try {
		// Use the HostProvider to execute the command in a terminal
		// This works across different platforms (VSCode, JetBrains, etc.)
		const response = await HostProvider.workspace.executeCommandInTerminal(
			ExecuteCommandInTerminalRequest.create({
				command: installCommand,
			}),
		)

		if (!response.success) {
			throw new Error("Failed to execute command in terminal")
		}
	} catch (error) {
		Logger.error("Error executing CLI installation:", error)
		await HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: t("cli.installFailed", { error: error instanceof Error ? error.message : "Unknown error" }),
			options: { items: [] },
		})
	}

	return Empty.create()
}
