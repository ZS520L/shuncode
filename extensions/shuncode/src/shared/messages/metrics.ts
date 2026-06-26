import { Mode } from "../storage/types"

export interface ShuncodeMessageModelInfo {
	modelId: string
	providerId: string
	mode: Mode
}

interface ShuncodeTokensInfo {
	prompt: number // Total input tokens (includes cached + non-cached)
	completion: number // Total output tokens
	cached: number // Subset of prompt_tokens that were cache hits
}

export interface ShuncodeMessageMetricsInfo {
	tokens?: ShuncodeTokensInfo
	cost?: number // Monetary cost for this turn
}
