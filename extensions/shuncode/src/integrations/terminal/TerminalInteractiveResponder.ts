/**
 * TerminalInteractiveResponder - Detects interactive prompts in terminal output
 * and automatically sends appropriate responses via stdin.
 *
 * Supports common patterns:
 * - Y/N confirmations: "Continue? [Y/n]", "Are you sure? (y/N)", "Proceed? [yes/no]"
 * - Package manager prompts: "Do you want to continue? [Y/n]"
 * - Overwrite prompts: "Overwrite file? [y/N]"
 *
 * Does NOT auto-respond to:
 * - Password/passphrase prompts
 * - Prompts requiring specific text input (not y/n)
 * - Prompts that appear destructive when default is "no"
 */

import { Logger } from "@/shared/services/Logger"

export interface PromptDetectionResult {
	detected: boolean
	response?: string
	promptType?: "confirmation" | "password" | "input" | "unknown"
	matchedPattern?: string
}

/**
 * Configuration for the interactive responder
 */
export interface InteractiveResponderConfig {
	/** Whether auto-responding is enabled */
	enabled: boolean
	/** Whether to auto-respond even when the default is "no" (destructive prompts) */
	respondToDestructivePrompts: boolean
}

// Patterns that indicate a Y/N confirmation prompt
// Each entry: [regex, defaultIsYes, description]
const CONFIRMATION_PATTERNS: Array<[RegExp, boolean, string]> = [
	// Explicit [Y/n] format (default is Yes)
	[/\[Y\/n\]\s*:?\s*$/i, true, "[Y/n] prompt"],
	[/\(Y\/n\)\s*:?\s*$/i, true, "(Y/n) prompt"],

	// Explicit [y/N] format (default is No - destructive)
	[/\[y\/N\]\s*:?\s*$/i, false, "[y/N] prompt"],
	[/\(y\/N\)\s*:?\s*$/i, false, "(y/N) prompt"],

	// Generic [yes/no] format
	[/\[yes\/no\]\s*:?\s*$/i, true, "[yes/no] prompt"],
	[/\(yes\/no\)\s*:?\s*$/i, true, "(yes/no) prompt"],

	// "Do you want to continue?" style (common in apt, npm, etc.)
	[/do you (?:want|wish) to continue\??\s*(?:\[Y\/n\])?\s*$/i, true, "continue prompt"],
	[/would you like to (?:continue|proceed)\??\s*$/i, true, "continue prompt"],

	// "Are you sure?" style
	[/are you sure\??\s*(?:\[y\/N\])?\s*$/i, false, "are you sure prompt"],
	[/are you sure you want to (?:continue|proceed)\??\s*$/i, false, "are you sure prompt"],

	// "Proceed?" style
	[/proceed\??\s*(?:\[Y\/n\])?\s*$/i, true, "proceed prompt"],

	// npm specific
	[/is this ok\?\s*\(yes\)\s*$/i, true, "npm ok prompt"],
	[/ok to proceed\?\s*\(yes\)\s*$/i, true, "npm proceed prompt"],

	// pip specific
	[/proceed\s*\(Y\/n\)\??\s*$/i, true, "pip proceed prompt"],

	// git specific
	[/continue connecting\s*\(yes\/no(?:\/\[fingerprint\])?\)\?\s*$/i, true, "git ssh prompt"],

	// Generic "? (y/n)" at end of line
	[/\?\s*\(y\/n\)\s*:?\s*$/i, true, "generic y/n prompt"],
	[/\?\s*\[y\/n\]\s*:?\s*$/i, true, "generic y/n prompt"],

	// Press Enter or Y to continue
	[/press (?:enter|y) to continue/i, true, "press to continue"],

	// "Type 'yes' to continue"
	[/type\s+['"]?yes['"]?\s+to\s+(?:continue|confirm|proceed)/i, true, "type yes prompt"],
]

// Patterns that indicate a password/passphrase prompt (NEVER auto-respond)
const PASSWORD_PATTERNS: RegExp[] = [
	/password\s*:/i,
	/passphrase\s*:/i,
	/enter\s+(?:your\s+)?password/i,
	/enter\s+(?:your\s+)?passphrase/i,
	/sudo.*password/i,
	/token\s*:/i,
	/secret\s*:/i,
	/api[_\s]?key\s*:/i,
]

// Patterns that indicate a generic text input prompt (don't auto-respond)
const INPUT_PATTERNS: RegExp[] = [
	/enter\s+(?:a\s+)?(?:name|value|path|url|email|username)/i,
	/what\s+(?:is|should)\s+/i,
	/please\s+(?:enter|provide|specify)/i,
	/type\s+(?:a|the|your)\s+/i,
]

export class TerminalInteractiveResponder {
	private config: InteractiveResponderConfig
	// Track recently auto-responded prompts to avoid double-responding
	private recentResponses: Map<string, number> = new Map()
	private readonly RESPONSE_COOLDOWN_MS = 2000

	constructor(config: InteractiveResponderConfig) {
		this.config = config
	}

	/**
	 * Update configuration at runtime (e.g., when settings change)
	 */
	updateConfig(config: Partial<InteractiveResponderConfig>): void {
		this.config = { ...this.config, ...config }
	}

	/**
	 * Analyze a line of terminal output to determine if it's an interactive prompt
	 * that should receive an automatic response.
	 *
	 * @param line The terminal output line to analyze
	 * @returns Detection result with the response to send (if any)
	 */
	detectPrompt(line: string): PromptDetectionResult {
		if (!this.config.enabled) {
			return { detected: false }
		}

		const trimmedLine = line.trim()
		if (!trimmedLine) {
			return { detected: false }
		}

		// Check for password prompts first (NEVER auto-respond)
		for (const pattern of PASSWORD_PATTERNS) {
			if (pattern.test(trimmedLine)) {
				return {
					detected: true,
					promptType: "password",
					matchedPattern: pattern.source,
				}
			}
		}

		// Check for generic text input prompts (don't auto-respond)
		for (const pattern of INPUT_PATTERNS) {
			if (pattern.test(trimmedLine)) {
				return {
					detected: true,
					promptType: "input",
					matchedPattern: pattern.source,
				}
			}
		}

		// Check for Y/N confirmation prompts
		for (const [pattern, defaultIsYes, description] of CONFIRMATION_PATTERNS) {
			if (pattern.test(trimmedLine)) {
				// Check cooldown to prevent double-responding
				const key = `${description}:${trimmedLine.slice(0, 50)}`
				const lastResponse = this.recentResponses.get(key)
				if (lastResponse && Date.now() - lastResponse < this.RESPONSE_COOLDOWN_MS) {
					return { detected: false }
				}

				// If default is "no" (destructive prompt), check config
				if (!defaultIsYes && !this.config.respondToDestructivePrompts) {
					Logger.info(`[InteractiveResponder] Skipping destructive prompt: "${trimmedLine}"`)
					return {
						detected: true,
						promptType: "confirmation",
						matchedPattern: description,
						// No response - let user handle it
					}
				}

				// Determine appropriate response
				let response: string
				if (/type\s+['"]?yes['"]?\s+to/i.test(trimmedLine)) {
					response = "yes"
				} else {
					response = "y"
				}

				// Record this response
				this.recentResponses.set(key, Date.now())
				this.cleanOldResponses()

				Logger.info(`[InteractiveResponder] Auto-responding "${response}" to prompt: "${trimmedLine}" (${description})`)

				return {
					detected: true,
					response,
					promptType: "confirmation",
					matchedPattern: description,
				}
			}
		}

		return { detected: false }
	}

	/**
	 * Check if the buffer (incomplete line) looks like it might be a prompt.
	 * This handles cases where prompts don't end with a newline.
	 *
	 * @param buffer The current incomplete output buffer
	 * @returns Detection result
	 */
	detectPromptInBuffer(buffer: string): PromptDetectionResult {
		if (!this.config.enabled || !buffer.trim()) {
			return { detected: false }
		}

		// Only check buffer if it hasn't changed for a bit (handled by caller via timeout)
		return this.detectPrompt(buffer)
	}

	/**
	 * Clean expired entries from the recent responses map
	 */
	private cleanOldResponses(): void {
		const now = Date.now()
		for (const [key, timestamp] of this.recentResponses) {
			if (now - timestamp > this.RESPONSE_COOLDOWN_MS * 2) {
				this.recentResponses.delete(key)
			}
		}
	}
}
