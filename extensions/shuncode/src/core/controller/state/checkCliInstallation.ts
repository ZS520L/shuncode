import { Boolean } from "@shared/proto/shuncode/common"
import { Logger } from "@/shared/services/Logger"
import { isShuncodeCliInstalled } from "@/utils/cli-detector"
import { Controller } from ".."

/**
 * Check if the Shuncode CLI is installed
 * @param controller The controller instance
 * @returns Boolean indicating if CLI is installed
 */
export async function checkCliInstallation(_controller: Controller): Promise<Boolean> {
	try {
		const isInstalled = await isShuncodeCliInstalled()
		return Boolean.create({ value: isInstalled })
	} catch (error) {
		Logger.error("Failed to check CLI installation:", error)
		return Boolean.create({ value: false })
	}
}
