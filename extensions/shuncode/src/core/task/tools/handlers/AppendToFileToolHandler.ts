import path from "node:path"
import * as vscode from "vscode"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { getWorkspaceBasename, resolveWorkspacePath } from "@core/workspace"
import { ShuncodeSayTool } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { getDiffSystem } from "@/core/diff-v2"

/**
 * AppendToFileToolHandler: Appends content to the end of a file.
 * If the file doesn't exist, creates it with the provided content.
 * Designed for writing large files in multiple chunks.
 */
export class AppendToFileToolHandler implements IFullyManagedTool {
	readonly name = ShuncodeDefaultTool.FILE_APPEND

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[append_to_file for '${block.params.path || block.params.absolutePath}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path || block.params.absolutePath
		if (!relPath) return

		const config = uiHelpers.getConfig()
		const readablePath = getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath))
		const isInWorkspace = await isLocatedInWorkspace(relPath)

		const raw = block.params.content
		if (!raw) return

		const cleaned = uiHelpers.removeClosingTag(block, "content", raw)
		const lines = cleaned.split('\n')
		const maxLines = 800
		const previewContent = lines.slice(0, maxLines).join('\n')

		const msg: ShuncodeSayTool = {
			tool: "newFileCreated",
			path: readablePath,
			content: `[APPEND]\n${previewContent}`,
			operationIsLocatedInWorkspace: isInWorkspace,
		}

		await uiHelpers.say("tool", JSON.stringify(msg), undefined, undefined, block.partial)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const rawRelPath = block.params.path || block.params.absolutePath
		const rawContent = block.params.content

		if (!rawRelPath) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "path")
		}

		if (!rawContent) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "content")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Resolve path
		const pathResult = resolveWorkspacePath(config, rawRelPath, "AppendToFileToolHandler.execute")
		const { absolutePath, resolvedPath } = typeof pathResult === "string"
			? { absolutePath: pathResult, resolvedPath: rawRelPath }
			: { absolutePath: pathResult.absolutePath, resolvedPath: pathResult.resolvedPath }

		// Check shuncodeignore
		const accessValidation = this.validator.checkShuncodeIgnorePath(resolvedPath)
		if (!accessValidation.ok) {
			await config.callbacks.say("shuncodeignore_error", resolvedPath)
			return formatResponse.toolError(formatResponse.shuncodeIgnoreError(resolvedPath))
		}

		const fileExists = await fileExistsAtPath(absolutePath)
		let existingContent = ""

		if (fileExists) {
			const doc = await vscode.workspace.openTextDocument(absolutePath)
			existingContent = doc.getText()
		}

		// Append content
		const appendContent = rawContent
		const newContent = fileExists
			? (existingContent.endsWith('\n') ? existingContent + appendContent : existingContent + '\n' + appendContent)
			: appendContent

		try {
			const diffSystem = getDiffSystem()

			if (!fileExists) {
				// Create new file
				const dir = path.dirname(absolutePath)
				await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir))
				await vscode.workspace.fs.writeFile(vscode.Uri.file(absolutePath), Buffer.from(""))

				const newLines = newContent.split('\n')
				await diffSystem.addLines(absolutePath, 0, newLines)
			} else {
				// Append to existing file: add lines after the last line
				const existingLines = existingContent.split('\n')
				const appendLines = appendContent.split('\n')

				// If existing content doesn't end with newline, we need to handle the join
				if (!existingContent.endsWith('\n') && existingContent.length > 0) {
					// Add a newline separator then append
					await diffSystem.addLines(absolutePath, existingLines.length, appendLines)
				} else {
					await diffSystem.addLines(absolutePath, existingLines.length - (existingContent.endsWith('\n') ? 1 : 0), appendLines)
				}
			}

			// Open document to register it
			await vscode.workspace.openTextDocument(absolutePath)

		} catch (error) {
			// Fallback: direct file write
			console.error('[AppendToFileToolHandler] DiffSystem error, falling back to direct write:', error)
			await vscode.workspace.fs.writeFile(vscode.Uri.file(absolutePath), Buffer.from(newContent))
		}

		// Show in chat
		const readablePath = getReadablePath(config.cwd, resolvedPath)
		const isInWorkspace = await isLocatedInWorkspace(resolvedPath)

		await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")

		const appendedLines = appendContent.split('\n').length
		const totalLines = newContent.split('\n').length

		const msg: ShuncodeSayTool = {
			tool: fileExists ? "editedExistingFile" : "newFileCreated",
			path: readablePath,
			content: `[APPEND +${appendedLines} lines, total: ${totalLines} lines]\n${appendContent.slice(0, 2000)}${appendContent.length > 2000 ? '\n...(truncated)' : ''}`,
			operationIsLocatedInWorkspace: isInWorkspace,
		}
		await config.callbacks.say("tool", JSON.stringify(msg), undefined, undefined, false)

		config.taskState.didEditFile = true
		config.services.fileContextTracker.markFileAsEditedByShuncode(resolvedPath)
		await config.services.fileContextTracker.trackFileContext(resolvedPath, "shuncode_edited")

		return formatResponse.fileEditWithoutUserChanges(
			resolvedPath,
			"",
			newContent,
			`Successfully appended ${appendedLines} lines to ${resolvedPath}. File now has ${totalLines} lines total.`,
		)
	}
}
