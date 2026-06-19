import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "@core/api"
import { formatResponse } from "@core/prompts/responses"
import { GlobalFileNames } from "@core/storage/disk"
import { ShuncodeApiReqInfo, ShuncodeMessage } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import cloneDeep from "clone-deep"
import fs from "fs/promises"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { getContextWindowInfo } from "./context-window-utils"
import { FileReadOptimizer } from "./FileReadOptimizer"

enum EditType {
	UNDEFINED = 0,
	NO_FILE_READ = 1,
	READ_FILE_TOOL = 2,
	ALTER_FILE_TOOL = 3,
	FILE_MENTION = 4,
}

// array of string values allows us to cover all changes for message types currently supported
type MessageContent = string[]
type MessageMetadata = string[][]

// Type for a single context update
type ContextUpdate = [number, string, MessageContent, MessageMetadata] // [timestamp, updateType, update, metadata]

// Type for the serialized format of our nested maps
type SerializedContextHistory = Array<
	[
		number, // messageIndex
		[
			number, // EditType (message type)
			Array<
				[
					number, // blockIndex
					ContextUpdate[], // updates array (now with 4 elements including metadata)
				]
			>,
		],
	]
>

export class ContextManager {
	// mapping from the apiMessages outer index to the inner message index to a list of actual changes, ordered by timestamp
	// timestamp is required in order to support full checkpointing, where the changes we apply need to be able to be undone when
	// moving to an earlier conversation history checkpoint - this ordering intuitively allows for binary search on truncation
	// there is also a number stored for each (EditType) which defines which message type it is, for custom handling

	// format:  { outerIndex => [EditType, { innerIndex => [[timestamp, updateType, update], ...] }] }
	// example: { 1 => { [0, 0 => [[<timestamp>, "text", "[NOTE] Some previous conversation history with the user has been removed ..."], ...] }] }
	// the above example would be how we update the first assistant message to indicate we truncated text
	private contextHistoryUpdates: Map<number, [number, Map<number, ContextUpdate[]>]>
	private fileReadOptimizer: FileReadOptimizer

	constructor() {
		this.contextHistoryUpdates = new Map()
		this.fileReadOptimizer = new FileReadOptimizer({
			getTextFromBlock: (block) => this.getTextFromBlock(block),
		})
	}

	/**
	 * Extracts text from a content block, handling both regular text blocks and tool_result wrappers.
	 * For tool_result blocks, extracts text from content[0] (native tool calling format).
	 * @returns The text content, or null if no text could be extracted
	 */
	private getTextFromBlock(block: Anthropic.Messages.ContentBlockParam): string | null {
		if (block.type === "text") {
			return block.text
		}
		if (block.type === "tool_result" && Array.isArray(block.content)) {
			const inner = block.content[0]
			if (inner && "type" in inner && inner.type === "text") {
				return inner.text
			}
		}
		return null
	}

	/**
	 * Sets text in a content block, handling both regular text blocks and tool_result wrappers.
	 * For tool_result blocks, sets text in content[0] (native tool calling format).
	 * @returns true if text was set successfully, false otherwise
	 */
	private setTextInBlock(block: Anthropic.Messages.ContentBlockParam, text: string): boolean {
		if (block.type === "text") {
			block.text = text
			return true
		}
		if (block.type === "tool_result" && Array.isArray(block.content)) {
			const inner = block.content[0]
			if (inner && "type" in inner && inner.type === "text") {
				inner.text = text
				return true
			}
		}
		return false
	}

	/**
	 * public function for loading contextHistoryUpdates from disk, if it exists
	 */
	async initializeContextHistory(taskDirectory: string) {
		this.contextHistoryUpdates = await this.getSavedContextHistory(taskDirectory)
	}

	/**
	 * get the stored context history updates from disk
	 */
	private async getSavedContextHistory(taskDirectory: string): Promise<Map<number, [number, Map<number, ContextUpdate[]>]>> {
		try {
			const filePath = path.join(taskDirectory, GlobalFileNames.contextHistory)
			if (await fileExistsAtPath(filePath)) {
				const data = await fs.readFile(filePath, "utf8")
				const serializedUpdates = JSON.parse(data) as SerializedContextHistory

				// Update to properly reconstruct the tuple structure
				return new Map(
					serializedUpdates.map(([messageIndex, [numberValue, innerMapArray]]) => [
						messageIndex,
						[numberValue, new Map(innerMapArray)],
					]),
				)
			}
		} catch (error) {
			Logger.error("Failed to load context history:", error)
		}
		return new Map()
	}

