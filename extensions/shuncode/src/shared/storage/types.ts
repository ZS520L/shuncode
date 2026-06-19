export type OpenaiReasoningEffort = "low" | "medium" | "high" | "xhigh"

export type Mode = "plan" | "act" | "ask" | "debug" | "chat"

/**
 * Map a Mode to its API-settings key.
 * ask → plan (read-only, same model settings)
 * debug → act (full access, same model settings)
 */
export function getApiSettingsMode(mode: Mode): "plan" | "act" {
	return mode === "plan" || mode === "ask" || mode === "chat" ? "plan" : "act"
}

/** Returns true for modes that are read-only (no file writes, no commands). */
export function isReadOnlyMode(mode: Mode): boolean {
	return mode === "plan" || mode === "ask" || mode === "chat"
}
