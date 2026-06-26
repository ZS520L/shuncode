/**
 * Post-Edit Diagnostics — checks for new errors introduced by an edit.
 *
 * After a file edit, waits briefly for language services to update,
 * then compares current diagnostics against pre-edit diagnostics.
 * If new errors appeared, they're returned as a warning string.
 */

import * as vscode from "vscode"

export interface DiagnosticDelta {
	newErrors: string[]
	newWarnings: string[]
}

/**
 * Get current error/warning diagnostics for a file.
 * Returns a simplified format for comparison.
 */
export function getFileDiagnostics(absolutePath: string): { errors: string[]; warnings: string[] } {
	const uri = vscode.Uri.file(absolutePath)
	const diagnostics = vscode.languages.getDiagnostics(uri)

	const errors: string[] = []
	const warnings: string[] = []

	for (const d of diagnostics) {
		const line = d.range.start.line + 1
		const msg = `L${line}: ${d.source ? `[${d.source}] ` : ""}${d.message}`
		if (d.severity === vscode.DiagnosticSeverity.Error) {
			errors.push(msg)
		} else if (d.severity === vscode.DiagnosticSeverity.Warning) {
			warnings.push(msg)
		}
	}

	return { errors, warnings }
}

/**
 * Compare pre-edit and post-edit diagnostics to find new issues.
 */
export function computeDiagnosticDelta(
	preEdit: { errors: string[]; warnings: string[] },
	postEdit: { errors: string[]; warnings: string[] },
): DiagnosticDelta {
	const preErrorSet = new Set(preEdit.errors)
	const preWarningSet = new Set(preEdit.warnings)

	const newErrors = postEdit.errors.filter((e) => !preErrorSet.has(e))
	const newWarnings = postEdit.warnings.filter((w) => !preWarningSet.has(w))

	return { newErrors, newWarnings }
}

/**
 * Wait for diagnostics to update after a file change.
 * Language servers need a brief moment to reprocess.
 */
export async function waitForDiagnosticsUpdate(ms: number = 300): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Format diagnostic delta as a string warning to append to tool result.
 * Returns empty string if no new issues.
 */
export function formatDiagnosticWarning(delta: DiagnosticDelta): string {
	if (delta.newErrors.length === 0 && delta.newWarnings.length === 0) {
		return ""
	}

	const parts: string[] = []

	if (delta.newErrors.length > 0) {
		parts.push(`⚠️ ${delta.newErrors.length} new error(s) introduced:`)
		// Show at most 5 errors to not overwhelm context
		const shown = delta.newErrors.slice(0, 5)
		for (const err of shown) {
			parts.push(`  ${err}`)
		}
		if (delta.newErrors.length > 5) {
			parts.push(`  ... and ${delta.newErrors.length - 5} more`)
		}
	}

	if (delta.newWarnings.length > 0) {
		parts.push(`⚡ ${delta.newWarnings.length} new warning(s):`)
		const shown = delta.newWarnings.slice(0, 3)
		for (const w of shown) {
			parts.push(`  ${w}`)
		}
		if (delta.newWarnings.length > 3) {
			parts.push(`  ... and ${delta.newWarnings.length - 3} more`)
		}
	}

	return "\n\n" + parts.join("\n")
}
