import React, { useRef } from "react"
import ChatTextArea from "@/components/chat/ChatTextArea"
import QuotedMessagePreview from "@/components/chat/QuotedMessagePreview"
import type { MessageQueueActions } from "../../hooks/useMessageQueue"
import { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"

interface InputSectionProps {
	chatState: ChatState
	messageHandlers: MessageHandlers
	scrollBehavior: ScrollBehavior
	placeholderText: string
	shouldDisableFilesAndImages: boolean
	selectFilesAndImages: () => Promise<void>
	/** Is AI currently working (streaming)? */
	isAiWorking?: boolean
	/** Message queue for Cursor-style queuing */
	messageQueue?: MessageQueueActions & { queue: { id: string; text: string }[] }
	/** Cancel the currently running task */
	onCancel?: () => void
}

/**
 * Input section including quoted message preview and chat text area
 */
export const InputSection: React.FC<InputSectionProps> = ({
	chatState,
	messageHandlers,
	scrollBehavior,
	placeholderText,
	shouldDisableFilesAndImages,
	selectFilesAndImages,
	isAiWorking,
	messageQueue,
	onCancel,
}) => {
	const {
		activeQuote,
		setActiveQuote,
		isTextAreaFocused,
		inputValue,
		setInputValue,
		sendingDisabled,
		selectedImages,
		setSelectedImages,
		selectedFiles,
		setSelectedFiles,
		textAreaRef,
		handleFocusChange,
	} = chatState

	const { isAtBottom, scrollToBottomAuto } = scrollBehavior
	const prevTextAreaHeightRef = useRef(0)

	// Handle send - queue if AI is working, send directly otherwise
	const handleSend = () => {
		const text = inputValue.trim()
		if (!text && selectedImages.length === 0 && selectedFiles.length === 0) {
			return
		}

		if (isAiWorking && messageQueue) {
			// AI is working - add to queue instead of sending
			messageQueue.addToQueue(text, selectedImages, selectedFiles)
			setInputValue("")
			setSelectedImages([])
			setSelectedFiles([])
			setActiveQuote(null)
		} else {
			// AI not working - send directly
			messageHandlers.handleSendMessage(inputValue, selectedImages, selectedFiles)
		}
	}

	return (
		<>
			{activeQuote && (
				<div style={{ marginBottom: "-12px", marginTop: "10px" }}>
					<QuotedMessagePreview
						isFocused={isTextAreaFocused}
						onDismiss={() => setActiveQuote(null)}
						text={activeQuote}
					/>
				</div>
			)}

			<ChatTextArea
				activeQuote={activeQuote}
				inputValue={inputValue}
				isAiWorking={isAiWorking}
				onCancel={onCancel}
				onFocusChange={handleFocusChange}
			onHeightChange={(height: number) => {
				const grew = prevTextAreaHeightRef.current > 0 && height > prevTextAreaHeightRef.current
				prevTextAreaHeightRef.current = height
				if (grew && isAtBottom) {
					scrollToBottomAuto()
				}
			}}
				onSelectFilesAndImages={selectFilesAndImages}
				onSend={handleSend}
				placeholderText={placeholderText}
				ref={textAreaRef}
				selectedFiles={selectedFiles}
				selectedImages={selectedImages}
				sendingDisabled={sendingDisabled}
				setInputValue={setInputValue}
				setSelectedFiles={setSelectedFiles}
				setSelectedImages={setSelectedImages}
				shouldDisableFilesAndImages={shouldDisableFilesAndImages}
			/>
		</>
	)
}
