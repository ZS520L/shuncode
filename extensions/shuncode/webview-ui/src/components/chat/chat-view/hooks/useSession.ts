/**
 * useSession - хук для работы с сессией через SessionService.
 *
 * Заменяет:
 * - isAiWorking (эвристика по сообщениям -> session.state)
 * - useMessageQueue (очередь -> session.inject())
 * - useMessageHandlers (маршрутизация -> session.inject() / session.approve())
 * - buttonConfig (автомат -> approvals)
 *
 * Подписывается на SessionService.subscribeToSession и собирает
 * инкрементальный state из SessionEvent стрима.
 */

import type { ShuncodeMessage } from "@shared/ExtensionMessage"
import type {
	ApprovalRequestProto,
	PipelineProgressProto,
	SessionStateProto,
} from "@shared/proto/shuncode/session"
import { SendMessageRequest, ApprovalResponse } from "@shared/proto/shuncode/session"
import { StringRequest } from "@shared/proto/shuncode/common"
import { useCallback, useEffect, useRef, useState } from "react"
import { SessionServiceClient } from "@/services/grpc-client"
import { convertProtoToShuncodeMessage } from "@shared/proto-conversions/shuncode-message"

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

export type SessionState = "idle" | "running" | "paused" | "done" | "error"

export interface PendingApproval {
	id: string
	toolType: string
	toolData: string
	description?: string
	primaryText?: string
	secondaryText?: string
}

export interface UseSessionReturn {
	/** Текущее состояние сессии (реальное, не угадываемое) */
	state: SessionState
	/** Сообщения сессии (собираются инкрементально) */
	sessionMessages: ShuncodeMessage[]
	/** Прогресс конвейера */
	progress: PipelineProgressProto | null
	/** Pending approvals (ожидают действия пользователя) */
	approvals: PendingApproval[]
	/** Отправить сообщение (всегда работает, без маршрутизации) */
	inject: (text: string, images?: string[], files?: string[]) => void
	/** Одобрить approval */
	approve: (approvalId: string, feedback?: string) => void
	/** Отклонить approval */
	reject: (approvalId: string, feedback?: string) => void
	/** Прервать сессию */
	abort: () => void
	/** Приостановить сессию */
	pause: () => void
	/** Возобновить сессию */
	resume: () => void
	/** AI работает? (упрощённый алиас для state === "running") */
	isWorking: boolean
}

// ---------------------------------------------------------------------------
// Конвертеры
// ---------------------------------------------------------------------------

function mapProtoState(state: SessionStateProto | string | undefined): SessionState {
	if (state === undefined) return "idle"
	const s = typeof state === "string" ? state : String(state)
	switch (s) {
		case "SESSION_RUNNING":
		case "1":
			return "running"
		case "SESSION_PAUSED":
		case "2":
			return "paused"
		case "SESSION_DONE":
		case "3":
			return "done"
		case "SESSION_ERROR":
		case "4":
			return "error"
		default:
			return "idle"
	}
}

function mapApproval(proto: ApprovalRequestProto): PendingApproval {
	return {
		id: proto.id,
		toolType: proto.toolType,
		toolData: proto.toolData,
		description: proto.description,
		primaryText: proto.primaryText,
		secondaryText: proto.secondaryText,
	}
}

// ---------------------------------------------------------------------------
// Хук
// ---------------------------------------------------------------------------

export function useSession(sessionId: string | null): UseSessionReturn {
	const [state, setState] = useState<SessionState>("idle")
	const [sessionMessages, setSessionMessages] = useState<ShuncodeMessage[]>([])
	const [progress, setProgress] = useState<PipelineProgressProto | null>(null)
	const [approvals, setApprovals] = useState<PendingApproval[]>([])
	const unsubRef = useRef<(() => void) | null>(null)

	// Subscribe to session events
	useEffect(() => {
		if (!sessionId) return

		const unsub = SessionServiceClient.subscribeToSession(
			StringRequest.create({ value: sessionId }),
			{
				onResponse: (event) => {
					// State changed
					if (event.stateChanged) {
						setState(mapProtoState(event.stateChanged.state))
					}

					// Message added
					if (event.messageAdded?.message) {
						const msg = convertProtoToShuncodeMessage(event.messageAdded.message)
						if (msg) {
							setSessionMessages((prev) => [...prev, msg])
						}
					}

					// Message updated (streaming partial)
					if (event.messageUpdated) {
						const { ts, patch } = event.messageUpdated
						if (ts && patch) {
							setSessionMessages((prev) =>
								prev.map((m) => {
									if (m.ts === ts) {
										return { ...m, ...convertProtoToShuncodeMessage(patch) }
									}
									return m
								}),
							)
						}
					}

					// Pipeline progress
					if (event.pipelineProgress) {
						setProgress(event.pipelineProgress)
					}

					// Approval needed
					if (event.approvalNeeded?.approval) {
						setApprovals((prev) => [...prev, mapApproval(event.approvalNeeded!.approval!)])
					}

					// Approval resolved
					if (event.approvalResolved) {
						setApprovals((prev) => prev.filter((a) => a.id !== event.approvalResolved!.approvalId))
					}
				},
				onError: (error) => {
					console.error("[useSession] Stream error:", error)
					setState("error")
				},
				onComplete: () => {
					console.log("[useSession] Stream completed")
				},
			},
		)

		unsubRef.current = unsub
		return () => {
			unsub()
			unsubRef.current = null
		}
	}, [sessionId])

	// --- Actions ---

	const inject = useCallback(
		(text: string, images?: string[], files?: string[]) => {
			if (!sessionId) return
			SessionServiceClient.sendMessage(
				SendMessageRequest.create({
					sessionId,
					text,
					images: images ?? [],
					files: files ?? [],
				}),
			).catch((error) => {
				console.error("[useSession] sendMessage error:", error)
			})
		},
		[sessionId],
	)

	const approve = useCallback(
		(approvalId: string, feedback?: string) => {
			if (!sessionId) return
			SessionServiceClient.respondToApproval(
				ApprovalResponse.create({
					sessionId,
					approvalId,
					approved: true,
					feedback,
				}),
			).catch((error) => {
				console.error("[useSession] approve error:", error)
			})
		},
		[sessionId],
	)

	const reject = useCallback(
		(approvalId: string, feedback?: string) => {
			if (!sessionId) return
			SessionServiceClient.respondToApproval(
				ApprovalResponse.create({
					sessionId,
					approvalId,
					approved: false,
					feedback,
				}),
			).catch((error) => {
				console.error("[useSession] reject error:", error)
			})
		},
		[sessionId],
	)

	const abort = useCallback(() => {
		if (!sessionId) return
		SessionServiceClient.abortSession(StringRequest.create({ value: sessionId })).catch((error) => {
			console.error("[useSession] abort error:", error)
		})
	}, [sessionId])

	const pause = useCallback(() => {
		if (!sessionId) return
		SessionServiceClient.pauseSession(StringRequest.create({ value: sessionId })).catch((error) => {
			console.error("[useSession] pause error:", error)
		})
	}, [sessionId])

	const resume = useCallback(() => {
		if (!sessionId) return
		SessionServiceClient.resumeSession(StringRequest.create({ value: sessionId })).catch((error) => {
			console.error("[useSession] resume error:", error)
		})
	}, [sessionId])

	return {
		state,
		sessionMessages,
		progress,
		approvals,
		inject,
		approve,
		reject,
		abort,
		pause,
		resume,
		isWorking: state === "running",
	}
}
