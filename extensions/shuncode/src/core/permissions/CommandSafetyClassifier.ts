/**
 * CommandSafetyClassifier — classifies shell commands as "safe" (read-only) or "unsafe" (modifying).
 *
 * Used by ExecuteCommandToolHandler to decide whether a command can be auto-approved
 * when the user has enabled "executeSafeCommands" but not "executeAllCommands".
 *
 * A "safe" command is one that ONLY reads data and does NOT modify the filesystem,
 * install packages, push to remote, or execute arbitrary code.
 *
 * Design:
 * - Whitelist approach: only explicitly listed commands are considered safe.
 * - Unknown commands are always classified as unsafe (secure by default).
 * - Pipes/chains: ALL segments must be safe for the whole command to be safe.
 * - Redirects (>, >>) always make a command unsafe.
 *
 * [SHUNCODE] This module is part of the security layer for auto-approve permissions.
 */

export type CommandSafety = "safe" | "unsafe"

export interface ClassificationResult {
	safety: CommandSafety
	/** The specific reason for the classification */
	reason: string
	/** If unsafe, which part of the command triggered it */
	unsafeSegment?: string
}

/**
 * Whitelist of safe (read-only) command prefixes.
 *
 * Rules:
 * - Entry "cmd" matches "cmd" exactly and "cmd ..." (with any arguments)
 * - Order doesn't matter
 * - Case-sensitive (Linux commands are case-sensitive)
 */
const SAFE_COMMANDS: string[] = [
	// File/directory listing & reading
	"ls",
	"dir",       // Windows
	"cat",
	"head",
	"tail",
	"less",
	"more",
	"file",
	"stat",
	"wc",
	"du",
	"df",

	// Search & find
	"grep",
	"rg",        // ripgrep
	"find",
	"which",
	"where",     // Windows
	"whereis",
	"locate",
	"fd",        // fd-find

	// Path & environment
	"pwd",
	"echo",
	"printenv",
	"env",
	"whoami",
	"hostname",
	"uname",
	"date",
	"uptime",

	// Text processing (read-only)
	"sort",
	"uniq",
	"cut",
	"tr",
	"awk",
	"sed",       // NOTE: without -i flag only (checked separately)
	"diff",
	"comm",
	"tee",       // NOTE: tee writes to files — checked separately
	"jq",
	"yq",
	"xargs",

	// Git (read-only operations)
	"git status",
	"git log",
	"git diff",
	"git show",
	"git branch",
	"git tag",
	"git remote",
	"git stash list",
	"git rev-parse",
	"git describe",
	"git config --get",
	"git config --list",
	"git ls-files",
	"git ls-tree",
	"git blame",
	"git shortlog",
	"git reflog",
	"git name-rev",
	"git for-each-ref",

	// Node.js / npm / yarn / pnpm (read-only)
	"node -v",
	"node --version",
	"node -e",   // Evaluate expression (read-only in most cases)
	"node -p",   // Print expression
	"npm list",
	"npm ls",
	"npm view",
	"npm info",
	"npm show",
	"npm outdated",
	"npm version",
	"npm -v",
	"npm --version",
	"npm config list",
	"npm config get",
	"npm help",
	"npm root",
	"npm prefix",
	"npm bin",
	"npm whoami",
	"npx --version",
	"yarn list",
	"yarn info",
	"yarn why",
	"yarn --version",
	"pnpm list",
	"pnpm ls",
	"pnpm --version",

	// TypeScript
	"tsc --version",
	"tsc --noEmit",
	"tsc -v",

	// Python (read-only)
	"python --version",
	"python -V",
	"python3 --version",
	"python3 -V",
	"pip list",
	"pip show",
	"pip --version",
	"pip3 list",
	"pip3 show",
	"pip3 --version",

	// Rust
	"rustc --version",
	"cargo --version",
	"cargo check",

	// Go
	"go version",
	"go env",
	"go list",

	// Java
	"java -version",
	"java --version",
	"javac -version",
	"mvn --version",
	"gradle --version",

	// Docker (read-only)
	"docker ps",
	"docker images",
	"docker version",
	"docker info",
	"docker inspect",
	"docker logs",
	"docker stats",

	// System info (read-only)
	"ps",
	"top",
	"htop",
	"free",
	"lsof",
	"netstat",
	"ss",
	"ifconfig",
	"ip",

	// Test runners (read-only in the sense they don't modify source)
	"npm test",
	"npm run test",
	"npm run lint",
	"npm run check",
	"npm run typecheck",
	"npm run type-check",
	"npx jest",
	"npx vitest",
	"npx eslint",
	"npx tsc --noEmit",
	"yarn test",
	"yarn lint",
	"pnpm test",
	"pnpm lint",
]

