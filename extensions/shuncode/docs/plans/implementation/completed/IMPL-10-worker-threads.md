# IMPL-10: Worker Threads для индексации

> Приоритет: СРЕДНИЙ
> Оценка: 6-8 часов
> Зависимости: нет
> **Статус: ВЫПОЛНЕНО** (2026-02-14)

---

## Цель

Сейчас индексация (embedding вычисления) работает в главном потоке extension host. При больших проектах это блокирует UI — подвисают автодополнения, команды. Перенести вычисление эмбеддингов в отдельный Worker Thread.

## Результат

- Индексация не блокирует extension host
- UI остаётся отзывчивым даже при индексации 10000+ файлов
- Прогресс индексации по-прежнему отображается в UI

---

## Архитектура

```
Extension Host (main thread)
  ├── IndexingService         ← управляет процессом
  │   └── sends chunks to →  EmbeddingWorker (Worker Thread)
  │       ├── loads model
  │       ├── computes embeddings
  │       └── sends results back
  └── SearchEngine           ← принимает результаты, обновляет storage
```

Коммуникация через `worker.postMessage()` / `parentPort.on("message")`.

---

## Файлы

1. **СОЗДАТЬ:** `src/core/indexing/workers/embedding-worker.ts` — Worker Thread
2. **СОЗДАТЬ:** `src/core/indexing/workers/EmbeddingWorkerManager.ts` — менеджер воркера
3. **ИЗМЕНИТЬ:** `src/core/indexing/IndexingService.ts` — использовать воркер вместо прямого вызова
4. **ИЗМЕНИТЬ:** `esbuild.mjs` — добавить entry point для воркера

---

## Шаг 1: Создать Worker Thread

**Файл:** `src/core/indexing/workers/embedding-worker.ts`

```typescript
/**
 * Worker Thread for computing embeddings.
 * Runs in a separate thread to avoid blocking the extension host.
 */
import { parentPort, workerData } from "node:worker_threads"
import * as path from "node:path"

// Types for messages between main thread and worker
interface InitMessage {
	type: "init"
	extensionPath: string
}

interface EmbedMessage {
	type: "embed"
	id: number  // request ID for matching responses
	texts: string[]
}

interface EmbedResult {
	type: "result"
	id: number
	embeddings: number[][]
}

interface ErrorResult {
	type: "error"
	id: number
	message: string
}

interface ReadyMessage {
	type: "ready"
	dimensions: number
}

let pipeline: any = null

async function initModel(extensionPath: string): Promise<void> {
	// Dynamic import of transformers.js
	// Adjust path based on where the bundled worker file ends up
	const { env, pipeline: createPipeline } = await import(
		// NOTE: The path here depends on how esbuild bundles the worker.
		// If the worker is bundled separately, this path may need adjustment.
		// Option 1: Inline the model code
		// Option 2: Pass the path via workerData
		path.join(extensionPath, "vendor/modules/@xenova/transformers/src/transformers.js")
	)

	env.allowLocalModels = true
	env.allowRemoteModels = false
	env.localModelPath = path.join(extensionPath, "models")

	// Use multilingual model (IMPL-01 done — model already in place)
	pipeline = await createPipeline("feature-extraction", "paraphrase-multilingual-MiniLM-L12-v2")

	parentPort?.postMessage({ type: "ready", dimensions: 384 } satisfies ReadyMessage)
}

async function computeEmbeddings(id: number, texts: string[]): Promise<void> {
	if (!pipeline) {
		parentPort?.postMessage({
			type: "error",
			id,
			message: "Model not initialized",
		} satisfies ErrorResult)
		return
	}

	try {
		const results: number[][] = []

		for (let i = 0; i < texts.length; i++) {
			const output = await pipeline([texts[i]], {
				pooling: "mean",
				normalize: true,
			})
			results.push(...output.tolist())
		}

		parentPort?.postMessage({
			type: "result",
			id,
			embeddings: results,
		} satisfies EmbedResult)
	} catch (error) {
		parentPort?.postMessage({
			type: "error",
			id,
			message: error instanceof Error ? error.message : String(error),
		} satisfies ErrorResult)
	}
}

// Listen for messages from main thread
parentPort?.on("message", async (msg: InitMessage | EmbedMessage) => {
	switch (msg.type) {
		case "init":
			await initModel(msg.extensionPath)
			break
		case "embed":
			await computeEmbeddings(msg.id, msg.texts)
			break
	}
})
```

---

## Шаг 2: Создать EmbeddingWorkerManager

**Файл:** `src/core/indexing/workers/EmbeddingWorkerManager.ts`

