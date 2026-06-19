import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity"
import { azureOpenAiDefaultApiVersion, ModelInfo, OpenAiCompatibleModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import OpenAI, { AzureOpenAI } from "openai"
import type { ChatCompletionReasoningEffort, ChatCompletionTool } from "openai/resources/chat/completions"
import { ShuncodeStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiFormat } from "@/shared/proto/shuncode/models"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToOpenAIResponsesInput } from "../transform/openai-response-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"
import { ThinkTagStreamParser } from "../transform/think-tag-parser"
import { Logger } from "@/shared/services/Logger"

interface OpenAiHandlerOptions extends CommonApiHandlerOptions {
	openAiApiKey?: string
	openAiBaseUrl?: string
	azureApiVersion?: string
	azureIdentity?: boolean
	openAiHeaders?: Record<string, string>
	openAiModelId?: string
	openAiModelInfo?: OpenAiCompatibleModelInfo
	reasoningEffort?: string
}

export class OpenAiHandler implements ApiHandler {
	private options: OpenAiHandlerOptions
	private client: OpenAI | undefined

	constructor(options: OpenAiHandlerOptions) {
		this.options = options
	}

	private getAzureAudienceScope(baseUrl?: string): string {
		const url = baseUrl?.toLowerCase() ?? ""
		if (url.includes("azure.us")) return "https://cognitiveservices.azure.us/.default"
		if (url.includes("azure.com")) return "https://cognitiveservices.azure.com/.default"
		return "https://cognitiveservices.azure.com/.default"
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.openAiApiKey && !this.options.azureIdentity) {
				throw new Error("OpenAI API key or Azure Identity Authentication is required")
			}
			try {
				const baseUrl = this.options.openAiBaseUrl?.toLowerCase() ?? ""
				const isAzureDomain = baseUrl.includes("azure.com") || baseUrl.includes("azure.us")
				// Azure API shape slightly differs from the core API shape...
				if (
					this.options.azureApiVersion ||
					(isAzureDomain && !this.options.openAiModelId?.toLowerCase().includes("deepseek"))
				) {
					if (this.options.azureIdentity) {
						this.client = new AzureOpenAI({
							baseURL: this.options.openAiBaseUrl,
							azureADTokenProvider: getBearerTokenProvider(
								new DefaultAzureCredential(),
								this.getAzureAudienceScope(this.options.openAiBaseUrl),
							),
							apiVersion: this.options.azureApiVersion || azureOpenAiDefaultApiVersion,
							defaultHeaders: this.options.openAiHeaders,
							fetch,
						})
					} else {
						this.client = new AzureOpenAI({
							baseURL: this.options.openAiBaseUrl,
							apiKey: this.options.openAiApiKey,
							apiVersion: this.options.azureApiVersion || azureOpenAiDefaultApiVersion,
							defaultHeaders: this.options.openAiHeaders,
							fetch,
						})
					}
				} else {
					this.client = new OpenAI({
						baseURL: this.options.openAiBaseUrl,
						apiKey: this.options.openAiApiKey,
						defaultHeaders: this.options.openAiHeaders,
						fetch,
					})
				}
			} catch (error: any) {
				throw new Error(`Error creating OpenAI client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ShuncodeStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
		// Route to Responses API if apiFormat indicates it
		if (this.options.openAiModelInfo?.apiFormat === ApiFormat.OPENAI_RESPONSES) {
			yield* this.createResponseStream(systemPrompt, messages, tools)
			return
		}

		const client = this.ensureClient()
		const modelId = this.options.openAiModelId ?? ""
		const isDeepseekReasoner = modelId.includes("deepseek-reasoner")
		const isR1FormatRequired = this.options.openAiModelInfo?.isR1FormatRequired ?? false
		const isReasoningModelFamily =
			["o1", "o3", "o4", "gpt-5"].some((prefix) => modelId.includes(prefix)) && !modelId.includes("chat")
		// Qwen3/Qwen3.5 models: enable thinking mode so reasoning goes into <think> tags
		// parsed by ThinkTagStreamParser instead of appearing as plain text.
		// Matches: qwen3, qwen3.5, qwen-3, Qwen/Qwen3.5-..., etc.
		const modelIdLower = modelId.toLowerCase()
		const isQwen3ThinkingModel =
			modelIdLower.includes("qwen3") ||
			modelIdLower.includes("qwen3.") ||
			modelIdLower.includes("qwen-3") ||
			/qwen\/qwen3/i.test(modelId)

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]
		let temperature: number | undefined
		if (this.options.openAiModelInfo?.temperature !== undefined) {
			const tempValue = Number(this.options.openAiModelInfo.temperature)
			temperature = tempValue === 0 ? undefined : tempValue
		} else {
			temperature = openAiModelInfoSaneDefaults.temperature
		}
		let reasoningEffort = ((this.options.reasoningEffort as ChatCompletionReasoningEffort) ||
			"medium") as ChatCompletionReasoningEffort
		let maxTokens: number | undefined

		if (this.options.openAiModelInfo?.maxTokens && this.options.openAiModelInfo.maxTokens > 0) {
			maxTokens = Number(this.options.openAiModelInfo.maxTokens)
		} else {
			maxTokens = undefined
		}

		if (isDeepseekReasoner || isR1FormatRequired) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		if (isReasoningModelFamily) {
			openAiMessages = [{ role: "developer", content: systemPrompt }, ...convertToOpenAiMessages(messages)]
			temperature = undefined // does not support temperature
		}

		// Qwen3 local thinking mode: prepend "/think\n" to the last user message.
		// This is the official Qwen3 way to enable per-turn thinking mode.
		// The model then outputs reasoning inside <think>...</think> tags,
		// which ThinkTagStreamParser extracts as reasoning chunks.
		if (isQwen3ThinkingModel) {
			for (let i = openAiMessages.length - 1; i >= 0; i--) {
				const msg = openAiMessages[i]
				if (msg.role === "user" && typeof msg.content === "string") {
					openAiMessages = [
						...openAiMessages.slice(0, i),
						{ ...msg, content: `/think\n${msg.content}` },
						...openAiMessages.slice(i + 1),
					]
					break
				}
			}
		}

		const stream = await client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			temperature,
			max_tokens: maxTokens,
			reasoning_effort: reasoningEffort,
			stream: true,
			stream_options: { include_usage: true },
			...getOpenAIToolParams(tools),
		})

		const toolCallProcessor = new ToolCallProcessor()
		const thinkParser = new ThinkTagStreamParser()
		let nativeReasoningReceived = false

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta

			// Native reasoning_content (some LM Studio versions, cloud APIs)
			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				nativeReasoningReceived = true
				yield {
					type: "reasoning",
					reasoning: (delta.reasoning_content as string | undefined) || "",
				}
			}

			if (delta?.content) {
				if (nativeReasoningReceived) {
					yield { type: "text", text: delta.content }
				} else {
					const { reasoning, text } = thinkParser.process(delta.content)
					if (reasoning) yield { type: "reasoning", reasoning }
					if (text) yield { type: "text", text }
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			if (chunk.usage) {
				const promptTokens = chunk.usage.prompt_tokens || 0
				const cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens || 0
				// @ts-ignore-next-line
				const cacheMissTokens = chunk.usage.prompt_cache_miss_tokens || 0
				yield {
					type: "usage",
					inputTokens: promptTokens - cachedTokens,
					outputTokens: chunk.usage.completion_tokens || 0,
					cacheReadTokens: cachedTokens,
					cacheWriteTokens: cacheMissTokens,
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.openAiModelId ?? "",
			info: this.options.openAiModelInfo ?? openAiModelInfoSaneDefaults,
		}
	}

	private async *createResponseStream(
		systemPrompt: string,
		messages: ShuncodeStorageMessage[],
		tools?: ChatCompletionTool[],
	): ApiStream {
		const client = this.ensureClient()
		const modelId = this.options.openAiModelId ?? ""

		// Convert messages to Responses API input format
		const input = convertToOpenAIResponsesInput(messages)

		// Convert ChatCompletion tools to Responses API format
		const responseTools = tools
			?.filter((tool) => tool.type === "function")
			.map((tool: any) => ({
				type: "function" as const,
				name: tool.function.name,
				description: tool.function.description,
				parameters: tool.function.parameters,
				strict: tool.function.strict ?? true,
			}))

		const reasoningEffort = ((this.options.reasoningEffort as ChatCompletionReasoningEffort) || "medium") as ChatCompletionReasoningEffort

		const stream = await client.responses.create({
			model: modelId,
			instructions: systemPrompt,
			input,
			stream: true,
			tools: responseTools?.length ? responseTools : undefined,
			reasoning: { effort: reasoningEffort, summary: "auto" },
		})

		for await (const chunk of stream) {
			if (chunk.type === "response.output_item.added") {
				const item = chunk.item
				if (item.type === "function_call" && item.id) {
					yield {
						type: "tool_calls",
						id: item.id,
						tool_call: {
							call_id: item.call_id,
							function: {
								id: item.id,
								name: item.name,
								arguments: item.arguments,
							},
						},
					}
				}
				if (item.type === "reasoning" && item.encrypted_content && item.id) {
					yield {
						type: "reasoning",
						id: item.id,
						reasoning: "",
						redacted_data: item.encrypted_content,
					}
				}
			}
			if (chunk.type === "response.output_item.done") {
				const item = chunk.item
				if (item.type === "function_call") {
					yield {
						type: "tool_calls",
						id: item.id || item.call_id,
						tool_call: {
							call_id: item.call_id,
							function: {
								id: item.id,
								name: item.name,
								arguments: item.arguments,
							},
						},
					}
				}
				if (item.type === "reasoning") {
					yield {
						type: "reasoning",
						id: item.id,
						details: item.summary,
						reasoning: "",
					}
				}
			}
			if (chunk.type === "response.reasoning_summary_part.added") {
				yield {
					type: "reasoning",
					id: chunk.item_id,
					reasoning: chunk.part.text,
				}
			}
			if (chunk.type === "response.reasoning_summary_text.delta") {
				yield {
					type: "reasoning",
					id: chunk.item_id,
					reasoning: chunk.delta,
				}
			}
			if (chunk.type === "response.output_text.delta") {
				if (chunk.delta) {
					yield {
						id: chunk.item_id,
						type: "text",
						text: chunk.delta,
					}
				}
			}
			if (chunk.type === "response.reasoning_text.delta") {
				if (chunk.delta) {
					yield {
						id: chunk.item_id,
						type: "reasoning",
						reasoning: chunk.delta,
					}
				}
			}
			if (chunk.type === "response.function_call_arguments.delta") {
				yield {
					type: "tool_calls",
					tool_call: {
						function: {
							id: chunk.item_id,
							name: chunk.item_id,
							arguments: chunk.delta,
						},
					},
				}
			}
			if (chunk.type === "response.function_call_arguments.done") {
				if (chunk.item_id && chunk.name && chunk.arguments) {
					yield {
						type: "tool_calls",
						tool_call: {
							function: {
								id: chunk.item_id,
								name: chunk.name,
								arguments: chunk.arguments,
							},
						},
					}
				}
			}
			if (
				chunk.type === "response.incomplete" &&
				chunk.response?.status === "incomplete" &&
				chunk.response?.incomplete_details?.reason === "max_output_tokens"
			) {
				Logger.log("Ran out of tokens")
			}
			if (chunk.type === "response.completed" && chunk.response?.usage) {
				const usage = chunk.response.usage
				const inputTokens = usage.input_tokens || 0
				const outputTokens = usage.output_tokens || 0
				const cacheReadTokens = usage.input_tokens_details?.cached_tokens || 0
				yield {
					type: "usage",
					inputTokens: Math.max(0, inputTokens - cacheReadTokens),
					outputTokens: outputTokens,
					cacheWriteTokens: 0,
					cacheReadTokens: cacheReadTokens,
					id: chunk.response.id,
				}
			}
		}
	}
}
