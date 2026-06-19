/**
 * SessionManager — управляет сессиями. Заменяет controller.task.
 *
 * Сейчас: одна активная сессия (как было с Task).
 * Будущее: несколько сессий = табы в UI.
 *
 * Ключевое: SessionManager НЕ знает про Task.
 * Он оперирует Session, а Session сама решает что внутри
 * (сейчас — адаптер над Task, потом — Pipeline).
 */

import { Session } from "./Session"

export class SessionManager {
	/** Все сессии (id -> Session) */
	private readonly sessions: Map<string, Session> = new Map()

	/** ID текущей активной сессии */
	private _activeSessionId: string | null = null

	// -----------------------------------------------------------------------
	// Публичный API
	// -----------------------------------------------------------------------

	/** Создать новую сессию */
	create(id?: string): Session {
		const sessionId = id || this.generateId()
		const session = new Session(sessionId)
		this.sessions.set(sessionId, session)

		// Если нет активной — делаем эту активной
		if (!this._activeSessionId) {
			this._activeSessionId = sessionId
		}

		return session
	}

	/** Получить сессию по ID */
	get(id: string): Session | undefined {
		return this.sessions.get(id)
	}

	/** Текущая активная сессия (для обратной совместимости с controller.task) */
	get currentSession(): Session | null {
		if (!this._activeSessionId) return null
		return this.sessions.get(this._activeSessionId) || null
	}

	/** ID активной сессии */
	get activeSessionId(): string | null {
		return this._activeSessionId
	}

	/**
	 * Переключить активную сессию (будущее: табы).
	 * Не останавливает предыдущую — она продолжает работать в фоне.
	 */
	switchTo(id: string): void {
		if (!this.sessions.has(id)) {
			throw new Error(`Session ${id} not found`)
		}
		this._activeSessionId = id
	}

	/** Удалить сессию */
	remove(id: string): void {
		const session = this.sessions.get(id)
		if (session) {
			session.dispose()
			this.sessions.delete(id)

			// Если удалили активную — переключаемся
			if (this._activeSessionId === id) {
				const remaining = Array.from(this.sessions.keys())
				this._activeSessionId = remaining.length > 0 ? remaining[0] : null
			}
		}
	}

	/** Очистить текущую сессию (аналог clearTask) */
	clearCurrent(): void {
		if (this._activeSessionId) {
			this.remove(this._activeSessionId)
		}
	}

	/** Все сессии (для UI: список табов) */
	getAll(): Session[] {
		return Array.from(this.sessions.values())
	}

	/** Количество сессий */
	get size(): number {
		return this.sessions.size
	}

	/** Очистить всё */
	dispose(): void {
		for (const session of this.sessions.values()) {
			session.dispose()
		}
		this.sessions.clear()
		this._activeSessionId = null
	}

	// -----------------------------------------------------------------------
	// Приватное
	// -----------------------------------------------------------------------

	private generateId(): string {
		return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
	}
}
