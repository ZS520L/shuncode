/**
 * Session — единица разговора. Заменяет controller.task.
 *
 * Ключевые отличия от Task:
 * - inject() ВСЕГДА работает — без маршрутизации, без "AI работает?"
 * - Состояние (state) — реальное, не угадываемое из сообщений
 * - События (SessionEvent) — инкрементальные, не дамп всего state
 * - Готова для табов: каждая Session независима
 *
 * Шаг 1 (текущий): Session оборачивает существующий Task как адаптер.
 * Шаг 2+: Task рефакторится внутри, внешний интерфейс Session стабилен.
 */

import { EventEmitter } from "node:events"
import type { ShuncodeMessage } from "@shared/ExtensionMessage"
import type { Task } from "../task"
import { Pipeline } from "./Pipeline"
import type {
	ApprovalResult,
	PipelineProgress,
	SessionEvent,
	SessionState,
	UserMessage,
} from "./SessionEvents"

// ---------------------------------------------------------------------------
// Типизированный EventEmitter для SessionEvent
// ---------------------------------------------------------------------------

export interface SessionEventMap {
	event: [SessionEvent]
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export class Session {
	readonly id: string
	private _state: SessionState = "idle"
	private _messages: ShuncodeMessage[] = []
	private _progress: PipelineProgress | null = null
	private readonly _pendingApprovals: Map<string, (result: ApprovalResult) => void> = new Map()

	/** Внутренний EventEmitter -- подписчики получают SessionEvent */
	private readonly emitter = new EventEmitter()

	/**
	 * Pipeline -- трекер стадий выполнения.
	 * Эмитит ProgressEvent при смене стадии, Session форвардит подписчикам.
	 */
	private readonly _pipeline: Pipeline = new Pipeline()
	private _pipelineUnsubscribe: (() => void) | null = null

	/**
	 * Адаптер: ссылка на существующий Task.
	 * На шаге 1 Session делегирует работу Task.
	 * На следующих шагах Task будет вынесен в Pipeline внутри Session.
	 */
	private _task: Task | null = null

	constructor(id: string) {
		this.id = id
		// Forward pipeline events к подписчикам Session
		this._pipelineUnsubscribe = this._pipeline.on((event) => {
			if (event.type === "progress") {
				this._progress = event.progress
			}
			this.emit(event)
		})
	}

	// -----------------------------------------------------------------------
	// Публичный API — стабильный контракт для фронтенда и контроллера
	// -----------------------------------------------------------------------

	/** Текущее состояние сессии (реальное, не угадываемое) */
	get state(): SessionState {
		return this._state
	}

	/** Список сообщений (append-only) */
	get messages(): ReadonlyArray<ShuncodeMessage> {
		return this._messages
	}

	/** Текущий прогресс конвейера */
	get progress(): PipelineProgress | null {
		return this._progress
	}

	/** Pipeline -- трекер стадий выполнения */
	get pipeline(): Pipeline {
		return this._pipeline
	}

	/** Ссылка на Task (адаптер, для миграции) */
	get task(): Task | null {
		return this._task
	}

	/**
	 * Привязать Task к сессии (адаптер на время миграции).
	 * После полного перехода на Pipeline — этот сеттер исчезнет.
	 */
	setTask(task: Task | null): void {
		this._task = task
		if (task) {
			this.setState("running")
		} else {
			this.setState("idle")
		}
	}

	/**
	 * inject() — отправить сообщение в сессию.
	 * ВСЕГДА работает. Не блокирует. Не требует маршрутизации.
	 *
	 * - Если сессия idle: запускает новую итерацию (через Task/Pipeline)
	 * - Если сессия running: ставит в внутреннюю очередь
	 * - Если сессия paused/done: обрабатывает как продолжение разговора
	 */
	inject(msg: UserMessage): void {
		// Шаг 1 (адаптер): делегируем в Task через handleWebviewAskResponse
		// На следующих шагах это станет прямым вызовом Pipeline
		if (this._task) {
			// Если task ожидает ответа (есть pending ask) — отвечаем
			if (this._task.taskState.lastMessageTs !== undefined) {
				this._task.handleWebviewAskResponse("messageResponse", msg.text, msg.images, msg.files)
			}
		}
	}

	/**
	 * abort() — мягкая остановка сессии.
	 * Не уничтожает — приостанавливает и позволяет возобновить.
	 */
	abort(): void {
		if (this._task) {
			this._task.abortTask()
		}
		this.setState("paused")
	}

	/**
	 * pause() — приостановить на чекпоинте (будущее).
	 * Пока alias для abort.
	 */
	pause(): void {
		this.abort()
	}

	/**
	 * resume() — возобновить из чекпоинта (будущее).
	 */
	resume(): void {
		this.setState("running")
	}

	// -----------------------------------------------------------------------
	// Управление состоянием
	// -----------------------------------------------------------------------

	/** Изменить состояние и эмитнуть событие */
	setState(state: SessionState, reason?: string): void {
		if (this._state === state) return
		this._state = state
		this.emit({
			type: "state_changed",
			state,
			reason,
		})
	}

	/** Добавить сообщение и эмитнуть событие */
	addMessage(message: ShuncodeMessage): void {
		this._messages.push(message)
		this.emit({
			type: "message_added",
			message,
		})
	}

	/** Обновить сообщение (streaming partial) */
	updateMessage(ts: number, patch: Partial<ShuncodeMessage>): void {
		const idx = this._messages.findIndex((m) => m.ts === ts)
		if (idx !== -1) {
			this._messages[idx] = { ...this._messages[idx], ...patch }
			this.emit({
				type: "message_updated",
				ts,
				patch,
			})
		}
	}

	/** Обновить прогресс конвейера */
	setProgress(progress: PipelineProgress): void {
		this._progress = progress
		this.emit({
			type: "progress",
			progress,
		})
	}

	/** Очистить прогресс (конвейер завершён) */
	clearProgress(): void {
		this._progress = null
	}

	// -----------------------------------------------------------------------
	// Подписка на события
	// -----------------------------------------------------------------------

	/** Подписаться на все события сессии */
	on(listener: (event: SessionEvent) => void): () => void {
		this.emitter.on("event", listener)
		return () => {
			this.emitter.off("event", listener)
		}
	}

	/** Эмитнуть событие всем подписчикам */
	private emit(event: SessionEvent): void {
		this.emitter.emit("event", event)
	}

	// -----------------------------------------------------------------------
	// Cleanup
	// -----------------------------------------------------------------------

	/** Очистить сессию */
	dispose(): void {
		this._pipelineUnsubscribe?.()
		this._pipelineUnsubscribe = null
		this._pipeline.dispose()
		this._task = null
		this._messages = []
		this._pendingApprovals.clear()
		this.emitter.removeAllListeners()
	}
}
