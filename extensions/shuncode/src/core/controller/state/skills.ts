import { ensureSkillsDirectoryExists } from "@core/storage/disk"
import { EmptyRequest, StringRequest, String as StringResponse } from "@shared/proto/shuncode/common"
import { fileExistsAtPath } from "@utils/fs"
import * as fs from "fs/promises"
import * as path from "path"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

// Built-in marketplace sources
const BUILTIN_SOURCES = [
	{ id: "anthropics/skills/skills", name: "Anthropic Skills", url: "https://github.com/anthropics/skills/tree/main/skills" },
]

const GITHUB_HEADERS = { Accept: "application/vnd.github.v3+json", "User-Agent": "ShunCode" }

// GitHub mirror for rate-limit bypass
const GITHUB_API_MIRROR = "https://gh-proxy.com/"

const ANTHROPIC_SKILL_FALLBACK_NAMES = [
	"algorithmic-art",
	"brand-guidelines",
	"canvas-design",
	"claude-api",
	"doc-coauthoring",
	"docx",
	"frontend-design",
	"internal-comms",
	"mcp-builder",
	"pdf",
	"pptx",
	"skill-creator",
	"slack-gif-creator",
	"theme-factory",
	"web-artifacts-builder",
	"webapp-testing",
	"xlsx",
]

interface SkillInfo {
	name: string
	description: string
	path: string
	enabled: boolean
}
interface MarketplaceItem {
	name: string
	description: string
	installed: boolean
}
interface MarketplaceSource {
	id: string
	name: string
	url: string
}
interface MarketplaceSourcePayload {
	sourceId?: string
	source?: MarketplaceSource
}
interface InstallSkillPayload extends MarketplaceSourcePayload {
	skillName?: string
}
interface DeleteSkillPayload {
	skillName?: string
	path?: string
}
interface GitHubDirectorySource {
	owner: string
	repo: string
	branch: string
	dirPath: string
	apiUrl: string
	rawBase: string
}
interface GitHubContentItem {
	name: string
	type: "file" | "dir" | string
	download_url?: string | null
}
interface JsDelivrFlatFile {
	name: string
	type?: string
}

function resolveMarketplaceSourceRequest(value?: string): { source: MarketplaceSource; error?: string } {
	if (!value) {
		return { source: BUILTIN_SOURCES[0] }
	}

	try {
		const payload = JSON.parse(value) as MarketplaceSourcePayload
		const resolved = resolveMarketplaceSource(payload.sourceId, payload.source)
		return resolved ? { source: resolved } : { source: BUILTIN_SOURCES[0], error: "Invalid marketplace source" }
	} catch {
		const source = BUILTIN_SOURCES.find((item) => item.id === value) || BUILTIN_SOURCES[0]
		return { source }
	}
}

function resolveInstallSkillRequest(value?: string): { skillName?: string; sources: MarketplaceSource[]; error?: string } {
	if (!value) {
		return { sources: BUILTIN_SOURCES, error: "No skill name" }
	}

	try {
		const payload = JSON.parse(value) as InstallSkillPayload
		const skillName = payload.skillName?.trim()
		const source = resolveMarketplaceSource(payload.sourceId, payload.source)
		return {
			skillName,
			sources: source ? [source] : BUILTIN_SOURCES,
			error: source ? undefined : "Invalid marketplace source",
		}
	} catch {
		return { skillName: value.trim(), sources: BUILTIN_SOURCES }
	}
}

function resolveMarketplaceSource(sourceId?: string, customSource?: MarketplaceSource): MarketplaceSource | undefined {
	if (customSource) {
		const normalized = normalizeMarketplaceSource(customSource)
		if (normalized) return normalized
	}
	return BUILTIN_SOURCES.find((source) => source.id === sourceId)
}

function normalizeMarketplaceSource(source: MarketplaceSource): MarketplaceSource | undefined {
	const id = typeof source.id === "string" ? source.id.trim() : ""
	const name = typeof source.name === "string" ? source.name.trim() : ""
	const url = typeof source.url === "string" ? source.url.trim() : ""
	if (!id || !name || !url || !parseGitHubUrl(url)) {
		return undefined
	}
	return { id, name, url }
}

