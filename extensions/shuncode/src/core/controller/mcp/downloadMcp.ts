import { McpServer } from "@shared/mcp"
import { StringRequest } from "@shared/proto/shuncode/common"
import { McpDownloadResponse } from "@shared/proto/shuncode/mcp"
import axios from "axios"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import { ShuncodeEnv } from "@/config"
import { getAxiosSettings } from "@/shared/net"
import { t } from "@/i18n/backend-i18n"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."
import { sendChatButtonClickedEvent } from "../ui/subscribeToChatButtonClicked"

// Placeholder patterns that indicate a value needs user input
const API_KEY_PLACEHOLDERS = [
	"YOUR_API_KEY",
	"your-api-key",
	"your_api_key",
	"<api-key>",
	"<API_KEY>",
	"INSERT_API_KEY",
	"sk-...",
	"sk-xxxxx",
]

/**
 * Fallback: find MCP details in static bundled catalog.
 * TODO: remove when own API is ready.
 */
async function findInStaticCatalog(mcpId: string): Promise<McpDownloadResponse | undefined> {
	const catalogPath = path.join(__dirname, "assets", "mcp-marketplace-catalog.json")
	const catalogData = await fs.readFile(catalogPath, "utf-8")
	const items = JSON.parse(catalogData)

	if (!Array.isArray(items)) {
		return undefined
	}

	const item = items.find((i: any) => i.mcpId === mcpId)
	if (!item) {
		return undefined
	}

	return {
		mcpId: item.mcpId,
		githubUrl: item.githubUrl,
		name: item.name,
		author: item.author,
		description: item.description,
		readmeContent: item.readmeContent || "",
		llmsInstallationContent: item.llmsInstallationContent || "",
		requiresApiKey: item.requiresApiKey || false,
	} as McpDownloadResponse
}

interface ExtractedConfig {
	command: string
	args: string[]
	env?: Record<string, string>
}

/**
 * Check if a string looks like an API key placeholder.
 */
function isPlaceholder(value: string): boolean {
	const lower = value.toLowerCase()
	return API_KEY_PLACEHOLDERS.some((p) => lower.includes(p.toLowerCase()))
}

/**
 * Extract a balanced JSON object starting at `startIdx` in `text`.
 * Returns the parsed object or undefined if parsing fails.
 */
function extractJsonObject(text: string, startIdx: number): any | undefined {
	if (text[startIdx] !== "{") return undefined
	let depth = 0
	for (let i = startIdx; i < text.length; i++) {
		if (text[i] === "{") depth++
		if (text[i] === "}") depth--
		if (depth === 0) {
			try {
				const raw = text.substring(startIdx, i + 1)
				// Strip single-line comments for jsonc support
				const cleaned = raw.replace(/\/\/.*$/gm, "")
				return JSON.parse(cleaned)
			} catch {
				return undefined
			}
		}
	}
	return undefined
}

/**
 * Extract MCP server config from README markdown.
 * Uses direct search for "mcpServers" in the text to avoid regex code-block pairing issues.
 * Prefers stdio configs (with `command`) over HTTP configs.
 * Prefers configs without API key placeholders when requiresApiKey=false.
 */
function extractConfigFromReadme(readme: string, requiresApiKey: boolean): ExtractedConfig | undefined {
	const configs: { config: ExtractedConfig; hasPlaceholders: boolean }[] = []
	const needle = '"mcpServers"'
	let searchFrom = 0

	while (true) {
		const idx = readme.indexOf(needle, searchFrom)
		if (idx === -1) break
		searchFrom = idx + needle.length

		// Find the opening { before "mcpServers"
		let braceIdx = -1
		for (let i = idx - 1; i >= Math.max(0, idx - 50); i--) {
			if (readme[i] === "{") {
				braceIdx = i
				break
			}
		}
		if (braceIdx === -1) continue

		const parsed = extractJsonObject(readme, braceIdx)
		if (!parsed || !parsed.mcpServers || typeof parsed.mcpServers !== "object") continue

		const serverNames = Object.keys(parsed.mcpServers)
		for (const name of serverNames) {
			const srv = parsed.mcpServers[name]
			if (srv.command && typeof srv.command === "string") {
				const args: string[] = Array.isArray(srv.args) ? srv.args.map(String) : []
				const env: Record<string, string> = {}
				let hasPlaceholders = false

				for (const arg of args) {
					if (isPlaceholder(arg)) {
						hasPlaceholders = true
					}
				}

				if (srv.env && typeof srv.env === "object") {
					for (const [key, val] of Object.entries(srv.env)) {
						const strVal = String(val)
						env[key] = strVal
						if (isPlaceholder(strVal)) {
							hasPlaceholders = true
						}
					}
				}

				configs.push({
					config: {
						command: srv.command,
						args,
						...(Object.keys(env).length > 0 ? { env } : {}),
					},
					hasPlaceholders,
				})
			}
		}
	}

	if (configs.length === 0) {
		return undefined
	}

	// For requiresApiKey servers: prefer config WITH placeholders (so we can substitute)
	// For non-apikey servers: prefer config WITHOUT placeholders (clean config)
	if (requiresApiKey) {
		return configs.find((c) => c.hasPlaceholders)?.config ?? configs[0].config
	} else {
		return configs.find((c) => !c.hasPlaceholders)?.config ?? configs[0].config
	}
}

