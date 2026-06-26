/**
 * SessionEvents — типизированные события конвейера сессии.
 *
 * Это единый контракт между бэкендом (Session/Pipeline/ApprovalGate)
 * и фронтендом (useSession хук). Все изменения в сессии передаются
 * через эти события, а не через дамп всего state.
 */

import type { ShuncodeMessage } from "@shared/ExtensionMessage"

// ---------------------------------------------------------------------------
// Состояние сессии
// ---------------------------------------------------------------------------

/** Возможные состояния сессии */
export type SessionState = "idle" | "running" | "paused" | "done" | "error"

// ---------------------------------------------------------------------------
// Стадии конвейера (Pipeline)
// ---------------------------------------------------------------------------

/** Стадии конвейера — каждый цикл проходит через них последовательно */
export type PipelineStage =
	| "preparing" // сборка системного промпта, контекста
	| "calling_api" // запрос к API модели
	| "streaming" // стриминг ответа
	| "tool_execution" // выполнение инструмента
	| "awaiting_approval" // ждём одобрения пользователя
	| "completed" // итерация завершена

/** Прогресс конвейера — что сейчас происходит */
export interface PipelineProgress {
	stage: PipelineStage
	/** 0-1 прогресс внутри текущей стадии (опционально) */
	progress?: number
	/** Человекочитаемое описание: "Editing src/index.ts" */
	label?: string
	/** Какая итерация цикла (для отладки) */
	iteration: number
}

// ---------------------------------------------------------------------------
// Approval (одобрение инструментов)
// ---------------------------------------------------------------------------

/** Запрос на одобрение — отправляется на фронт когда auto-approve не сработал */
export interface ApprovalRequest {
	/** Уникальный ID этого запроса на одобрение */
	id: string
	/** Тип инструмента: "editedExistingFile", "command", "browser_action" и т.д. */
	toolType: string
	/** Данные инструмента для отображения (JSON) */
	toolData: string
	/** Текстовое описание для пользователя */
	description?: string
	/** Конфиг кнопок для этого конкретного approval */
	primaryText?: string
	secondaryText?: string
}

/** Результат одобрения — приходит с фронта */
export interface ApprovalResult {
	approved: boolean
	/** Фидбек пользователя при отклонении */
	feedback?: string
	/** Изображения (если пользователь прикрепил) */
	images?: string[]
	/** Файлы (если пользователь прикрепил) */
	files?: string[]
}

// ---------------------------------------------------------------------------
// Пользовательское сообщение
// ---------------------------------------------------------------------------

/** Сообщение от пользователя — всегда принимается через inject() */
export interface UserMessage {
	text: string
	images?: string[]
	files?: string[]
}

// ---------------------------------------------------------------------------
// Типизированные события сессии
// ---------------------------------------------------------------------------

/** Изменение состояния сессии */
export interface StateChangedEvent {
	type: "state_changed"
	state: SessionState
	/** Причина (для отладки): "user_abort", "api_error", "completed" */
	reason?: string
}

/** Новое сообщение добавлено (append) */
export interface MessageAddedEvent {
	type: "message_added"
	message: ShuncodeMessage
}

/** Обновление существующего сообщения (streaming partial) */
export interface MessageUpdatedEvent {
	type: "message_updated"
	/** Timestamp сообщения для поиска */
	ts: number
	/** Частичное обновление полей */
	patch: Partial<ShuncodeMessage>
}

/** Обновление прогресса конвейера */
export interface ProgressEvent {
	type: "progress"
	progress: PipelineProgress
}

/** Требуется одобрение пользователя */
export interface ApprovalNeededEvent {
	type: "approval_needed"
	approval: ApprovalRequest
}

/** Одобрение разрешено (для UI — убрать из списка pending) */
export interface ApprovalResolvedEvent {
	type: "approval_resolved"
	approvalId: string
	result: "approved" | "rejected"
}

/** Объединённый тип всех событий сессии */
export type SessionEvent =
	| StateChangedEvent
	| MessageAddedEvent
	| MessageUpdatedEvent
	| ProgressEvent
	| ApprovalNeededEvent
	| ApprovalResolvedEvent
