import {
	ActivatedConditionalRule,
	getRemoteRulesTotalContentWithMetadata,
	getRuleFilesTotalContentWithMetadata,
	RULE_SOURCE_PREFIX,
	RuleLoadResultWithInstructions,
	synchronizeRuleToggles,
} from "@core/context/instructions/user-instructions/rule-helpers"
import { formatResponse } from "@core/prompts/responses"
import { ensureRulesDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { StateManager } from "@core/storage/StateManager"
import { ShuncodeRulesToggles } from "@shared/shuncode-rules"
import { fileExistsAtPath, isDirectory, readDirectory } from "@utils/fs"
import fs from "fs/promises"
import path from "path"
import { Controller } from "@/core/controller"
import { Logger } from "@/shared/services/Logger"
import { parseYamlFrontmatter } from "./frontmatter"
import { evaluateRuleConditionals, type RuleEvaluationContext } from "./rule-conditionals"

export const getGlobalShuncodeRules = async (
	globalShuncodeRulesFilePath: string,
	toggles: ShuncodeRulesToggles,
	opts?: { evaluationContext?: RuleEvaluationContext },
): Promise<RuleLoadResultWithInstructions> => {
	let combinedContent = ""
	const activatedConditionalRules: ActivatedConditionalRule[] = []

	// 1. Get file-based rules
	if (await fileExistsAtPath(globalShuncodeRulesFilePath)) {
		if (await isDirectory(globalShuncodeRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(globalShuncodeRulesFilePath)
				// Note: ruleNamePrefix explicitly set to "global" for clarity (matches the default)
				const rulesFilesTotal = await getRuleFilesTotalContentWithMetadata(
					rulesFilePaths,
					globalShuncodeRulesFilePath,
					toggles,
					{
						evaluationContext: opts?.evaluationContext,
						ruleNamePrefix: "global",
					},
				)
				if (rulesFilesTotal.content) {
					combinedContent = rulesFilesTotal.content
					activatedConditionalRules.push(...rulesFilesTotal.activatedConditionalRules)
				}
			} catch {
				Logger.error(`Failed to read .shuncoderules directory at ${globalShuncodeRulesFilePath}`)
			}
		} else {
			Logger.error(`${globalShuncodeRulesFilePath} is not a directory`)
		}
	}

	// 2. Append remote config rules
	const stateManager = StateManager.get()
	const remoteConfigSettings = stateManager.getRemoteConfigSettings()
	const remoteRules = remoteConfigSettings.remoteGlobalRules || []
	const remoteToggles = stateManager.getGlobalStateKey("remoteRulesToggles") || {}
	const remoteResult = getRemoteRulesTotalContentWithMetadata(remoteRules, remoteToggles, {
		evaluationContext: opts?.evaluationContext,
	})
	if (remoteResult.content) {
		if (combinedContent) combinedContent += "\n\n"
		combinedContent += remoteResult.content
		activatedConditionalRules.push(...remoteResult.activatedConditionalRules)
	}

	// 3. Return formatted instructions
	if (!combinedContent) {
		return { instructions: undefined, content: undefined, activatedConditionalRules: [] }
	}

	return {
		instructions: formatResponse.shuncodeRulesGlobalDirectoryInstructions(globalShuncodeRulesFilePath, combinedContent),
		content: combinedContent,
		activatedConditionalRules,
	}
}

export const getLocalShuncodeRules = async (
	cwd: string,
	toggles: ShuncodeRulesToggles,
	opts?: { evaluationContext?: RuleEvaluationContext },
): Promise<RuleLoadResultWithInstructions> => {
	const shuncodeRulesFilePath = path.resolve(cwd, GlobalFileNames.shuncodeRules)

	let instructions: string | undefined
	const activatedConditionalRules: ActivatedConditionalRule[] = []

	if (await fileExistsAtPath(shuncodeRulesFilePath)) {
		if (await isDirectory(shuncodeRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(shuncodeRulesFilePath, [
					[".shuncoderules", "workflows"],
					[".shuncoderules", "hooks"],
					[".shuncoderules", "skills"],
				])

				const rulesFilesTotal = await getRuleFilesTotalContentWithMetadata(rulesFilePaths, cwd, toggles, {
					evaluationContext: opts?.evaluationContext,
					ruleNamePrefix: "workspace",
				})
				if (rulesFilesTotal.content) {
					instructions = formatResponse.shuncodeRulesLocalDirectoryInstructions(cwd, rulesFilesTotal.content)
					activatedConditionalRules.push(...rulesFilesTotal.activatedConditionalRules)
				}
			} catch {
				Logger.error(`Failed to read .shuncoderules directory at ${shuncodeRulesFilePath}`)
			}
		} else {
			try {
				if (shuncodeRulesFilePath in toggles && toggles[shuncodeRulesFilePath] !== false) {
					const raw = (await fs.readFile(shuncodeRulesFilePath, "utf8")).trim()
					if (raw) {
						// Keep single-file .shuncoderules behavior consistent with directory/remote rules:
						// - Parse YAML frontmatter (fail-open on parse errors)
						// - Evaluate conditionals against the request's evaluation context
						const parsed = parseYamlFrontmatter(raw)
						if (parsed.hadFrontmatter && parsed.parseError) {
							// Fail-open: preserve the raw contents so the LLM can still see the author's intent.
							instructions = formatResponse.shuncodeRulesLocalFileInstructions(cwd, raw)
						} else {
							const { passed, matchedConditions } = evaluateRuleConditionals(
								parsed.data,
								opts?.evaluationContext ?? {},
							)
							if (passed) {
								instructions = formatResponse.shuncodeRulesLocalFileInstructions(cwd, parsed.body.trim())
								if (parsed.hadFrontmatter && Object.keys(matchedConditions).length > 0) {
									activatedConditionalRules.push({
										name: `${RULE_SOURCE_PREFIX.workspace}:${GlobalFileNames.shuncodeRules}`,
										matchedConditions,
									})
								}
							}
						}
					}
				}
			} catch {
				Logger.error(`Failed to read .shuncoderules file at ${shuncodeRulesFilePath}`)
			}
		}
	}

	return { instructions, activatedConditionalRules }
}

export async function refreshShuncodeRulesToggles(
	controller: Controller,
	workingDirectory: string,
): Promise<{
	globalToggles: ShuncodeRulesToggles
	localToggles: ShuncodeRulesToggles
}> {
	// Global toggles
	const globalShuncodeRulesToggles = controller.stateManager.getGlobalSettingsKey("globalShuncodeRulesToggles")
	const globalShuncodeRulesFilePath = await ensureRulesDirectoryExists()
	const updatedGlobalToggles = await synchronizeRuleToggles(globalShuncodeRulesFilePath, globalShuncodeRulesToggles)
	controller.stateManager.setGlobalState("globalShuncodeRulesToggles", updatedGlobalToggles)

	// Local toggles
	const localShuncodeRulesToggles = controller.stateManager.getWorkspaceStateKey("localShuncodeRulesToggles")
	const localShuncodeRulesFilePath = path.resolve(workingDirectory, GlobalFileNames.shuncodeRules)
	const updatedLocalToggles = await synchronizeRuleToggles(localShuncodeRulesFilePath, localShuncodeRulesToggles, "", [
		[".shuncoderules", "workflows"],
		[".shuncoderules", "hooks"],
		[".shuncoderules", "skills"],
	])
	controller.stateManager.setWorkspaceState("localShuncodeRulesToggles", updatedLocalToggles)

	return {
		globalToggles: updatedGlobalToggles,
		localToggles: updatedLocalToggles,
	}
}
