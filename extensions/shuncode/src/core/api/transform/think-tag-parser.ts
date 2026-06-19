/**
 * Streaming parser for <think>...</think> and <thinking>...</thinking> tags.
 *
 * Some models (Qwen3, DeepSeek) output reasoning inside <think> or <thinking>
 * tags in delta.content instead of a separate reasoning_content field.
 * This parser extracts that content and routes it to reasoning chunks.
 *
 * Handles tags split across multiple stream chunks.
 */
export class ThinkTagStreamParser {
	private buffer = ""
	private inThinkBlock: boolean

	constructor(startInThinkBlock = false) {
		this.inThinkBlock = startInThinkBlock
	}

	process(content: string): { reasoning: string; text: string } {
		this.buffer += content
		let reasoning = ""
		let text = ""

		while (this.buffer.length > 0) {
			if (this.inThinkBlock) {
				const closeResult = this.findClosingTag(this.buffer)
				if (closeResult) {
					reasoning += this.buffer.slice(0, closeResult.start)
					this.buffer = this.buffer.slice(closeResult.end)
					this.inThinkBlock = false
				} else {
					// Keep potential partial closing tag suffix in buffer
					// Longest possible partial: "</thinking" (10 chars, missing ">")
					const partial = this.getPartialTagSuffix(this.buffer, "</thinking>")
					reasoning += this.buffer.slice(0, this.buffer.length - partial)
					this.buffer = this.buffer.slice(this.buffer.length - partial)
					break
				}
			} else {
				const openResult = this.findOpeningTag(this.buffer)
				if (openResult) {
					text += this.buffer.slice(0, openResult.start)
					this.buffer = this.buffer.slice(openResult.end)
					this.inThinkBlock = true
				} else {
					// Keep potential partial opening tag suffix in buffer
					// Longest possible partial: "<thinking" (9 chars, missing ">")
					const partial = this.getPartialTagSuffix(this.buffer, "<thinking>")
					text += this.buffer.slice(0, this.buffer.length - partial)
					this.buffer = this.buffer.slice(this.buffer.length - partial)
					break
				}
			}
		}

		return { reasoning, text }
	}

	/**
	 * Find complete closing tag: </think> or </thinking>
	 * Returns { start, end } of the full tag, or null if not found/incomplete.
	 */
	private findClosingTag(str: string): { start: number; end: number } | null {
		const idx = str.indexOf("</think")
		if (idx === -1) return null

		const after = str.slice(idx + 7) // after "</think"
		if (after.startsWith(">")) {
			return { start: idx, end: idx + 8 } // "</think>"
		}
		if (after.startsWith("ing>")) {
			return { start: idx, end: idx + 11 } // "</thinking>" = 11 chars
		}
		if (after.startsWith("ing") && !after.startsWith("ing>")) {
			return null // partial "</thinking" without ">"
		}
		if (after.length === 0 || after.startsWith("i") || after.startsWith("in")) {
			return null // partial, need more data
		}
		// Not a valid close tag (e.g. </thinker>), skip past it
		return { start: idx, end: idx + 7 }
	}

	/**
	 * Find complete opening tag: <think> or <thinking>
	 * Returns { start, end } of the full tag, or null if not found/incomplete.
	 */
	private findOpeningTag(str: string): { start: number; end: number } | null {
		const idx = str.indexOf("<think")
		if (idx === -1) return null

		const after = str.slice(idx + 6) // after "<think"
		if (after.startsWith(">")) {
			return { start: idx, end: idx + 7 } // "<think>"
		}
		if (after.startsWith("ing>")) {
			return { start: idx, end: idx + 10 } // "<thinking>"
		}
		if (after.length === 0 || after.startsWith("i") || after.startsWith("in") || after.startsWith("ing")) {
			return null // partial, need more data
		}
		// Not a valid open tag, skip past it
		return null
	}

	/** Returns how many chars at end of str could be the start of tag */
	private getPartialTagSuffix(str: string, tag: string): number {
		const maxCheck = Math.min(str.length, tag.length - 1)
		for (let i = maxCheck; i > 0; i--) {
			if (str.endsWith(tag.slice(0, i))) return i
		}
		return 0
	}
}