// Parse GitHub directory URL to API URL and raw base.
// Example: https://github.com/OWNER/REPO/tree/BRANCH/PATH
function parseGitHubUrl(treeUrl: string): GitHubDirectorySource | null {
	try {
		const url = new URL(treeUrl)
		if (url.hostname !== "github.com") {
			return null
		}

		const segments = url.pathname.split("/").filter(Boolean)
		if (segments.length < 5 || segments[2] !== "tree") {
			return null
		}

		const [owner, repo, , branch, ...pathParts] = segments
		const dirPath = pathParts.join("/").replace(/^\/+|\/+$/g, "")
		if (!owner || !repo || !branch || !dirPath) {
			return null
		}

		return {
			owner,
			repo,
			branch,
			dirPath,
			apiUrl: githubContentsUrl(owner, repo, branch, dirPath),
			rawBase: githubRawUrl(owner, repo, branch, dirPath),
		}
	} catch {
		return null
	}
}

export async function listInstalledSkills(_controller: Controller, _request: EmptyRequest): Promise<StringResponse> {
	const skills: SkillInfo[] = []
	const globalDir = await ensureSkillsDirectoryExists()
	await collectSkills(globalDir, skills)
	return StringResponse.create({ value: JSON.stringify(skills) })
}

export async function listMarketplaceSources(_controller: Controller, _request: EmptyRequest): Promise<StringResponse> {
	return StringResponse.create({ value: JSON.stringify(BUILTIN_SOURCES) })
}

export async function listMarketplaceSkills(_controller: Controller, request: StringRequest): Promise<StringResponse> {
	const { source, error } = resolveMarketplaceSourceRequest(request.value)
	if (error) {
		return StringResponse.create({ value: JSON.stringify({ items: [], error }) })
	}
	const parsed = parseGitHubUrl(source.url)
	if (!parsed) {
		return StringResponse.create({
			value: JSON.stringify({ items: [], error: `Invalid marketplace source URL: ${source.url}` }),
		})
	}

	try {
		const items = await fetchGitHubJson<GitHubContentItem[]>(parsed.apiUrl)
		if (!Array.isArray(items)) {
			throw new Error("GitHub contents response is not an array")
		}

		const globalDir = await ensureSkillsDirectoryExists()
		const installedNames = new Set(await listSkillDirs(globalDir))
		const skillDirs = items.filter((i) => i.type === "dir")

		const marketplace = await Promise.all(
			skillDirs.map(async (dir): Promise<MarketplaceItem> => {
				let description = ""
				try {
					const skillUrl = githubRawUrl(
						parsed.owner,
						parsed.repo,
						parsed.branch,
						joinGitHubPath(parsed.dirPath, dir.name, "SKILL.md"),
					)
					const content = await fetchText(skillUrl)
					description = extractFrontmatter(content, "description") || ""
				} catch {
					// The marketplace should still show the folder name even if metadata cannot be read.
				}

				return { name: dir.name, description, installed: installedNames.has(dir.name) }
			}),
		)

		return StringResponse.create({ value: JSON.stringify(marketplace) })
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		Logger.error("Failed to list marketplace skills:", error)

		const fallback = await getFallbackMarketplace(source.id)
		if (fallback.length > 0) {
			return StringResponse.create({
				value: JSON.stringify({ items: fallback, error: `Using built-in catalog fallback: ${errorMessage}` }),
			})
		}

		return StringResponse.create({ value: JSON.stringify({ items: [], error: errorMessage }) })
	}
}

