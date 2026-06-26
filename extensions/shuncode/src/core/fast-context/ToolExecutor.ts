/**
 * ToolExecutor — executes the restricted tool set for the Fast Context sub-agent.
 *
 * Tools available:
 * 1. grep (ripgrep) — regex/fixed-string search across the codebase
 * 2. read_file — read a file or line range
 * 3. find_files — glob-based file discovery
 * 4. ls — list the immediate contents of a directory
 *
 * All tools run locally with strict safety constraints:
 * - No writes, only reads
 * - Restricted to the workspace root
 * - Output truncated to prevent context overflow
 */
import * as path from "node:path"
import * as fs from "node:fs"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { FastContextConfig } from "@shared/FastContextTypes"
import { getBinaryLocation } from "@/utils/fs"

const execFileAsync = promisify(execFile)

/** Maximum output bytes per tool call to prevent context flooding */
const MAX_OUTPUT_BYTES = 16000
/** Maximum lines to return from grep */
const MAX_GREP_LINES = 100
/** Timeout for tool execution in ms */
const TOOL_EXEC_TIMEOUT_MS = 10000

export interface ToolCallInput {
	tool: "grep" | "read_file" | "find_files" | "ls"
	args: Record<string, any>
}

export interface ToolCallOutput {
	tool: string
	success: boolean
	output: string
	durationMs: number
}

export class ToolExecutor {
	private readonly workspaceRoot: string
	private readonly config: FastContextConfig
	private rgPath: string | null = null

	constructor(workspaceRoot: string, config: FastContextConfig) {
		this.workspaceRoot = path.resolve(workspaceRoot)
		this.config = config
	}

	/**
	 * Execute a single tool call.
	 */
	async execute(input: ToolCallInput): Promise<ToolCallOutput> {
		const start = Date.now()
		try {
			let output: string
			switch (input.tool) {
				case "grep":
					output = await this.executeGrep(input.args)
					break
				case "read_file":
					output = await this.executeReadFile(input.args)
					break
				case "find_files":
					output = await this.executeFindFiles(input.args)
					break
				case "ls":
					output = await this.executeLs(input.args)
					break
				default:
					output = `Unknown tool: ${input.tool}`
			}
			return {
				tool: input.tool,
				success: true,
				output: this.truncateOutput(output),
				durationMs: Date.now() - start,
			}
		} catch (err: any) {
			return {
				tool: input.tool,
				success: false,
				output: `Error: ${err.message}`,
				durationMs: Date.now() - start,
			}
		}
	}

	/**
	 * Execute multiple tool calls in parallel.
	 */
	async executeParallel(inputs: ToolCallInput[]): Promise<ToolCallOutput[]> {
		return Promise.all(inputs.map((input) => this.execute(input)))
	}

	// ── grep ──────────────────────────────────────────────────────

	private async executeGrep(args: Record<string, any>): Promise<string> {
		const { pattern, path: searchPath, include, fixed_string } = args
		if (!pattern) return "Error: pattern is required"

		const rgBin = await this.findRipgrep()
		const targetPath = this.resolvePath(searchPath || ".")

		const rgArgs: string[] = [
			"--no-heading",
			"--line-number",
			"--color=never",
			`--max-count=${MAX_GREP_LINES}`,
			"--max-filesize", `${this.config.maxReadFileSize}`,
		]

		if (fixed_string) {
			rgArgs.push("--fixed-strings")
		}

		// Add include glob
		if (include) {
			const globs = Array.isArray(include) ? include : [include]
			for (const g of globs) {
				rgArgs.push("--glob", g)
			}
		}

		// Add exclude patterns
		for (const exc of this.config.excludePatterns) {
			rgArgs.push("--glob", `!${exc}`)
		}

		rgArgs.push("--", pattern, targetPath)

		try {
			const { stdout } = await execFileAsync(rgBin, rgArgs, {
				cwd: this.workspaceRoot,
				timeout: TOOL_EXEC_TIMEOUT_MS,
				maxBuffer: MAX_OUTPUT_BYTES * 2,
			})
			return stdout || "(no matches)"
		} catch (err: any) {
			// rg exits 1 when no matches found
			if (err.code === 1) return "(no matches)"
			if (err.stdout) return err.stdout
			throw err
		}
	}

