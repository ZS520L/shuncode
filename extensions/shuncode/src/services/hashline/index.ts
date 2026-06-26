/**
 * Hashline: Content-hashed line anchoring for precise AI file editing.
 *
 * Every line gets a 2-character content hash. Edits reference hashes instead of
 * reproducing old text, preventing whitespace/formatting failures.
 *
 * Hash algorithm: FNV-1a on trimmed line content, folded to 1 byte → 2 hex chars.
 * Lines with only symbols (e.g. `}`, `//`) use line index as additional seed
 * to reduce collisions on structurally identical markers.
 */

// Custom alphabet: excludes hex digits, vowels, and visually ambiguous chars (D/G/I/L/O)
// This ensures hashes can never be confused with code, hex literals, or English words
const HASH_ALPHABET = "ZPMQVRWSNKTXJBYH"

/**
 * FNV-1a hash, 32-bit, folded to 8 bits → mapped to 2-char string.
 */
function fnv1aFolded(input: string, seed: number = 0): number {
	let hash = 2166136261 ^ seed
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}
	// XOR-fold 32 bits down to 8 bits
	const folded = ((hash >>> 24) ^ (hash >>> 16) ^ (hash >>> 8) ^ hash) & 0xff
	return folded
}

/**
 * Convert an 8-bit value to a 2-character hash using the custom alphabet.
 */
function byteToHash(byte: number): string {
	const hi = (byte >>> 4) & 0x0f
	const lo = byte & 0x0f
	return HASH_ALPHABET[hi] + HASH_ALPHABET[lo]
}

/**
 * Determine if a line is "symbol-only" (no alphanumeric chars).
 * These lines (like `}`, `{`, `//`) get line-number-seeded hashes to differentiate them.
 */
function isSymbolOnlyLine(line: string): boolean {
	return !/[a-zA-Z0-9]/.test(line)
}

/**
 * Compute the 2-char hash for a single line.
 * @param content - The raw line content
 * @param lineIndex - 0-based line index (used as seed for symbol-only lines)
 */
export function computeLineHash(content: string, lineIndex: number): string {
	const trimmed = content.trimEnd()
	const seed = isSymbolOnlyLine(trimmed) ? lineIndex : 0
	const byte = fnv1aFolded(trimmed, seed)
	return byteToHash(byte)
}

export interface HashlineLine {
	lineNumber: number // 1-indexed
	hash: string // 2-char hash
	content: string // original content
}

/**
 * Annotate file content with hashline references.
 * Output format: `LINE:HASH|content` (no padding after |, preserves original indentation)
 *
 * Example:
 *   1:SW|import { foo } from "./bar"
 *   2:KN|
 *   3:VR|export class MyClass {
 */
export function hashlineRead(fileContent: string): { lines: HashlineLine[]; annotated: string } {
	const rawLines = fileContent.split("\n")
	const lines: HashlineLine[] = rawLines.map((content, idx) => ({
		lineNumber: idx + 1,
		hash: computeLineHash(content, idx),
		content,
	}))

	const annotated = lines.map((l) => `${l.lineNumber}:${l.hash}|${l.content}`).join("\n")

	return { lines, annotated }
}

/**
 * Validate that a LINE:HASH reference matches the current file state.
 * Returns the matching line or an error description.
 */
export function validateAnchor(
	lines: HashlineLine[],
	lineNumber: number,
	hash: string,
): { valid: true; line: HashlineLine } | { valid: false; error: string; currentHash?: string } {
	if (lineNumber < 1 || lineNumber > lines.length) {
		return { valid: false, error: `Line ${lineNumber} is out of range (file has ${lines.length} lines)` }
	}

	const line = lines[lineNumber - 1]
	if (line.hash !== hash) {
		return {
			valid: false,
			error: `Hash mismatch at line ${lineNumber}: expected "${hash}", got "${line.hash}". File may have changed since last read.`,
			currentHash: line.hash,
		}
	}

	return { valid: true, line }
}

/**
 * Parse a hashline anchor reference string like "5:VR" or "10:KN".
 */
export function parseAnchorRef(ref: string): { lineNumber: number; hash: string } | null {
	const match = ref.match(/^(\d+):([A-Z]{2})$/)
	if (!match) return null
	return { lineNumber: parseInt(match[1], 10), hash: match[2] }
}

/**
 * Parse a range reference like "5:VR-10:KN" (start-end inclusive).
 */
export function parseRangeRef(rangeStr: string): {
	start: { lineNumber: number; hash: string }
	end: { lineNumber: number; hash: string }
} | null {
	const parts = rangeStr.split("-")
	if (parts.length !== 2) return null

	const start = parseAnchorRef(parts[0])
	const end = parseAnchorRef(parts[1])
	if (!start || !end) return null

	return { start, end }
}

