import * as path from "path"
import * as vscode from "vscode"
import type { ToolUse } from "@core/assistant-message"
import { resolveWorkspacePath } from "@core/workspace"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { formatResponse } from "@/core/prompts/responses"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

type LspUiTool = "goToDefinition" | "findReferences" | "getHover"

type LspLocation = {
	uri: vscode.Uri
	range: vscode.Range
}

const RESULT_LIMIT_DEFAULT = 50
const RESULT_LIMIT_MAX = 200
const HOVER_LIMIT = 6000

export class LspNavigationToolHandler implements IFullyManagedTool {
	constructor(
		readonly name: ShuncodeDefaultTool.GO_TO_DEFINITION | ShuncodeDefaultTool.FIND_REFERENCES | ShuncodeDefaultTool.GET_HOVER,
		private validator: ToolValidator,
	) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for ${block.params.path}:${block.params.line}:${block.params.character}]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const config = uiHelpers.getConfig()
		const relPath = block.params.path
		const labelPath = getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath))
		const partialMessage = JSON.stringify({
			tool: this.uiToolName(),
			path: labelPath,
			content: "",
			line: block.params.line,
			character: block.params.character,
			operationIsLocatedInWorkspace: relPath ? await isLocatedInWorkspace(relPath) : true,
		})

		await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const validation = this.validator.assertRequiredParams(block, "path", "line", "character")
		if (!validation.ok) {
			config.taskState.consecutiveMistakeCount++
			const missingParam = validation.error.includes("line") ? "line" : validation.error.includes("character") ? "character" : "path"
			return await config.callbacks.sayAndCreateMissingParamError(this.name, missingParam, block.params.path)
		}

		const relPath = block.params.path!
		const line = this.parsePositiveInteger(block.params.line, "line")
		const character = this.parsePositiveInteger(block.params.character, "character")
		if (typeof line === "string") return line
		if (typeof character === "string") return character

		const ignoreValidation = this.validator.checkShuncodeIgnorePath(relPath)
		if (!ignoreValidation.ok) return formatResponse.toolError(ignoreValidation.error)

		config.taskState.consecutiveMistakeCount = 0

		const pathResult = resolveWorkspacePath(config, relPath, "LspNavigationToolHandler.execute")
		const { absolutePath, displayPath } = typeof pathResult === "string" ? { absolutePath: pathResult, displayPath: relPath } : pathResult
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath))
		const position = new vscode.Position(line - 1, character - 1)

		let result: string
		if (this.name === ShuncodeDefaultTool.GO_TO_DEFINITION) {
			result = await this.goToDefinition(document, position, config.cwd)
		} else if (this.name === ShuncodeDefaultTool.FIND_REFERENCES) {
			const maxResults = this.parseResultLimit(block.params.max_results)
			const includeDeclaration = this.parseBoolean(block.params.include_declaration, true)
			result = await this.findReferences(document, position, config.cwd, includeDeclaration, maxResults)
		} else {
			result = await this.getHover(document, position)
		}

		const completeMessage = JSON.stringify({
			tool: this.uiToolName(),
			path: getReadablePath(config.cwd, displayPath),
			content: result,
			line,
			character,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		})

		await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
		await config.callbacks.say("tool", completeMessage, undefined, undefined, false)

		return result
	}

	private async goToDefinition(document: vscode.TextDocument, position: vscode.Position, cwd: string): Promise<string> {
		const definitions = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
			"vscode.executeDefinitionProvider",
			document.uri,
			position,
		)
		const locations = (definitions || []).map((item) => this.toLocation(item))
		return this.formatLocations("Definitions", locations, cwd)
	}

	private async findReferences(
		document: vscode.TextDocument,
		position: vscode.Position,
		cwd: string,
		includeDeclaration: boolean,
		maxResults: number,
	): Promise<string> {
		const references = await vscode.commands.executeCommand<vscode.Location[]>(
			"vscode.executeReferenceProvider",
			document.uri,
			position,
			{ includeDeclaration },
		)
		return this.formatLocations("References", (references || []).slice(0, maxResults), cwd, references?.length || 0, maxResults)
	}

	private async getHover(document: vscode.TextDocument, position: vscode.Position): Promise<string> {
		const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", document.uri, position)
		const contents = (hovers || [])
			.flatMap((hover) => hover.contents)
			.map((content) => this.hoverContentToString(content))
			.filter(Boolean)

		if (contents.length === 0) {
			return "No hover information found at the specified position."
		}

		const result = contents.join("\n\n---\n\n")
		return result.length > HOVER_LIMIT ? `${result.slice(0, HOVER_LIMIT)}\n\n[truncated]` : result
	}

	private async formatLocations(
		title: string,
		locations: LspLocation[],
		cwd: string,
		total = locations.length,
		limit = locations.length,
	): Promise<string> {
		if (locations.length === 0) {
			return `No ${title.toLowerCase()} found at the specified position.`
		}

		const lines: string[] = [`${title}: ${total}`]
		if (total > limit) lines.push(`Showing first ${limit}.`)

		for (let i = 0; i < locations.length; i++) {
			const loc = locations[i]
			const filePath = loc.uri.fsPath
			const relPath = path.relative(cwd, filePath) || filePath
			const line = loc.range.start.line + 1
			const character = loc.range.start.character + 1
			const preview = await this.getPreviewLine(loc.uri, loc.range.start.line)
			lines.push(`${i + 1}. ${relPath}:${line}:${character}${preview ? `\n   ${preview}` : ""}`)
		}

		return lines.join("\n")
	}

	private async getPreviewLine(uri: vscode.Uri, lineNumber: number): Promise<string> {
		try {
			const doc = await vscode.workspace.openTextDocument(uri)
			if (lineNumber < 0 || lineNumber >= doc.lineCount) return ""
			return doc.lineAt(lineNumber).text.trim().slice(0, 300)
		} catch {
			return ""
		}
	}

	private toLocation(item: vscode.Location | vscode.LocationLink): LspLocation {
		if ("targetUri" in item) {
			return { uri: item.targetUri, range: item.targetSelectionRange || item.targetRange }
		}
		return { uri: item.uri, range: item.range }
	}

	private hoverContentToString(content: vscode.MarkedString | vscode.MarkdownString): string {
		if (typeof content === "string") return content
		return content.value
	}
	private parsePositiveInteger(value: string | undefined, name: string): number | string {
		const parsed = Number(value)
		if (!Number.isInteger(parsed) || parsed < 1) {
			return formatResponse.toolError(`${name} must be a positive 1-based integer.`)
		}
		return parsed
	}

	private parseResultLimit(value: string | undefined): number {
		const parsed = Number(value)
		if (!Number.isInteger(parsed) || parsed < 1) return RESULT_LIMIT_DEFAULT
		return Math.min(parsed, RESULT_LIMIT_MAX)
	}

	private parseBoolean(value: string | undefined, fallback: boolean): boolean {
		if (value === undefined) return fallback
		return String(value).trim().toLowerCase() !== "false"
	}

	private uiToolName(): LspUiTool {
		if (this.name === ShuncodeDefaultTool.GO_TO_DEFINITION) return "goToDefinition"
		if (this.name === ShuncodeDefaultTool.FIND_REFERENCES) return "findReferences"
		return "getHover"
	}
}

