import { getWorkspaceBasename } from "@core/workspace"
import type { ToggleShuncodeRuleRequest } from "@shared/proto/shuncode/file"
import { RuleScope, ToggleShuncodeRules } from "@shared/proto/shuncode/file"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Toggles a Shuncode rule (enable or disable)
 * @param controller The controller instance
 * @param request The toggle request
 * @returns The updated Shuncode rule toggles
 */
export async function toggleShuncodeRule(
	controller: Controller,
	request: ToggleShuncodeRuleRequest,
): Promise<ToggleShuncodeRules> {
	const { scope, rulePath, enabled } = request

	if (!rulePath || typeof enabled !== "boolean" || scope === undefined) {
		Logger.error("toggleShuncodeRule: Missing or invalid parameters", {
			rulePath,
			scope,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleShuncodeRule")
	}

	// Handle the three different scopes
	switch (scope) {
		case RuleScope.GLOBAL: {
			const toggles = controller.stateManager.getGlobalSettingsKey("globalShuncodeRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setGlobalState("globalShuncodeRulesToggles", toggles)
			break
		}
		case RuleScope.LOCAL: {
			const toggles = controller.stateManager.getWorkspaceStateKey("localShuncodeRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setWorkspaceState("localShuncodeRulesToggles", toggles)
			break
		}
		case RuleScope.REMOTE: {
			const toggles = controller.stateManager.getGlobalStateKey("remoteRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setGlobalState("remoteRulesToggles", toggles)
			break
		}
		default:
			throw new Error(`Invalid scope: ${scope}`)
	}

	// Track rule toggle telemetry with current task context
	if (controller.task?.ulid) {
		// Extract just the filename for privacy (no full paths)
		const ruleFileName = getWorkspaceBasename(rulePath, "Controller.toggleShuncodeRule")
		const isGlobal = scope === RuleScope.GLOBAL
		telemetryService.captureShuncodeRuleToggled(controller.task.ulid, ruleFileName, enabled, isGlobal)
	}

	// Get the current state to return in the response
	const globalToggles = controller.stateManager.getGlobalSettingsKey("globalShuncodeRulesToggles")
	const localToggles = controller.stateManager.getWorkspaceStateKey("localShuncodeRulesToggles")
	const remoteToggles = controller.stateManager.getGlobalStateKey("remoteRulesToggles")

	return ToggleShuncodeRules.create({
		globalShuncodeRulesToggles: { toggles: globalToggles },
		localShuncodeRulesToggles: { toggles: localToggles },
		remoteRulesToggles: { toggles: remoteToggles },
	})
}
