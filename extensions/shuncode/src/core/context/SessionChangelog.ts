import type { ShuncodeMessage } from "@shared/ExtensionMessage"

interface ChangelogEntry {
	timestamp: number
	action: string // "edited", "created", "deleted", "ran", "searched"
	target: string // file path or command
}

/**
 * Extract a compact changelog from the previous task's messages.
 * Returns last N actions as a brief summary for context between sessions.
 */
export function extractChangelog(
	previousTaskMessages: ShuncodeMessage[],
	maxEntries: number = 15,
): string {
	const entries: ChangelogEntry[] = []

	for (const msg of previousTaskMessages) {
		if (!msg.ts) {
			continue
		}

		if (msg.say === "tool" && msg.text) {
			try {
				const tool = JSON.parse(msg.text)
				if (tool.tool === "editedExistingFile" && tool.path) {
					entries.push({
						timestamp: msg.ts,
						action: "edited",
						target: tool.path,
					})
				} else if (tool.tool === "newFileCreated" && tool.path) {
					entries.push({
						timestamp: msg.ts,
						action: "created",
						target: tool.path,
					})
				} else if (tool.tool === "fileDeleted" && tool.path) {
					entries.push({
						timestamp: msg.ts,
						action: "deleted",
						target: tool.path,
					})
				} else if ((tool.tool === "searchFiles" || tool.tool === "codebaseSearch") && tool.path) {
					entries.push({
						timestamp: msg.ts,
						action: "searched",
						target: tool.path,
					})
				}
			} catch {
				// Ignore JSON parse errors
			}
		} else if (msg.say === "command" && msg.text) {
			entries.push({
				timestamp: msg.ts,
				action: "ran",
				target: msg.text.substring(0, 80),
			})
		}
	}

	if (entries.length === 0) {
		return ""
	}

	// Take last N entries, deduplicate consecutive same-file edits
	const deduped: ChangelogEntry[] = []
	for (const entry of entries) {
		const prev = deduped[deduped.length - 1]
		if (prev && prev.action === entry.action && prev.target === entry.target) {
			// Skip duplicate consecutive action on same target
			continue
		}
		deduped.push(entry)
	}

	const recent = deduped.slice(-maxEntries)

	const lines = recent.map((e) => {
		const time = new Date(e.timestamp).toLocaleTimeString("en-US", {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		})
		return `  ${time} ${e.action}: ${e.target}`
	})

	return `\n\n# Previous Session Actions\n${lines.join("\n")}`
}
