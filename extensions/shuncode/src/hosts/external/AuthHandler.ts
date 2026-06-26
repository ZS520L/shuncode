import type { IncomingMessage, Server, ServerResponse } from "node:http"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { SharedUriHandler } from "@/services/uri/SharedUriHandler"
import { Logger } from "@/shared/services/Logger"
import { t } from "@/i18n/backend-i18n"
import { HostProvider } from "../host-provider"

const SERVER_TIMEOUT = 10 * 60 * 1000 // 10 minutes

const PORT_RANGE_START = 48801
const PORT_RANGE_END = 48811
const PORTS: number[] = Array.from({ length: PORT_RANGE_END - PORT_RANGE_START + 1 }, (_, i) => PORT_RANGE_START + i)

/**
 * Handles OAuth authentication flow by creating a local server to receive tokens.
 */
export class AuthHandler {
	private static instance: AuthHandler | null = null

	private port = 0
	private server: Server | null = null
	private serverCreationPromise: Promise<void> | null = null
	private timeoutId: NodeJS.Timeout | null = null
	private enabled: boolean = false

	private constructor() {}

	/**
	 * Gets the singleton instance of AuthHandler
	 * @returns The singleton AuthHandler instance
	 */
	public static getInstance(): AuthHandler {
		if (!AuthHandler.instance) {
			AuthHandler.instance = new AuthHandler()
		}
		return AuthHandler.instance
	}

	public setEnabled(enabled: boolean): void {
		this.enabled = enabled
	}

	public async getCallbackUrl(): Promise<string> {
		if (!this.enabled) {
			throw Error("AuthHandler was not enabled")
		}

		if (!this.server) {
			// If server creation is already in progress, wait for it
			if (this.serverCreationPromise) {
				await this.serverCreationPromise
			} else {
				// Start server creation and track the promise
				this.serverCreationPromise = this.createServer()
				await this.serverCreationPromise
			}
		} else {
			this.updateTimeout()
		}

		return `http://127.0.0.1:${this.port}`
	}

	private async createServer(): Promise<void> {
		return new Promise(async (resolve, reject) => {
			try {
				const server = http.createServer(this.handleRequest.bind(this))

				// Try to bind on a port from the allowed range
				for (const port of PORTS) {
					try {
						await this.tryListenOnPort(server, port)

						const address = server.address()
						if (!address) {
							Logger.error("AuthHandler: Failed to get server address")
							this.server = null
							this.port = 0
							this.serverCreationPromise = null
							reject(new Error("Failed to get server address"))
							return
						}

						// Get the assigned port and set up the server
						this.port = (address as AddressInfo).port
						this.server = server
						Logger.log("AuthHandler: Server started on port", this.port)
						this.updateTimeout()
						this.serverCreationPromise = null

						// Attach a general error logger for visibility after successful bind
						server.on("error", (error) => {
							Logger.error("AuthHandler: Server error", error)
						})

						resolve()
						return
					} catch (error) {
						const err = error as NodeJS.ErrnoException
						if (err?.code === "EADDRINUSE") {
							Logger.warn(`AuthHandler: Port ${port} in use, trying next...`)
							continue
						}
						Logger.error("AuthHandler: Server error", error)
						this.server = null
						this.port = 0
						this.serverCreationPromise = null
						reject(error)
						return
					}
				}

				// If we reach here, all ports in the range are occupied
				Logger.error(`AuthHandler: No available port in range ${PORT_RANGE_START}-${PORT_RANGE_END}`)
				this.server = null
				this.port = 0
				this.serverCreationPromise = null
				reject(
					new Error(`No available port found for local auth callback (tried ${PORT_RANGE_START}-${PORT_RANGE_END}).`),
				)
			} catch (error) {
				Logger.error("AuthHandler: Failed to create server", error)
				this.server = null
				this.port = 0
				this.serverCreationPromise = null
				reject(error)
			}
		})
	}

