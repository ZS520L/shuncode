import { YandexGptModelId, yandexGptDefaultModelId, yandexGptModels, ModelInfo } from "@shared/api"
import { ShuncodeStorageMessage } from "@/shared/messages/content"
import { t } from "@/i18n/backend-i18n"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

const YANDEX_GPT_BASE_URL = "https://llm.api.cloud.yandex.net/v1/chat/completions"

interface YandexGptHandlerOptions extends CommonApiHandlerOptions {
	yandexGptApiKey?: string
	yandexGptFolderId?: string
	apiModelId?: string
}

export class YandexGptHandler implements ApiHandler {
	private options: YandexGptHandlerOptions

	constructor(options: YandexGptHandlerOptions) {
		this.options = options
	}

	/**
	 * Build the model URI for YandexGPT.
	 * Format: gpt://<folder_id>/<model>/latest
	 */
	private getModelUri(): string {
		const model = this.getModel()
		const folderId = this.options.yandexGptFolderId
		if (!folderId) {
			throw new Error(t("yandexgpt.error.folderIdRequired"))
		}
		return `gpt://${folderId}/${model.id}/latest`
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ShuncodeStorageMessage[]): ApiStream {
		if (!this.options.yandexGptApiKey) {
			throw new Error(t("yandexgpt.error.apiKeyRequired"))
		}
		if (!this.options.yandexGptFolderId) {
			throw new Error(t("yandexgpt.error.folderIdRequired"))
		}

		const model = this.getModel()
		const modelUri = this.getModelUri()

		// Build OpenAI-compatible messages
		const openAiMessages = [
			{ role: "system" as const, content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Flatten multipart content to strings (YandexGPT doesn't support images)
		const flatMessages = openAiMessages.map((msg) => {
			if (typeof msg.content === "string") {
				return { role: msg.role, content: msg.content }
			}
			if (Array.isArray(msg.content)) {
				const text = (msg.content as any[])
					.map((part: any) => {
						if (typeof part === "string") return part
						if (part.type === "text" && part.text) return part.text
						return ""
					})
					.filter(Boolean)
					.join("\n")
				return { role: msg.role, content: text }
			}
			return { role: msg.role, content: String(msg.content ?? "") }
		})

		const requestBody: Record<string, any> = {
			model: modelUri,
			messages: flatMessages,
			stream: true,
			temperature: 0.1,
		}
		if (model.info.maxTokens) {
			requestBody.max_tokens = model.info.maxTokens
		}

		console.log(
			`[YandexGPT] Request: model=${model.id}, uri=${modelUri}, messages=${flatMessages.length}, stream=true`,
		)

		const response = await fetch(YANDEX_GPT_BASE_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.options.yandexGptApiKey}`,
				"x-folder-id": this.options.yandexGptFolderId,
			},
			body: JSON.stringify(requestBody),
		})

		if (!response.ok) {
			const errorText = await response.text()
			console.error(`[YandexGPT] API error ${response.status}: ${errorText}`)
			throw new Error(t("yandexgpt.error.apiFailed", { status: String(response.status), details: errorText }))
		}

		if (!response.body) {
			throw new Error(t("yandexgpt.error.noResponseBody"))
		}

		// Parse SSE stream (OpenAI-compatible format)
		const reader = response.body.getReader()
		const decoder = new TextDecoder()
		let buffer = ""

		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			buffer += decoder.decode(value, { stream: true })
			const lines = buffer.split("\n")
			buffer = lines.pop() || ""

			for (const line of lines) {
				const trimmed = line.trim()
				if (!trimmed || trimmed === "data: [DONE]") continue
				if (!trimmed.startsWith("data: ")) continue

				try {
					const json = JSON.parse(trimmed.slice(6))
					const choice = json.choices?.[0]
					const delta = choice?.delta

					// Text content
					const textContent = delta?.content
					if (textContent) {
						yield {
							type: "text" as const,
							text: textContent,
						}
					}

					// Usage info
					if (json.usage) {
						const inputTokens = json.usage.prompt_tokens || 0
						const outputTokens = json.usage.completion_tokens || 0
						const totalCost =
							(inputTokens * (model.info.inputPrice || 0) +
								outputTokens * (model.info.outputPrice || 0)) / 1_000_000
						yield {
							type: "usage" as const,
							inputTokens,
							outputTokens,
							totalCost,
						}
					}
				} catch {
					// Skip malformed SSE lines
				}
			}
		}
	}

	getModel(): { id: YandexGptModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in yandexGptModels) {
			const id = modelId as YandexGptModelId
			return { id, info: yandexGptModels[id] }
		}
		return {
			id: yandexGptDefaultModelId,
			info: yandexGptModels[yandexGptDefaultModelId],
		}
	}
}