export async function installSkill(_controller: Controller, request: StringRequest): Promise<StringResponse> {
	const { skillName, sources, error } = resolveInstallSkillRequest(request.value)
	if (error) {
		return StringResponse.create({ value: JSON.stringify({ success: false, error }) })
	}
	if (!skillName) {
		return StringResponse.create({ value: JSON.stringify({ success: false, error: "No skill name" }) })
	}
	if (!isSafePathSegment(skillName)) {
		return StringResponse.create({ value: JSON.stringify({ success: false, error: "Invalid skill name" }) })
	}

	// Try the requested source first, or all built-in sources for legacy requests.
	let lastError: string | undefined
	for (const source of sources) {
		const parsed = parseGitHubUrl(source.url)
		if (!parsed) {
			continue
		}

		const sourceSkillPath = joinGitHubPath(parsed.dirPath, skillName)
		const globalDir = await ensureSkillsDirectoryExists()
		const targetDir = path.join(globalDir, skillName)
		const tempDir = path.join(globalDir, `.${skillName}.tmp-${Date.now()}`)

		try {
			await fs.rm(tempDir, { recursive: true, force: true })
			await downloadGitHubDirectory(parsed, sourceSkillPath, tempDir)
			await installDownloadedSkill(tempDir, targetDir, skillName)
			return StringResponse.create({ value: JSON.stringify({ success: true, name: skillName }) })
		} catch (error) {
			const primaryError = error instanceof Error ? error.message : String(error)
			lastError = primaryError
			await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)

			if (isFallbackSkill(source.id, skillName)) {
				try {
					await downloadFallbackSkill(parsed, skillName, tempDir)
					await installDownloadedSkill(tempDir, targetDir, skillName)
					return StringResponse.create({ value: JSON.stringify({ success: true, name: skillName }) })
				} catch (fallbackError) {
					const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
					lastError = `${primaryError}; raw fallback failed: ${fallbackMessage}`
					await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
				}
			}

			Logger.debug(`Failed to install skill "${skillName}" from ${source.url}: ${lastError}`)
		}
	}
	return StringResponse.create({
		value: JSON.stringify({
			success: false,
			error: lastError ? `Skill not found: ${skillName} (${lastError})` : `Skill not found: ${skillName}`,
		}),
	})
}

export async function deleteSkill(controller: Controller, request: StringRequest): Promise<StringResponse> {
	const { skillName, skillPath, error } = resolveDeleteSkillRequest(request.value)
	if (error) {
		return StringResponse.create({ value: JSON.stringify({ success: false, error }) })
	}

	try {
		const globalDir = await ensureSkillsDirectoryExists()
		const dirPath = resolveSkillDirectoryForDelete(globalDir, skillPath, skillName)
		if (!dirPath) {
			return StringResponse.create({ value: JSON.stringify({ success: false, error: "Invalid skill path" }) })
		}
		if (!(await fileExistsAtPath(dirPath))) {
			return StringResponse.create({
				value: JSON.stringify({ success: false, error: `Skill not found: ${skillName || skillPath}` }),
			})
		}

		const deletedSkillName = path.basename(dirPath)
		await fs.rm(dirPath, { recursive: true, force: true })
		removeGlobalSkillToggles(controller, dirPath)
		await controller.postStateToWebview()
		Logger.info(`Deleted skill: ${deletedSkillName} at ${dirPath}`)
		return StringResponse.create({ value: JSON.stringify({ success: true, name: deletedSkillName }) })
	} catch (error) {
		Logger.error(`Failed to delete skill "${skillName || skillPath}":`, error)
		return StringResponse.create({
			value: JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
		})
	}
}

function resolveDeleteSkillRequest(value?: string): { skillName?: string; skillPath?: string; error?: string } {
	const trimmed = value?.trim()
	if (!trimmed) {
		return { error: "No skill name" }
	}

	try {
		const payload = JSON.parse(trimmed) as DeleteSkillPayload
		const skillName = typeof payload.skillName === "string" ? payload.skillName.trim() : undefined
		const skillPath = typeof payload.path === "string" ? payload.path.trim() : undefined
		if (!skillName && !skillPath) {
			return { error: "No skill name" }
		}
		if (!skillPath && skillName && !isSafePathSegment(skillName)) {
			return { error: "Invalid skill name" }
		}
		return { skillName, skillPath }
	} catch {
		if (!isSafePathSegment(trimmed)) {
			return { error: "Invalid skill name" }
		}
		return { skillName: trimmed }
	}
}

function resolveSkillDirectoryForDelete(globalDir: string, skillPath?: string, skillName?: string): string | undefined {
	if (skillPath) {
		const requestedPath = path.basename(skillPath).toLowerCase() === "skill.md" ? path.dirname(skillPath) : skillPath
		const resolvedPath = path.resolve(requestedPath)
		const resolvedGlobalDir = path.resolve(globalDir)
		const relativePath = path.relative(resolvedGlobalDir, resolvedPath)
		if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
			return undefined
		}
		const relativeParts = relativePath.split(path.sep).filter(Boolean)
		if (relativeParts.length !== 1 || !isSafePathSegment(relativeParts[0])) {
			return undefined
		}
		return resolvedPath
	}

	return skillName && isSafePathSegment(skillName) ? path.join(globalDir, skillName) : undefined
}

