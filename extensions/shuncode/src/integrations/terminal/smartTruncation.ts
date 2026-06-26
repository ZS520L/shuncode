/**
 * Smart Output Truncation for Command Results
 *
 * When command output exceeds the line limit, instead of naive head+tail split,
 * this module:
 * 1. Always preserves the TAIL (last N lines) — errors/results are typically at the end
 * 2. Extracts ERROR LINES from the head portion that would otherwise be lost
 * 3. Provides a concise summary header with total line count and error count
 *
 * This ensures the AI sees the most actionable information even when output is huge.
 */

// Patterns that indicate error/warning/failure lines worth preserving
const ERROR_PATTERNS = [
	/\berror\b/i,
	/\bfailed\b/i,
	/\bfailure\b/i,
	/\bERROR\b/,
	/\bFAIL\b/,
	/\bException\b/,
	/\bTraceback\b/,
	/\bpanic\b/,
	/\bfatal\b/i,
	/\bsegfault\b/i,
	/^\s*at\s+/,  // stack trace lines
	/\bTS\d{4,5}\b/, // TypeScript errors (e.g. TS2345)
	/\b[A-Z]\d{4}\b/, // Common error codes (E0001, C4996)
	/\bwarning\b/i,
	/\bWARN\b/,
	/\bdeprecated\b/i,
	/not found/i,
	/permission denied/i,
	/cannot find/i,
	/no such file/i,
]

// Lines that look like errors but aren't (false positives to skip)
const FALSE_POSITIVE_PATTERNS = [
	/error.*=.*0/i,  // "errors = 0", "error count: 0"
	/0 errors?/i,    // "0 errors"
	/no errors/i,
	/error handling/i,
	/error\.ts/i,    // filenames containing "error"
	/on-error/i,
]

/**
 * Check if a line matches error patterns (and is not a false positive).
 */
function isErrorLine(line: string): boolean {
	if (FALSE_POSITIVE_PATTERNS.some((p) => p.test(line))) {
		return false
	}
	return ERROR_PATTERNS.some((p) => p.test(line))
}

export interface SmartTruncationResult {
	output: string
	totalLines: number
	errorLinesFound: number
	wasTruncated: boolean
}

/**
 * Smart truncation: tail-biased with error extraction from discarded head.
 *
 * Strategy:
 * - Keep last `tailLines` lines (where results/errors typically appear)
 * - Keep first `headLines` lines (often has the command echo + initial context)
 * - From the discarded middle, extract up to `maxErrorLines` error/warning lines
 * - Produce a summary header
 *
 * @param outputLines All output lines
 * @param limit Total line budget (default 500)
 * @returns Formatted output string with summary
 */
export function smartTruncateOutput(
	outputLines: string[],
	limit: number = 500,
): SmartTruncationResult {
	const totalLines = outputLines.length

	if (totalLines <= limit) {
		return {
			output: outputLines.join("\n").trim(),
			totalLines,
			errorLinesFound: 0,
			wasTruncated: false,
		}
	}

	// Allocate budget: 20% head, 70% tail, 10% error lines from middle
	const headLines = Math.floor(limit * 0.15)
	const tailLines = Math.floor(limit * 0.70)
	const maxErrorLines = Math.floor(limit * 0.15)

	const head = outputLines.slice(0, headLines)
	const tail = outputLines.slice(totalLines - tailLines)
	const middle = outputLines.slice(headLines, totalLines - tailLines)

	// Extract error lines from the discarded middle section
	const errorLines: { lineNum: number; content: string }[] = []
	for (let i = 0; i < middle.length && errorLines.length < maxErrorLines; i++) {
		if (isErrorLine(middle[i])) {
			errorLines.push({
				lineNum: headLines + i + 1,
				content: middle[i],
			})
		}
	}

	// Build the truncated output
	const parts: string[] = []

	// Summary header
	const skippedCount = totalLines - headLines - tailLines
	parts.push(`[Output: ${totalLines} lines total, showing ${headLines} head + ${tailLines} tail${errorLines.length > 0 ? ` + ${errorLines.length} error lines from middle` : ""}]`)
	parts.push("")

	// Head section
	parts.push(...head)

	// Error lines from middle (if any)
	if (errorLines.length > 0) {
		parts.push("")
		parts.push(`--- ${errorLines.length} error/warning lines extracted from ${skippedCount} skipped lines ---`)
		for (const { lineNum, content } of errorLines) {
			parts.push(`L${lineNum}: ${content}`)
		}
	}

	// Separator
	parts.push("")
	parts.push(`... (${skippedCount - errorLines.length} lines omitted) ...`)
	parts.push("")

	// Tail section (most important — where results are)
	parts.push(...tail)

	return {
		output: parts.join("\n").trim(),
		totalLines,
		errorLinesFound: errorLines.length,
		wasTruncated: true,
	}
}
