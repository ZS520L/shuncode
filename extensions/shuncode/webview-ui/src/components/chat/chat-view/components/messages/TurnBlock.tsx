import { ShuncodeMessage } from "@shared/ExtensionMessage"
import React, { memo, useCallback, useRef, useState, useEffect } from "react"
import UserMessage from "@/components/chat/UserMessage"
import { MessageHandlers } from "../../types/chatTypes"
import { TurnData } from "../../utils/messageUtils"
import { MessageRenderer } from "./MessageRenderer"

/** If the raw text is longer than this, we show the collapsed two-line preview. */
const LONG_MESSAGE_THRESHOLD = 120 // characters

interface TurnBlockProps {
	turn: TurnData
	turnIndex: number
	totalTurns: number
	modifiedMessages: ShuncodeMessage[]
	expandedRows: Record<number, boolean>
	onToggleExpand: (ts: number) => void
	onHeightChange: (isTaller: boolean) => void
	onSetQuote: (quote: string | null) => void
	inputValue: string
	messageHandlers: MessageHandlers
}

/**
 * A Turn wraps one user message (sticky header) + all AI responses below it.
 *
 * The header uses native CSS `position: sticky` - no JS calculations.
 * When the next Turn's header reaches the top, it pushes this header out
 * (standard sticky section-header behavior).
 */
export const TurnBlock: React.FC<TurnBlockProps> = memo(({
	turn,
	turnIndex,
	totalTurns,
	modifiedMessages,
	expandedRows,
	onToggleExpand,
	onHeightChange,
	onSetQuote,
	inputValue,
	messageHandlers,
}) => {
	const isLastTurn = turnIndex === totalTurns - 1
	const isLong = (turn.userMessage.text?.length ?? 0) > LONG_MESSAGE_THRESHOLD
	const [isExpanded, setIsExpanded] = useState(false)

	const toggleExpanded = useCallback(() => {
		setIsExpanded((prev) => !prev)
	}, [])

	const getItemTs = useCallback((item: ShuncodeMessage | ShuncodeMessage[] | undefined): number | undefined => {
		if (!item) return undefined
		return Array.isArray(item) ? item[0]?.ts : item.ts
	}, [])

	return (
		<div data-turn-ts={turn.userMessage.ts}>
			{/* Sticky header - user message. Skipped for task-turns (TaskSection renders it). */}
			{turn.userMessage && (
				<div
					className="bg-background"
					data-message-ts={turn.userMessage.ts}
					style={{ position: "sticky", top: 0, zIndex: 10 }}>
					<div className="pt-2.5 px-[15px]">
					{isLong && !isExpanded ? (
						/* Collapsed: two-line preview with badge background */
						<div
							onClick={toggleExpanded}
							className="flex items-center gap-1.5 cursor-pointer p-2.5 pr-2 my-1 rounded-xs hover:brightness-110"
							style={{
								backgroundColor: "var(--vscode-badge-background)",
								color: "var(--vscode-badge-foreground)",
							}}>
							<span
								className="text-sm flex-1 min-w-0"
								style={{
									display: "-webkit-box",
									WebkitLineClamp: 2,
									WebkitBoxOrient: "vertical",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "pre-line",
									wordWrap: "break-word",
								}}>
								{turn.userMessage.text}
							</span>
							<span
								className="codicon codicon-chevron-down shrink-0 self-start mt-0.5"
								style={{ fontSize: 14, color: "var(--vscode-descriptionForeground)" }}
							/>
						</div>
						) : (
							/* Expanded: full UserMessage with edit/retry/delete */
							<>
								<UserMessage
									files={turn.userMessage.files}
									images={turn.userMessage.images}
									messageTs={turn.userMessage.ts}
									sendMessageFromChatRow={messageHandlers.handleSendMessage}
									text={turn.userMessage.text}
								/>
							{isLong && (
								<div
									onClick={toggleExpanded}
									className="flex justify-center cursor-pointer py-1 opacity-60 hover:opacity-100"
									style={{ userSelect: "none" }}>
									<span
										className="codicon codicon-chevron-up"
										style={{ fontSize: 14, color: "var(--vscode-descriptionForeground)" }}
									/>
								</div>
							)}
							</>
						)}
					</div>
				</div>
			)}

			{/* Turn content — AI responses, tools, edits */}
			{turn.items.map((item, i) => (
				<MessageRenderer
					expandedRows={expandedRows}
					index={i}
					inputValue={inputValue}
					isLastMessage={isLastTurn && i === turn.items.length - 1}
					key={Array.isArray(item) ? item[0]?.ts ?? i : item.ts}
					messageHandlers={messageHandlers}
					messageOrGroup={item}
					modifiedMessages={modifiedMessages}
					nextItemTs={getItemTs(turn.items[i + 1])}
					onHeightChange={onHeightChange}
					onSetQuote={onSetQuote}
					onToggleExpand={onToggleExpand}
				/>
			))}
		</div>
	)
})

TurnBlock.displayName = "TurnBlock"
