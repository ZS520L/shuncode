import { GigaChatModelId, gigaChatDefaultModelId, gigaChatModels, ModelInfo } from "@shared/api"
import https from "https"
import { Agent as UndiciAgent, fetch as undiciFetch } from "undici"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ShuncodeStorageMessage } from "@/shared/messages/content"
import { t } from "@/i18n/backend-i18n"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

const GIGACHAT_OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
const GIGACHAT_BASE_URL = "https://gigachat.devices.sberbank.ru/api/v1"
// Token lifetime is 30 minutes, refresh 1 minute early
const TOKEN_REFRESH_BUFFER_MS = 60_000

/**
 * Russian Trusted Root CA + Sub CA certificates from the Ministry of Digital Development.
 * Required because GigaChat API servers use certificates signed by this CA,
 * which is not included in the default Node.js/OS trust stores outside of Russia.
 *
 * Root CA valid until: 2032-02-28
 * Sub CA valid until:  2027-03-06
 *
 * See REMEMBER.md in project root for maintenance schedule.
 */
const RUSSIAN_TRUSTED_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIFwjCCA6qgAwIBAgICEAAwDQYJKoZIhvcNAQELBQAwcDELMAkGA1UEBhMCUlUx
PzA9BgNVBAoMNlRoZSBNaW5pc3RyeSBvZiBEaWdpdGFsIERldmVsb3BtZW50IGFu
ZCBDb21tdW5pY2F0aW9uczEgMB4GA1UEAwwXUnVzc2lhbiBUcnVzdGVkIFJvb3Qg
Q0EwHhcNMjIwMzAxMjEwNDE1WhcNMzIwMjI3MjEwNDE1WjBwMQswCQYDVQQGEwJS
VTE/MD0GA1UECgw2VGhlIE1pbmlzdHJ5IG9mIERpZ2l0YWwgRGV2ZWxvcG1lbnQg
YW5kIENvbW11bmljYXRpb25zMSAwHgYDVQQDDBdSdXNzaWFuIFRydXN0ZWQgUm9v
dCBDQTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAMfFOZ8pUAL3+r2n
qqE0Zp52selXsKGFYoG0GM5bwz1bSFtCt+AZQMhkWQheI3poZAToYJu69pHLKS6Q
XBiwBC1cvzYmUYKMYZC7jE5YhEU2bSL0mX7NaMxMDmH2/NwuOVRj8OImVa5s1F4U
zn4Kv3PFlDBjjSjXKVY9kmjUBsXQrIHeaqmUIsPIlNWUnimXS0I0abExqkbdrXbX
YwCOXhOO2pDUx3ckmJlCMUGacUTnylyQW2VsJIyIGA8V0xzdaeUXg0VZ6ZmNUr5Y
Ber/EAOLPb8NYpsAhJe2mXjMB/J9HNsoFMBFJ0lLOT/+dQvjbdRZoOT8eqJpWnVD
U+QL/qEZnz57N88OWM3rabJkRNdU/Z7x5SFIM9FrqtN8xewsiBWBI0K6XFuOBOT
D4V08o4TzJ8+Ccq5XlCUW2L48pZNCYuBDfBh7FxkB7qDgGDiaftEkZZfApRg2E+M
9G8wkNKTPLDc4wH0FDTijhgxR3Y4PiS1HL2Zhw7bD3CbslmEGgfnnZojNkJtcLeB
HBLa52/dSwNU4WWLubaYSiAmA9IUMX1/RpfpxOxd4Ykmhz97oFbUaDJFipIggx5s
XePAlkTdWnv+RWBxlJwMQ25oEHmRguNYf4Zr/Rxr9cS93Y+mdXIZaBEE0KS2iLRq
aOiWBki9IMQU4phqPOBAaG7A+eP8PAgMBAAGjZjBkMB0GA1UdDgQWBBTh0YHlzlpf
BKrS6badZrHF+qwshzAfBgNVHSMEGDAWgBTh0YHlzlpfBKrS6badZrHF+qwshzAS
BgNVHRMBAf8ECDAGAQH/AgEEMA4GA1UdDwEB/wQEAwIBhjANBgkqhkiG9w0BAQsF
AAOCAgEAALIY1wkilt/urfEVM5vKzr6utOeDWCUczmWX/RX4ljpRdgF+5fAIS4vH
tmXkqpSCOVeWUrJV9QvZn6L227ZwuE15cWi8DCDal3Ue90WgAJJZMfTshN4OI8cq
W9E4EG9wglbEtMnObHlms8F3CHmrw3k6KmUkWGoa+/ENmcVl68u/cMRl1JbW2bM+
/3A+SAg2c6iPDlehczKx2oa95QW0SkPPWGuNA/CE8CpyANIhu9XFrj3RQ3EqeRcS
AQQod1RNuHpfETLU/A2gMmvn/w/sx7TB3W5BPs6rprOA37tutPq9u6FTZOcG1Oqj
C/B7yTqgI7rbyvox7DEXoX7rIiEqyNNUguTk/u3SZ4VXE2kmxdmSh3TQvybfbnXV
4JbCZVaqiZraqc7oZMnRoWrXRG3ztbnbes/9qhRGI7PqXqeKJBztxRTEVj8ONs1d
WN5szTwaPIvhkhO3CO5ErU2rVdUr89wKpNXbBODFKRtgxUT70YpmJ46VVaqdAhOZ
D9EUUn4YaeLaS8AjSF/h7UkjOibNc4qVDiPP+rkehFWM66PVnP1Msh93tc+taIfC
EYVMxjh8zNbFuoc7fzvvrFILLe7ifvEIUqSVIC/AzplM/Jxw7buXFeGP1qVCBEHq
391d/9RAfaZ12zkwFsl+IKwE/OZxW8AHa9i1p4GO0YSNuczzEm4=
-----END CERTIFICATE-----`

const RUSSIAN_TRUSTED_SUB_CA = `-----BEGIN CERTIFICATE-----
MIIHQjCCBSqgAwIBAgICEAIwDQYJKoZIhvcNAQELBQAwcDELMAkGA1UEBhMCUlUx
PzA9BgNVBAoMNlRoZSBNaW5pc3RyeSBvZiBEaWdpdGFsIERldmVsb3BtZW50IGFu
ZCBDb21tdW5pY2F0aW9uczEgMB4GA1UEAwwXUnVzc2lhbiBUcnVzdGVkIFJvb3Qg
Q0EwHhcNMjIwMzAyMTEyNTE5WhcNMjcwMzA2MTEyNTE5WjBvMQswCQYDVQQGEwJS
VTE/MD0GA1UECgw2VGhlIE1pbmlzdHJ5IG9mIERpZ2l0YWwgRGV2ZWxvcG1lbnQg
YW5kIENvbW11bmljYXRpb25zMR8wHQYDVQQDDBZSdXNzaWFuIFRydXN0ZWQgU3Vi
IENBMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA9YPqBKOk19NFymrE
wehzrhBEgT2atLezpduB24mQ7CiOa/HVpFCDRZzdxqlh8drku408/tTmWzlNH/br
HuQhZ/miWKOf35lpKzjyBd6TPM23uAfJvEOQ2/dnKGGJbsUo1/udKSvxQwVHpVv3
S80OlluKfhWPDEXQpgyFqIzPoxIQTLZ0deirZwMVHarZ5u8HqHetRuAtmO2ZDGQ
nvVOJYAjls+Hiueq7Lj7Oce7CQsTwVZeP+XQx28PAaEZ3y6sQEt6rL06ddpSdoTM
pBnCqTbxW+eWMyjkIn6t9GBtUV45yB1EkHNnj2Ex4GwCiN9T84QQjKSr+8f0psGr
ZvPbCbQAwNFJjisLixnjlGPLKa5vOmNwIh/LAyUW5DjpkCx004LPDuqPpFsKXNKp
aL2Dm6uc0x4Jo5m+gUTVORB6hOSzWnWDj2GWfomLzzyjG81DRGFBpco/O93zecsI
N3SL2Ysjpq1zdoS01CMYxie//9zWvYwzI25/OZigtnpCIrcd2j1Y6dMUFQAzAtHE
+qsXflSL8HIS+IJEFIQobLlYhHkoE3avgNx5jlu+OLYe0dF0Ykx1PGNjbwqvTX37
RCn32NMjlotW2QcGEZhDKj+3urZizp5xdTPZitA+aEjZM/Ni71VOdiOP0igbw6as
Z2fxdozZ1TnSSYNYvNATwthNmZysCAwEAAaOCAeUwggHhMBIGA1UdEwEB/wQIMAYB
Af8CAQAwDgYDVR0PAQH/BAQDAgGGMB0GA1UdDgQWBBTR4XENCy2BTm6KSo9MI7NM
XqtpCzAfBgNVHSMEGDAWgBTh0YHlzlpfBKrS6badZrHF+qwshzCBxwYIKwYBBQUH
AQEEgbowgbcwOwYIKwYBBQUHMAKGL2h0dHA6Ly9yb3N0ZWxlY29tLnJ1L2NkcC9y
b290Y2Ffc3NsX3JzYTIwMjIuY3J0MDsGCCsGAQUFBzAChi9odHRwOi8vY29tcGFu
eS5ydC5ydS9jZHAvcm9vdGNhX3NzbF9yc2EyMDIyLmNydDA7BggrBgEFBQcwAoYv
aHR0cDovL3JlZXN0ci1wa2kucnUvY2RwL3Jvb3RjYV9zc2xfcnNhMjAyMi5jcnQw
gbAGA1UdHwSBqDCBpTA1oDOgMYYvaHR0cDovL3Jvc3RlbGVjb20ucnUvY2RwL3Jv
b3RjYV9zc2xfcnNhMjAyMi5jcmwwNaAzoDGGL2h0dHA6Ly9jb21wYW55LnJ0LnJ1
L2NkcC9yb290Y2Ffc3NsX3JzYTIwMjIuY3JsMDWgM6Axhi9odHRwOi8vcmVlc3Ry
LXBraS5ydS9jZHAvcm9vdGNhX3NzbF9yc2EyMDIyLmNybDANBgkqhkiG9w0BAQsF
AAOCAgEARBVzZls79AdiSCpar15dA5Hr/rrT4WbrOfzlpI+xrLeRPrUG6eUWIW4v
Sui1yx3iqGLCjPcKb+HOTwoRMbI6ytP/ndp3TlYua2advYBEhSvjs+4vDZNwXr/D
anbwIWdurZmViQRBDFebpkvnIvru/RpWud/5r624Wp8voZMRtj/cm6aI9LtvBfT9
cfzhOaexI/99c14dyiuk1+6QhdwKaCRTc1mdfNQmnfWNRbfWhWBlK3h4GGE9JK33
Gk8ZS8DMrkdAh0xby4xAQ/mSWAfWrBmfzlOqGyoB1U47WTOeqNbWkkoAP2ys94+
sJg4NTkiDVtXRF6nr6fYi0bSOvOFg0IQrMXO2Y8gyg9ARdPJwKtvWX8VPADCYMiW
Hh4n8bZokIrImVKLDQKHY4jCsND2HHdJfnrdL2YJw1qFskNO4cSNmZydw0Wkgjv9
kF+KxqrDKlB8MZu2Hclph6v/CZ0fQ9YuE8/lsHZ0Qc2HyiSMnvjgK5fDc3TD4fa
8FE8gMNurM+kV8PT8LNIM+4Zs+LKEV8nqRWBaxkIVJGekkVKO8xDBOG/aN62AZKH
OeGcyIdu7yNMMRihGVZCYr8rYiJoKiOzDqOkPkLOPdhtVlgnhowzHDxMHND/E2WA
5pZHuNM/m0TXt2wTTPL7JH2YC0gPz/BvvSzjksgzU5rLbRyUKQkgU=
-----END CERTIFICATE-----`

/**
 * Undici Agent configured to trust Russian Trusted CA certificates.
 * Used for all requests to GigaChat API endpoints (*.sberbank.ru).
 */
const GIGACHAT_CA_BUNDLE = RUSSIAN_TRUSTED_ROOT_CA + "\n" + RUSSIAN_TRUSTED_SUB_CA

const gigaChatAgent = new UndiciAgent({
	connect: {
		ca: GIGACHAT_CA_BUNDLE,
	},
})

/**
 * Node https.Agent for OAuth requests (uses native https.request).
 */
const gigaChatHttpsAgent = new https.Agent({
	ca: [RUSSIAN_TRUSTED_ROOT_CA, RUSSIAN_TRUSTED_SUB_CA],
})

/**
 * Custom fetch that uses our trusted CA bundle for GigaChat requests.
 */
const gigaChatFetch: typeof globalThis.fetch = (input, init) => {
	return undiciFetch(input as any, {
		...init as any,
		dispatcher: gigaChatAgent,
	}) as any
}

interface GigaChatHandlerOptions extends CommonApiHandlerOptions {
	gigaChatApiKey?: string
	gigaChatScope?: string
	apiModelId?: string
}

interface GigaChatToken {
	accessToken: string
	expiresAt: number
}

export class GigaChatHandler implements ApiHandler {
	private options: GigaChatHandlerOptions
	private cachedToken: GigaChatToken | undefined

	constructor(options: GigaChatHandlerOptions) {
		this.options = options
	}

	/**
	 * Obtain an OAuth access token from GigaChat.
	 * The token is cached and refreshed automatically when it expires.
	 */
	private async getAccessToken(): Promise<string> {
		if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
			return this.cachedToken.accessToken
		}

		if (!this.options.gigaChatApiKey) {
			throw new Error(t("gigachat.error.authRequired"))
		}

		const scope = this.options.gigaChatScope || "GIGACHAT_API_PERS"

		// Use native https.request with our custom CA agent for OAuth
		console.log(`[GigaChat] ${t("gigachat.log.oauthStarting")}`)
		const data = await new Promise<{ access_token: string; expires_at: number }>((resolve, reject) => {
			const url = new URL(GIGACHAT_OAUTH_URL)
			const body = `scope=${scope}`
			const req = https.request(
				{
					hostname: url.hostname,
					port: url.port || 443,
					path: url.pathname,
					method: "POST",
					agent: gigaChatHttpsAgent,
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
						Accept: "application/json",
						Authorization: `Basic ${this.options.gigaChatApiKey}`,
						RqUID: crypto.randomUUID(),
						"Content-Length": Buffer.byteLength(body),
					},
				},
				(res) => {
					let responseData = ""
					res.on("data", (chunk: Buffer) => {
						responseData += chunk.toString()
					})
					res.on("end", () => {
						console.log(`[GigaChat] ${t("gigachat.log.oauthStatus", { status: String(res.statusCode) })}`)
						if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
							try {
								const parsed = JSON.parse(responseData)
								console.log(`[GigaChat] ${t("gigachat.log.oauthTokenReceived", { expiresAt: String(parsed.expires_at) })}`)
								resolve(parsed)
							} catch (e) {
								reject(new Error(t("gigachat.error.oauthInvalidResponse", { details: responseData })))
							}
						} else {
						console.error(`[GigaChat] OAuth error: ${responseData}`)
						reject(new Error(t("gigachat.error.oauthFailed", { status: String(res.statusCode), details: responseData })))
						}
					})
				},
			)
			req.on("error", (err) => {
				console.error(`[GigaChat] ${t("gigachat.error.oauthRequest", { error: err.message })}`)
				reject(err)
			})
			req.write(body)
			req.end()
		})

		this.cachedToken = {
			accessToken: data.access_token,
			// expires_at is in milliseconds from GigaChat API
			expiresAt: data.expires_at,
		}

		return this.cachedToken.accessToken
	}

	/**
	 * Convert OpenAI-format messages to GigaChat format.
	 *
	 * Key differences from OpenAI:
	 * - "tool" role → "function" role, content must be JSON string with "result" field
	 * - assistant messages with tool_calls → assistant with function_call (single)
	 * - multipart content arrays → flattened to plain strings
	 * - GigaChat only supports one function_call per assistant message
	 *
	 * See: https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-chat
	 */
	private convertMessagesForGigaChat(
		openAiMessages: Array<{ role: string; content: any; [key: string]: any }>,
	): Array<Record<string, any>> {
		const result: Array<Record<string, any>> = []

		for (const msg of openAiMessages) {
			// tool result → function role with JSON content
			if (msg.role === "tool") {
				const rawContent = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content || "")
				result.push({
					role: "function",
					content: JSON.stringify({ result: rawContent }),
					name: msg.name || msg.tool_call_id || "tool_result",
				})
				continue
			}

			// assistant with tool_calls → assistant with function_call
			if (msg.role === "assistant" && msg.tool_calls?.length > 0) {
				const tc = msg.tool_calls[0] // GigaChat supports one function_call per message
				let args = tc.function?.arguments
				// Parse arguments string to object if needed (GigaChat expects object)
				if (typeof args === "string") {
					try { args = JSON.parse(args) } catch { args = {} }
				}
				result.push({
					role: "assistant",
					content: msg.content || "",
					function_call: {
						name: tc.function?.name || "",
						arguments: args || {},
					},
				})
				continue
			}

			// Regular messages — flatten content to string
			let content: string
			if (typeof msg.content === "string") {
				content = msg.content
			} else if (Array.isArray(msg.content)) {
				content = msg.content
					.map((part: any) => {
						if (typeof part === "string") return part
						if (part.type === "text" && part.text) return part.text
						if (part.type === "image_url") return "[image]"
						return ""
					})
					.filter(Boolean)
					.join("\n")
			} else {
				content = msg.content?.toString() || ""
			}

			if (content.length > 0 || msg.role === "assistant") {
				result.push({ role: msg.role, content })
			}
		}

		return result
	}

	/**
	 * Convert OpenAI tools format to GigaChat functions format.
	 *
	 * OpenAI: { type: "function", function: { name, description, parameters } }
	 * GigaChat: { name, description, parameters } (no wrapper)
	 *
	 * See: https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-chat
	 */
	private convertToolsToGigaChatFunctions(
		tools: OpenAITool[],
	): Array<{ name: string; description?: string; parameters?: Record<string, any> }> {
		return tools
			.filter((t): t is Extract<OpenAITool, { type: "function" }> => t.type === "function" && "function" in t)
			.map((t) => ({
				name: t.function.name,
				description: t.function.description,
				parameters: t.function.parameters as Record<string, any> | undefined,
			}))
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ShuncodeStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const accessToken = await this.getAccessToken()
		const model = this.getModel()

		const rawMessages = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Convert messages to GigaChat format (handles tool/function role conversion)
		const gigaChatMessages = this.convertMessagesForGigaChat(rawMessages as any)

		const requestBody: Record<string, any> = {
			model: model.id,
			messages: gigaChatMessages,
			stream: true,
			temperature: 0.1,
		}
		if (model.info.maxTokens) {
			requestBody.max_tokens = model.info.maxTokens
		}

		// Add native function calling params if tools are provided
		if (tools?.length) {
			requestBody.functions = this.convertToolsToGigaChatFunctions(tools)
			requestBody.function_call = "auto"
		}

		console.log(`[GigaChat] ${t("gigachat.log.chatRequest", { model: model.id, count: String(gigaChatMessages.length) })}`)
		if (tools?.length) {
			console.log(`[GigaChat] Sending ${tools.length} native functions`)
		}

		const response = await gigaChatFetch(`${GIGACHAT_BASE_URL}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "text/event-stream",
				Authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify(requestBody),
		})

		if (!response.ok) {
			const errorText = await response.text()
			console.error(`[GigaChat] ${t("gigachat.error.apiFailed", { status: String(response.status), details: errorText })}`)
			throw new Error(t("gigachat.error.apiFailed", { status: String(response.status), details: errorText }))
		}

		if (!response.body) {
			throw new Error(t("gigachat.error.noResponseBody"))
		}

		// Parse SSE stream with support for native function_call responses
		const reader = response.body.getReader()
		const decoder = new TextDecoder()
		let buffer = ""

		// Accumulator for function_call deltas (name + arguments may come in chunks)
		let accFunctionCall: { name: string; arguments: string } | null = null
		const toolCallId = `gigachat-${Date.now()}`

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
					const message = choice?.message

					// Handle function_call in streaming delta
					const fc = delta?.function_call || message?.function_call
					if (fc) {
						if (!accFunctionCall) {
							accFunctionCall = { name: "", arguments: "" }
						}
						if (fc.name) {
							accFunctionCall.name = fc.name
							console.log(`[GigaChat] Function call: ${fc.name}`)
						}
						if (fc.arguments !== undefined) {
							// arguments can be string or object
							const argStr = typeof fc.arguments === "string"
								? fc.arguments
								: JSON.stringify(fc.arguments)
							accFunctionCall.arguments += argStr

							// Yield tool_calls chunk with accumulated data
							yield {
								type: "tool_calls" as const,
								tool_call: {
									function: {
										id: toolCallId,
										name: accFunctionCall.name,
										arguments: argStr,
									},
								},
							}
						}
					}

					// Text content (from delta in streaming, or message in non-streaming)
					const textContent = delta?.content || message?.content
					if (textContent) {
						yield {
							type: "text" as const,
							text: textContent,
						}
					}

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

	getModel(): { id: GigaChatModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in gigaChatModels) {
			const id = modelId as GigaChatModelId
			return { id, info: gigaChatModels[id] }
		}
		return {
			id: gigaChatDefaultModelId,
			info: gigaChatModels[gigaChatDefaultModelId],
		}
	}
}
