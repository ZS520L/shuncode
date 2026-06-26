export enum ModelFamily {
	CLAUDE = "claude",
	GPT = "gpt",
	GPT_5 = "gpt-5",
	NATIVE_GPT_5 = "gpt-5-native", // Uses native tool calling
	NATIVE_GPT_5_1 = "gpt-5-1-native", // Uses native tool calling
	GEMINI = "gemini",
	GEMINI_3 = "gemini3", // Uses native tool calling
	QWEN = "qwen",
	GLM = "glm",
	HERMES = "hermes",
	DEVSTRAL = "devstral",
	NEXT_GEN = "next-gen",
	GENERIC = "generic",
	XS = "xs",
	NATIVE_NEXT_GEN = "native-next-gen", // Uses native tool calling
}

export type ModelCapabilityTier = "strong" | "medium" | "weak"

export interface WeakModelSessionLimits {
	maxToolCallsPerTurn: number
	maxConsecutiveReadOnlyTools: number
	forceCompactAfterSteps: number
	contextWindowUsageRatio: number
}

export const MODEL_SESSION_LIMITS: Record<ModelCapabilityTier, WeakModelSessionLimits> = {
	strong: {
		maxToolCallsPerTurn: Infinity,
		maxConsecutiveReadOnlyTools: Infinity,
		forceCompactAfterSteps: Infinity,
		contextWindowUsageRatio: 0.8,
	},
	medium: {
		maxToolCallsPerTurn: 40,
		maxConsecutiveReadOnlyTools: 8,
		forceCompactAfterSteps: 25,
		contextWindowUsageRatio: 0.65,
	},
	weak: {
		maxToolCallsPerTurn: 20,
		maxConsecutiveReadOnlyTools: 5,
		forceCompactAfterSteps: 12,
		contextWindowUsageRatio: 0.5,
	},
}
