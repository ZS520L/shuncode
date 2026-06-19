# План 4: SQLite Storage [ВЫПОЛНЕНО]

## Статус: ВЫПОЛНЕНО (2026-02-06)

## Цель

Заменить текущее хранилище (JSON файлы + flat binary) на SQLite. Результат: быстрая загрузка/сохранение, нормальные инкрементальные обновления без перезаписи всего файла, меньше потребление RAM на больших индексах (44K+ чанков).

## Важно

- `@vscode/sqlite3` уже установлен в основном проекте VS Code (зависимость в `vscode/package.json`)
- НЕ МЕНЯТЬ интерфейсы `ChunkRow`, `IndexMetadata` из `src/core/indexing/types.ts`
- НЕ МЕНЯТЬ интерфейс `IndexSearchResult` из `src/shared/IndexingTypes.ts`
- НЕ МЕНЯТЬ `VectorSearch.ts` — он работает с тем что даёт storage
- Текущий `IndexStorage.ts` полностью ЗАМЕНЯЕТСЯ новой реализацией
- Новый `IndexStorage` должен реализовать ВСЕ те же публичные методы что и текущий

## Публичные методы текущего IndexStorage (контракт, который нельзя сломать)

```typescript
class IndexStorage {
  constructor(workspacePath: string)
  load(): Promise<boolean>
  save(): Promise<void>
  clear(): Promise<void>
  beginIndexing(embeddingProviderId: string, dimensions: number): void
  addChunks(newChunks: ChunkRow[], newVectors: number[][]): void
  finalize(): Promise<void>
  removeFile(filePath: string): number
  isFileChanged(filePath: string, currentHash: string): boolean
  getChunks(): ChunkRow[]
  getVector(offset: number): Float32Array
  getAllVectors(): Float32Array
  getDimensions(): number
  getMetadata(): IndexMetadata | null
  getStats(): { totalChunks: number; totalFiles: number; lastIndexedAt: number }
}
```

## Файлы

### Файл 1: `src/core/indexing/storage/IndexStorage.ts` (ЗАМЕНИТЬ ПОЛНОСТЬЮ)

Заменить весь файл новой реализацией на SQLite.

Схема базы данных:

```sql
-- Таблица метаданных индекса (одна строка)
CREATE TABLE IF NOT EXISTS metadata (
  id INTEGER PRIMARY KEY DEFAULT 1,
  embedding_provider_id TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  last_indexed_at INTEGER NOT NULL DEFAULT 0,
  total_chunks INTEGER NOT NULL DEFAULT 0
);

-- Таблица чанков
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  content TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  language TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  vector BLOB NOT NULL
);

-- Индекс для быстрого поиска/удаления по файлу
CREATE INDEX IF NOT EXISTS idx_chunks_file_path ON chunks(file_path);

-- Индекс для проверки hash
CREATE INDEX IF NOT EXISTS idx_chunks_file_hash ON chunks(file_path, file_hash);
```

Важные решения:
- Вектор хранится как BLOB (Buffer из Float32Array) в каждой строке чанка
- Это позволяет удалять/добавлять чанки без пересчёта offsets
- При поиске: загружаем все векторы в память (SELECT vector FROM chunks), строим Float32Array
- При загрузке (`load()`): читаем chunks и vectors в память (для совместимости с VectorSearch)

Реализация:

```typescript
/**
 * IndexStorage — хранилище индекса на SQLite.
 *
 * Структура на диске:
 *   ~/.shuncode/indexing/{workspace-hash}/
 *     index.db — SQLite база с метаданными, чанками и векторами
 *
 * Векторы хранятся как BLOB в таблице chunks (Float32Array → Buffer).
 * При load() загружаются в память для быстрого cosine similarity.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import * as crypto from "node:crypto"
import * as os from "node:os"
import type { ChunkRow, IndexMetadata } from "../types"

function getIndexBaseDir(): string {
  return path.join(os.homedir(), ".shuncode", "indexing")
}

function workspaceHash(workspacePath: string): string {
  return crypto.createHash("sha256").update(workspacePath).digest("hex").slice(0, 16)
}

export class IndexStorage {
  private indexDir: string
  private dbPath: string
  private db: any = null  // better-sqlite3 или @vscode/sqlite3 instance

  // In-memory кэш для быстрого поиска (совместимость с VectorSearch)
  private chunks: ChunkRow[] = []
  private vectors: Float32Array = new Float32Array(0)
  private metadata: IndexMetadata | null = null
  private dimensions: number = 0

  constructor(workspacePath: string) {
    const hash = workspaceHash(workspacePath)
    this.indexDir = path.join(getIndexBaseDir(), hash)
    this.dbPath = path.join(this.indexDir, "index.db")
  }

  private async ensureDir(): Promise<void> {
    await fs.promises.mkdir(this.indexDir, { recursive: true })
  }

  /**
   * Открыть или создать SQLite базу.
   * Использовать better-sqlite3 (синхронный, быстрый, уже есть в экосистеме VS Code).
   */
  private openDb(): void {
    if (this.db) return
    // better-sqlite3 — синхронный драйвер, идеально для extension host
    const Database = require("better-sqlite3")
    this.db = new Database(this.dbPath)
    this.db.pragma("journal_mode = WAL")  // WAL режим для параллельного чтения
    this.db.pragma("synchronous = NORMAL")  // Баланс скорости/надёжности
    this.createTables()
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        id INTEGER PRIMARY KEY DEFAULT 1,
        embedding_provider_id TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        last_indexed_at INTEGER NOT NULL DEFAULT 0,
        total_chunks INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        content TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        language TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        vector BLOB NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_file_path ON chunks(file_path);
      CREATE INDEX IF NOT EXISTS idx_chunks_file_hash ON chunks(file_path, file_hash);
    `)
  }

  /**
   * Загрузить индекс из SQLite в память.
   * Возвращает false если БД не существует или пуста.
   */
  async load(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.dbPath)) return false
      await this.ensureDir()
      this.openDb()

      // Загрузить метаданные
      const metaRow = this.db.prepare("SELECT * FROM metadata WHERE id = 1").get()
      if (!metaRow) return false

      this.metadata = {
        embeddingProviderId: metaRow.embedding_provider_id,
        dimensions: metaRow.dimensions,
        lastIndexedAt: metaRow.last_indexed_at,
        totalChunks: metaRow.total_chunks,
      }
      this.dimensions = metaRow.dimensions

      // Загрузить чанки и собрать vectors в flat Float32Array
      const rows = this.db.prepare("SELECT * FROM chunks").all()
      this.chunks = []
      const vectorArrays: Float32Array[] = []

      for (const row of rows) {
        const vectorBuf = row.vector as Buffer
        const vec = new Float32Array(vectorBuf.buffer, vectorBuf.byteOffset, vectorBuf.byteLength / 4)
        const vectorOffset = vectorArrays.length > 0
          ? vectorArrays.reduce((sum, v) => sum + v.length, 0)
          : 0

        this.chunks.push({
          id: row.id,
          filePath: row.file_path,
          content: row.content,
          startLine: row.start_line,
          endLine: row.end_line,
          language: row.language,
          vectorOffset,
          fileHash: row.file_hash,
        })

        vectorArrays.push(vec)
      }

      // Склеить все векторы в один Float32Array
      const totalLength = vectorArrays.reduce((sum, v) => sum + v.length, 0)
      this.vectors = new Float32Array(totalLength)
      let offset = 0
      for (const v of vectorArrays) {
        this.vectors.set(v, offset)
        offset += v.length
      }

      return this.chunks.length > 0
    } catch {
      this.chunks = []
      this.vectors = new Float32Array(0)
      this.metadata = null
      return false
    }
  }

  /**
   * Сохранить текущее состояние в SQLite.
   * Вызывается из finalize().
   */
  async save(): Promise<void> {
    // Данные уже в SQLite благодаря addChunks/removeFile.
    // save() обновляет только метаданные.
    if (!this.db || !this.metadata) return

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO metadata (id, embedding_provider_id, dimensions, last_indexed_at, total_chunks)
      VALUES (1, ?, ?, ?, ?)
    `)
    stmt.run(
      this.metadata.embeddingProviderId,
      this.metadata.dimensions,
      this.metadata.lastIndexedAt,
      this.metadata.totalChunks,
    )
  }

  /**
   * Очистить весь индекс.
   */
  async clear(): Promise<void> {
    if (this.db) {
      try { this.db.close() } catch { /* ignore */ }
      this.db = null
    }
    this.chunks = []
    this.vectors = new Float32Array(0)
    this.metadata = null
    this.dimensions = 0

    try {
      await fs.promises.rm(this.indexDir, { recursive: true, force: true })
    } catch { /* ignore */ }
  }

  /**
   * Начать новую сессию индексации.
   * Очищает таблицу chunks в БД.
   */
  beginIndexing(embeddingProviderId: string, dimensions: number): void {
    this.chunks = []
    this.vectors = new Float32Array(0)
    this.dimensions = dimensions
    this.metadata = {
      embeddingProviderId,
      dimensions,
      lastIndexedAt: 0,
      totalChunks: 0,
    }

    // Подготовить БД
    // Используем fs.mkdirSync чтобы не делать async в sync-методе
    fs.mkdirSync(this.indexDir, { recursive: true })
    this.openDb()

    // Очистить старые данные
    this.db.exec("DELETE FROM chunks")
    this.db.exec("DELETE FROM metadata")
  }

  /**
   * Добавить батч чанков с векторами.
   * Пишет сразу в SQLite (в транзакции) и в in-memory кэш.
   */
  addChunks(newChunks: ChunkRow[], newVectors: number[][]): void {
    if (newChunks.length !== newVectors.length) {
      throw new Error("Chunks and vectors arrays must have the same length")
    }
    if (newChunks.length === 0) return

    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO chunks (id, file_path, content, start_line, end_line, language, file_hash, vector)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertMany = this.db.transaction((chunks: ChunkRow[], vectors: number[][]) => {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        const vec = new Float32Array(vectors[i])
        const vecBuf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)

        insertStmt.run(
          chunk.id,
          chunk.filePath,
          chunk.content,
          chunk.startLine,
          chunk.endLine,
          chunk.language,
          chunk.fileHash,
          vecBuf,
        )
      }
    })

    insertMany(newChunks, newVectors)

    // Обновить in-memory кэш
    const startOffset = this.vectors.length
    for (let i = 0; i < newChunks.length; i++) {
      newChunks[i].vectorOffset = startOffset + i * this.dimensions
      this.chunks.push(newChunks[i])
    }

    const flatVectors = new Float32Array(newVectors.length * this.dimensions)
    for (let i = 0; i < newVectors.length; i++) {
      flatVectors.set(newVectors[i], i * this.dimensions)
    }

    const combined = new Float32Array(this.vectors.length + flatVectors.length)
    combined.set(this.vectors)
    combined.set(flatVectors, this.vectors.length)
    this.vectors = combined
  }

  /**
   * Завершить сессию индексации.
   */
  async finalize(): Promise<void> {
    if (this.metadata) {
      this.metadata.lastIndexedAt = Date.now()
      this.metadata.totalChunks = this.chunks.length
    }
    await this.save()
  }

  /**
   * Удалить все чанки файла.
   */
  removeFile(filePath: string): number {
    const before = this.chunks.length

    // Удалить из SQLite
    if (this.db) {
      this.db.prepare("DELETE FROM chunks WHERE file_path = ?").run(filePath)
    }

    // Удалить из in-memory кэша
    this.chunks = this.chunks.filter((c) => c.filePath !== filePath)
    // Примечание: vectors в памяти содержат orphan-слоты.
    // Они корректно пересоздаются при следующем load() или beginIndexing().

    return before - this.chunks.length
  }

  /**
   * Проверить изменился ли файл.
   */
  isFileChanged(filePath: string, currentHash: string): boolean {
    // Сначала проверить in-memory кэш (быстро)
    const existing = this.chunks.find((c) => c.filePath === filePath)
    if (!existing) return true
    return existing.fileHash !== currentHash
  }

  // --- Методы доступа к данным (для VectorSearch и KeywordSearch) ---

  getChunks(): ChunkRow[] {
    return this.chunks
  }

  getVector(offset: number): Float32Array {
    return this.vectors.slice(offset, offset + this.dimensions)
  }

  getAllVectors(): Float32Array {
    return this.vectors
  }

  getDimensions(): number {
    return this.dimensions
  }

  getMetadata(): IndexMetadata | null {
    return this.metadata
  }

  getStats(): { totalChunks: number; totalFiles: number; lastIndexedAt: number } {
    const uniqueFiles = new Set(this.chunks.map((c) => c.filePath))
    return {
      totalChunks: this.chunks.length,
      totalFiles: uniqueFiles.size,
      lastIndexedAt: this.metadata?.lastIndexedAt ?? 0,
    }
  }
}
```

---

### Файл 2: `vscode/extensions/shuncode/esbuild.mjs` (ИЗМЕНИТЬ)

Добавить `better-sqlite3` в массив external (нативный модуль, нельзя бандлить):

Найти строку:

```javascript
external: ["vscode", "onnxruntime-node"],
```

Заменить на:

```javascript
external: ["vscode", "onnxruntime-node", "better-sqlite3"],
```

---

### Файл 3: Установка зависимости

Выполнить в `vscode/extensions/shuncode/`:

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

`better-sqlite3` — синхронный SQLite3 драйвер для Node.js. Быстрый, стабильный, широко используется.

---

### Файл 4: Миграция со старого формата

При первом запуске после обновления у пользователя на диске будут старые файлы:
- `index.json`
- `chunks.json`
- `vectors.bin`

В методе `load()` нового `IndexStorage` уже есть логика: если `index.db` не существует — возвращает `false`. Это значит, что `IndexingService.initialize()` запустит полную переиндексацию. Старые файлы останутся на диске, но не будут использоваться.

Если хочется явно удалить старые файлы, добавить в `load()` после успешной загрузки из SQLite:

```typescript
// Очистить старые JSON-файлы если они ещё есть
const oldFiles = ["index.json", "chunks.json", "vectors.bin"]
for (const f of oldFiles) {
  const p = path.join(this.indexDir, f)
  try { fs.unlinkSync(p) } catch { /* ignore */ }
}
```

---

## Проверка после реализации

1. Удалить папку `~/.shuncode/indexing/` чтобы начать с чистого состояния
2. Собрать: `node esbuild.mjs`
3. Запустить форк
4. Нажать "Переиндексировать"
5. Проверить что в `~/.shuncode/indexing/{hash}/` создался файл `index.db` (а не JSON файлы)
6. Проверить размер `index.db` — должен быть компактнее чем `chunks.json` + `vectors.bin`
7. Перезапустить форк — индекс должен загрузиться из SQLite (не переиндексировать заново)
8. Проверить поиск в чате

## Риски

- `better-sqlite3` — нативный модуль, нужна компиляция под платформу (Windows/macOS/Linux)
- Если `better-sqlite3` не подходит — альтернатива: `@vscode/sqlite3` (уже есть в зависимостях VS Code)
- При использовании `@vscode/sqlite3` вместо `better-sqlite3`: API асинхронный, нужно переделать sync-вызовы (beginIndexing, addChunks, removeFile) на async
- На 44K чанков SQLite transaction INSERT будет ~2-5 секунд (быстро)
- WAL-режим позволяет читать во время записи — поиск не блокируется индексацией
