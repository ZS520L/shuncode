import * as fs from "fs/promises"
import * as path from "path"
import type { ToolUse } from "@core/assistant-message"
import { ensureRulesDirectoryExists } from "@core/storage/disk"
import { ShuncodeDefaultTool } from "@shared/tools"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

type MemoryAction = "list" | "read" | "write" | "delete"

interface MemorySummary {
	file: string
	path: string
	content?: string
	createdAt?: string
	updatedAt?: string
}

export class MemoryToolHandler implements IToolHandler {
	readonly name = ShuncodeDefaultTool.MEMORY

	getDescription(block: ToolUse): string {
		const action = block.params.action || "manage"
		const target = block.params.path ? ` ${block.params.path}` : ""
		return `[memory ${action}${target}]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const action = normalizeAction(block.params.action)
		if (!action) {
			config.taskState.consecutiveMistakeCount++
			return "Error: Missing or invalid parameter 'action'. Expected one of: list, read, write, delete."
		}

		const rulesDir = await ensureRulesDirectoryExists()

		try {
			switch (action) {
				case "list":
					return await this.listMemories(rulesDir)
				case "read":
					return await this.readMemory(rulesDir, block.params.path)
				case "write":
					return await this.writeMemory(config, rulesDir, block.params.path, block.params.content)
				case "delete":
					return await this.deleteMemory(config, rulesDir, block.params.path)
			}
		} catch (error) {
			return `Error managing memory: ${error instanceof Error ? error.message : String(error)}`
		}
	}

	private async listMemories(rulesDir: string): Promise<ToolResponse> {
		const memories = await collectMemories(rulesDir, false)
		return JSON.stringify({ memories }, null, 2)
	}

	private async readMemory(rulesDir: string, requestedPath: unknown): Promise<ToolResponse> {
		const filePath = resolveMemoryPath(rulesDir, requestedPath)
		const memory = await readMemorySummary(filePath, true)
		return JSON.stringify({ memory }, null, 2)
	}

	private async writeMemory(
		config: TaskConfig,
		rulesDir: string,
		requestedPath: unknown,
		requestedContent: unknown,
	): Promise<ToolResponse> {
		if (typeof requestedContent !== "string" || !requestedContent.trim()) {
			config.taskState.consecutiveMistakeCount++
			return "Error: Missing required parameter 'content' for action=write."
		}

		const filePath = resolveMemoryPath(rulesDir, requestedPath || createDefaultFilename(requestedContent))
		await fs.writeFile(filePath, `${requestedContent.trim()}\n`, "utf8")
		await enableMemory(config, filePath)
		await config.callbacks.say("tool", JSON.stringify({ tool: "memory", action: "write", status: "success", path: filePath }))
		return JSON.stringify({ success: true, memory: await readMemorySummary(filePath, true) }, null, 2)
	}

	private async deleteMemory(config: TaskConfig, rulesDir: string, requestedPath: unknown): Promise<ToolResponse> {
		const filePath = resolveMemoryPath(rulesDir, requestedPath)
		await fs.unlink(filePath)
		await removeMemoryToggle(config, filePath)
		await config.callbacks.say("tool", JSON.stringify({ tool: "memory", action: "delete", status: "success", path: filePath }))
		return JSON.stringify({ success: true, deleted: { file: path.basename(filePath), path: filePath } }, null, 2)
	}
}

function normalizeAction(value: unknown): MemoryAction | undefined {
	if (typeof value !== "string") return undefined
	const normalized = value.trim().toLowerCase()
	if (normalized === "update" || normalized === "edit" || normalized === "create") return "write"
	return ["list", "read", "write", "delete"].includes(normalized) ? normalized as MemoryAction : undefined
}

function resolveMemoryPath(rulesDir: string, value: unknown): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error("Missing required parameter 'path'. Use action=list first if you do not know it.")
	}

	const raw = value.trim()
	const candidate = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(rulesDir, sanitizeFilename(raw))
	if (!isMemoryPath(rulesDir, candidate)) {
		throw new Error(`Invalid memory path: ${raw}`)
	}
	return candidate
}

function sanitizeFilename(value: string): string {
	const basename = path.basename(value).replace(/\.md$/i, "")
	const safe = basename
		.replace(/[\\/:*?"<>|#{}%~&]/g, " ")
		.replace(/[^\p{L}\p{N}._ -]+/gu, " ")
		.trim()
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[._ -]+|[._ -]+$/g, "")
		.slice(0, 64)
	return `${safe || "memory"}.md`
}

function createDefaultFilename(content: string): string {
	return sanitizeFilename(content.trim().split(/\r?\n/, 1)[0] || "memory")
}

function isMemoryPath(rulesDir: string, filePath: string): boolean {
	const resolvedRulesDir = path.resolve(rulesDir)
	const resolvedPath = path.resolve(filePath)
	const relative = path.relative(resolvedRulesDir, resolvedPath)
	return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.extname(resolvedPath).toLowerCase() === ".md")
}

async function collectMemories(rulesDir: string, includeContent: boolean): Promise<MemorySummary[]> {
	const entries = await fs.readdir(rulesDir, { withFileTypes: true })
	const memories: MemorySummary[] = []
	for (const entry of entries) {
		if (entry.isFile() && entry.name.endsWith(".md")) {
			memories.push(await readMemorySummary(path.join(rulesDir, entry.name), includeContent))
		}
	}
	return memories
}

async function readMemorySummary(filePath: string, includeContent: boolean): Promise<MemorySummary> {
	const stat = await fs.stat(filePath)
	return {
		file: path.basename(filePath),
		path: filePath,
		...(includeContent ? { content: await fs.readFile(filePath, "utf8") } : {}),
		createdAt: stat.birthtime.toISOString(),
		updatedAt: stat.mtime.toISOString(),
	}
}

async function enableMemory(config: TaskConfig, filePath: string): Promise<void> {
	const stateManager = config.services.stateManager
	const toggles = stateManager.getGlobalSettingsKey("globalShuncodeRulesToggles") ?? {}
	stateManager.setGlobalState("globalShuncodeRulesToggles", { ...toggles, [filePath]: true })
	await stateManager.flushPendingState()
	await config.callbacks.postStateToWebview()
}

async function removeMemoryToggle(config: TaskConfig, filePath: string): Promise<void> {
	const stateManager = config.services.stateManager
	const toggles = stateManager.getGlobalSettingsKey("globalShuncodeRulesToggles") ?? {}
	if (filePath in toggles) {
		const updatedToggles = { ...toggles }
		delete updatedToggles[filePath]
		stateManager.setGlobalState("globalShuncodeRulesToggles", updatedToggles)
		await stateManager.flushPendingState()
	}
	await config.callbacks.postStateToWebview()
}
