import { StringRequest } from "@shared/proto/shuncode/common"
import { SessionEvent as SessionEventProto, SessionStateProto, PipelineStageProto } from "@shared/proto/shuncode/session"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"
import type { SessionEvent } from "@core/session/SessionEvents"

// Active session subscriptions: sessionId -> Set<handler>
const activeSessionSubscriptions = new Map<string, Set<StreamingResponseHandler<SessionEventProto>>>()

/**
 * Subscribe to session events. Replaces postStateToWebview for messages.
 * One stream per session - all events (state, messages, progress, approvals).
 */
export async function subscribeToSession(
	controller: Controller,
	request: StringRequest,
	responseStream: StreamingResponseHandler<SessionEventProto>,
	requestId?: string,
): Promise<void> {
	const sessionId = request.value
	const session = controller.sessionManager.get(sessionId)
	if (!session) {
		Logger.warn(`[SessionService] subscribeToSession: Session not found: ${sessionId}`)
		return
	}

	// Track this subscription
	if (!activeSessionSubscriptions.has(sessionId)) {
		activeSessionSubscriptions.set(sessionId, new Set())
	}
	activeSessionSubscriptions.get(sessionId)!.add(responseStream)

	// Subscribe to session events and forward to gRPC stream
	const unsubscribe = session.on((event: SessionEvent) => {
		const protoEvent = convertSessionEventToProto(sessionId, event)
		if (protoEvent) {
			responseStream(protoEvent, false).catch((error) => {
				Logger.error(`[SessionService] Error streaming event to session ${sessionId}:`, error)
				activeSessionSubscriptions.get(sessionId)?.delete(responseStream)
			})
		}
	})

	// Cleanup when stream is cancelled
	const cleanup = () => {
		unsubscribe()
		activeSessionSubscriptions.get(sessionId)?.delete(responseStream)
		if (activeSessionSubscriptions.get(sessionId)?.size === 0) {
			activeSessionSubscriptions.delete(sessionId)
		}
	}

	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "session_subscription" }, responseStream)
	}

	// Send initial state
	try {
		await responseStream(
			SessionEventProto.create({
				sessionId,
				stateChanged: {
					state: mapSessionState(session.state),
				},
			}),
			false,
		)
	} catch (error) {
		Logger.error(`[SessionService] Error sending initial state for session ${sessionId}:`, error)
		cleanup()
	}
}

/**
 * Send a session event to all subscribers of a specific session.
 * Called from Session when events are emitted.
 */
export function sendSessionEvent(sessionId: string, event: SessionEvent): void {
	const subscribers = activeSessionSubscriptions.get(sessionId)
	if (!subscribers || subscribers.size === 0) return

	const protoEvent = convertSessionEventToProto(sessionId, event)
	if (!protoEvent) return

	for (const handler of subscribers) {
		handler(protoEvent, false).catch((error) => {
			Logger.error(`[SessionService] Error sending event to subscriber:`, error)
			subscribers.delete(handler)
		})
	}
}

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

function mapSessionState(state: string): SessionStateProto {
	switch (state) {
		case "idle":
			return SessionStateProto.SESSION_IDLE
		case "running":
			return SessionStateProto.SESSION_RUNNING
		case "paused":
			return SessionStateProto.SESSION_PAUSED
		case "done":
			return SessionStateProto.SESSION_DONE
		case "error":
			return SessionStateProto.SESSION_ERROR
		default:
			return SessionStateProto.SESSION_IDLE
	}
}

function mapPipelineStage(stage: string): PipelineStageProto {
	switch (stage) {
		case "preparing":
			return PipelineStageProto.PREPARING
		case "calling_api":
			return PipelineStageProto.CALLING_API
		case "streaming":
			return PipelineStageProto.STREAMING
		case "tool_execution":
			return PipelineStageProto.TOOL_EXECUTION
		case "awaiting_approval":
			return PipelineStageProto.AWAITING_APPROVAL
		case "completed":
			return PipelineStageProto.PIPELINE_COMPLETED
		default:
			return PipelineStageProto.PREPARING
	}
}

function convertSessionEventToProto(sessionId: string, event: SessionEvent): SessionEventProto | null {
	switch (event.type) {
		case "state_changed":
			return SessionEventProto.create({
				sessionId,
				stateChanged: {
					state: mapSessionState(event.state),
					reason: event.reason,
				},
			})

		case "progress":
			return SessionEventProto.create({
				sessionId,
				pipelineProgress: {
					stage: mapPipelineStage(event.progress.stage),
					progress: event.progress.progress,
					label: event.progress.label,
					iteration: event.progress.iteration,
				},
			})

		case "approval_needed":
			return SessionEventProto.create({
				sessionId,
				approvalNeeded: {
					approval: {
						id: event.approval.id,
						toolType: event.approval.toolType,
						toolData: event.approval.toolData,
						description: event.approval.description,
						primaryText: event.approval.primaryText,
						secondaryText: event.approval.secondaryText,
					},
				},
			})

		case "approval_resolved":
			return SessionEventProto.create({
				sessionId,
				approvalResolved: {
					approvalId: event.approvalId,
					approved: event.result === "approved",
				},
			})

		case "message_added":
		case "message_updated":
			// Messages still go through the old postStateToWebview for now
			// Will be migrated in Step 5
			return null

		default:
			return null
	}
}
