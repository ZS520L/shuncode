/**
 * Variant Registry - Unified single variant for all models.
 *
 * All models use the same universal variant with native function calling.
 * Tool visibility is controlled by mode-based filtering and user customization settings.
 */

import { ModelFamily } from "@/shared/prompts"
import { config as universalConfig } from "./native-next-gen/config"

export { config as nativeNextGenConfig, type NativeNextGenVariantConfig } from "./native-next-gen/config"

/**
 * Variant Registry — single universal variant
 */
export const VARIANT_CONFIGS = {
	[ModelFamily.NATIVE_NEXT_GEN]: universalConfig,
} as const

/**
 * Type-safe variant identifier
 */
export type VariantId = keyof typeof VARIANT_CONFIGS

/**
 * Helper function to get all available variant IDs
 */
export function getAvailableVariants(): VariantId[] {
	return Object.keys(VARIANT_CONFIGS) as VariantId[]
}

/**
 * Helper function to check if a variant ID is valid
 */
export function isValidVariantId(id: string): id is VariantId {
	return id in VARIANT_CONFIGS
}

/**
 * Load a variant configuration dynamically
 */
export function loadVariantConfig(variantId: VariantId) {
	return VARIANT_CONFIGS[variantId]
}

/**
 * Load all variant configurations
 */
export function loadAllVariantConfigs() {
	return VARIANT_CONFIGS
}
