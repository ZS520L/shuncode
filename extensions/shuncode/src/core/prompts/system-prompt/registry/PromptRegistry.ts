import { ModelFamily, MODEL_SESSION_LIMITS } from "@/shared/prompts"
import { Logger } from "@/shared/services/Logger"
import type { ShuncodeTool } from "@/shared/tools"
import { getModelCapabilityTier } from "@/utils/model-utils"
import { ShuncodeToolSet } from ".."
import { getSystemPromptComponents } from "../components"
import { registerShuncodeToolSets } from "../tools"
import type { ComponentFunction, ComponentRegistry, PromptVariant, SystemPromptContext } from "../types"
import { loadAllVariantConfigs } from "../variants"
import { PromptBuilder } from "./PromptBuilder"

export class PromptRegistry {
	private static instance: PromptRegistry
	private variants: Map<string, PromptVariant> = new Map()
	private components: ComponentRegistry = {}
	private loaded: boolean = false
	public nativeTools: ShuncodeTool[] | undefined = undefined

	private constructor() {
		registerShuncodeToolSets()
	}

	static getInstance(): PromptRegistry {
		if (!PromptRegistry.instance) {
			PromptRegistry.instance = new PromptRegistry()
		}
		return PromptRegistry.instance
	}

	/**
	 * Load all prompts and components on initialization
	 */
	async load(): Promise<void> {
		if (this.loaded) {
			return
		}

		await Promise.all([this.loadVariants(), this.loadComponents()])

		this.performHealthCheck()
		this.loaded = true
	}

	/**
	 * Perform health check to ensure registry is in a valid state
	 */
	private performHealthCheck(): void {
		if (this.variants.size === 0) {
			Logger.error("Registry health check failed: No variants loaded at all")
		}

		if (!this.variants.has(ModelFamily.NATIVE_NEXT_GEN)) {
			Logger.error("Registry health check failed: Universal variant not found")
		}

		if (Object.keys(this.components).length === 0) {
			Logger.warn("Registry health check warning: No components loaded")
		}

		Logger.log(
			`Registry health check: ${this.variants.size} variants, ${Object.keys(this.components).length} components loaded`,
		)
	}

	/**
	 * Get the model family — always returns the universal variant.
	 */
	getModelFamily(_context: SystemPromptContext) {
		return ModelFamily.NATIVE_NEXT_GEN
	}

	/**
	 * Get prompt using the universal variant
	 */
	async get(context: SystemPromptContext): Promise<string> {
		await this.load()

		const family = this.getModelFamily(context)
		const modelId = context.providerInfo?.model?.id ?? "unknown"
		const tier = getModelCapabilityTier(modelId, context.providerInfo)
		const tierLimits = MODEL_SESSION_LIMITS[tier]
		Logger.log(
			`[Prompt Profile] model="${modelId}" variant="${family}" tier="${tier}" ` +
			`limits={tools:${tierLimits.maxToolCallsPerTurn}, readOnly:${tierLimits.maxConsecutiveReadOnlyTools}, compact:${tierLimits.forceCompactAfterSteps}}`,
		)

		const variant = this.variants.get(family)

		if (!variant) {
			const availableVariants = Array.from(this.variants.keys())
			Logger.error("Prompt variant lookup failed:", {
				requestedModel: context.providerInfo.model.id,
				availableVariants,
				variantsCount: this.variants.size,
				isLoaded: this.loaded,
			})

			throw new Error(
				`Universal variant not found. Available variants: [${availableVariants.join(", ")}]. ` +
				`Registry state: loaded=${this.loaded}, variants=${this.variants.size}`,
			)
		}

		this.nativeTools = ShuncodeToolSet.getNativeTools(variant, context)

		const builder = new PromptBuilder(variant, context, this.components)
		return await builder.build()
	}

	/**
	 * Get specific version of a prompt
	 */
	async getVersion(
		_modelId: string,
		_version: number,
		context: SystemPromptContext,
		_isNextGenModelFamily?: boolean,
	): Promise<string> {
		// With single variant, always return the universal prompt
		return this.get(context)
	}

	/**
	 * Get prompt by tag/label
	 */
	async getByTag(
		_modelId: string,
		_tag?: string,
		_label?: string,
		context?: SystemPromptContext,
		_isNextGenModelFamily?: boolean,
	): Promise<string> {
		if (!context) {
			throw new Error("Context is required for prompt building")
		}
		// With single variant, always return the universal prompt
		return this.get(context)
	}

	/**
	 * Register a component function
	 */
	registerComponent(id: string, componentFn: ComponentFunction): void {
		this.components[id] = componentFn
	}

	/**
	 * Get list of available model IDs
	 */
	getAvailableModels(): string[] {
		return [ModelFamily.NATIVE_NEXT_GEN]
	}

	/**
	 * Get variant metadata
	 */
	getVariantMetadata(modelId: string): PromptVariant | undefined {
		return this.variants.get(modelId)
	}

	/**
	 * Load all variants from the variants directory
	 */
	private loadVariants(): void {
		try {
			this.variants = new Map<string, PromptVariant>()

			for (const [id, config] of Object.entries(loadAllVariantConfigs())) {
				this.variants.set(id, { ...config, id })
			}
		} catch (error) {
			Logger.error("Failed to load variants:", error)
		}
	}

	/**
	 * Load all components from the components directory
	 */
	private async loadComponents(): Promise<void> {
		try {
			const componentMappings = getSystemPromptComponents()

			for (const { id, fn } of componentMappings) {
				if (fn) {
					this.components[id] = fn
				}
			}
		} catch (error) {
			Logger.warn("Warning: Could not load some components:", error)
		}
	}

	public static dispose(): void {
		PromptRegistry.instance = null as unknown as PromptRegistry
	}
}
