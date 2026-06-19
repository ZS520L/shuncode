import { ShuncodeMessage } from "@shared/ExtensionMessage"
import React, { useCallback, useEffect, useRef } from "react"
import { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"
import { TurnData } from "../../utils/messageUtils"
import { TurnBlock } from "../messages/TurnBlock"

interface MessagesAreaProps {
	task: ShuncodeMessage
	turns: TurnData[]
	modifiedMessages: ShuncodeMessage[]
	scrollBehavior: ScrollBehavior
	chatState: ChatState
	messageHandlers: MessageHandlers
}

/**
 * Chat scroll area — native scroll, no Virtuoso.
 *
 * Each TurnBlock = one user message (sticky header) + AI responses.
 * Sticky headers are pure CSS — no JS overlay, no translateY hacks.
 *
 * Footer spacer (100vh) lets the last turn scroll to the top of viewport
 * (Cursor-like "message at top" behavior). Its height never changes.
 */
export const MessagesArea: React.FC<MessagesAreaProps> = ({
	task,
	turns,
	modifiedMessages,
	scrollBehavior,
	chatState,
	messageHandlers,
}) => {
	const {
		scrollContainerRef,
		toggleRowExpansion,
		handleRowHeightChange,
		onScrollerRef,
	} = scrollBehavior

	const { expandedRows, inputValue, setActiveQuote } = chatState

	const scrollerCallbackRef = useCallback(
		(node: HTMLDivElement | null) => {
			;(scrollContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = node
			onScrollerRef(node)
		},
		[scrollContainerRef, onScrollerRef],
	)

	return (
		<div className="overflow-hidden flex flex-col h-full relative">
			<div
				className="scrollable grow overflow-y-auto"
				ref={scrollerCallbackRef}
				style={{
					scrollbarWidth: "none",
					msOverflowStyle: "none",
					overflowAnchor: "none",
				}}>
				{turns.map((turn, index) => (
					<div data-turn-index={index} key={turn.userMessage.ts}>
						<TurnBlock
							expandedRows={expandedRows}
							inputValue={inputValue}
							messageHandlers={messageHandlers}
							modifiedMessages={modifiedMessages}
							onHeightChange={handleRowHeightChange}
							onSetQuote={setActiveQuote}
							onToggleExpand={toggleRowExpansion}
							totalTurns={turns.length}
							turn={turn}
							turnIndex={index}
						/>
					</div>
				))}
				{/* Footer spacer — allows last turn to be pinned at viewport top */}
				<div style={{ minHeight: "100vh" }} />
			</div>
		</div>
	)
}
