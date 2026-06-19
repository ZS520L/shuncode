import { Anthropic } from "@anthropic-ai/sdk"
import { formatResponse } from "@core/prompts/responses"

enum EditType {
	UNDEFINED = 0,
	NO_FILE_READ = 1,
	READ_FILE_TOOL = 2,
	ALTER_FILE_TOOL = 3,
	FILE_MENTION = 4,
}

type MessageContent = string[]
type MessageMetadata = string[][]
type ContextUpdate = [number, string, MessageContent, MessageMetadata]

type ContextHistoryMap = Map<number, [number, Map<number, ContextUpdate[]>]>

interface TextBlockAccessor {
	getTextFromBlock(block: Anthropic.Messages.ContentBlockParam): string | null
}

export class FileReadOptimizer {
	private accessor: TextBlockAccessor

	constructor(accessor: TextBlockAccessor) {
		this.accessor = accessor
	}

	applyContextOptimizations(
		apiMessages: Anthropic.Messages.MessageParam[],
		startFromIndex: number,
		timestamp: number,
		contextHistoryUpdates: ContextHistoryMap,
	): [boolean, Set<number>] {
		const [fileReadUpdatesBool, uniqueFileReadIndices] = this.findAndPotentiallySaveFileReadContextHistoryUpdates(
			apiMessages,
			startFromIndex,
			timestamp,
			contextHistoryUpdates,
		)
		return [fileReadUpdatesBool, uniqueFileReadIndices]
	}

	attemptFileReadOptimizationCore(
		apiConversationHistory: Anthropic.Messages.MessageParam[],
		conversationHistoryDeletedRange: [number, number] | undefined,
		timestamp: number,
		contextHistoryUpdates: ContextHistoryMap,
	): {
		anyContextUpdates: boolean
		needToTruncate: boolean
	} {
		const startIndex = conversationHistoryDeletedRange ? conversationHistoryDeletedRange[1] + 1 : 2

		const [anyContextUpdates, uniqueFileReadIndices] = this.applyContextOptimizations(
			apiConversationHistory,
			startIndex,
			timestamp,
			contextHistoryUpdates,
		)

		if (!anyContextUpdates) {
			return { anyContextUpdates: false, needToTruncate: true }
		}

		const percentSaved = this.calculateContextOptimizationMetrics(
			apiConversationHistory,
			conversationHistoryDeletedRange,
			uniqueFileReadIndices,
			contextHistoryUpdates,
		)

		return {
			anyContextUpdates: true,
			needToTruncate: percentSaved < 0.3,
		}
	}

	countCharactersAndSavingsInRange(
		apiMessages: Anthropic.Messages.MessageParam[],
		startIndex: number,
		endIndex: number,
		uniqueFileReadIndices: Set<number>,
		contextHistoryUpdates: ContextHistoryMap,
	): { totalCharacters: number; charactersSaved: number } {
		let totalCharCount = 0
		let totalCharactersSaved = 0

		for (let i = startIndex; i < endIndex; i++) {
			const message = apiMessages[i]

			if (!message.content) {
				continue
			}

			const hasExistingAlterations = contextHistoryUpdates.has(i)
			const hasNewAlterations = uniqueFileReadIndices.has(i)

			if (Array.isArray(message.content)) {
				for (let blockIndex = 0; blockIndex < message.content.length; blockIndex++) {
					const block = message.content[blockIndex]
					const blockText = this.accessor.getTextFromBlock(block)
					if (blockText) {
						if (hasExistingAlterations) {
							const innerTuple = contextHistoryUpdates.get(i)
							const updates = innerTuple?.[1].get(blockIndex)

							if (updates && updates.length > 0) {
								const latestUpdate = updates[updates.length - 1]

								if (hasNewAlterations) {
									let originalTextLength: number
									if (updates.length > 1) {
										originalTextLength = updates[updates.length - 2][2][0].length
									} else {
										originalTextLength = blockText.length
									}
									const newTextLength = latestUpdate[2][0].length
									totalCharactersSaved += originalTextLength - newTextLength
									totalCharCount += originalTextLength
								} else {
									totalCharCount += latestUpdate[2][0].length
								}
							} else {
								totalCharCount += blockText.length
							}
						} else {
							totalCharCount += blockText.length
						}
					} else if (block.type === "image" && block.source) {
						if (block.source.type === "base64" && block.source.data) {
							totalCharCount += block.source.data.length
						}
					}
				}
			}
		}

		return { totalCharacters: totalCharCount, charactersSaved: totalCharactersSaved }
	}