export interface HashlineEdit {
	operation: "replace" | "insert_after" | "insert_before" | "delete"
	anchor: string // "LINE:HASH" for single, "LINE:HASH-LINE:HASH" for range
	content?: string // new content (not needed for delete)
}

export interface HashlineEditResult {
	success: boolean
	newContent?: string
	error?: string
	updatedAnchors?: string // fresh anchors for the changed region
}

/**
 * Apply a batch of hashline edits to file content.
 * All anchors are validated before any edit is applied (atomic).
 * Edits are applied bottom-up to preserve line numbers for earlier edits.
 */
export function applyHashlineEdits(fileContent: string, edits: HashlineEdit[]): HashlineEditResult {
	const { lines } = hashlineRead(fileContent)

	// Phase 1: Validate all anchors
	for (const edit of edits) {
		const rangeRef = parseRangeRef(edit.anchor)
		if (rangeRef) {
			const startValidation = validateAnchor(lines, rangeRef.start.lineNumber, rangeRef.start.hash)
			if (!startValidation.valid) {
				return { success: false, error: `Anchor validation failed: ${startValidation.error}` }
			}
			const endValidation = validateAnchor(lines, rangeRef.end.lineNumber, rangeRef.end.hash)
			if (!endValidation.valid) {
				return { success: false, error: `Anchor validation failed: ${endValidation.error}` }
			}
			if (rangeRef.start.lineNumber > rangeRef.end.lineNumber) {
				return { success: false, error: `Invalid range: start line ${rangeRef.start.lineNumber} > end line ${rangeRef.end.lineNumber}` }
			}
		} else {
			const singleRef = parseAnchorRef(edit.anchor)
			if (!singleRef) {
				return { success: false, error: `Invalid anchor format: "${edit.anchor}". Expected "LINE:HASH" or "LINE:HASH-LINE:HASH".` }
			}
			// For insert_before at line 0, skip validation (insert at file start)
			if (singleRef.lineNumber === 0 && edit.operation === "insert_before") {
				continue
			}
			const validation = validateAnchor(lines, singleRef.lineNumber, singleRef.hash)
			if (!validation.valid) {
				return { success: false, error: `Anchor validation failed: ${validation.error}` }
			}
		}
	}

	// Phase 2: Sort edits bottom-up (highest line first) to preserve line numbers
	const sortedEdits = [...edits].sort((a, b) => {
		const aLine = getEditLine(a)
		const bLine = getEditLine(b)
		return bLine - aLine
	})

	// Phase 3: Apply edits
	const resultLines = fileContent.split("\n")

	for (const edit of sortedEdits) {
		const rangeRef = parseRangeRef(edit.anchor)

		if (rangeRef) {
			// Range operation
			const startIdx = rangeRef.start.lineNumber - 1
			const endIdx = rangeRef.end.lineNumber - 1
			const count = endIdx - startIdx + 1

			switch (edit.operation) {
				case "replace": {
					const newLines = (edit.content ?? "").split("\n")
					resultLines.splice(startIdx, count, ...newLines)
					break
				}
				case "delete": {
					resultLines.splice(startIdx, count)
					break
				}
				default:
					return { success: false, error: `Operation "${edit.operation}" not supported for range anchors. Use "replace" or "delete".` }
			}
		} else {
			// Single line operation
			const ref = parseAnchorRef(edit.anchor)!
			const idx = ref.lineNumber - 1

			switch (edit.operation) {
				case "replace": {
					const newLines = (edit.content ?? "").split("\n")
					resultLines.splice(idx, 1, ...newLines)
					break
				}
				case "insert_after": {
					const newLines = (edit.content ?? "").split("\n")
					resultLines.splice(idx + 1, 0, ...newLines)
					break
				}
				case "insert_before": {
					const newLines = (edit.content ?? "").split("\n")
					const insertIdx = ref.lineNumber === 0 ? 0 : idx
					resultLines.splice(insertIdx, 0, ...newLines)
					break
				}
				case "delete": {
					resultLines.splice(idx, 1)
					break
				}
			}
		}
	}

	const newContent = resultLines.join("\n")

	// Generate updated anchors for the changed region
	const { annotated: updatedAnchors } = hashlineRead(newContent)

	return { success: true, newContent, updatedAnchors }
}

/**
 * Get the primary line number for an edit (used for sorting).
 */
function getEditLine(edit: HashlineEdit): number {
	const rangeRef = parseRangeRef(edit.anchor)
	if (rangeRef) return rangeRef.start.lineNumber
	const singleRef = parseAnchorRef(edit.anchor)
	return singleRef?.lineNumber ?? 0
}