	/**
	 * save the context history updates to disk
	 */
	private async saveContextHistory(taskDirectory: string) {
		try {
			const serializedUpdates: SerializedContextHistory = Array.from(this.contextHistoryUpdates.entries()).map(
				([messageIndex, [numberValue, innerMap]]) => [messageIndex, [numberValue, Array.from(innerMap.entries())]],
			)

			await fs.writeFile(
				path.join(taskDirectory, GlobalFileNames.contextHistory),
				JSON.stringify(serializedUpdates),
				"utf8",
			)
		} catch (error) {
			Logger.error("Failed to save context history:", error)
		}
	}

	/**
	 * Determine whether we should compact context window, based on token counts
	 */
	shouldCompactContextWindow(
		shuncodeMessages: ShuncodeMessage[],
		api: ApiHandler,
		previousApiReqIndex: number,
		thresholdPercentage?: number,
	): boolean {
		if (previousApiReqIndex >= 0) {
			const previousRequest = shuncodeMessages[previousApiReqIndex]
			if (previousRequest && previousRequest.text) {
				const { tokensIn, tokensOut, cacheWrites, cacheReads }: ShuncodeApiReqInfo = JSON.parse(previousRequest.text)
				const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)

				const { contextWindow, maxAllowedSize } = getContextWindowInfo(api)
				const roundedThreshold = thresholdPercentage ? Math.floor(contextWindow * thresholdPercentage) : maxAllowedSize
				const thresholdTokens = Math.min(roundedThreshold, maxAllowedSize)
				return totalTokens >= thresholdTokens
			}
		}
		return false
	}

	/**
	 * Get telemetry data for context management decisions
	 * Returns the token counts and context window info that drove summarization
	 */
	getContextTelemetryData(
		shuncodeMessages: ShuncodeMessage[],
		api: ApiHandler,
		triggerIndex?: number,
	): {
		tokensUsed: number
		maxContextWindow: number
	} | null {
		// Use provided triggerIndex or fallback to automatic detection
		let targetIndex: number
		if (triggerIndex !== undefined) {
			targetIndex = triggerIndex
		} else {
			// Find all API request indices
			const apiReqIndices = shuncodeMessages
				.map((msg, index) => (msg.say === "api_req_started" ? index : -1))
				.filter((index) => index !== -1)

			// We want the second-to-last API request (the one that caused summarization)
			targetIndex = apiReqIndices.length >= 2 ? apiReqIndices[apiReqIndices.length - 2] : -1
		}

		if (targetIndex >= 0) {
			const targetRequest = shuncodeMessages[targetIndex]
			if (targetRequest && targetRequest.text) {
				try {
					const { tokensIn, tokensOut, cacheWrites, cacheReads }: ShuncodeApiReqInfo = JSON.parse(targetRequest.text)
					const tokensUsed = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)

					const { contextWindow } = getContextWindowInfo(api)

					return {
						tokensUsed,
						maxContextWindow: contextWindow,
					}
				} catch (error) {
					Logger.error("Error parsing API request info for context telemetry:", error)
				}
			}
		}
		return null
	}

	/**
	 * primary entry point for getting up to date context
	 */
	async getNewContextMessagesAndMetadata(
		apiConversationHistory: Anthropic.Messages.MessageParam[],
		shuncodeMessages: ShuncodeMessage[],
		api: ApiHandler,
		conversationHistoryDeletedRange: [number, number] | undefined,
		previousApiReqIndex: number,
		taskDirectory: string,
		useAutoCondense: boolean, // option to use new auto-condense or old programmatic context management
	) {
		let updatedConversationHistoryDeletedRange = false

		if (!useAutoCondense) {
			// If the previous API request's total token usage is close to the context window, truncate the conversation history to free up space for the new request
			if (previousApiReqIndex >= 0) {
				const previousRequest = shuncodeMessages[previousApiReqIndex]
				if (previousRequest && previousRequest.text) {
					const timestamp = previousRequest.ts
					const { tokensIn, tokensOut, cacheWrites, cacheReads }: ShuncodeApiReqInfo = JSON.parse(previousRequest.text)
					const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
					const { maxAllowedSize } = getContextWindowInfo(api)

					// This is the most reliable way to know when we're close to hitting the context window.
					if (totalTokens >= maxAllowedSize) {
						// Since the user may switch between models with different context windows, truncating half may not be enough (ie if switching from claude 200k to deepseek 64k, half truncation will only remove 100k tokens, but we need to remove much more)
						// So if totalTokens/2 is greater than maxAllowedSize, we truncate 3/4 instead of 1/2
						const keep = totalTokens / 2 > maxAllowedSize ? "quarter" : "half"

						// Attempt file read optimization and check if we need to truncate
						let { anyContextUpdates, needToTruncate } = this.attemptFileReadOptimizationCore(
							apiConversationHistory,
							conversationHistoryDeletedRange,
							timestamp,
						)

						if (needToTruncate) {
							// go ahead with truncation
							anyContextUpdates = this.applyStandardContextTruncationNoticeChange(timestamp) || anyContextUpdates

							// NOTE: it's okay that we overwriteConversationHistory in resume task since we're only ever removing the last user message and not anything in the middle which would affect this range
							conversationHistoryDeletedRange = this.getNextTruncationRange(
								apiConversationHistory,
								conversationHistoryDeletedRange,
								keep,
							)

							updatedConversationHistoryDeletedRange = true
						}

						// if we alter the context history, save the updated version to disk
						if (anyContextUpdates) {
							await this.saveContextHistory(taskDirectory)
						}
					}
				}
			}
		}

		const truncatedConversationHistory = this.getAndAlterTruncatedMessages(
			apiConversationHistory,
			conversationHistoryDeletedRange,
		)

		return {
			conversationHistoryDeletedRange: conversationHistoryDeletedRange,
			updatedConversationHistoryDeletedRange: updatedConversationHistoryDeletedRange,
			truncatedConversationHistory: truncatedConversationHistory,
		}
	}

	/**
	 * get truncation range
	 */
	public getNextTruncationRange(
		apiMessages: Anthropic.Messages.MessageParam[],
		currentDeletedRange: [number, number] | undefined,
		keep: "none" | "lastTwo" | "half" | "quarter",
	): [number, number] {
		// We always keep the first user-assistant pairing, and truncate an even number of messages from there
		const rangeStartIndex = 2 // index 0 and 1 are kept
		const startOfRest = currentDeletedRange ? currentDeletedRange[1] + 1 : 2 // inclusive starting index

		let messagesToRemove: number
		if (keep === "none") {
			// Removes all messages beyond the first core user/assistant message pair
			messagesToRemove = Math.max(apiMessages.length - startOfRest, 0)
		} else if (keep === "lastTwo") {
			// Keep the last user-assistant pair in addition to the first core user/assistant message pair
			messagesToRemove = Math.max(apiMessages.length - startOfRest - 2, 0)
		} else if (keep === "half") {
			// Remove half of remaining user-assistant pairs
			// We first calculate half of the messages then divide by 2 to get the number of pairs.
			// After flooring, we multiply by 2 to get the number of messages.
			// Note that this will also always be an even number.
			messagesToRemove = Math.floor((apiMessages.length - startOfRest) / 4) * 2 // Keep even number
		} else {
			// Remove 3/4 of remaining user-assistant pairs
			// We calculate 3/4ths of the messages then divide by 2 to get the number of pairs.
			// After flooring, we multiply by 2 to get the number of messages.
			// Note that this will also always be an even number.
			messagesToRemove = Math.floor(((apiMessages.length - startOfRest) * 3) / 4 / 2) * 2
		}

		let rangeEndIndex = startOfRest + messagesToRemove - 1 // inclusive ending index

		// Make sure that the last message being removed is a assistant message, so the next message after the initial user-assistant pair is an assistant message. This preserves the user-assistant-user-assistant structure.
		// NOTE: anthropic format messages are always user-assistant-user-assistant, while openai format messages can have multiple user messages in a row (we use anthropic format throughout shuncode)
		if (apiMessages[rangeEndIndex] && apiMessages[rangeEndIndex].role !== "assistant") {
			rangeEndIndex -= 1
		}

		// this is an inclusive range that will be removed from the conversation history
		return [rangeStartIndex, rangeEndIndex]
	}

	/**
	 * external interface to support old calls
	 */
	public getTruncatedMessages(
		messages: Anthropic.Messages.MessageParam[],
		deletedRange: [number, number] | undefined,
	): Anthropic.Messages.MessageParam[] {
		return this.getAndAlterTruncatedMessages(messages, deletedRange)
	}

	/**
	 * apply all required truncation methods to the messages in context
	 */
	private getAndAlterTruncatedMessages(
		messages: Anthropic.Messages.MessageParam[],
		deletedRange: [number, number] | undefined,
	): Anthropic.Messages.MessageParam[] {
		if (messages.length <= 1) {
			return messages
		}

		const updatedMessages = this.applyContextHistoryUpdates(messages, deletedRange ? deletedRange[1] + 1 : 2)

		// Validate and fix tool_use/tool_result pairing
		this.ensureToolResultsFollowToolUse(updatedMessages)

		// OLD NOTE: if you try to Logger log these, don't forget that logging a reference to an array may not provide the same result as logging a slice() snapshot of that array at that exact moment. The following DOES in fact include the latest assistant message.
		return updatedMessages
	}

	/**
	 * Ensures that every tool_use block in assistant messages has a corresponding tool_result in the next user message,
	 * and that tool_result blocks immediately follow their corresponding tool_use blocks
	 */
	private ensureToolResultsFollowToolUse(messages: Anthropic.Messages.MessageParam[]): void {
		for (let i = 0; i < messages.length - 1; i++) {
			const message = messages[i]

			// Only process assistant messages with content
			if (message.role !== "assistant" || !Array.isArray(message.content)) {
				continue
			}

			// Extract tool_use IDs in order
			const toolUseIds: string[] = []
			for (const block of message.content) {
				if (block.type === "tool_use" && block.id) {
					toolUseIds.push(block.id)
				}
			}

			// Skip if no tool_use blocks found
			if (toolUseIds.length === 0) {
				continue
			}

			const nextMessage = messages[i + 1]

			// Skip if next message is not a user message
			if (nextMessage.role !== "user") {
				continue
			}

			// Ensure content is an array
			if (!Array.isArray(nextMessage.content)) {
				nextMessage.content = []
			}

			// Separate tool_results from other blocks in a single pass
			const toolResultMap = new Map<string, Anthropic.Messages.ToolResultBlockParam>()
			const otherBlocks: Anthropic.Messages.ContentBlockParam[] = []
			let needsUpdate = false

			for (const block of nextMessage.content) {
				if (block.type === "tool_result" && block.tool_use_id) {
					toolResultMap.set(block.tool_use_id, block)
				} else {
					otherBlocks.push(block)
				}
			}

			// Check if reordering is needed (tool_results not at start in correct order)
			if (toolResultMap.size > 0) {
				let expectedIndex = 0
				for (let j = 0; j < nextMessage.content.length && expectedIndex < toolUseIds.length; j++) {
					const block = nextMessage.content[j]
					if (block.type === "tool_result" && block.tool_use_id === toolUseIds[expectedIndex]) {
						expectedIndex++
					} else if (block.type === "tool_result" || expectedIndex < toolUseIds.length) {
						needsUpdate = true
						break
					}
				}
				if (!needsUpdate && expectedIndex < toolResultMap.size) {
					needsUpdate = true
				}
			}

			// Add missing tool_results
			for (const toolUseId of toolUseIds) {
				if (!toolResultMap.has(toolUseId)) {
					toolResultMap.set(toolUseId, {
						type: "tool_result",
						tool_use_id: toolUseId,
						content: "result missing",
					})
					needsUpdate = true
				}
			}

			// Only modify if changes are needed
			if (!needsUpdate) {
				continue
			}

			// Build new content: tool_results first (in toolUseIds order), then other blocks
			const newContent: Anthropic.Messages.ContentBlockParam[] = []

			// Add tool_results in the order of toolUseIds
			const processedToolResults = new Set<string>()
			for (const toolUseId of toolUseIds) {
				const toolResult = toolResultMap.get(toolUseId)
				if (toolResult) {
					newContent.push(toolResult)
					processedToolResults.add(toolUseId)
				}
			}

			// Add all other blocks
			newContent.push(...otherBlocks)

			// Clone and update the message
			const clonedMessage = cloneDeep(nextMessage)
			clonedMessage.content = newContent
			messages[i + 1] = clonedMessage
		}
	}

	/**
	 * applies deletedRange truncation and other alterations based on changes in this.contextHistoryUpdates
	 */
	private applyContextHistoryUpdates(
		messages: Anthropic.Messages.MessageParam[],
		startFromIndex: number,
	): Anthropic.Messages.MessageParam[] {
		// runtime is linear in length of user messages, if expecting a limited number of alterations, could be more optimal to loop over alterations

		const firstChunk = messages.slice(0, 2) // get first user-assistant pair
		const secondChunk = messages.slice(startFromIndex) // get remaining messages within context
		const messagesToUpdate = [...firstChunk, ...secondChunk]

		// Remove orphaned tool_results from the first message after truncation (if it's a user message)
		if (startFromIndex > 2 && messagesToUpdate.length > 2) {
			const firstMessageAfterTruncation = messagesToUpdate[2]
			if (firstMessageAfterTruncation.role === "user" && Array.isArray(firstMessageAfterTruncation.content)) {
				const hasToolResults = firstMessageAfterTruncation.content.some((block) => block.type === "tool_result")
				if (hasToolResults) {
					// Clone and filter out all tool_result blocks
					messagesToUpdate[2] = cloneDeep(firstMessageAfterTruncation)
					;(messagesToUpdate[2].content as Anthropic.Messages.ContentBlockParam[]) = (
						firstMessageAfterTruncation.content as Anthropic.Messages.ContentBlockParam[]
					).filter((block) => block.type !== "tool_result")
				}
			}
		}

		// we need the mapping from the local indices in messagesToUpdate to the global array of updates in this.contextHistoryUpdates
		const originalIndices = [
			...Array(2).keys(),
			...Array(secondChunk.length)
				.fill(0)
				.map((_, i) => i + startFromIndex),
		]

		for (let arrayIndex = 0; arrayIndex < messagesToUpdate.length; arrayIndex++) {
			const messageIndex = originalIndices[arrayIndex]

			const innerTuple = this.contextHistoryUpdates.get(messageIndex)
			if (!innerTuple) {
				continue
			}

			// because we are altering this, we need a deep copy
			messagesToUpdate[arrayIndex] = cloneDeep(messagesToUpdate[arrayIndex])

			// Extract the map from the tuple
			const innerMap = innerTuple[1]
			for (const [blockIndex, changes] of innerMap) {
				// apply the latest change among n changes - [timestamp, updateType, update]
				const latestChange = changes[changes.length - 1]

				if (latestChange[1] === "text") {
					// only altering text for now
					const message = messagesToUpdate[arrayIndex]

					if (Array.isArray(message.content)) {
						const block = message.content[blockIndex]
						if (block) {
							this.setTextInBlock(block, latestChange[2][0])
						}
					}
				}
			}
		}

		return messagesToUpdate
	}

	/**
	 * removes all context history updates that occurred after the specified timestamp and saves to disk
	 */
	async truncateContextHistory(timestamp: number, taskDirectory: string): Promise<void> {
		this.truncateContextHistoryAtTimestamp(this.contextHistoryUpdates, timestamp)

		// save the modified context history to disk
		await this.saveContextHistory(taskDirectory)
	}

	/**
	 * alters the context history to remove all alterations after a given timestamp
	 * removes the index if there are no alterations there anymore, both outer and inner indices
	 */
	private truncateContextHistoryAtTimestamp(
		contextHistory: Map<number, [number, Map<number, ContextUpdate[]>]>,
		timestamp: number,
	): void {
		for (const [messageIndex, [_, innerMap]] of contextHistory) {
			// track which blockIndices to delete
			const blockIndicesToDelete: number[] = []

			// loop over the innerIndices of the messages in this block
			for (const [blockIndex, updates] of innerMap) {
				// updates ordered by timestamp, so find cutoff point by iterating from right to left
				let cutoffIndex = updates.length - 1
				while (cutoffIndex >= 0 && updates[cutoffIndex][0] > timestamp) {
					cutoffIndex--
				}

				// If we found updates to remove
				if (cutoffIndex < updates.length - 1) {
					// Modify the array in place to keep only updates up to cutoffIndex
					updates.length = cutoffIndex + 1

					// If no updates left after truncation, mark this block for deletion
					if (updates.length === 0) {
						blockIndicesToDelete.push(blockIndex)
					}
				}
			}

			// Remove empty blocks from inner map
			for (const blockIndex of blockIndicesToDelete) {
				innerMap.delete(blockIndex)
			}

			// If inner map is now empty, remove the message index from outer map
			if (innerMap.size === 0) {
				contextHistory.delete(messageIndex)
			}
		}
	}

	/**
	 * applies the context optimization steps and returns whether any changes were made
	 */
	public applyContextOptimizations(
		apiMessages: Anthropic.Messages.MessageParam[],
		startFromIndex: number,
		timestamp: number,
	): [boolean, Set<number>] {
		return this.fileReadOptimizer.applyContextOptimizations(
			apiMessages,
			startFromIndex,
			timestamp,
			this.contextHistoryUpdates,
		)
	}

	/**
	 * Private helper that attempts file read optimization and checks threshold.
	 */
	private attemptFileReadOptimizationCore(
		apiConversationHistory: Anthropic.Messages.MessageParam[],
		conversationHistoryDeletedRange: [number, number] | undefined,
		timestamp: number,
	): {
		anyContextUpdates: boolean
		needToTruncate: boolean
	} {
		return this.fileReadOptimizer.attemptFileReadOptimizationCore(
			apiConversationHistory,
			conversationHistoryDeletedRange,
			timestamp,
			this.contextHistoryUpdates,
		)
	}

	/**
	 * Public helper that attempts file read optimization and saves to disk.
	 */
	async attemptFileReadOptimization(
		apiConversationHistory: Anthropic.Messages.MessageParam[],
		conversationHistoryDeletedRange: [number, number] | undefined,
		shuncodeMessages: ShuncodeMessage[],
		previousApiReqIndex: number,
		taskDirectory: string,
	): Promise<boolean> {
		// Extract timestamp using same logic as getNewContextMessagesAndMetadata
		if (previousApiReqIndex < 0) {
			return true
		}

		const previousRequest = shuncodeMessages[previousApiReqIndex]
		if (!previousRequest || !previousRequest.text) {
			return true
		}

		const timestamp = previousRequest.ts

		const { anyContextUpdates, needToTruncate } = this.attemptFileReadOptimizationCore(
			apiConversationHistory,
			conversationHistoryDeletedRange,
			timestamp,
		)

		if (anyContextUpdates) {
			await this.saveContextHistory(taskDirectory)
		}

		return needToTruncate
	}

	/**
	 * Public function for triggering potentially setting the truncation message
	 * If the truncation message already exists, does nothing, otherwise adds the message
	 */
	async triggerApplyStandardContextTruncationNoticeChange(
		timestamp: number,
		taskDirectory: string,
		apiConversationHistory: Anthropic.Messages.MessageParam[],
	) {
		const assistantUpdated = this.applyStandardContextTruncationNoticeChange(timestamp)
		const userUpdated = this.applyFirstUserMessageReplacement(timestamp, apiConversationHistory)
		if (assistantUpdated || userUpdated) {
			await this.saveContextHistory(taskDirectory)
		}
	}

	/**
	 * if there is any truncation and there is no other alteration already set, alter the assistant message to indicate this occurred
	 */
	private applyStandardContextTruncationNoticeChange(timestamp: number): boolean {
		if (!this.contextHistoryUpdates.has(1)) {
			// first assistant message always at index 1
			const innerMap = new Map<number, ContextUpdate[]>()
			innerMap.set(0, [[timestamp, "text", [formatResponse.contextTruncationNotice()], []]])
			this.contextHistoryUpdates.set(1, [0, innerMap]) // EditType is undefined for first assistant message
			return true
		}
		return false
	}

	/**
	 * Replace the first user message when context window is compacted
	 */
	private applyFirstUserMessageReplacement(
		timestamp: number,
		apiConversationHistory: Anthropic.Messages.MessageParam[],
	): boolean {
		if (!this.contextHistoryUpdates.has(0)) {
			try {
				// choosing to be extra careful here, but likely not required
				let firstUserMessage = ""

				const message = apiConversationHistory[0]
				if (Array.isArray(message.content)) {
					const block = message.content[0]
					if (block && block.type === "text") {
						firstUserMessage = block.text
					}
				}

				if (firstUserMessage) {
					const processedFirstUserMessage = formatResponse.processFirstUserMessageForTruncation()

					const innerMap = new Map<number, ContextUpdate[]>()
					innerMap.set(0, [[timestamp, "text", [processedFirstUserMessage], []]])
					this.contextHistoryUpdates.set(0, [0, innerMap]) // same EditType as first assistant truncation notice

					return true
				}
			} catch (error) {
				Logger.error("applyFirstUserMessageReplacement:", error)
			}
		}
		return false
	}
}