	calculateContextOptimizationMetrics(
		apiMessages: Anthropic.Messages.MessageParam[],
		conversationHistoryDeletedRange: [number, number] | undefined,
		uniqueFileReadIndices: Set<number>,
		contextHistoryUpdates: ContextHistoryMap,
	): number {
		const firstChunkResult = this.countCharactersAndSavingsInRange(
			apiMessages,
			0,
			2,
			uniqueFileReadIndices,
			contextHistoryUpdates,
		)
		const secondChunkResult = this.countCharactersAndSavingsInRange(
			apiMessages,
			conversationHistoryDeletedRange ? conversationHistoryDeletedRange[1] + 1 : 2,
			apiMessages.length,
			uniqueFileReadIndices,
			contextHistoryUpdates,
		)

		const totalCharacters = firstChunkResult.totalCharacters + secondChunkResult.totalCharacters
		const totalCharactersSaved = firstChunkResult.charactersSaved + secondChunkResult.charactersSaved

		return totalCharacters === 0 ? 0 : totalCharactersSaved / totalCharacters
	}

	private findAndPotentiallySaveFileReadContextHistoryUpdates(
		apiMessages: Anthropic.Messages.MessageParam[],
		startFromIndex: number,
		timestamp: number,
		contextHistoryUpdates: ContextHistoryMap,
	): [boolean, Set<number>] {
		const [fileReadIndices, messageFilePaths] = this.getPossibleDuplicateFileReads(
			apiMessages,
			startFromIndex,
			contextHistoryUpdates,
		)
		return this.applyFileReadContextHistoryUpdates(
			fileReadIndices,
			messageFilePaths,
			apiMessages,
			timestamp,
			contextHistoryUpdates,
		)
	}

	private getPossibleDuplicateFileReads(
		apiMessages: Anthropic.Messages.MessageParam[],
		startFromIndex: number,
		contextHistoryUpdates: ContextHistoryMap,
	): [Map<string, [number, number, string, string, number][]>, Map<number, string[]>] {
		const fileReadIndices = new Map<string, [number, number, string, string, number][]>()
		const messageFilePaths = new Map<number, string[]>()

		for (let i = startFromIndex; i < apiMessages.length; i++) {
			let thisExistingFileReads: string[] = []

			if (contextHistoryUpdates.has(i)) {
				const innerTuple = contextHistoryUpdates.get(i)

				if (innerTuple) {
					const editType = innerTuple[0]

					if (editType === EditType.FILE_MENTION) {
						const innerMap = innerTuple[1]
						const blockUpdates = innerMap.values().next().value

						if (blockUpdates && blockUpdates.length > 0) {
							if (
								blockUpdates[blockUpdates.length - 1][3][0].length ===
								blockUpdates[blockUpdates.length - 1][3][1].length
							) {
								continue
							} else {
								thisExistingFileReads = blockUpdates[blockUpdates.length - 1][3][0]
							}
						}
					} else {
						continue
					}
				}
			}

			const message = apiMessages[i]
			if (message.role === "user" && Array.isArray(message.content) && message.content.length > 0) {
				const firstBlock = message.content[0]
				const firstBlockText = this.accessor.getTextFromBlock(firstBlock)

				if (firstBlockText) {
					const result = this.parseToolCallWithFormat(firstBlockText)
					let foundNormalFileRead = false
					if (result) {
						const [toolName, filePath, contentBlockIndex, headerText] = result

						if (toolName === "read_file") {
							this.handleReadFileToolCall(i, filePath, fileReadIndices, contentBlockIndex, headerText)
							foundNormalFileRead = true
						} else if (toolName === "replace_in_file" || toolName === "write_to_file") {
							let blockText: string | undefined
							if (firstBlock.type === "tool_result") {
								blockText = firstBlockText
							} else if (contentBlockIndex === 0) {
								blockText = firstBlockText
							} else if (contentBlockIndex === 1 && message.content.length > 1) {
								const secondBlock = message.content[1]
								if (secondBlock.type === "text") {
									blockText = secondBlock.text
								}
							}

							if (blockText) {
								this.handlePotentialFileChangeToolCalls(
									i,
									filePath,
									blockText,
									fileReadIndices,
									contentBlockIndex,
								)
								foundNormalFileRead = true
							}
						}
					}

					if (!foundNormalFileRead) {
						for (const candidateIndex of [0, 1, 2]) {
							if (candidateIndex >= message.content.length) {
								break
							}

							const block = message.content[candidateIndex]
							const blockText = this.accessor.getTextFromBlock(block)
							if (blockText) {
								const [hasFileRead, filePaths] = this.handlePotentialFileMentionCalls(
									i,
									blockText,
									fileReadIndices,
									thisExistingFileReads,
									candidateIndex,
								)
								if (hasFileRead) {
									messageFilePaths.set(i, filePaths)
									break
								}
							}
						}
					}
				}
			}
		}

		return [fileReadIndices, messageFilePaths]
	}