/**
 * Commands that are ALWAYS unsafe regardless of arguments.
 * These are checked first (before whitelist).
 */
const ALWAYS_UNSAFE_COMMANDS: string[] = [
	"rm",
	"rmdir",
	"del",       // Windows
	"mv",
	"move",      // Windows
	"cp",
	"copy",      // Windows
	"chmod",
	"chown",
	"chgrp",
	"mkfs",
	"dd",
	"sudo",
	"su",
	"kill",
	"killall",
	"pkill",
	"shutdown",
	"reboot",
	"halt",
	"poweroff",
	"curl",      // Can download & execute
	"wget",      // Can download & execute
	"ssh",
	"scp",
	"rsync",
	"ftp",
	"sftp",
	"nc",        // netcat
	"ncat",
	"telnet",

	// Package managers that install/modify
	"npm install",
	"npm i",
	"npm ci",
	"npm uninstall",
	"npm update",
	"npm run build",
	"npm run dev",
	"npm run start",
	"npm run serve",
	"npm publish",
	"npm link",
	"npm init",
	"npx create-",

	// Git write operations
	"git push",
	"git commit",
	"git merge",
	"git rebase",
	"git reset",
	"git checkout",  // Can modify working tree
	"git switch",
	"git restore",
	"git cherry-pick",
	"git revert",
	"git clean",
	"git stash drop",
	"git stash pop",
	"git stash apply",
	"git add",
	"git rm",
	"git mv",
	"git init",
	"git clone",
	"git pull",
	"git fetch",     // Fetch is network but doesn't modify working tree — borderline

	// Python write
	"pip install",
	"pip3 install",
	"pip uninstall",
	"pip3 uninstall",

	// Yarn/pnpm write
	"yarn add",
	"yarn remove",
	"yarn install",
	"pnpm add",
	"pnpm remove",
	"pnpm install",
	"pnpm i",

	// Docker write
	"docker run",
	"docker exec",
	"docker build",
	"docker push",
	"docker pull",
	"docker rm",
	"docker rmi",
	"docker stop",
	"docker start",
	"docker restart",
	"docker kill",
	"docker compose up",
	"docker compose down",
]

/**
 * Flags that make otherwise-safe commands unsafe.
 */
const UNSAFE_FLAGS: Record<string, string[]> = {
	"sed": ["-i", "--in-place"],  // sed -i modifies files
	"find": ["-exec", "-execdir", "-delete", "-ok"],  // find -exec runs commands
	"xargs": [],  // xargs always runs commands — but it's in safe list for pipes like `grep | xargs echo`
}

export class CommandSafetyClassifier {

	/**
	 * Classify a command as safe or unsafe.
	 *
	 * For compound commands (pipes, &&, ||, ;), ALL segments must be safe.
	 */
	classify(command: string): ClassificationResult {
		const trimmed = command.trim()

		if (!trimmed) {
			return { safety: "safe", reason: "empty_command" }
		}

		// Check for redirects (>, >>, <) — always unsafe
		if (this.hasRedirect(trimmed)) {
			return {
				safety: "unsafe",
				reason: "redirect_detected",
				unsafeSegment: trimmed,
			}
		}

		// Split by shell operators: &&, ||, |, ;
		const segments = this.splitCommand(trimmed)

		for (const segment of segments) {
			const segmentTrimmed = segment.trim()
			if (!segmentTrimmed) continue

			const result = this.classifySegment(segmentTrimmed)
			if (result.safety === "unsafe") {
				return result
			}
		}

		return { safety: "safe", reason: "all_segments_safe" }
	}