/**
 * Remove API key args from config (for non-apikey servers that only have configs with placeholders).
 * Removes patterns like: --api-key YOUR_API_KEY
 */
function cleanApiKeyArgs(config: ExtractedConfig): ExtractedConfig {
	const cleanedArgs: string[] = []
	let skipNext = false

	for (let i = 0; i < config.args.length; i++) {
		if (skipNext) {
			skipNext = false
			continue
		}
		const arg = config.args[i]

		// Skip --api-key/--apikey/--token flags and their values
		if (/^--(?:api[-_]?key|token|secret)$/i.test(arg)) {
			// Next arg is the value, skip it too
			if (i + 1 < config.args.length && !config.args[i + 1].startsWith("--")) {
				skipNext = true
			}
			continue
		}

		// Skip args that look like standalone placeholders
		if (isPlaceholder(arg)) {
			continue
		}

		cleanedArgs.push(arg)
	}

	// Clean env: remove entries with placeholder values
	const cleanedEnv: Record<string, string> = {}
	if (config.env) {
		for (const [key, val] of Object.entries(config.env)) {
			if (!isPlaceholder(val)) {
				cleanedEnv[key] = val
			}
		}
	}

	return {
		command: config.command,
		args: cleanedArgs,
		...(Object.keys(cleanedEnv).length > 0 ? { env: cleanedEnv } : {}),
	}
}

/**
 * Prompt user for API key values in config.
 * Returns updated config or undefined if user cancelled.
 */
async function promptForApiKey(config: ExtractedConfig, serverName: string): Promise<ExtractedConfig | undefined> {
	// Collect all placeholder positions
	const newArgs = [...config.args]
	const newEnv = config.env ? { ...config.env } : undefined

	// Check args for placeholders
	for (let i = 0; i < newArgs.length; i++) {
		if (isPlaceholder(newArgs[i])) {
			// Find the flag name (previous arg)
			const flagName = i > 0 && newArgs[i - 1].startsWith("--") ? newArgs[i - 1] : "API Key"
			const value = await vscode.window.showInputBox({
				prompt: `Enter ${flagName} for ${serverName}`,
				placeHolder: `Enter your ${flagName}...`,
				password: true,
				ignoreFocusOut: true,
			})
			if (value === undefined) {
				return undefined // User cancelled
			}
			newArgs[i] = value
		}
	}

	// Check env for placeholders
	if (newEnv) {
		for (const [key, val] of Object.entries(newEnv)) {
			if (isPlaceholder(val)) {
				const value = await vscode.window.showInputBox({
					prompt: `Enter ${key} for ${serverName}`,
					placeHolder: `Enter your ${key}...`,
					password: true,
					ignoreFocusOut: true,
				})
				if (value === undefined) {
					return undefined // User cancelled
				}
				newEnv[key] = value
			}
		}
	}

	return {
		command: config.command,
		args: newArgs,
		...(newEnv && Object.keys(newEnv).length > 0 ? { env: newEnv } : {}),
	}
}

/**
 * Write server config directly to shuncode_mcp_settings.json via McpHub.
 */
async function writeServerConfig(controller: Controller, mcpId: string, config: ExtractedConfig): Promise<void> {
	const mcpHub = controller.mcpHub
	if (!mcpHub) {
		throw new Error("McpHub is not initialized")
	}

	const settingsPath = await mcpHub.getMcpSettingsFilePath()
	const content = await fs.readFile(settingsPath, "utf-8")
	const settings = JSON.parse(content)

	if (!settings.mcpServers || typeof settings.mcpServers !== "object") {
		settings.mcpServers = {}
	}

	// Build server config
	const serverConfig: Record<string, any> = {
		command: config.command,
		args: config.args,
		disabled: false,
		autoApprove: [],
	}

	if (config.env && Object.keys(config.env).length > 0) {
		serverConfig.env = config.env
	}

	settings.mcpServers[mcpId] = serverConfig

	await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2))
	Logger.log(`[downloadMcp] Wrote config for "${mcpId}" to ${settingsPath}`)
}

/**
 * Fallback: create AI task to install MCP server from README.
 * Used when config cannot be extracted programmatically.
 */
async function fallbackToAiTask(controller: Controller, mcpDetails: McpDownloadResponse): Promise<void> {
	// Build a cleaner prompt than the original
	const readme = mcpDetails.readmeContent || ""
	// Strip markdown badges, images to reduce noise
	const cleanedReadme = readme
		.replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g, "") // [![badge](img)](link)
		.replace(/!\[.*?\]\(.*?\)/g, "") // ![image](url)
		.replace(/\n{3,}/g, "\n\n") // Collapse multiple blank lines
		.trim()

	const installContent = mcpDetails.llmsInstallationContent || ""

	const task = `Install the MCP server "${mcpDetails.mcpId}" from ${mcpDetails.githubUrl}.

RULES:
- Server name in shuncode_mcp_settings.json must be exactly: "${mcpDetails.mcpId}"
- Read the existing shuncode_mcp_settings.json first, do NOT overwrite other servers.
- This server ${mcpDetails.requiresApiKey ? "REQUIRES an API key" : "does NOT require an API key"}.
- Use commands for the user's OS and shell.
- After installation, test the server by calling one of its tools.

${installContent ? `INSTALLATION INSTRUCTIONS:\n${installContent}\n\n` : ""}README:\n${cleanedReadme}`

	const { mode } = await controller.getStateToPostToWebview()
	if (mode === "plan" || mode === "ask" || mode === "chat") {
		await controller.togglePlanActMode("act")
	}

	await controller.initTask(task)
	await sendChatButtonClickedEvent()
}