function removeGlobalSkillToggles(controller: Controller, skillDir: string): void {
	const globalToggles = controller.stateManager.getGlobalSettingsKey("globalSkillsToggles") || {}
	const skillMdPath = path.join(skillDir, "SKILL.md")
	const nextGlobalToggles = { ...globalToggles }
	delete nextGlobalToggles[skillDir]
	delete nextGlobalToggles[skillMdPath]
	controller.stateManager.setGlobalState("globalSkillsToggles", nextGlobalToggles)
}

async function collectSkills(dirPath: string, skills: SkillInfo[]): Promise<void> {
	try {
		if (!(await fileExistsAtPath(dirPath))) {
			return
		}
		const entries = await fs.readdir(dirPath, { withFileTypes: true })
		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue
			}
			const skillMdPath = path.join(dirPath, entry.name, "SKILL.md")
			if (!(await fileExistsAtPath(skillMdPath))) {
				continue
			}
			try {
				const content = await fs.readFile(skillMdPath, "utf-8")
				const name = extractFrontmatter(content, "name") || entry.name
				const desc = extractFrontmatter(content, "description") || ""
				skills.push({ name, description: desc, path: path.join(dirPath, entry.name), enabled: true })
			} catch {
				/* skip */
			}
		}
	} catch {
		/* dir not found */
	}
}

async function listSkillDirs(dirPath: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(dirPath, { withFileTypes: true })
		return entries.filter((e) => e.isDirectory()).map((e) => e.name)
	} catch {
		return []
	}
}

async function getFallbackMarketplace(sourceId: string): Promise<MarketplaceItem[]> {
	if (sourceId !== "anthropics/skills/skills") {
		return []
	}

	const globalDir = await ensureSkillsDirectoryExists()
	const installedNames = new Set(await listSkillDirs(globalDir))
	return ANTHROPIC_SKILL_FALLBACK_NAMES.map((name) => ({
		name,
		description: "",
		installed: installedNames.has(name),
	}))
}

async function installDownloadedSkill(tempDir: string, targetDir: string, skillName: string): Promise<void> {
	const skillMdPath = path.join(tempDir, "SKILL.md")
	if (!(await fileExistsAtPath(skillMdPath))) {
		throw new Error(`Downloaded skill is missing SKILL.md: ${skillName}`)
	}

	await fs.rm(targetDir, { recursive: true, force: true })
	await fs.rename(tempDir, targetDir)
}

async function downloadFallbackSkill(source: GitHubDirectorySource, skillName: string, targetDir: string): Promise<void> {
	await fs.mkdir(targetDir, { recursive: true })
	const skillDirPath = joinGitHubPath(source.dirPath, skillName)
	const skillDirPrefix = `/${skillDirPath}/`

	try {
		const flat = await fetchJson<{ files?: JsDelivrFlatFile[] }>(
			`https://data.jsdelivr.com/v1/package/gh/${source.owner}/${source.repo}@${encodeURIComponent(source.branch)}/flat`,
		)
		const files = (flat.files ?? []).filter((file) => file.type !== "directory" && file.name.startsWith(skillDirPrefix))
		if (files.length === 0) {
			throw new Error(`jsDelivr package listing did not contain ${skillDirPrefix}`)
		}

		for (const file of files) {
			const relativePath = file.name.slice(skillDirPrefix.length)
			if (!isSafeRelativePath(relativePath)) {
				continue
			}
			const targetPath = path.join(targetDir, ...relativePath.split("/"))
			await fs.mkdir(path.dirname(targetPath), { recursive: true })
			const content = await fetchBuffer(
				githubJsDelivrUrl(source.owner, source.repo, source.branch, file.name.replace(/^\/+/, "")),
			)
			await fs.writeFile(targetPath, content)
		}
		return
	} catch (error) {
		Logger.debug(
			`Failed to install skill "${skillName}" via jsDelivr directory fallback: ${error instanceof Error ? error.message : String(error)}`,
		)
	}

	const skillPath = joinGitHubPath(skillDirPath, "SKILL.md")
	const content = await fetchFirstText([
		githubRawUrl(source.owner, source.repo, source.branch, skillPath),
		githubJsDelivrUrl(source.owner, source.repo, source.branch, skillPath),
	])
	await fs.writeFile(path.join(targetDir, "SKILL.md"), content)
}

function isFallbackSkill(sourceId: string, skillName: string): boolean {
	return sourceId === "anthropics/skills/skills" && ANTHROPIC_SKILL_FALLBACK_NAMES.includes(skillName)
}

