import { ShuncodeSayTool } from "@shared/ExtensionMessage"
import { ShuncodeDefaultTool } from "@shared/tools"
import { UrlContentFetcher } from "@/services/browser/UrlContentFetcher"
import { telemetryService } from "@/services/telemetry"

import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { ToolResponse } from "../.."
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class WebFetchToolHandler implements IFullyManagedTool {
	readonly name = ShuncodeDefaultTool.WEB_FETCH

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.url}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const url = block.params.url || ""
		const sharedMessageProps: ShuncodeSayTool = {
			tool: "webFetch",
			path: uiHelpers.removeClosingTag(block, "url", url),
			content: `Fetching URL: ${uiHelpers.removeClosingTag(block, "url", url)}`,
			operationIsLocatedInWorkspace: false,
		} satisfies ShuncodeSayTool

		const partialMessage = JSON.stringify(sharedMessageProps)

		await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		try {
			const url: string | undefined = block.params.url
			const prompt: string | undefined = block.params.prompt

			const apiConfig = config.services.stateManager.getApiConfiguration()
			const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
			const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

			if (!url) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError(this.name, "url")
			}
			if (!prompt) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError(this.name, "prompt")
			}
			config.taskState.consecutiveMistakeCount = 0

			try {
				new URL(url)
			} catch {
				config.taskState.consecutiveMistakeCount++
				return formatResponse.toolError(`Invalid URL: ${url}`)
			}

			const sharedMessageProps: ShuncodeSayTool = {
				tool: "webFetch",
				path: url,
				content: `Fetching URL: ${url}`,
				operationIsLocatedInWorkspace: false,
			}
			const completeMessage = JSON.stringify(sharedMessageProps)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			telemetryService.captureToolUsage(
				config.ulid,
				"web_fetch",
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

			const fetcher = new UrlContentFetcher(config.context)
			try {
				await fetcher.launchBrowser()
				const markdown = await fetcher.urlToMarkdown(url)

				if (!markdown || markdown.trim().length === 0) {
					return formatResponse.toolResult(`Page fetched but no readable content found at: ${url}`)
				}

				const maxLength = 50_000
				const truncated = markdown.length > maxLength ? markdown.slice(0, maxLength) + "\n\n[Content truncated]" : markdown

				return formatResponse.toolResult(truncated)
			} finally {
				await fetcher.closeBrowser()
			}
		} catch (error) {
			return `Error fetching web content: ${(error as Error).message}`
		}
	}
}
