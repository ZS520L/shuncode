import { ShuncodeSayTool } from "@shared/ExtensionMessage"
import { ShuncodeDefaultTool } from "@shared/tools"
import { LocalWebSearchService } from "@/services/browser/LocalWebSearchService"
import { telemetryService } from "@/services/telemetry"
import { parsePartialArrayString } from "@/shared/array"

import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { ToolResponse } from "../.."
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class WebSearchToolHandler implements IFullyManagedTool {
	readonly name = ShuncodeDefaultTool.WEB_SEARCH
	readonly isConcurrencySafe = true

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.query}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const query = block.params.query || ""
		const sharedMessageProps: ShuncodeSayTool = {
			tool: "webSearch",
			path: uiHelpers.removeClosingTag(block, "query", query),
			content: `Searching for: ${uiHelpers.removeClosingTag(block, "query", query)}`,
			operationIsLocatedInWorkspace: false,
		} satisfies ShuncodeSayTool

		const partialMessage = JSON.stringify(sharedMessageProps)

		await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		try {
			const query: string | undefined = block.params.query
			const allowedDomainsRaw: string | undefined = block.params.allowed_domains
			const blockedDomainsRaw: string | undefined = block.params.blocked_domains

			const apiConfig = config.services.stateManager.getApiConfiguration()
			const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
			const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

			if (!query) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError(this.name, "query")
			}
			config.taskState.consecutiveMistakeCount = 0

			const allowedDomains = parsePartialArrayString(allowedDomainsRaw || "[]")
			const blockedDomains = parsePartialArrayString(blockedDomainsRaw || "[]")

			if (allowedDomains.length > 0 && blockedDomains.length > 0) {
				config.taskState.consecutiveMistakeCount++
				return formatResponse.toolError("Cannot specify both allowed_domains and blocked_domains")
			}

			const sharedMessageProps: ShuncodeSayTool = {
				tool: "webSearch",
				path: query,
				content: `Searching for: ${query}`,
				operationIsLocatedInWorkspace: false,
			}
			const completeMessage = JSON.stringify(sharedMessageProps)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			telemetryService.captureToolUsage(
				config.ulid,
				"web_search",
				config.api.getModel().id,
				provider,
				true,
				true,
				undefined,
				block.isNativeToolCall,
			)

			try {
				const { ToolHookUtils } = await import("../utils/ToolHookUtils")
				await ToolHookUtils.runPreToolUseIfEnabled(config, block)
			} catch (error) {
				const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
				if (error instanceof PreToolUseHookCancellationError) {
					return formatResponse.toolDenied()
				}
				throw error
			}

			const searchService = new LocalWebSearchService()
			const results = await searchService.search(
				query,
				allowedDomains.length > 0 ? allowedDomains : undefined,
				blockedDomains.length > 0 ? blockedDomains : undefined,
			)

			if (results.length === 0) {
				return formatResponse.toolResult(`No results found for: ${query}`)
			}

			let resultText = `Search completed (${results.length} results found):\n\n`
			results.forEach((result, index) => {
				resultText += `${index + 1}. ${result.title}\n   ${result.url}\n   ${result.snippet}\n\n`
			})

			return formatResponse.toolResult(resultText)
		} catch (error) {
			return `Error performing web search: ${(error as Error).message}`
		}
	}
}
