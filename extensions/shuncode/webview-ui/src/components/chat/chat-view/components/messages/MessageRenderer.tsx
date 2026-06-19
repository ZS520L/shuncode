import { ShuncodeMessage } from "@shared/ExtensionMessage"
import React, { useMemo } from "react"
import BrowserSessionRow from "@/components/chat/BrowserSessionRow"
import ChatRow from "@/components/chat/ChatRow"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { MessageHandlers } from "../../types/chatTypes"
import { findReasoningForApiReq, isEditTool, isProcessBlock, isReadFileGroup, isTextMessagePendingToolCall } from "../../utils/messageUtils"
import { EditCard } from "./EditCard"
import { ProcessBlock } from "./ProcessBlock"
import { ReadFileGroup } from "./ReadFileGroup"

interface MessageRendererProps {
	index: number
	messageOrGroup: ShuncodeMessage | ShuncodeMessage[]
	/** Whether this is the last message in the entire chat (last item in last turn) */
	isLastMessage: boolean
	modifiedMessages: ShuncodeMessage[]
	expandedRows: Record<number, boolean>
	onToggleExpand: (ts: number) => void
	onHeightChange?: (isTaller: boolean) => void
	onSetQuote: (quote: string | null) => void
	inputValue: string
	messageHandlers: MessageHandlers
}

/**
 * Renders a single item within a TurnBlock: ProcessBlock, EditCard, BrowserSession, or ChatRow.
 */
export const MessageRenderer: React.FC<MessageRendererProps> = ({
	index,
	messageOrGroup,
	isLastMessage,
	modifiedMessages,
	expandedRows,
	onToggleExpand,
	onHeightChange,
	onSetQuote,
	inputValue,
	messageHandlers,
}) => {
	const { mode } = useExtensionState()

	// Get reasoning content and response status for api_req_started messages
	const reasoningData = useMemo(() => {
		if (!Array.isArray(messageOrGroup) && messageOrGroup.say === "api_req_started") {
			// Use the same message source-of-truth that `groupedMessages` is derived from.
			return findReasoningForApiReq(messageOrGroup.ts, modifiedMessages)
		}
		return { reasoning: undefined, responseStarted: false }
	}, [messageOrGroup, modifiedMessages])

	// Check if a text message is waiting for tool call completion
	const isRequestInProgress = useMemo(() => {
		if (!Array.isArray(messageOrGroup) && messageOrGroup.say === "text") {
			// Use modifiedMessages so this stays consistent with the rendered list.
			return isTextMessagePendingToolCall(messageOrGroup.ts, modifiedMessages)
		}
		return false
	}, [messageOrGroup, modifiedMessages])

	// Process block (entire AI work process: text + tools + reasoning)
	if (isProcessBlock(messageOrGroup)) {
		return (
			<ProcessBlock
				isLast={isLastMessage}
				lastModifiedMessage={modifiedMessages.at(-1)}
				messages={messageOrGroup}
				onHeightChange={onHeightChange}
			/>
		)
	}

	// Edit card (file edit/create/delete — shown as standalone card between process blocks)
	if (!Array.isArray(messageOrGroup) && isEditTool(messageOrGroup)) {
		return <EditCard message={messageOrGroup} />
	}

	// ReadFile group (consecutive reads of same file — collapsible with line ranges)
	if (isReadFileGroup(messageOrGroup)) {
		return <ReadFileGroup messages={messageOrGroup} />
	}

	// Browser session group
	if (Array.isArray(messageOrGroup)) {
		return (
			<BrowserSessionRow
				expandedRows={expandedRows}
				isLast={isLastMessage}
				key={messageOrGroup[0]?.ts}
				lastModifiedMessage={modifiedMessages.at(-1)}
				messages={messageOrGroup}
				onHeightChange={onHeightChange}
				onSetQuote={onSetQuote}
				onToggleExpand={onToggleExpand}
			/>
		)
	}

	// Regular message
	return (
		<div
			className={cn({
				"pb-2.5": isLastMessage,
			})}
			data-message-ts={messageOrGroup.ts}>
			<ChatRow
				inputValue={inputValue}
				isExpanded={expandedRows[messageOrGroup.ts] || false}
				isLast={isLastMessage}
				isRequestInProgress={isRequestInProgress}
				key={messageOrGroup.ts}
				lastModifiedMessage={modifiedMessages.at(-1)}
				message={messageOrGroup}
				mode={mode}
				onCancelCommand={() => messageHandlers.executeButtonAction("cancel")}
				onHeightChange={onHeightChange}
				onSetQuote={onSetQuote}
				onToggleExpand={onToggleExpand}
				reasoningContent={reasoningData.reasoning}
				responseStarted={reasoningData.responseStarted}
				sendMessageFromChatRow={messageHandlers.handleSendMessage}
			/>
		</div>
	)
}

