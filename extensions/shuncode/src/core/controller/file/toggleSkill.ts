import { SkillsToggles, ToggleSkillRequest } from "@shared/proto/shuncode/file"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Toggles a global skill on or off.
 * @param controller The controller instance
 * @param request The request containing the skill path and enabled state
 * @returns The updated skills toggles
 */
export async function toggleSkill(controller: Controller, request: ToggleSkillRequest): Promise<SkillsToggles> {
	const { skillPath, enabled } = request

	if (!skillPath || typeof enabled !== "boolean") {
		Logger.error("toggleSkill: Missing or invalid parameters", {
			skillPath,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleSkill")
	}

	const globalToggles = {
		...(controller.stateManager.getGlobalSettingsKey("globalSkillsToggles") || {}),
		[skillPath]: enabled,
	}
	controller.stateManager.setGlobalState("globalSkillsToggles", globalToggles)

	await controller.postStateToWebview()

	return SkillsToggles.create({
		globalSkillsToggles: globalToggles,
		localSkillsToggles: {},
	})
}