	// ── read_file ──────────────────────────────────────────────────

	private async executeReadFile(args: Record<string, any>): Promise<string> {
		const { path: filePath, start_line, end_line } = args
		if (!filePath) return "Error: path is required"

		const resolved = this.resolvePath(filePath)

		// Safety: check file exists and size
		const stat = await fs.promises.stat(resolved)
		if (stat.size > this.config.maxReadFileSize) {
			return `Error: file too large (${stat.size} bytes > ${this.config.maxReadFileSize} limit). Use grep to find relevant sections.`
		}

		const content = await fs.promises.readFile(resolved, "utf-8")
		const lines = content.split("\n")

		const start = Math.max(1, start_line || 1)
		const end = Math.min(lines.length, end_line || lines.length)

		const selectedLines = lines.slice(start - 1, end)
		const numbered = selectedLines.map((line, i) => `${start + i}\t${line}`).join("\n")
		return numbered
	}

	// ── find_files ────────────────────────────────────────────────

	private async executeFindFiles(args: Record<string, any>): Promise<string> {
		const { pattern, path: searchPath, type } = args
		if (!pattern) return "Error: pattern is required"

		const targetPath = this.resolvePath(searchPath || ".")

		// Try fd first, then ripgrep --files, then Node.js fallback
		try {
			const fdBin = await this.findFd()
			const fdArgs: string[] = [
				"--color=never",
				"--max-depth", "8",
			]

			if (type === "file") fdArgs.push("--type", "f")
			else if (type === "directory") fdArgs.push("--type", "d")

			for (const exc of this.config.excludePatterns) {
				fdArgs.push("--exclude", exc)
			}

			fdArgs.push(pattern, targetPath)

			const { stdout } = await execFileAsync(fdBin, fdArgs, {
				cwd: this.workspaceRoot,
				timeout: TOOL_EXEC_TIMEOUT_MS,
				maxBuffer: MAX_OUTPUT_BYTES * 2,
			})
			return stdout || "(no matches)"
		} catch {
			// Fallback: use ripgrep --files with glob
			try {
				const rgBin = await this.findRipgrep()
				// Convert the pattern to a proper glob: wrap with ** and * if not already a glob
				const isGlob = /[*?{}\[\]]/.test(pattern)
				const globPattern = isGlob ? pattern : `**/*${pattern}*`
				const rgArgs = ["--files", "--glob", globPattern]
				for (const exc of this.config.excludePatterns) {
					rgArgs.push("--glob", `!${exc}`)
				}
				rgArgs.push(targetPath)

				const { stdout } = await execFileAsync(rgBin, rgArgs, {
					cwd: this.workspaceRoot,
					timeout: TOOL_EXEC_TIMEOUT_MS,
					maxBuffer: MAX_OUTPUT_BYTES * 2,
				})
				return stdout || "(no matches)"
			} catch (rgErr: any) {
				// Final fallback: use Node.js fs to walk and filter
				try {
					return await this.findFilesNodeFallback(pattern, targetPath, type)
				} catch (fsErr: any) {
					return `Error: Could not find files. ripgrep error: ${rgErr.message}. fs fallback error: ${fsErr.message}`
				}
			}
		}
	}

	/**
	 * Node.js native fallback for find_files when fd and rg are both unavailable.
	 * Walks directories up to depth 6 and matches file names against the pattern.
	 */
	private async findFilesNodeFallback(pattern: string, targetPath: string, type?: string): Promise<string> {
		const MAX_DEPTH = 6
		const MAX_RESULTS = 100
		const results: string[] = []
		const patternLower = pattern.toLowerCase()
		const excludeSet = new Set(this.config.excludePatterns.filter(p => !p.includes("*")))

		const walk = async (dir: string, depth: number) => {
			if (depth > MAX_DEPTH || results.length >= MAX_RESULTS) return
			let entries: fs.Dirent[]
			try {
				entries = await fs.promises.readdir(dir, { withFileTypes: true })
			} catch { return }

			for (const entry of entries) {
				if (results.length >= MAX_RESULTS) break
				if (excludeSet.has(entry.name)) continue

				const fullPath = path.join(dir, entry.name)
				const isDir = entry.isDirectory()

				if (type === "file" && isDir) {
					await walk(fullPath, depth + 1)
					continue
				}
				if (type === "directory" && !isDir) continue

				// Match: case-insensitive substring match on entry name
				if (entry.name.toLowerCase().includes(patternLower)) {
					const relPath = path.relative(this.workspaceRoot, fullPath)
					results.push(relPath.replace(/\\/g, "/"))
				}

				if (isDir) {
					await walk(fullPath, depth + 1)
				}
			}
		}

		await walk(targetPath, 0)
		return results.length > 0 ? results.join("\n") : "(no matches)"
	}

