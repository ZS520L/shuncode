import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import ReconnectingEventSource from "reconnecting-eventsource"
import { z } from "zod"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { expandEnvironmentVariables } from "@/utils/envExpansion"
import { McpOAuthManager } from "./McpOAuthManager"
import { ServerConfigSchema } from "./schemas"
import type { McpConnection, Transport } from "./types"

type TransportErrorHandler = (name: string, error: unknown) => Promise<void>
type TransportCloseHandler = (name: string) => Promise<void>
type StderrHandler = (name: string, output: string) => Promise<void>

export interface TransportFactoryCallbacks {
	onTransportError: TransportErrorHandler
	onTransportClose: TransportCloseHandler
	onStderr: StderrHandler
}

export interface TransportResult {
	transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport
	authProvider: Awaited<ReturnType<McpOAuthManager["getOrCreateProvider"]>> | undefined
	createFallbackTransport?: () => SSEClientTransport | StreamableHTTPClientTransport
}

export async function createTransport(
	name: string,
	config: z.infer<typeof ServerConfigSchema>,
	mcpOAuthManager: McpOAuthManager,
	callbacks: TransportFactoryCallbacks,
): Promise<TransportResult> {
	const expandedConfig = expandEnvironmentVariables(config)

	const authProvider =
		expandedConfig.type === "sse" || expandedConfig.type === "streamableHttp"
			? await mcpOAuthManager.getOrCreateProvider(name, expandedConfig.url)
			: undefined

	let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport

	switch (expandedConfig.type) {
		case "stdio": {
			transport = new StdioClientTransport({
				command: expandedConfig.command,
				args: expandedConfig.args,
				cwd: expandedConfig.cwd,
				env: {
					...getDefaultEnvironment(),
					...(expandedConfig.env || {}),
				},
				stderr: "pipe",
			})

			transport.onerror = async (error) => {
				Logger.error(`Transport error for "${name}":`, error)
				await callbacks.onTransportError(name, error)
			}

			transport.onclose = async () => {
				await callbacks.onTransportClose(name)
			}

			await transport.start()
			const stderrStream = transport.stderr
			if (stderrStream) {
				stderrStream.on("data", async (data: Buffer) => {
					const output = data.toString()
					const isInfoLog = !/\berror\b/i.test(output)
					if (isInfoLog) {
						Logger.log(`Server "${name}" info:`, output)
					} else {
						Logger.error(`Server "${name}" stderr:`, output)
						await callbacks.onStderr(name, output)
					}
				})
			} else {
				Logger.error(`No stderr stream for ${name}`)
			}
			transport.start = async () => { }
			break
		}
		case "sse": {
			// Try streamable HTTP first (modern protocol), with fallback to legacy SSE
			global.EventSource = ReconnectingEventSource

			const sseFallbackStreamableHttpFetch: typeof fetch = async (url, init) => {
				const response = await fetch(url, init)
				if (init?.method === "GET" && response.status === 404) {
					return new Response(response.body, {
						status: 405,
						statusText: "Method Not Allowed",
						headers: response.headers,
					})
				}
				return response
			}

			transport = new StreamableHTTPClientTransport(new URL(expandedConfig.url), {
				authProvider,
				requestInit: {
					headers: expandedConfig.headers ?? undefined,
				},
				fetch: sseFallbackStreamableHttpFetch,
			})
			transport.onerror = async (error) => {
				Logger.error(`Transport error for "${name}":`, error)
				await callbacks.onTransportError(name, error)
			}

			// Provide legacy SSE fallback in case streamable HTTP fails
			const createSSEFallback = () => {
				const sseOptions = {
					authProvider,
					requestInit: {
						headers: expandedConfig.headers,
					},
				}
				const reconnectingEventSourceOptions = {
					max_retry_time: 5000,
					withCredentials: !!expandedConfig.headers?.["Authorization"],
					fetch: authProvider
						? async (url: string | URL, init?: RequestInit) => {
							const tokens = await authProvider.tokens()
							const headers = new Headers(init?.headers)
							if (tokens?.access_token) {
								headers.set("Authorization", `Bearer ${tokens.access_token}`)
							}
							return fetch(url.toString(), { ...init, headers })
						}
						: undefined,
				}
				const sseTransport = new SSEClientTransport(new URL(expandedConfig.url), {
					...sseOptions,
					eventSourceInit: reconnectingEventSourceOptions,
				})
				sseTransport.onerror = async (error) => {
					Logger.error(`Transport error for "${name}" (SSE fallback):`, error)
					await callbacks.onTransportError(name, error)
				}
				return sseTransport
			}

			return { transport, authProvider, createFallbackTransport: createSSEFallback }
		}
		case "streamableHttp": {
			global.EventSource = ReconnectingEventSource

			const streamableHttpFetch: typeof fetch = async (url, init) => {
				const response = await fetch(url, init)
				if (init?.method === "GET" && response.status === 404) {
					return new Response(response.body, {
						status: 405,
						statusText: "Method Not Allowed",
						headers: response.headers,
					})
				}
				return response
			}

			transport = new StreamableHTTPClientTransport(new URL(expandedConfig.url), {
				authProvider,
				requestInit: {
					headers: expandedConfig.headers ?? undefined,
				},
				fetch: streamableHttpFetch,
			})
			transport.onerror = async (error) => {
				Logger.error(`Transport error for "${name}":`, error)
				await callbacks.onTransportError(name, error)
			}
			break
		}
		default:
			throw new Error(`Unknown transport type: ${(config as any).type}`)
	}

	return { transport, authProvider }
}
