import type { ShuncodeMessage } from "@shared/ExtensionMessage"
import { EmptyRequest } from "@shared/proto/shuncode/common"
import { AskResponseRequest, NewTaskRequest } from "@shared/proto/shuncode/task"
import { useCallback, useEffect, useRef, useState } from "react"
import { TaskServiceClient } from "@/services/grpc-client"

export interface QueuedMessage {
	id: string
	text: string
	images: string[]
	files: string[]
}

export interface MessageQueueState {
	queue: QueuedMessage[]
	selectedIndex: number
}

export interface MessageQueueActions {
	addToQueue: (text: string, images: string[], files: string[]) => void
	sendNow: () => void // [→] - прервать AI и отправить первый
	removeSelected: () => void // [🗑] - удалить выбранный
	clearQueue: () => void // [✕] - очистить всю очередь
	selectItem: (index: number) => void
}

// Correct responseType based on shuncodeAsk
function getResponseType(shuncodeAsk: string | undefined): string {
	if (shuncodeAsk === "resume_task" || shuncodeAsk === "resume_completed_task") {
		return "yesButtonClicked"
	}
	return "messageResponse"
}

/**
 * Cursor-style message queue.
 * Pure reactive - no timers, no polling.
 *
 * 1. AI working → messages go to queue
 * 2. shuncodeAsk appears + queue not empty → auto-send first
 * 3. [→] button → cancelTask → shuncodeAsk appears → auto-send
 */
export function useMessageQueue(_messages: ShuncodeMessage[], shuncodeAsk: string | undefined): MessageQueueState & MessageQueueActions {
	const [queue, setQueue] = useState<QueuedMessage[]>([])
	const [selectedIndex, setSelectedIndex] = useState(0)
	const sendingRef = useRef(false) // prevent double-send

	// Add message to queue
	const addToQueue = useCallback((text: string, images: string[], files: string[]) => {
		setQueue((prev) => [
			...prev,
			{
				id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
				text,
				images,
				files,
			},
		])
	}, [])

	// [→] Send now - interrupt AI and force-send first queued message
	const sendNow = useCallback(async () => {
		if (queue.length === 0) {
			return
		}

		const firstMessage = queue[0]
		if (!shuncodeAsk) {
			// AI is working — cancel first and keep message in queue.
			// It will be auto-sent by the shuncodeAsk effect as soon as ask state appears.
			console.log("[MessageQueue] sendNow - cancelling AI, then forcing send:", firstMessage.text)
			try {
				await TaskServiceClient.cancelTask(EmptyRequest.create({}))
			} catch (err) {
				console.error("[MessageQueue] cancelTask failed:", err)
			}
			return
		}

		// ask state already exists: send immediately and remove from queue
		setQueue((prev) => prev.slice(1))
		setSelectedIndex(0)

		// Send as askResponse (works for both "AI waiting" and "just cancelled" states)
		const responseType = getResponseType(shuncodeAsk)
		console.log("[MessageQueue] sendNow - askResponse:", firstMessage.text, "responseType:", responseType)

		try {
			await TaskServiceClient.askResponse(
				AskResponseRequest.create({
					responseType,
					text: firstMessage.text,
					images: firstMessage.images,
					files: firstMessage.files,
				}),
			)
		} catch (err) {
			console.error("[MessageQueue] sendNow askResponse failed, trying newTask:", err)
			// Fallback: start as new task if askResponse fails
			try {
				await TaskServiceClient.newTask(
					NewTaskRequest.create({
						text: firstMessage.text,
						images: firstMessage.images,
					}),
				)
			} catch (err2) {
				console.error("[MessageQueue] sendNow newTask also failed:", err2)
			}
		}
	}, [queue, shuncodeAsk])

	// Remove selected message
	const removeSelected = useCallback(() => {
		if (queue.length === 0) {
			return
		}
		setQueue((prev) => prev.filter((_, i) => i !== selectedIndex))
		setSelectedIndex((prev) => Math.max(0, Math.min(prev, queue.length - 2)))
	}, [queue.length, selectedIndex])

	// Clear entire queue
	const clearQueue = useCallback(() => {
		setQueue([])
		setSelectedIndex(0)
	}, [])

	// Select item
	const selectItem = useCallback(
		(index: number) => {
			setSelectedIndex(Math.max(0, Math.min(index, queue.length - 1)))
		},
		[queue.length],
	)

	// CORE: React to shuncodeAsk changes - auto-send when shuncodeAsk appears and queue has messages.
	// IMPORTANT: We must wait for the ask message to be fully complete (partial === false/undefined).
	// During streaming, ask messages arrive as partial=true first (e.g. followup question being typed),
	// and we must NOT consume the queue until the AI has fully finished writing its response.
	const lastMessage = _messages.at(-1)
	const isLastMessagePartial = lastMessage?.partial === true

	useEffect(() => {
		if (!shuncodeAsk || queue.length === 0 || sendingRef.current || isLastMessagePartial) {
			return
		}

		// shuncodeAsk appeared, message is complete, and we have queued messages - send first one
		sendingRef.current = true
		const firstMessage = queue[0]

		const responseType = getResponseType(shuncodeAsk)
		// allow-any-unicode-next-line
		console.log("[MessageQueue] shuncodeAsk:", shuncodeAsk, "→ auto-sending:", firstMessage.text, "responseType:", responseType)

		setQueue((prev) => prev.slice(1))
		setSelectedIndex(0)

		TaskServiceClient.askResponse(
			AskResponseRequest.create({
				responseType,
				text: firstMessage.text,
				images: firstMessage.images,
				files: firstMessage.files,
			}),
		)
			.catch((err) => console.error("[MessageQueue] auto-send failed:", err))
			.finally(() => {
				sendingRef.current = false
			})
	}, [shuncodeAsk, queue, isLastMessagePartial])

	return {
		queue,
		selectedIndex,
		addToQueue,
		sendNow,
		removeSelected,
		clearQueue,
		selectItem,
	}
}
