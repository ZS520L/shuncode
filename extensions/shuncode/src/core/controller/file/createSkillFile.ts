import { CreateSkillRequest, SkillsToggles } from "@shared/proto/shuncode/file"
import fs from "fs/promises"
import path from "path"
import { ensureSkillsDirectoryExists } from "@/core/storage/disk"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { fileExistsAtPath } from "@/utils/fs"
import { Controller } from ".."
import { openFile } from "./openFile"

const SKILL_TEMPLATE = `---
name: {{SKILL_NAME}}
description: Brief description of what this skill does
---

# {{SKILL_NAME}}

Instructions for the AI agent...

## Usage

Describe when and how to use this skill.

## Steps

1. First step
2. Second step
3. Third step
`

/**
 * Creates a new skill from template
 * @param controller The controller instance
 * @param request The request containing the skill name
 * @returns The updated skills toggles
 */
export async function createSkillFile(controller: Controller, request: CreateSkillRequest): Promise<SkillsToggles> {
	const { skillName } = request

	if (!skillName || typeof skillName !== "string") {
		Logger.error("createSkillFile: Missing or invalid parameters", {
			skillName: typeof skillName === "string" ? skillName : `Invalid: ${typeof skillName}`,
		})
		throw new Error("Missing or invalid parameters for createSkillFile")
	}

	// Validate skill name (must be valid directory name)
	const sanitizedName = skillName.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase()
	if (!sanitizedName) {
		throw new Error("Invalid skill name")
	}

	const globalSkillsDir = await ensureSkillsDirectoryExists()
	const skillDir = path.join(globalSkillsDir, sanitizedName)

	// Check if skill already exists
	if (await fileExistsAtPath(skillDir)) {
		await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: `Skill "${sanitizedName}" already exists`,
		})
		// Return current toggles
		const globalToggles = controller.stateManager.getGlobalSettingsKey("globalSkillsToggles") || {}
		const localToggles = controller.stateManager.getWorkspaceStateKey("localSkillsToggles") || {}
		return SkillsToggles.create({
			globalSkillsToggles: globalToggles,
			localSkillsToggles: localToggles,
		})
	}

	// Create skill directory
	await fs.mkdir(skillDir, { recursive: true })

	// Create SKILL.md from template
	const skillMdPath = path.join(skillDir, "SKILL.md")
	const content = SKILL_TEMPLATE.replace(/\{\{SKILL_NAME\}\}/g, sanitizedName)
	await fs.writeFile(skillMdPath, content, "utf-8")

	// Open the file for editing
	await openFile(controller, { value: skillMdPath })

	// Return current toggles (new skill defaults to enabled)
	const globalToggles = controller.stateManager.getGlobalSettingsKey("globalSkillsToggles") || {}
	const localToggles = controller.stateManager.getWorkspaceStateKey("localSkillsToggles") || {}

	return SkillsToggles.create({
		globalSkillsToggles: globalToggles,
		localSkillsToggles: localToggles,
	})
}