	/**
	 * Classify a single command segment (no pipes/chains).
	 */
	private classifySegment(segment: string): ClassificationResult {
		// Check always-unsafe commands first
		for (const unsafeCmd of ALWAYS_UNSAFE_COMMANDS) {
			if (segment === unsafeCmd || segment.startsWith(unsafeCmd + " ")) {
				return {
					safety: "unsafe",
					reason: "always_unsafe_command",
					unsafeSegment: segment,
				}
			}
		}

		// Check whitelist
		for (const safeCmd of SAFE_COMMANDS) {
			if (segment === safeCmd || segment.startsWith(safeCmd + " ")) {
				// Check for unsafe flags that override safety
				const unsafeFlag = this.hasUnsafeFlags(safeCmd, segment)
				if (unsafeFlag) {
					return {
						safety: "unsafe",
						reason: `unsafe_flag: ${unsafeFlag}`,
						unsafeSegment: segment,
					}
				}
				return { safety: "safe", reason: `whitelisted: ${safeCmd}` }
			}
		}

		// Not in whitelist — unsafe by default
		return {
			safety: "unsafe",
			reason: "unknown_command",
			unsafeSegment: segment,
		}
	}

	/**
	 * Check if a command has flags that make it unsafe.
	 */
	private hasUnsafeFlags(baseCmd: string, fullCommand: string): string | null {
		// Extract the base command name (first word)
		const baseName = baseCmd.split(" ")[0]
		const flags = UNSAFE_FLAGS[baseName]
		if (!flags || flags.length === 0) return null

		// Parse arguments (simple split, respecting quotes would be better but this covers 95%)
		const args = fullCommand.split(/\s+/)

		for (const flag of flags) {
			if (args.includes(flag)) {
				return flag
			}
			// Check for combined short flags like -iE → contains -i
			if (flag.startsWith("-") && flag.length === 2) {
				const flagChar = flag[1]
				for (const arg of args) {
					if (arg.startsWith("-") && !arg.startsWith("--") && arg.includes(flagChar)) {
						return flag
					}
				}
			}
		}

		return null
	}

	/**
	 * Check if command contains output redirects outside of quotes.
	 */
	private hasRedirect(command: string): boolean {
		let inSingleQuote = false
		let inDoubleQuote = false
		let escaped = false

		for (let i = 0; i < command.length; i++) {
			const char = command[i]

			if (escaped) {
				escaped = false
				continue
			}

			if (char === "\\") {
				escaped = true
				continue
			}

			if (char === "'" && !inDoubleQuote) {
				inSingleQuote = !inSingleQuote
				continue
			}

			if (char === '"' && !inSingleQuote) {
				inDoubleQuote = !inDoubleQuote
				continue
			}

			// Only check redirects outside quotes
			if (!inSingleQuote && !inDoubleQuote) {
				if (char === ">" || char === "<") {
					return true
				}
			}
		}

		return false
	}

	/**
	 * Split command by shell operators (&&, ||, |, ;) respecting quotes.
	 * Returns individual command segments.
	 */
	private splitCommand(command: string): string[] {
		const segments: string[] = []
		let current = ""
		let inSingleQuote = false
		let inDoubleQuote = false
		let escaped = false

		for (let i = 0; i < command.length; i++) {
			const char = command[i]
			const nextChar = command[i + 1]

			if (escaped) {
				current += char
				escaped = false
				continue
			}

			if (char === "\\") {
				current += char
				escaped = true
				continue
			}

			if (char === "'" && !inDoubleQuote) {
				inSingleQuote = !inSingleQuote
				current += char
				continue
			}

			if (char === '"' && !inSingleQuote) {
				inDoubleQuote = !inDoubleQuote
				current += char
				continue
			}

			// Only split outside quotes
			if (!inSingleQuote && !inDoubleQuote) {
				// && or ||
				if ((char === "&" && nextChar === "&") || (char === "|" && nextChar === "|")) {
					segments.push(current)
					current = ""
					i++ // Skip next char
					continue
				}

				// Single | (pipe)
				if (char === "|") {
					segments.push(current)
					current = ""
					continue
				}

				// Semicolon
				if (char === ";") {
					segments.push(current)
					current = ""
					continue
				}
			}

			current += char
		}

		if (current.trim()) {
			segments.push(current)
		}

		return segments
	}
}