	private handlePotentialFileMentionCalls(
		i: number,
		blockText: string,
		fileReadIndices: Map<string, [number, number, string, string, number][]>,
		thisExistingFileReads: string[],
		innerIndex: number,
	): [boolean, string[]] {
		const pattern = /<file_content path="([^"]*)">([\s\S]*?)<\/file_content>/g

		let foundMatch = false
		const filePaths: string[] = []

		for (const match of blockText.matchAll(pattern)) {
			foundMatch = true

			const filePath = match[1]
			filePaths.push(filePath)

			if (!thisExistingFileReads.includes(filePath)) {
				const entireMatch = match[0]
				const replacementText = `<file_content path="${filePath}">${formatResponse.duplicateFileReadNotice()}</file_content>`

				const indices = fileReadIndices.get(filePath) || []
				indices.push([i, EditType.FILE_MENTION, entireMatch, replacementText, innerIndex])
				fileReadIndices.set(filePath, indices)
			}
		}

		return [foundMatch, filePaths]
	}

	private parseToolCallWithFormat(text: string): [string, string, number, string] | null {
		const match = text.match(/^\[([^\s]+) for '([^']+)'\] Result:/)

		if (!match) {
			return null
		}

		const headerLength = match[0].length
		let contentBlockIndex = 1
		if (text.length > headerLength) {
			contentBlockIndex = 0
		}

		return [match[1], match[2], contentBlockIndex, match[0]]
	}

	private handleReadFileToolCall(
		i: number,
		filePath: string,
		fileReadIndices: Map<string, [number, number, string, string, number][]>,
		contentBlockIndex: number,
		headerText: string,
	) {
		const indices = fileReadIndices.get(filePath) || []

		if (contentBlockIndex === 1) {
			indices.push([i, EditType.READ_FILE_TOOL, "", formatResponse.duplicateFileReadNotice(), contentBlockIndex])
		} else {
			indices.push([
				i,
				EditType.READ_FILE_TOOL,
				"",
				headerText + "\n" + formatResponse.duplicateFileReadNotice(),
				contentBlockIndex,
			])
		}

		fileReadIndices.set(filePath, indices)
	}

	private handlePotentialFileChangeToolCalls(
		i: number,
		filePath: string,
		blockText: string,
		fileReadIndices: Map<string, [number, number, string, string, number][]>,
		contentBlockIndex: number,
	) {
		const pattern = /(<final_file_content path="[^"]*">)[\s\S]*?(<\/final_file_content>)/

		if (pattern.test(blockText)) {
			const replacementText = blockText.replace(pattern, `$1 ${formatResponse.duplicateFileReadNotice()} $2`)
			const indices = fileReadIndices.get(filePath) || []
			indices.push([i, EditType.ALTER_FILE_TOOL, "", replacementText, contentBlockIndex])
			fileReadIndices.set(filePath, indices)
		}
	}

	private applyFileReadContextHistoryUpdates(
		fileReadIndices: Map<string, [number, number, string, string, number][]>,
		messageFilePaths: Map<number, string[]>,
		apiMessages: Anthropic.Messages.MessageParam[],
		timestamp: number,
		contextHistoryUpdates: ContextHistoryMap,
	): [boolean, Set<number>] {
		let didUpdate = false
		const updatedMessageIndices = new Set<number>()
		const fileMentionUpdates = new Map<number, [string, string[], number]>()

		for (const [filePath, indices] of fileReadIndices.entries()) {
			if (indices.length > 1) {
				for (let i = 0; i < indices.length - 1; i++) {
					const messageIndex = indices[i][0]
					const messageType = indices[i][1]
					const searchText = indices[i][2]
					const messageString = indices[i][3]
					const innerIndex = indices[i][4]

					didUpdate = true
					updatedMessageIndices.add(messageIndex)

					if (messageType === EditType.FILE_MENTION) {
						if (!fileMentionUpdates.has(messageIndex)) {
							let baseText = ""
							let prevFilesReplaced: string[] = []

							const innerTuple = contextHistoryUpdates.get(messageIndex)
							if (innerTuple) {
								const blockUpdates = innerTuple[1].get(innerIndex)
								if (blockUpdates && blockUpdates.length > 0) {
									baseText = blockUpdates[blockUpdates.length - 1][2][0]
									prevFilesReplaced = blockUpdates[blockUpdates.length - 1][3][0]
								}
							}

							const messageContent = apiMessages[messageIndex]?.content
							if (!baseText && Array.isArray(messageContent) && messageContent.length > innerIndex) {
								const contentBlock = messageContent[innerIndex]
								const extractedText = this.accessor.getTextFromBlock(contentBlock)
								if (extractedText) {
									baseText = extractedText
								}
							}

							fileMentionUpdates.set(messageIndex, [baseText, prevFilesReplaced, innerIndex])
						}

						if (searchText) {
							const currentTuple = fileMentionUpdates.get(messageIndex) || ["", [], 0]
							if (currentTuple[0]) {
								const updatedText = currentTuple[0].replace(searchText, messageString)
								const updatedFileReads = currentTuple[1]
								updatedFileReads.push(filePath)
								fileMentionUpdates.set(messageIndex, [updatedText, updatedFileReads, currentTuple[2]])
							}
						}
					} else {
						const innerTuple = contextHistoryUpdates.get(messageIndex)
						let innerMap: Map<number, ContextUpdate[]>

						if (!innerTuple) {
							innerMap = new Map<number, ContextUpdate[]>()
							contextHistoryUpdates.set(messageIndex, [messageType, innerMap])
						} else {
							innerMap = innerTuple[1]
						}

						const blockIndex = innerIndex
						const updates = innerMap.get(blockIndex) || []
						updates.push([timestamp, "text", [messageString], []])
						innerMap.set(blockIndex, updates)
					}
				}
			}
		}

		for (const [messageIndex, [updatedText, filePathsUpdated, blockIndex]] of fileMentionUpdates.entries()) {
			const innerTuple = contextHistoryUpdates.get(messageIndex)
			let innerMap: Map<number, ContextUpdate[]>

			if (!innerTuple) {
				innerMap = new Map<number, ContextUpdate[]>()
				contextHistoryUpdates.set(messageIndex, [EditType.FILE_MENTION, innerMap])
			} else {
				innerMap = innerTuple[1]
			}

			const updates = innerMap.get(blockIndex) || []

			if (messageFilePaths.has(messageIndex)) {
				const allFileReads = messageFilePaths.get(messageIndex)
				if (allFileReads) {
					updates.push([timestamp, "text", [updatedText], [filePathsUpdated, allFileReads]])
					innerMap.set(blockIndex, updates)
				}
			}
		}

		return [didUpdate, updatedMessageIndices]
	}
}
