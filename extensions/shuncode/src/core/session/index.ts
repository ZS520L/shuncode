/**
 * Session module — публичный API модуля сессий.
 *
 * Экспортирует:
 * - Session — единица разговора
 * - SessionManager — управление сессиями
 * - Типы событий — контракт между бэкендом и фронтендом
 */

export { ApprovalGate } from "./ApprovalGate"
export type { AskResult } from "./ApprovalGate"
export { Pipeline } from "./Pipeline"
export { Session } from "./Session"
export { SessionManager } from "./SessionManager"
export type {
	ApprovalRequest,
	ApprovalResult,
	PipelineProgress,
	PipelineStage,
	SessionEvent,
	SessionState,
	UserMessage,
	// Конкретные типы событий
	StateChangedEvent,
	MessageAddedEvent,
	MessageUpdatedEvent,
	ProgressEvent,
	ApprovalNeededEvent,
	ApprovalResolvedEvent,
} from "./SessionEvents"
