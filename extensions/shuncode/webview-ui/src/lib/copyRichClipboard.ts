function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
}

/**
 * Writes HTML + plain text to the clipboard (e.g. Word). Falls back to writeText(plain) if ClipboardItem fails.
 */
export async function writeRichHtmlFromRenderedRoot(
	root: HTMLElement | null | undefined,
	plainFallback: string,
): Promise<void> {
	const inner = root?.innerHTML?.trim() ?? ""
	const plainRaw = root?.innerText ?? ""
	const plain =
		plainRaw.replace(/\u00a0/g, " ").trim() || plainFallback.trim() || ""

	const htmlBody = inner
		? `<div class="shuncode-chat-copy">${inner}</div>`
		: `<p>${escapeHtml(plain)}</p>`

	const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${htmlBody}</body></html>`

	try {
		if (typeof ClipboardItem !== "undefined") {
			await navigator.clipboard.write([
				new ClipboardItem({
					"text/html": new Blob([html], { type: "text/html" }),
					"text/plain": new Blob([plain], { type: "text/plain" }),
				}),
			])
			return
		}
	} catch {
		// fall through
	}

	await navigator.clipboard.writeText(plain || plainFallback)
}