	private tryListenOnPort(server: Server, port: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const onError = (error: NodeJS.ErrnoException) => {
				server.off("error", onError)
				reject(error)
			}
			server.once("error", onError)
			server.listen(port, "127.0.0.1", () => {
				server.off("error", onError)
				resolve()
			})
		})
	}

	private updateTimeout(): void {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId)
		}

		this.timeoutId = setTimeout(() => this.stop(), SERVER_TIMEOUT)
	}

	private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		Logger.log("AuthHandler: Received request", req.url)

		if (!req.url) {
			this.sendResponse(res, 404, "text/plain", "Not found")
			return
		}

		try {
			const fullUrl = `http://127.0.0.1:${this.port}${req.url}`

			// Use SharedUriHandler directly - it handles all validation and processing
			const success = await SharedUriHandler.handleUri(fullUrl)

			// No redirect URI needed — the local HTTP server already processed
			// the auth code in the current IDE instance via SharedUriHandler.
			// Redirecting to a custom URI scheme (shuncode://) would open a NEW instance.
			const html = createAuthSucceededHtml()

			if (success) {
				this.sendResponse(res, 200, "text/html", html)
			} else {
				this.sendResponse(res, 400, "text/plain", "Bad request")
			}
		} catch (error) {
			Logger.error("AuthHandler: Error processing request", error)
			this.sendResponse(res, 400, "text/plain", "Bad request")
		} finally {
			// Stop the server after handling any request (success or failure)
			this.stop()
		}
	}

	private sendResponse(res: ServerResponse, status: number, type: string, content: string): void {
		res.writeHead(status, { "Content-Type": type })
		res.end(content)
	}

	public stop(): void {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId)
			this.timeoutId = null
		}

		if (this.server) {
			this.server.close()
			this.server = null
		}

		this.serverCreationPromise = null
		this.port = 0
	}

	public dispose(): void {
		this.stop()
	}
}

function createAuthSucceededHtml(): string {
	const title = t("auth.success.title")
	const heading = t("auth.success.heading")
	const body1 = t("auth.success.body")
	const body2prefix = t("auth.success.redirectPrefix")
	const body2suffix = t("auth.success.redirectSuffix")
	return [
		"<!DOCTYPE html>",
		'<html lang="ru">',
		"<head>",
		'<meta charset="UTF-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1.0">',
		`<title>${title}</title>`,
		'<script>setTimeout(function(){window.location.href="https://shuncode-ai.ru"},2000);</script>',
		"<style>",
		"@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');",
		"*{margin:0;padding:0;box-sizing:border-box}",
		"body{font-family:'Inter',system-ui,-apple-system,sans-serif;background-color:#f9fafb;color:#1f2937;height:100vh;display:flex;align-items:center;justify-content:center;line-height:1.5}",
		".container{text-align:center;padding:40px 32px;background-color:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);max-width:440px;width:90%}",
		".checkmark{width:56px;height:56px;border-radius:50%;background-color:#10b981;margin:0 auto 20px;display:flex;align-items:center;justify-content:center}",
		".checkmark::after{content:'\\2713';font-size:28px;color:#fff;font-weight:600}",
		"h1{font-size:1.375rem;margin-bottom:12px;font-weight:600;color:#111827}",
		"p{font-size:.875rem;line-height:1.6;margin-bottom:24px;color:#6b7280}",
		".countdown{font-weight:500;color:#111827}",
		"@media(max-width:480px){.container{padding:28px 20px}}",
		"</style>",
		"</head>",
		"<body>",
		'<div class="container">',
		'<div class="checkmark"></div>',
		`<h1>${heading}</h1>`,
		`<p>${body1}</p>`,
		`<p>${body2prefix}<span class="countdown" id="sec">2</span>${body2suffix}</p>`,
		"</div>",
		'<script>var s=2;setInterval(function(){s--;var el=document.getElementById("sec");if(el)el.textContent=s>0?s:"0"},1000);</script>',
		"</body>",
		"</html>",
	].join("\n")
}
