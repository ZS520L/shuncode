/**
 * Pipeline - трекер стадий выполнения конвейера.
 *
 * Каждый цикл agent loop проходит через типизированные стадии:
 * preparing -> calling_api -> streaming -> tool_execution -> (awaiting_approval) -> completed
 *
 * Pipeline НЕ содержит сам agent loop (он остаётся в Task.recursivelyMakeShuncodeRequests).
 * Pipeline инструментирует существующий loop: Task вызывает pipeline.setStage()
 * при переходах, Pipeline эмитит ProgressEvent для фронтенда.
 *
 * Будущее: agent loop переедет внутрь Pipeline.run() как AsyncGenerator<PipelineEvent>.
 */

import { EventEmitter } from "node:events"
import type {
	PipelineProgress,
	PipelineStage,
	ProgressEvent,
	SessionEvent,
} from "./SessionEvents"

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class Pipeline {
	private _stage: PipelineStage = "preparing"
	private _iteration = 0
	private _isRunning = false
	private readonly emitter = new EventEmitter()

	// -----------------------------------------------------------------------
	// Публичный API (вызывается из Task)
	// -----------------------------------------------------------------------

	/** Текущая стадия */
	get stage(): PipelineStage {
		return this._stage
	}

	/** Текущая итерация */
	get iteration(): number {
		return this._iteration
	}

	/** Работает ли конвейер */
	get isRunning(): boolean {
		return this._isRunning
	}

	/**
	 * start() - начало работы конвейера.
	 * Вызывается один раз в начале initiateTaskLoop.
	 */
	start(): void {
		this._isRunning = true
		this._iteration = 0
		this._stage = "preparing"
		this.emitProgress()
	}

	/**
	 * nextIteration() - начало новой итерации agent loop.
	 * Сбрасывает стадию на "preparing", инкрементирует счётчик.
	 */
	nextIteration(): void {
		this._iteration++
		this._stage = "preparing"
		this.emitProgress()
	}

	/**
	 * setStage() - установить текущую стадию.
	 * Вызывается из Task при переходах между фазами.
	 *
	 * @param stage - новая стадия
	 * @param label - описание (например, имя инструмента)
	 */
	setStage(stage: PipelineStage, label?: string): void {
		this._stage = stage
		this.emitProgress(label)
	}

	/**
	 * complete() - конвейер завершён.
	 */
	complete(): void {
		this._stage = "completed"
		this._isRunning = false
		this.emitProgress()
	}

	// -----------------------------------------------------------------------
	// Подписка на события
	// -----------------------------------------------------------------------

	/**
	 * Подписаться на ProgressEvent от Pipeline.
	 * Session подписывается и форвардит подписчикам.
	 */
	on(listener: (event: SessionEvent) => void): () => void {
		this.emitter.on("event", listener)
		return () => {
			this.emitter.off("event", listener)
		}
	}

	// -----------------------------------------------------------------------
	// Cleanup
	// -----------------------------------------------------------------------

	dispose(): void {
		this._isRunning = false
		this.emitter.removeAllListeners()
	}

	// -----------------------------------------------------------------------
	// Внутренние методы
	// -----------------------------------------------------------------------

	/** Создать и эмитнуть ProgressEvent */
	private emitProgress(label?: string): void {
		const progress: PipelineProgress = {
			stage: this._stage,
			label,
			iteration: this._iteration,
		}

		const event: ProgressEvent = {
			type: "progress",
			progress,
		}

		this.emitter.emit("event", event)
	}
}
