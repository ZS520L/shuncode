import { DeleteSkillRequest, SkillsToggles } from "@shared/proto/shuncode/file"
import fs from "fs/promises"
import path from "path"
import { ensureSkillsDirectoryExists } from "@/core/storage/disk"
import { Logger } from "@/shared/services/Logger"
import { fileExistsAtPath } from "@/utils/fs"
import { Controller } from ".."

/**
 * Deletes an existing global skill directory.
 * @param controller The controller instance
 * @param request The request containing the skill path
 * @returns The updated skills toggles
 */
export async function deleteSkillFile(controller: Controller, request: DeleteSkillRequest): Promise<SkillsToggles> {
	const { skillPath } = request

	if (!skillPath || typeof skillPath !== "string") {
		Logger.error("deleteSkillFile: Missing or invalid parameters", {
			skillPath: typeof skillPath === "string" ? skillPath : `Invalid: ${typeof skillPath}`,
		})
		throw new Error("Missing or invalid parameters for deleteSkillFile")
	}

	const globalSkillsDir = path.resolve(await ensureSkillsDirectoryExists())
	const skillDir = path.resolve(path.dirname(skillPath))
	const relativeToGlobal = path.relative(globalSkillsDir, skillDir)
	if (!relativeToGlobal || relativeToGlobal.startsWith("..") || path.isAbsolute(relativeToGlobal)) {
		throw new Error("Only global skill subdirectories can be deleted")
	}

	if (!(await fileExistsAtPath(skillDir))) {
		Logger.warn(`deleteSkillFile: Skill directory not found: ${skillDir}`)
		return SkillsToggles.create({
			globalSkillsToggles: controller.stateManager.getGlobalSettingsKey("globalSkillsToggles") || {},
			localSkillsToggles: {},
		})
	}

	await fs.rm(skillDir, { recursive: true, force: true })

	const currentToggles = controller.stateManager.getGlobalSettingsKey("globalSkillsToggles") || {}
	const { [skillPath]: _, ...globalToggles } = currentToggles
	controller.stateManager.setGlobalState("globalSkillsToggles", globalToggles)

	await controller.postStateToWebview()

	return SkillsToggles.create({
		globalSkillsToggles: globalToggles,
		localSkillsToggles: {},
	})
}
