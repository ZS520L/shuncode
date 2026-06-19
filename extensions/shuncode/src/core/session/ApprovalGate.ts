/**
 * ApprovalGate - Promise-based замена pWaitFor для ask/response.
 *
 * Вместо поллинга глобальной переменной каждые 100мс,
 * создаём Promise + resolver для каждого ask-запроса.
 * Когда приходит ответ с фронта - резолвим промис по ID.
 *
 * Преимущества:
 * - Нет поллинга (100ms interval)
 * - Нет глобальных переменных (taskState.askResponse)
 * - Нет гонок (каждый ask имеет уникальный ID)
 * - Несколько pending approvals одновременно (будущее)
 */

import type { ShuncodeAskResponse } from "@shared/WebviewMessage"

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

/** Результат одобрения, возвращаемый из ask() */
export interface AskResult {
	response: ShuncodeAskResponse
	text?: string
	images?: string[]
	files?: string[]
}

/** Внутренняя запись pending approval */
interface PendingAsk {
	resolve: (result: AskResult) => void
	reject: (error: Error) => void
	type: string
	createdAt: number
}

// ---------------------------------------------------------------------------
// ApprovalGate
// ---------------------------------------------------------------------------

export class ApprovalGate {
	/** Pending approvals: askTs -> resolver */
	private readonly pending: Map<number, PendingAsk> = new Map()

	/** Pre-arrived responses: queued when handleResponse arrives before waitForResponse.
	 *  This solves the race condition in resend flow:
	 *  deleteFromMessage → cancelTask → initTask (fire-and-forget) → webview sends response
	 *  → but task's ask() hasn't been called yet → response would be dropped.
	 *  Instead, we queue it and deliver when waitForResponse is called. */
	private readonly earlyResponses: AskResult[] = []

	/**
	 * waitForResponse - заменяет pWaitFor в task.ask().
	 *
	 * Создаёт Promise, который резолвится когда приходит
	 * handleResponse() с совпадающим askTs.
	 *
	 * @param askTs - timestamp ask-сообщения (уникальный ID запроса)
	 * @param type - тип ask (для отладки)
	 * @returns Promise<AskResult> - ответ пользователя
	 */
	waitForResponse(askTs: number, type: string): Promise<AskResult> {
		// Если предыдущий ask с другим ts ещё pending - отменяем его
		// (аналог проверки lastMessageTs !== askTs в старом коде)
		for (const [ts, pending] of this.pending) {
			if (ts !== askTs) {
				pending.reject(new Error("Current ask promise was ignored"))
				this.pending.delete(ts)
			}
		}

		// Check if a response already arrived before we started waiting (race condition fix)
		if (this.earlyResponses.length > 0) {
			const early = this.earlyResponses.shift()!
			console.log(`[ApprovalGate] Delivering early response for ask ${type} (ts=${askTs}): ${early.response}`)
			return Promise.resolve(early)
		}

		return new Promise<AskResult>((resolve, reject) => {
			this.pending.set(askTs, {
				resolve,
				reject,
				type,
				createdAt: Date.now(),
			})
		})
	}

	/**
	 * handleResponse - заменяет handleWebviewAskResponse.
	 *
	 * Резолвит pending Promise для данного askTs.
	 * Если askTs не указан, резолвит последний pending ask
	 * (обратная совместимость с текущим фронтендом).
	 * If no pending ask exists, queues the response for later delivery.
	 *
	 * @param response - тип ответа (yesButtonClicked/noButtonClicked/messageResponse)
	 * @param text - текст сообщения
	 * @param images - изображения
	 * @param files - файлы
	 * @param askTs - опциональный ID запроса (для будущего per-approval routing)
	 */
	handleResponse(
		response: ShuncodeAskResponse,
		text?: string,
		images?: string[],
		files?: string[],
		askTs?: number,
	): boolean {
		if (askTs !== undefined) {
			// Точное совпадение по ID
			const target = this.pending.get(askTs)
			if (target) {
				this.pending.delete(askTs)
				target.resolve({ response, text, images, files })
				return true
			}
			// No pending ask for this ts — queue for later
			console.log(`[ApprovalGate] No pending ask for ts=${askTs}, queueing early response`)
			this.earlyResponses.push({ response, text, images, files })
			return true
		}

		// Обратная совместимость: резолвим последний pending ask
		// (текущий фронтенд не шлёт askTs)
		const entries = Array.from(this.pending.entries())
		const last = entries.at(-1)
		if (last) {
			const [lastTs, target] = last
			this.pending.delete(lastTs)
			target.resolve({ response, text, images, files })
			return true
		}

		// No pending ask at all — queue for later delivery
		console.log(`[ApprovalGate] No pending ask found, queueing early response: ${response}`)
		this.earlyResponses.push({ response, text, images, files })
		return true
	}

	/**
	 * Отменить все pending запросы (при abort/cancel).
	 */
	rejectAll(reason: string = "Task aborted"): void {
		for (const [, pending] of this.pending) {
			pending.reject(new Error(reason))
		}
		this.pending.clear()
		this.earlyResponses.length = 0
	}

	/**
	 * Отменить конкретный pending запрос.
	 */
	reject(askTs: number, reason: string = "Ask superseded"): void {
		const pending = this.pending.get(askTs)
		if (pending) {
			this.pending.delete(askTs)
			pending.reject(new Error(reason))
		}
	}

	/**
	 * Есть ли pending запросы?
	 */
	get hasPending(): boolean {
		return this.pending.size > 0
	}

	/**
	 * Количество pending запросов.
	 */
	get pendingCount(): number {
		return this.pending.size
	}

	/**
	 * Очистить без reject (для cleanup).
	 */
	clear(): void {
		this.pending.clear()
		this.earlyResponses.length = 0
	}
}