	// ── ls ────────────────────────────────────────────────────────

	/**
	 * List the immediate (non-recursive) contents of a directory.
	 * Directories are suffixed with "/" so the LLM can distinguish them.
	 * Excluded names (from config.excludePatterns, ignoring glob entries) are skipped.
	 */
	private async executeLs(args: Record<string, any>): Promise<string> {
		const { path: dirPath } = args
		const targetPath = this.resolvePath(dirPath || ".")

		const stat = await fs.promises.stat(targetPath)
		if (!stat.isDirectory()) {
			return `Error: not a directory: ${dirPath || "."}. Use read_file to read a file.`
		}

		const excludeSet = new Set(this.config.excludePatterns.filter((p) => !p.includes("*")))
		const entries = await fs.promises.readdir(targetPath, { withFileTypes: true })

		const dirs: string[] = []
		const files: string[] = []
		for (const entry of entries) {
			if (excludeSet.has(entry.name)) continue
			if (entry.isDirectory()) {
				dirs.push(`${entry.name}/`)
			} else {
				files.push(entry.name)
			}
		}

		// Directories first, then files; each sorted alphabetically
		dirs.sort()
		files.sort()
		const listing = [...dirs, ...files]
		return listing.length > 0 ? listing.join("\n") : "(empty directory)"
	}

	// ── Helpers ──────────────────────────────────────────────────

	private resolvePath(relativePath: string): string {
		const resolved = path.resolve(this.workspaceRoot, relativePath)
		// Safety: ensure path is within workspace
		if (!resolved.startsWith(this.workspaceRoot)) {
			throw new Error(`Path escapes workspace: ${relativePath}`)
		}
		return resolved
	}

	private truncateOutput(output: string): string {
		if (output.length <= MAX_OUTPUT_BYTES) return output
		return output.slice(0, MAX_OUTPUT_BYTES) + "\n...[truncated]"
	}

	private async findRipgrep(): Promise<string> {
		if (this.rgPath) return this.rgPath

		// Primary: use the project's getBinaryLocation utility which finds
		// the rg bundled with VS Code / ShunCode reliably
		try {
			const location = await getBinaryLocation("rg")
			this.rgPath = location
			return location
		} catch { /* getBinaryLocation failed, try manual fallback */ }

		// Fallback: check common locations
		const candidates = process.platform === "win32"
			? ["rg.exe", "C:\\Program Files\\ripgrep\\rg.exe"]
			: ["rg", "/usr/bin/rg", "/usr/local/bin/rg"]

		for (const candidate of candidates) {
			try {
				await execFileAsync(candidate, ["--version"], { timeout: 3000 })
				this.rgPath = candidate
				return candidate
			} catch { /* try next */ }
		}

		// Last resort: try 'where' on Windows or 'which' on Unix
		try {
			const cmd = process.platform === "win32" ? "where" : "which"
			const { stdout } = await execFileAsync(cmd, ["rg"], { timeout: 3000 })
			const found = stdout.trim().split("\n")[0]
			if (found) {
				this.rgPath = found
				return found
			}
		} catch { /* ignore */ }

		throw new Error("ripgrep (rg) not found. getBinaryLocation failed and rg is not in PATH.")
	}

	private async findFd(): Promise<string> {
		const candidates = process.platform === "win32"
			? ["fd.exe"]
			: ["fd", "fdfind", "/usr/bin/fd", "/usr/local/bin/fd"]

		for (const candidate of candidates) {
			try {
				await execFileAsync(candidate, ["--version"], { timeout: 3000 })
				return candidate
			} catch { /* try next */ }
		}
		throw new Error("fd not found")
	}
}