```typescript
import { Worker } from "node:worker_threads"
import * as path from "node:path"
import type { EmbeddingProvider } from "../types"

/**
 * Manages a Worker Thread for embedding computations.
 * Implements EmbeddingProvider interface so it can be a drop-in replacement.
 */
export class EmbeddingWorkerManager implements EmbeddingProvider {
	readonly id = "local-worker-thread"
	readonly dimensions = 384

	private worker: Worker | null = null
	private ready = false
	private readyPromise: Promise<void> | null = null
	private requestId = 0
	private pendingRequests = new Map<
		number,
		{
			resolve: (embeddings: number[][]) => void
			reject: (error: Error) => void
		}
	>()

	constructor(private readonly extensionPath: string) {}

	/**
	 * Start the worker and load the model.
	 * Call this once during initialization.
	 */
	async start(): Promise<void> {
		if (this.readyPromise) return this.readyPromise

		this.readyPromise = new Promise((resolve, reject) => {
			// Path to the bundled worker file
			// esbuild should bundle embedding-worker.ts into dist/embedding-worker.js
			const workerPath = path.join(this.extensionPath, "dist", "embedding-worker.js")

			this.worker = new Worker(workerPath)

			this.worker.on("message", (msg: any) => {
				switch (msg.type) {
					case "ready":
						this.ready = true
						resolve()
						break
					case "result": {
						const pending = this.pendingRequests.get(msg.id)
						if (pending) {
							pending.resolve(msg.embeddings)
							this.pendingRequests.delete(msg.id)
						}
						break
					}
					case "error": {
						const pendingErr = this.pendingRequests.get(msg.id)
						if (pendingErr) {
							pendingErr.reject(new Error(msg.message))
							this.pendingRequests.delete(msg.id)
						}
						break
					}
				}
			})

			this.worker.on("error", (err) => {
				reject(err)
				// Reject all pending requests
				for (const [id, pending] of this.pendingRequests) {
					pending.reject(err)
				}
				this.pendingRequests.clear()
			})

			this.worker.on("exit", (code) => {
				if (code !== 0) {
					const err = new Error(`Worker exited with code ${code}`)
					for (const [id, pending] of this.pendingRequests) {
						pending.reject(err)
					}
					this.pendingRequests.clear()
				}
				this.ready = false
				this.worker = null
			})

			// Initialize model in worker
			this.worker.postMessage({
				type: "init",
				extensionPath: this.extensionPath,
			})
		})

		return this.readyPromise
	}

	async embed(texts: string[]): Promise<number[][]> {
		if (!this.ready || !this.worker) {
			await this.start()
		}

		if (!this.worker) {
			throw new Error("Worker not available")
		}

		const id = this.requestId++

		return new Promise((resolve, reject) => {
			this.pendingRequests.set(id, { resolve, reject })
			this.worker!.postMessage({ type: "embed", id, texts })
		})
	}

	dispose(): void {
		if (this.worker) {
			this.worker.terminate()
			this.worker = null
		}
		this.ready = false
		this.readyPromise = null
		this.pendingRequests.clear()
	}
}
```

---

## Шаг 3: Добавить entry point в esbuild

**Файл:** `esbuild.mjs`

Найти массив entry points. Добавить worker:

```javascript
// Existing entry points
entryPoints: [
	"src/extension.ts",
	// ... other entries
	"src/core/indexing/workers/embedding-worker.ts",  // ← добавить
],
```

Или если entry points задаются иначе, создать отдельный build step:

```javascript
// Build worker separately
await esbuild.build({
	entryPoints: ["src/core/indexing/workers/embedding-worker.ts"],
	bundle: true,
	outfile: "dist/embedding-worker.js",
	format: "cjs",
	platform: "node",
	target: "node18",
	external: ["vscode"],
})
```

**ВАЖНО:** Worker должен быть отдельным .js файлом в dist/. Он НЕ может быть частью основного бандла расширения.

---

## Шаг 4: Подключить в EmbeddingRouter

**Файл:** `src/core/indexing/EmbeddingRouter.ts`

**Найти:**
```typescript
case "local":
	return new LocalEmbeddingProvider(extensionPath)
```

**Заменить на:**
```typescript
case "local":
	return new EmbeddingWorkerManager(extensionPath)
```

Добавить импорт:
```typescript
import { EmbeddingWorkerManager } from "./workers/EmbeddingWorkerManager"
```

---

## Шаг 5: Обеспечить graceful shutdown

В месте где расширение деактивируется (`deactivate()` в `extension.ts`), добавить:

```typescript
embeddingWorkerManager?.dispose()
```

Или, если используется через IndexingService, убедиться что `IndexingService.dispose()` вызывает `provider.dispose()`.

---

## Проверка

1. Собрать расширение: `node esbuild.mjs`
2. Проверить что `dist/embedding-worker.js` создан
3. Открыть проект, запустить индексацию
4. Во время индексации — UI должен быть отзывчивым (автодополнение работает, команды не зависают)
5. Прогресс индексации отображается корректно
6. Поиск после индексации работает
7. Закрытие VS Code — worker должен завершиться без ошибок (проверить что нет zombie процессов)

### Тест производительности:
- Открыть большой проект (1000+ файлов)
- Замерить: время индексации не должно быть ЗНАЧИТЕЛЬНО больше чем без воркера (overhead ~5-10%)
- Замерить: отзывчивость UI (набор текста, автодополнение) во время индексации
