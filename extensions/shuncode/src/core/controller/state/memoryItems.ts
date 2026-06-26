import * as fs from "fs/promises"
import * as path from "path"
import { refreshShuncodeRulesToggles } from "@core/context/instructions/user-instructions/shuncode-rules"
import { ensureRulesDirectoryExists } from "@core/storage/disk"
import { EmptyRequest, String as StringResponse, StringRequest } from "@shared/proto/shuncode/common"
import { getCwd, getDesktopDir } from "@/utils/path"
import type { Controller } from ".."

export interface MemoryItem {
	id: string
	name: string
	path: string
	scope: "global" | "project"
	content: string
	createdAt?: string
}

interface AddMemoryItemRequest {
	name?: string
	content?: string
}

export async function addMemoryItem(controller: Controller, request: StringRequest): Promise<StringResponse> {
	let payload: AddMemoryItemRequest
	try {
		payload = JSON.parse(request.value || "{}")
	} catch {
		return StringResponse.create({ value: JSON.stringify({ success: false, error: "Invalid request payload" }) })
	}

	const content = payload.content?.trim()
	if (!content) {
		return StringResponse.create({ value: JSON.stringify({ success: false, error: "Memory content is required" }) })
	}

	const rulesDir = await ensureRulesDirectoryExists()
	const baseName = normalizeMemoryName(payload.name || content)
	const filePath = await getAvailableMemoryFilePath(rulesDir, baseName)

	try {
		await fs.writeFile(filePath, `${content}\n`, { encoding: "utf-8", flag: "wx" })

		const toggles = controller.stateManager.getGlobalSettingsKey("globalShuncodeRulesToggles")
		controller.stateManager.setGlobalState("globalShuncodeRulesToggles", { ...toggles, [filePath]: true })
		await refreshShuncodeRulesToggles(controller, await getCwd(getDesktopDir()))
		await controller.stateManager.flushPendingState()
		await controller.postStateToWebview()

		return StringResponse.create({
			value: JSON.stringify({ success: true, item: await createMemoryItem(filePath, "global") }),
		})
	} catch (error) {
		return StringResponse.create({
			value: JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
		})
	}
}

export async function listMemoryItems(_controller: Controller, _request: EmptyRequest): Promise<StringResponse> {
	const items: MemoryItem[] = []

	// Global rules only
	const globalRulesDir = await ensureRulesDirectoryExists()
	await collectRuleFiles(globalRulesDir, "global", items)

	return StringResponse.create({ value: JSON.stringify(items) })
}

export async function deleteMemoryItem(controller: Controller, request: StringRequest): Promise<StringResponse> {
	const filePath = request.value
	if (!filePath) {
		return StringResponse.create({ value: JSON.stringify({ success: false, error: "No path provided" }) })
	}

	try {
		const rulesDir = await ensureRulesDirectoryExists()
		if (!isMemoryFilePath(filePath, rulesDir)) {
			return StringResponse.create({ value: JSON.stringify({ success: false, error: "Invalid memory item path" }) })
		}

		await fs.unlink(filePath)
		const toggles = controller.stateManager.getGlobalSettingsKey("globalShuncodeRulesToggles")
		if (filePath in toggles) {
			const updatedToggles = { ...toggles }
			delete updatedToggles[filePath]
			controller.stateManager.setGlobalState("globalShuncodeRulesToggles", updatedToggles)
			await controller.stateManager.flushPendingState()
			await controller.postStateToWebview()
		}
		return StringResponse.create({ value: JSON.stringify({ success: true }) })
	} catch (error) {
		return StringResponse.create({
			value: JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
		})
	}
}

async function collectRuleFiles(dirPath: string, scope: "global" | "project", items: MemoryItem[]): Promise<void> {
	try {
		const entries = await fs.readdir(dirPath, { withFileTypes: true })
		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith(".md")) {
				const fullPath = path.join(dirPath, entry.name)
				try {
					items.push(await createMemoryItem(fullPath, scope))
				} catch {
					// Skip unreadable files
				}
			}
		}
	} catch {
		// Directory doesn't exist or unreadable
	}
}

async function createMemoryItem(filePath: string, scope: "global" | "project"): Promise<MemoryItem> {
	const content = await fs.readFile(filePath, "utf-8")
	const stat = await fs.stat(filePath)
	const parsedPath = path.parse(filePath)
	return {
		id: filePath,
		name: parsedPath.name,
		path: filePath,
		scope,
		content,
		createdAt: stat.birthtime.toISOString(),
	}
}

async function getAvailableMemoryFilePath(dirPath: string, baseName: string): Promise<string> {
	let candidate = path.join(dirPath, `${baseName}.md`)
	let suffix = 2
	while (await fileExists(candidate)) {
		candidate = path.join(dirPath, `${baseName}-${suffix}.md`)
		suffix++
	}
	return candidate
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

function isMemoryFilePath(filePath: string, rulesDir: string): boolean {
	const resolvedPath = path.resolve(filePath)
	const resolvedRulesDir = path.resolve(rulesDir)
	const relativePath = path.relative(resolvedRulesDir, resolvedPath)
	return Boolean(
		relativePath &&
			!relativePath.startsWith("..") &&
			!path.isAbsolute(relativePath) &&
			path.extname(resolvedPath).toLowerCase() === ".md",
	)
}

function normalizeMemoryName(value: string): string {
	const firstLine = value.trim().split(/\r?\n/, 1)[0] ?? "memory"
	const normalized = firstLine
		.toLowerCase()
		.replace(/\.md$/i, "")
		.replace(/[\\/:*?"<>|#{}%~&]/g, " ")
		.replace(/[^\p{L}\p{N}._ -]+/gu, " ")
		.trim()
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[._ -]+|[._ -]+$/g, "")
		.slice(0, 64)

	return normalized || `memory-${new Date().toISOString().replace(/[:.]/g, "-")}`
}
