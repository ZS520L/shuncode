import { ShuncodeSayTool } from "@shared/ExtensionMessage"
import { ShuncodeDefaultTool } from "@shared/tools"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { ToolResponse } from "../.."
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

interface ImageGenerationResponse {
	created: number
	data: Array<{
		b64_json?: string
		url?: string
		revised_prompt?: string
	}>
	usage?: {
		input_tokens?: number
		output_tokens?: number
		total_tokens?: number
	}
}

export class GenerateImageToolHandler implements IFullyManagedTool {
	readonly name = ShuncodeDefaultTool.GENERATE_IMAGE

	getDescription(block: ToolUse): string {
		const prompt = block.params.prompt || ""
		const truncated = prompt.length > 50 ? prompt.slice(0, 50) + "..." : prompt
		return `[${block.name} for '${truncated}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const prompt = block.params.prompt || ""
		const sharedMessageProps: ShuncodeSayTool = {
			tool: "generateImage",
			path: uiHelpers.removeClosingTag(block, "prompt", prompt),
			content: `Generating image: ${uiHelpers.removeClosingTag(block, "prompt", prompt)}`,
			operationIsLocatedInWorkspace: false,
		} satisfies ShuncodeSayTool

		const partialMessage = JSON.stringify(sharedMessageProps)

		await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		try {
			const prompt: string | undefined = block.params.prompt
			const size: string | undefined = block.params.size
			const quality: string | undefined = block.params.quality

			if (!prompt) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError(this.name, "prompt")
			}
			config.taskState.consecutiveMistakeCount = 0

			// Read image generation endpoint config from settings
			const stateManager = config.services.stateManager
			const baseUrl = stateManager.getGlobalSettingsKey("imageGenerationBaseUrl")
			const apiKey = stateManager.getGlobalSettingsKey("imageGenerationApiKey")
			const modelId = stateManager.getGlobalSettingsKey("imageGenerationModelId")

			if (!baseUrl || !apiKey || !modelId) {
				return formatResponse.toolError(
					"Image generation is not configured. Please set imageGenerationBaseUrl, imageGenerationApiKey, and imageGenerationModelId in settings.",
				)
			}

			const sharedMessageProps: ShuncodeSayTool = {
				tool: "generateImage",
				path: prompt,
				content: `Generating image: ${prompt}`,
				status: "generating",
				operationIsLocatedInWorkspace: false,
			}
			const completeMessage = JSON.stringify(sharedMessageProps)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, true)

			// Build the API request
			const endpoint = baseUrl.replace(/\/+$/, "") + "/v1/images/generations"

			const requestBody: Record<string, any> = {
				model: modelId,
				prompt,
				n: 1,
			}

			if (size && size !== "auto") {
				requestBody.size = size
			}

			if (quality) {
				requestBody.quality = quality
			}

			Logger.log(`[GenerateImage] Calling ${endpoint} with model ${modelId}`)

			const response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${apiKey}`,
				},
				body: JSON.stringify(requestBody),
			})

			if (!response.ok) {
				const errorText = await response.text()
				Logger.error(`[GenerateImage] API error ${response.status}: ${errorText}`)
				// Update status to error
				const errorProps: ShuncodeSayTool = {
					tool: "generateImage",
					path: prompt,
					content: `Image generation failed (${response.status})`,
					status: "error",
					operationIsLocatedInWorkspace: false,
				}
				await config.callbacks.say("tool", JSON.stringify(errorProps), undefined, undefined, false)
				return formatResponse.toolError(
					`Image generation API error (${response.status}): ${errorText}`,
				)
			}

			const result = (await response.json()) as ImageGenerationResponse

			// Update the tool message to show completed status
			const doneProps: ShuncodeSayTool = {
				tool: "generateImage",
				path: prompt,
				content: `Image generated: ${prompt}`,
				status: "done",
				operationIsLocatedInWorkspace: false,
			}
			await config.callbacks.say("tool", JSON.stringify(doneProps), undefined, undefined, false)

			if (!result.data || result.data.length === 0) {
				return formatResponse.toolError("Image generation returned no data.")
			}

			const imageData = result.data[0]

			// Handle base64 response (GPT Image models always return base64)
			if (imageData.b64_json) {
				const dataUri = `data:image/png;base64,${imageData.b64_json}`

				// Save image to temp dir for file access
				const tmpDir = path.join(os.tmpdir(), "shuncode-images")
				await fs.mkdir(tmpDir, { recursive: true })
				const fileName = `generated_${Date.now()}.png`
				const filePath = path.join(tmpDir, fileName)
				await fs.writeFile(filePath, Buffer.from(imageData.b64_json, "base64"))
				Logger.log(`[GenerateImage] Image saved to ${filePath}`)

				// Show the image in the chat UI via say with images array
				await config.callbacks.say("text", undefined, [dataUri])

				let resultText = `Image generated successfully. Saved to: ${filePath}`
				if (imageData.revised_prompt) {
					resultText += `\n\nRevised prompt: ${imageData.revised_prompt}`
				}
				if (result.usage) {
					resultText += `\n\nTokens used - Input: ${result.usage.input_tokens || 0}, Output: ${result.usage.output_tokens || 0}`
				}

				return formatResponse.toolResult(resultText)
			}

			// Handle URL response (DALL-E 2 may return URLs)
			if (imageData.url) {
				let resultText = `Image generated successfully.\n\n![Generated Image](${imageData.url})`
				if (imageData.revised_prompt) {
					resultText += `\n\nRevised prompt: ${imageData.revised_prompt}`
				}
				return formatResponse.toolResult(resultText)
			}

			return formatResponse.toolError("Image generation returned unexpected response format.")
		} catch (error) {
			Logger.error("[GenerateImage] Error:", error)
			return formatResponse.toolError(`Error generating image: ${(error as Error).message}`)
		}
	}
}
