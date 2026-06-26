import type { ToolUse } from "@core/assistant-message"
import { SHUNCODE_MCP_TOOL_IDENTIFIER } from "@/shared/mcp"
import { ShuncodeDefaultTool, READ_ONLY_TOOLS } from "@/shared/tools"
import type { ToolResponse } from "../index"
import type { TaskConfig } from "./types/TaskConfig"
import type { StronglyTypedUIHelpers } from "./types/UIHelpers"

export interface IToolHandler {
	readonly name: ShuncodeDefaultTool
	/**
	 * Whether this tool is safe to execute concurrently with other tools.
	 * Read-only tools (no file/state mutation) should return true.
	 * Defaults to false if not implemented.
	 */
	readonly isConcurrencySafe?: boolean
	execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse>
	getDescription(block: ToolUse): string
}

export interface IPartialBlockHandler {
	handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void>
}

export interface IFullyManagedTool extends IToolHandler, IPartialBlockHandler {
	// Marker interface for tools that handle their own complete approval flow
}

/**
 * A wrapper class that allows a single tool handler to be registered under multiple names.
 * This provides proper typing for tools that share the same implementation logic.
 */
export class SharedToolHandler implements IFullyManagedTool {
	constructor(
		public readonly name: ShuncodeDefaultTool,
		private baseHandler: IFullyManagedTool,
	) { }

	getDescription(block: ToolUse): string {
		return this.baseHandler.getDescription(block)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		return this.baseHandler.execute(config, block)
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		return this.baseHandler.handlePartialBlock(block, uiHelpers)
	}
}

/**
 * Coordinates tool execution by routing to registered handlers.
 * Falls back to legacy switch for unregistered tools.
 */
export class ToolExecutorCoordinator {
	private handlers = new Map<string, IToolHandler>()

	/**
	 * Register a tool handler
	 */
	register(handler: IToolHandler): void {
		this.handlers.set(handler.name, handler)
	}

	/**
	 * Check if a handler is registered for the given tool
	 */
	has(toolName: string): boolean {
		return this.handlers.has(toolName)
	}

	/**
	 * Get a handler for the given tool name
	 */
	getHandler(toolName: string): IToolHandler | undefined {
		// HACK: Normalize MCP tool names to the standard handler
		if (toolName.includes(SHUNCODE_MCP_TOOL_IDENTIFIER)) {
			toolName = ShuncodeDefaultTool.MCP_USE
		}
		return this.handlers.get(toolName)
	}

	/**
	 * Execute a tool through its registered handler
	 */
	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const handler = this.handlers.get(block.name)
		if (!handler) {
			throw new Error(`No handler registered for tool: ${block.name}`)
		}
		return handler.execute(config, block)
	}

	/**
	 * Execute multiple tool blocks in parallel if they are all concurrency-safe.
	 * Falls back to sequential execution if any tool is not concurrency-safe.
	 * Returns results in the same order as the input blocks.
	 */
	async executeParallel(
		config: TaskConfig,
		blocks: ToolUse[],
	): Promise<{ block: ToolUse; result: ToolResponse }[]> {
		if (blocks.length === 0) {
			return []
		}

		if (blocks.length === 1) {
			const result = await this.execute(config, blocks[0])
			return [{ block: blocks[0], result }]
		}

		// Check if all blocks are concurrency-safe
		const allSafe = blocks.every((b) => {
			const handler = this.handlers.get(b.name)
			// Use explicit isConcurrencySafe flag, or fall back to READ_ONLY_TOOLS list
			return handler?.isConcurrencySafe ?? READ_ONLY_TOOLS.includes(b.name as any)
		})

		if (allSafe) {
			// Execute all in parallel
			const promises = blocks.map(async (block) => {
				const result = await this.execute(config, block)
				return { block, result }
			})
			return Promise.all(promises)
		}

		// Fallback: execute sequentially
		const results: { block: ToolUse; result: ToolResponse }[] = []
		for (const block of blocks) {
			const result = await this.execute(config, block)
			results.push({ block, result })
		}
		return results
	}

	/**
	 * Check if a given tool name is concurrency-safe.
	 */
	isConcurrencySafeForTool(toolName: string): boolean {
		const handler = this.handlers.get(toolName)
		return handler?.isConcurrencySafe ?? READ_ONLY_TOOLS.includes(toolName as any)
	}
}
