import type { ShuncodeMessage } from "@shared/ExtensionMessage"
import { EmptyRequest, StringRequest } from "@shared/proto/shuncode/common"
import { AskResponseRequest, NewTaskRequest } from "@shared/proto/shuncode/task"
import { useCallback } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { SlashServiceClient, TaskServiceClient } from "@/services/grpc-client"
import type { ButtonActionType } from "../shared/buttonConfig"
import type { ChatState, MessageHandlers } from "../types/chatTypes"

/**
 * Custom hook for managing message handlers
 * Handles sending messages, button clicks, and task management
 */
export function useMessageHandlers(messages: ShuncodeMessage[], chatState: ChatState): MessageHandlers {
	const { backgroundCommandRunning } = useExtensionState()
	const {
		setInputValue,
		activeQuote,
		setActiveQuote,
		setSelectedImages,
		setSelectedFiles,
		setSendingDisabled,
		setEnableButtons,
		shuncodeAsk,
		lastMessage,
	} = chatState

	// Handle sending a message
	const handleSendMessage = useCallback(
		async (text: string, images: string[], files: string[]) => {
			let messageToSend = text.trim()
			const hasContent = messageToSend || images.length > 0 || files.length > 0

			// Prepend the active quote if it exists
			if (activeQuote && hasContent) {
				const prefix = "[context] \n> "
				const formattedQuote = activeQuote
				const suffix = "\n[/context] \n\n"
				messageToSend = `${prefix} ${formattedQuote} ${suffix} ${messageToSend}`
			}

			if (hasContent) {
				console.log("[ChatView] handleSendMessage - Sending message:", messageToSend)
				console.log("[ChatView] messages.length:", messages.length, "shuncodeAsk:", shuncodeAsk)
				let messageSent = false

				if (messages.length === 0) {
					console.log("[ChatView] PATH: newTask (messages.length === 0)")
					await TaskServiceClient.newTask(
						NewTaskRequest.create({
							text: messageToSend,
							images,
							files,
						}),
					)
					messageSent = true
				} else if (shuncodeAsk) {
					console.log("[ChatView] PATH: shuncodeAsk exists:", shuncodeAsk)
					// Cursor-style: все ask типы используют messageResponse для продолжения чата
					// resume_task использует yesButtonClicked для возобновления прерванной работы
					if (shuncodeAsk === "resume_task") {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: messageToSend,
								images,
								files,
							}),
						)
						messageSent = true
					} else {
						// All other ask types (including completion_result, resume_completed_task) use messageResponse
						// This allows continuous conversation without creating new tasks
						switch (shuncodeAsk) {
							case "followup":
							case "plan_mode_respond":
							case "tool":
							case "browser_action_launch":
							case "command":
							case "command_output":
							case "use_mcp_server":
							case "completion_result":
							case "resume_completed_task":
							case "mistake_limit_reached":
							case "api_req_failed":
							case "new_task":
							case "condense":
							case "report_bug":
								await TaskServiceClient.askResponse(
									AskResponseRequest.create({
										responseType: "messageResponse",
										text: messageToSend,
										images,
										files,
									}),
								)
								messageSent = true
								break
						}
					}
				} else if (messages.length > 0) {
					// No shuncodeAsk - send message directly
					// Note: If AI is working, InputSection handles queuing
					console.log("[ChatView] PATH: no shuncodeAsk, sending askResponse")
					await TaskServiceClient.askResponse(
						AskResponseRequest.create({
							responseType: "messageResponse",
							text: messageToSend,
							images,
							files,
						}),
					)
					messageSent = true
				}

				// Only clear input if message was actually sent
				// Note: sendingDisabled is managed by buttonConfig in ActionButtons, not here
				if (messageSent) {
					setInputValue("")
					setActiveQuote(null)
					setSelectedImages([])
					setSelectedFiles([])

					// Reset auto-scroll
					if ("disableAutoScrollRef" in chatState) {
						;(chatState as any).disableAutoScrollRef.current = false
					}
				}
			}
		},
		[messages.length, shuncodeAsk, activeQuote, setInputValue, setActiveQuote, setSelectedImages, setSelectedFiles, chatState],
	)

	// Start a new task
	const startNewTask = useCallback(async () => {
		setActiveQuote(null)
		await TaskServiceClient.clearTask(EmptyRequest.create({}))
		// Focus textarea after UI resets
		setTimeout(() => chatState.textAreaRef.current?.focus(), 100)
	}, [setActiveQuote, chatState.textAreaRef])

	// Clear input state helper
	const clearInputState = useCallback(() => {
		setInputValue("")
		setActiveQuote(null)
		setSelectedImages([])
		setSelectedFiles([])
	}, [setInputValue, setActiveQuote, setSelectedImages, setSelectedFiles])

	// Execute button action based on type
	const executeButtonAction = useCallback(
		async (actionType: ButtonActionType, text?: string, images?: string[], files?: string[]) => {
			const trimmedInput = text?.trim()
			const hasContent = trimmedInput || (images && images.length > 0) || (files && files.length > 0)

			switch (actionType) {
				case "retry":
					// For API retry (api_req_failed), always send simple approval without content
					await TaskServiceClient.askResponse(
						AskResponseRequest.create({
							responseType: "yesButtonClicked",
						}),
					)
					clearInputState()
					break
				case "approve":
					if (hasContent) {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: trimmedInput,
								images: images,
								files: files,
							}),
						)
					} else {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
					}
					clearInputState()
					break

				case "reject":
					if (hasContent) {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "noButtonClicked",
								text: trimmedInput,
								images: images,
								files: files,
							}),
						)
					} else {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "noButtonClicked",
							}),
						)
					}
					clearInputState()
					break

				case "proceed":
					if (hasContent) {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: trimmedInput,
								images: images,
								files: files,
							}),
						)
					} else {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
					}
					clearInputState()
					break

				case "new_task":
					if (shuncodeAsk === "new_task") {
						await TaskServiceClient.newTask(
							NewTaskRequest.create({
								text: lastMessage?.text,
								images: [],
								files: [],
							}),
						)
					} else {
						await startNewTask()
					}
					break

				case "cancel":
					if (backgroundCommandRunning) {
						await TaskServiceClient.cancelBackgroundCommand(EmptyRequest.create({}))
					} else {
						await TaskServiceClient.cancelTask(EmptyRequest.create({}))
					}
					// Clear any pending state that might interfere with resume
					setSendingDisabled(false)
					setEnableButtons(true)
					break

				case "utility":
					switch (shuncodeAsk) {
						case "condense":
							await SlashServiceClient.condense(StringRequest.create({ value: lastMessage?.text })).catch((err) =>
								console.error(err),
							)
							break
						case "report_bug":
							await SlashServiceClient.reportBug(StringRequest.create({ value: lastMessage?.text })).catch((err) =>
								console.error(err),
							)
							break
					}
					break
			}

			if ("disableAutoScrollRef" in chatState) {
				;(chatState as any).disableAutoScrollRef.current = false
			}
		},
		[
			shuncodeAsk,
			lastMessage,
			messages,
			clearInputState,
			handleSendMessage,
			startNewTask,
			chatState,
			backgroundCommandRunning,
			setSendingDisabled,
			setEnableButtons,
		],
	)

	// Handle task close button click
	const handleTaskCloseButtonClick = useCallback(() => {
		startNewTask()
	}, [startNewTask])

	return {
		handleSendMessage,
		executeButtonAction,
		handleTaskCloseButtonClick,
		startNewTask,
	}
}
