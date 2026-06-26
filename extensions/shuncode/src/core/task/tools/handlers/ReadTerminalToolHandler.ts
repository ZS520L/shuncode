import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import type { TerminalSnapshot } from "@/integrations/terminal/types"
import { ShuncodeDefaultTool } from "@/shared/tools"
import { truncateToolOutput } from "../utils/ToolConstants"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

const DEFAULT_OUTPUT_LINE_LIMIT = 500
const MAX_OUTPUT_LINE_LIMIT = 2000

export class ReadTerminalToolHandler implements IFullyManagedTool {
	readonly name = ShuncodeDefaultTool.READ_TERMINAL
	readonly isConcurrencySafe = true

	getDescription(block: ToolUse): string {
		const terminalId = block.params.terminal_id
		return terminalId ? `[${block.name} for terminal ${terminalId}]` : `[${block.name} for all terminals]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const partialMessage = JSON.stringify({
			tool: "readTerminal",
			terminalId: block.params.terminal_id || "all",
			content: "",
		})

		await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		config.taskState.consecutiveMistakeCount = 0

		const terminalId = this.parseTerminalId(block.params.terminal_id)
		if (block.params.terminal_id && terminalId === undefined) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError("Invalid terminal_id. Expected a numeric terminal id from a previous read_terminal result.")
		}

		const lineLimit = this.parseLineLimit(block.params.line_limit)
		const terminals = config.services.terminalManager.getTerminalSnapshots({ terminalId, lineLimit })

		let result: string
		if (terminals.length === 0) {
			result = terminalId === undefined ? "No ShunCode-managed terminals found." : `No ShunCode-managed terminal found with id ${terminalId}.`
		} else {
			result = terminals.map((terminal) => this.formatTerminal(terminal)).join("\n\n")
		}

		const completeMessage = JSON.stringify({
			tool: "readTerminal",
			terminalId: terminalId ?? "all",
			content: result,
		})

		await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await config.callbacks.say("tool", completeMessage, undefined, undefined, false)

		return truncateToolOutput(result)
	}

	private parseTerminalId(value: string | undefined): number | undefined {
		if (value === undefined || value === "") {
			return undefined
		}

		const parsed = Number(value)
		if (!Number.isInteger(parsed) || parsed < 0) {
			return undefined
		}

		return parsed
	}

	private parseLineLimit(value: string | undefined): number {
		if (value === undefined || value === "") {
			return DEFAULT_OUTPUT_LINE_LIMIT
		}

		const parsed = Number(value)
		if (!Number.isInteger(parsed) || parsed <= 0) {
			return DEFAULT_OUTPUT_LINE_LIMIT
		}

		return Math.min(parsed, MAX_OUTPUT_LINE_LIMIT)
	}

	private formatTerminal(terminal: TerminalSnapshot): string {
		const lines = [
			`# Terminal ${terminal.id}`,
			`Status: ${terminal.status}`,
			`Busy: ${terminal.busy ? "true" : "false"}`,
			`Hot: ${terminal.isHot ? "true" : "false"}`,
			`Command: ${terminal.lastCommand || "(none)"}`,
		]

		if (terminal.output) {
			lines.push(`Output (${terminal.outputLineCount} lines captured${terminal.outputTruncated ? ", truncated" : ""}):`)
			lines.push(terminal.output)
		} else {
			lines.push("Output: (no captured output)")
		}

		return lines.join("\n")
	}
}