async function downloadGitHubDirectory(source: GitHubDirectorySource, sourcePath: string, targetDir: string): Promise<void> {
	const items = await fetchGitHubJson<GitHubContentItem[]>(
		githubContentsUrl(source.owner, source.repo, source.branch, sourcePath),
	)
	if (!Array.isArray(items)) {
		throw new Error(`GitHub path is not a directory: ${sourcePath}`)
	}

	await fs.mkdir(targetDir, { recursive: true })
	for (const item of items) {
		if (!isSafePathSegment(item.name)) {
			continue
		}

		const targetPath = path.join(targetDir, item.name)
		if (item.type === "dir") {
			await downloadGitHubDirectory(source, joinGitHubPath(sourcePath, item.name), targetPath)
			continue
		}

		if (item.type !== "file" || !item.download_url) {
			continue
		}
		const content = await fetchBuffer(item.download_url)
		await fs.writeFile(targetPath, content)
	}
}

async function fetchGitHubJson<T>(url: string): Promise<T> {
	// Try mirror first (prefixed by githubContentsUrl), fallback to direct GitHub API
	for (const tryUrl of [url, url.replace(GITHUB_API_MIRROR, "")]) {
		try {
			const headers = tryUrl === url ? {} : GITHUB_HEADERS
			const response = await fetch(tryUrl, { headers })
			if (!response.ok) {
				throw new Error(`GitHub request failed: HTTP ${response.status} ${response.statusText}`)
			}
			return (await response.json()) as T
		} catch (err) {
			if (tryUrl === url.replace(GITHUB_API_MIRROR, "")) {
				// Direct API also failed — rethrow
				throw err
			}
			// Mirror failed — continue to direct
			Logger.warn(`GitHub mirror failed for ${url}, trying direct API`)
		}
	}
	throw new Error("GitHub request failed: all sources exhausted")
}

async function fetchJson<T>(url: string): Promise<T> {
	const response = await fetch(url, { headers: GITHUB_HEADERS })
	if (!response.ok) {
		throw new Error(`Request failed: HTTP ${response.status} ${response.statusText}`)
	}
	return (await response.json()) as T
}

async function fetchText(url: string): Promise<string> {
	const response = await fetch(url, { headers: GITHUB_HEADERS })
	if (!response.ok) {
		throw new Error(`Request failed: HTTP ${response.status} ${response.statusText}`)
	}
	return response.text()
}

async function fetchFirstText(urls: string[]): Promise<string> {
	const errors: string[] = []
	for (const url of urls) {
		try {
			return await fetchText(url)
		} catch (error) {
			errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
		}
	}
	throw new Error(errors.join("; "))
}

async function fetchBuffer(url: string): Promise<Buffer> {
	const response = await fetch(url, { headers: GITHUB_HEADERS })
	if (!response.ok) {
		throw new Error(`Request failed: HTTP ${response.status} ${response.statusText}`)
	}
	return Buffer.from(await response.arrayBuffer())
}

function githubContentsUrl(owner: string, repo: string, branch: string, contentPath: string): string {
	const direct = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeGitHubPath(contentPath)}?ref=${encodeURIComponent(branch)}`
	return `${GITHUB_API_MIRROR}${direct}`
}

function githubRawUrl(owner: string, repo: string, branch: string, contentPath: string): string {
	return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${encodeGitHubPath(contentPath)}`
}

function githubJsDelivrUrl(owner: string, repo: string, branch: string, contentPath: string): string {
	return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${encodeURIComponent(branch)}/${encodeGitHubPath(contentPath)}`
}

function joinGitHubPath(...parts: string[]): string {
	return parts
		.flatMap((part) => part.split("/"))
		.map((part) => part.trim())
		.filter(Boolean)
		.join("/")
}

function encodeGitHubPath(contentPath: string): string {
	return contentPath.split("/").map(encodeURIComponent).join("/")
}

function isSafePathSegment(value: string): boolean {
	return Boolean(value) && value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\")
}

function isSafeRelativePath(value: string): boolean {
	return Boolean(value) && value.split("/").every(isSafePathSegment)
}

function extractFrontmatter(content: string, field: string): string | null {
	const match = content.match(new RegExp(`${field}:\\s*(.+)\\r?\\n`, "i"))
	return match ? match[1].trim().replace(/^["']|["']$/g, "") : null
}
