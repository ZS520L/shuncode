import type { ShuncodeMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useI18n } from "@/i18n"
import { ButtonActionType, getButtonConfig } from "../../shared/buttonConfig"
import type { ChatState, MessageHandlers } from "../../types/chatTypes"

interface ActionButtonsProps {
	task?: ShuncodeMessage
	messages: ShuncodeMessage[]
	chatState: ChatState
	messageHandlers: MessageHandlers
	mode: Mode
	scrollBehavior: {
		scrollToBottomSmooth: () => void
		disableAutoScrollRef: React.MutableRefObject<boolean>
		showScrollToBottom: boolean
	}
}

/**
 * Action buttons area including scroll-to-bottom and approve/reject buttons
 */
export const ActionButtons: React.FC<ActionButtonsProps> = ({
	task,
	messages,
	chatState,
	mode,
	messageHandlers,
	scrollBehavior: _scrollBehavior,
}) => {
	const { t } = useI18n()
	const { inputValue, selectedImages, selectedFiles, setSendingDisabled } = chatState
	const [isProcessing, setIsProcessing] = useState(false)

	// Memoize last messages to avoid unnecessary recalculations
	const [lastMessage, secondLastMessage] = useMemo(() => {
		const len = messages.length
		return len > 0 ? [messages[len - 1], messages[len - 2]] : [undefined, undefined]
	}, [messages])

	// Memoize button configuration to avoid recalculation on every render
	const buttonConfig = useMemo(() => {
		return lastMessage ? getButtonConfig(lastMessage, mode) : { sendingDisabled: false, enableButtons: false }
	}, [lastMessage, mode])

	// Single effect to handle all configuration updates
	useEffect(() => {
		setSendingDisabled(buttonConfig.sendingDisabled)
		setIsProcessing(false)
	}, [buttonConfig, setSendingDisabled])

	// Clear input when transitioning from command_output to api_req
	// This happens when user provides feedback during command execution
	useEffect(() => {
		if (lastMessage?.type === "say" && lastMessage.say === "api_req_started" && secondLastMessage?.ask === "command_output") {
			chatState.setInputValue("")
			chatState.setSelectedImages([])
			chatState.setSelectedFiles([])
		}
	}, [lastMessage?.type, lastMessage?.say, secondLastMessage?.ask, chatState])

	const handleActionClick = useCallback(
		async (action: ButtonActionType, text?: string, images?: string[], files?: string[]) => {
			// Cancel should always work, even if other actions are processing
			if (action !== "cancel" && isProcessing) {
				return
			}

			// Only set processing flag for non-cancel actions
			if (action !== "cancel") {
				setIsProcessing(true)
			}

			try {
				await messageHandlers.executeButtonAction(action, text, images, files)
			} catch (error) {
				console.error("[ActionButtons] executeButtonAction failed:", error)
			} finally {
				// Keep cancel behavior instant, and always unlock buttons on errors.
				if (action !== "cancel") {
					setIsProcessing(false)
				}
			}
		},
		[messageHandlers, isProcessing],
	)

	// Keyboard event handler
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault()
				event.stopPropagation()
				messageHandlers.executeButtonAction("cancel")
			}
		},
		[messageHandlers],
	)

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [handleKeyDown])

	if (!task) {
		return null
	}

	const { primaryText, secondaryText, primaryAction, secondaryAction, enableButtons } = buttonConfig
	const hasButtons = primaryText || secondaryText
	const isStreaming = task.partial === true
	const canInteract = enableButtons && !isProcessing

	if (!hasButtons) {
		return null
	}

	const opacity = canInteract || isStreaming ? 1 : 0.5

	return (
		<div className="flex px-3.5" style={{ opacity }}>
			{primaryText && primaryAction && (
				<VSCodeButton
					appearance="primary"
					className={secondaryText ? "flex-1 mr-[6px]" : "flex-2"}
					disabled={!canInteract}
					onClick={() => handleActionClick(primaryAction, inputValue, selectedImages, selectedFiles)}>
					{t(primaryText)}
				</VSCodeButton>
			)}
			{secondaryText && secondaryAction && (
				<VSCodeButton
					appearance="secondary"
					className={primaryText ? "flex-1" : "flex-2"}
					disabled={!canInteract}
					onClick={() => handleActionClick(secondaryAction, inputValue, selectedImages, selectedFiles)}>
					{t(secondaryText)}
				</VSCodeButton>
			)}
		</div>
	)
}