/**
 * Download and install an MCP server from the marketplace.
 *
 * Strategy:
 * 1. Get server details (API → static catalog fallback)
 * 2. Try to extract config from README (JSON blocks with mcpServers)
 * 3. If config found: write directly to shuncode_mcp_settings.json
 *    - For requiresApiKey servers: prompt user for API key first
 * 4. If no config found: fallback to AI task
 */
export async function downloadMcp(controller: Controller, request: StringRequest): Promise<McpDownloadResponse> {
	try {
		if (!request.value) {
			throw new Error("MCP ID is required")
		}

		const mcpId = request.value

		// Check if already installed
		const servers = controller.mcpHub?.getServers() || []
		const isInstalled = servers.some((server: McpServer) => server.name === mcpId)
		if (isInstalled) {
			throw new Error("This MCP server is already installed")
		}

		// Get server details (API → static catalog)
		let mcpDetails: McpDownloadResponse | undefined
		try {
			const response = await axios.post<McpDownloadResponse>(
				`${ShuncodeEnv.config().mcpBaseUrl}/download`,
				{ mcpId },
				{
					headers: { "Content-Type": "application/json" },
					timeout: 5000,
					...getAxiosSettings(),
				},
			)
			mcpDetails = response.data
		} catch {
			Logger.log("[downloadMcp] API unavailable, using static catalog")
			mcpDetails = await findInStaticCatalog(mcpId)
		}

		if (!mcpDetails) {
			throw new Error(`MCP server "${mcpId}" not found`)
		}

		Logger.log("[downloadMcp] Got details for", { mcpId, requiresApiKey: mcpDetails.requiresApiKey })

		// Try programmatic installation
		const readme = mcpDetails.readmeContent || ""
		let config = extractConfigFromReadme(readme, mcpDetails.requiresApiKey)

		if (config) {
			Logger.log("[downloadMcp] Extracted config:", JSON.stringify(config))

			if (mcpDetails.requiresApiKey) {
				// Prompt user for API key
				config = await promptForApiKey(config, mcpDetails.name || mcpId)
				if (!config) {
					// User cancelled
					return McpDownloadResponse.create({
						mcpId: "",
						githubUrl: "",
						name: "",
						author: "",
						description: "",
						readmeContent: "",
						llmsInstallationContent: "",
						requiresApiKey: false,
						error: "Installation cancelled by user",
					})
				}
			} else {
				// Clean up any stray API key placeholders
				config = cleanApiKeyArgs(config)
			}

			// Write config to shuncode_mcp_settings.json
			await writeServerConfig(controller, mcpId, config)

			Logger.log(`[downloadMcp] Successfully installed "${mcpId}" programmatically`)

			vscode.window.showInformationMessage(t("mcp.installSuccess", { name: mcpDetails.name || mcpId }))
		} else {
			// No config extracted — fallback to AI task
			Logger.log("[downloadMcp] No config found in README, falling back to AI task")

			if (!mcpDetails.githubUrl) {
				throw new Error("Missing GitHub URL in MCP download response")
			}

			await fallbackToAiTask(controller, mcpDetails)
		}

		return McpDownloadResponse.create({
			mcpId: mcpDetails.mcpId,
			githubUrl: mcpDetails.githubUrl,
			name: mcpDetails.name,
			author: mcpDetails.author,
			description: mcpDetails.description,
			readmeContent: mcpDetails.readmeContent,
			llmsInstallationContent: mcpDetails.llmsInstallationContent,
			requiresApiKey: mcpDetails.requiresApiKey,
		})
	} catch (error) {
		Logger.error("Failed to download MCP:", error)
		let errorMessage = t("mcp.downloadFailed")

		if (axios.isAxiosError(error)) {
			if (error.code === "ECONNABORTED") {
				errorMessage = t("mcp.errorTimeout")
			} else if (error.response?.status === 404) {
				errorMessage = t("mcp.errorNotFound")
			} else if (error.response?.status === 500) {
				errorMessage = t("mcp.errorServer")
			} else if (!error.response && error.request) {
				errorMessage = t("mcp.errorNetwork")
			}
		} else if (error instanceof Error) {
			errorMessage = error.message
		}

		return McpDownloadResponse.create({
			mcpId: "",
			githubUrl: "",
			name: "",
			author: "",
			description: "",
			readmeContent: "",
			llmsInstallationContent: "",
			requiresApiKey: false,
			error: errorMessage,
		})
	}
}
