# План 2: Hybrid Search (Semantic + Keyword) [ВЫПОЛНЕНО]

## Статус: ВЫПОЛНЕНО (2026-02-06)

## Цель

Добавить keyword-поиск по содержимому и путям чанков, объединить его с текущим семантическим (vector) поиском. Результат: точные термины (`JWT`, `AutoFAQ`, `Bearer`) находятся даже если embedding-модель их не распознаёт.

## Важно

- НЕ МЕНЯТЬ существующий `VectorSearch.ts` — он остаётся как есть
- НЕ МЕНЯТЬ интерфейс `IndexSearchResult` из `src/shared/IndexingTypes.ts`
- НЕ МЕНЯТЬ `IndexStorage.ts`
- Изменения только в: один новый файл + правки в `SearchEngine.ts`

## Файлы

### Файл 1: `src/core/indexing/storage/KeywordSearch.ts` (НОВЫЙ)

Создать новый файл. Это модуль keyword-поиска по чанкам.

```typescript
/**
 * KeywordSearch — поиск чанков по совпадению ключевых слов.
 *
 * Работает по содержимому чанка (content) и пути файла (filePath).
 * Не требует эмбеддингов — чисто текстовый.
 */
import type { IndexSearchResult } from "@shared/IndexingTypes"
import type { ChunkRow } from "../types"

/**
 * Извлечь ключевые токены из строки запроса.
 * Разбивает по пробелам, приводит к нижнему регистру, убирает короткие (<=2 символа).
 */
function extractTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s\-_.,;:!?(){}[\]<>"'`/\\|@#$%^&*+=~]+/)
    .filter((t) => t.length > 2)
}

/**
 * Посчитать score чанка по keyword-совпадениям.
 *
 * Логика:
 * - За каждый токен, найденный в content → +1 балл
 * - За каждый токен, найденный в filePath → +0.5 балла
 * - Нормализовать: score = совпавших / всего токенов
 *
 * @param chunk — чанк из индекса
 * @param tokens — массив ключевых слов из запроса (уже в lowercase)
 * @returns число от 0 до 1
 */
function scoreChunk(chunk: ChunkRow, tokens: string[]): number {
  if (tokens.length === 0) return 0

  const contentLower = chunk.content.toLowerCase()
  const pathLower = chunk.filePath.toLowerCase()

  let matchScore = 0
  for (const token of tokens) {
    if (contentLower.includes(token)) {
      matchScore += 1.0
    }
    if (pathLower.includes(token)) {
      matchScore += 0.5
    }
  }

  // Нормализовать в диапазон [0, 1]
  const maxPossible = tokens.length * 1.5  // (1.0 content + 0.5 path) per token
  return matchScore / maxPossible
}

/**
 * Поиск чанков по ключевым словам.
 *
 * @param chunks — все чанки из индекса (массив ChunkRow)
 * @param query — текстовый запрос пользователя
 * @param topK — количество результатов
 * @param threshold — минимальный score для включения (по умолчанию 0.15)
 * @returns массив IndexSearchResult, отсортированный по убыванию score
 */
export function keywordSearch(
  chunks: ChunkRow[],
  query: string,
  topK: number = 10,
  threshold: number = 0.15,
): IndexSearchResult[] {
  const tokens = extractTokens(query)
  if (tokens.length === 0) return []

  const scored: Array<{ chunk: ChunkRow; score: number }> = []

  for (const chunk of chunks) {
    const score = scoreChunk(chunk, tokens)
    if (score >= threshold) {
      scored.push({ chunk, score })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  const topResults = scored.slice(0, topK)

  return topResults.map(({ chunk, score }) => ({
    filePath: chunk.filePath,
    content: chunk.content,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    score,
    language: chunk.language,
  }))
}
```

---

### Файл 2: `src/core/indexing/SearchEngine.ts` (ИЗМЕНИТЬ)

Изменить метод `search()` чтобы он делал оба поиска и объединял результаты.

1. Добавить импорт в начало файла:

```typescript
import { keywordSearch } from "./storage/KeywordSearch"
```

2. Заменить метод `search()` полностью:

```typescript
/**
 * Search the codebase index using hybrid approach:
 * semantic (vector) + keyword, then merge.
 *
 * @param query - Natural language query or code snippet
 * @param topK  - Number of top results (default: 10)
 * @returns Array of search results sorted by relevance
 */
async search(query: string, topK: number = 10): Promise<IndexSearchResult[]> {
  // Запросить больше кандидатов от каждого канала, чтобы после merge хватило на topK
  const candidateCount = topK * 2

  // Канал 1: semantic (vector) — через IndexingService
  const semanticResults = await this.indexingService.search(query, candidateCount)

  // Канал 2: keyword — по содержимому и путям чанков
  const chunks = this.indexingService.getStorage().getChunks()
  const keywordResults = keywordSearch(chunks, query, candidateCount)

  // Merge: объединить результаты, нормализовать scores, взвесить
  return this.mergeResults(semanticResults, keywordResults, topK)
}

/**
 * Объединить результаты из двух каналов поиска.
 *
 * Логика:
 * 1. Нормализовать scores обоих каналов в [0, 1]
 * 2. Для каждого уникального чанка: finalScore = 0.65 * semantic + 0.35 * keyword
 * 3. Если чанк найден только одним каналом — второй score = 0
 * 4. Отсортировать по finalScore, взять topK
 */
private mergeResults(
  semanticResults: IndexSearchResult[],
  keywordResults: IndexSearchResult[],
  topK: number,
): IndexSearchResult[] {
  // Нормализация: найти max score в каждом канале
  const semMax = semanticResults.length > 0 ? semanticResults[0].score : 1
  const kwMax = keywordResults.length > 0 ? keywordResults[0].score : 1

  // Собрать все результаты в map по ключу filePath:startLine
  const merged = new Map<string, {
    result: IndexSearchResult
    semScore: number
    kwScore: number
  }>()

  for (const r of semanticResults) {
    const key = `${r.filePath}:${r.startLine}`
    merged.set(key, {
      result: r,
      semScore: semMax > 0 ? r.score / semMax : 0,
      kwScore: 0,
    })
  }

  for (const r of keywordResults) {
    const key = `${r.filePath}:${r.startLine}`
    const existing = merged.get(key)
    if (existing) {
      existing.kwScore = kwMax > 0 ? r.score / kwMax : 0
    } else {
      merged.set(key, {
        result: r,
        semScore: 0,
        kwScore: kwMax > 0 ? r.score / kwMax : 0,
      })
    }
  }

  // Вычислить финальный score и отсортировать
  const SEMANTIC_WEIGHT = 0.65
  const KEYWORD_WEIGHT = 0.35

  const final = Array.from(merged.values()).map((entry) => ({
    ...entry.result,
    score: SEMANTIC_WEIGHT * entry.semScore + KEYWORD_WEIGHT * entry.kwScore,
  }))

  final.sort((a, b) => b.score - a.score)
  return final.slice(0, topK)
}
```

---

### Файл 3: `src/core/indexing/IndexingService.ts` (ИЗМЕНИТЬ)

Добавить публичный метод для доступа к storage (нужен для keyword-поиска):

```typescript
// Добавить в класс IndexingService (в любом месте среди публичных методов):

/** Get the underlying storage (for keyword search access to chunks) */
getStorage(): IndexStorage {
  return this.storage
}
```

Свойство `storage` уже существует как `private readonly storage: IndexStorage`. Метод `getStorage()` просто даёт к нему доступ.

---

### Файл 4: `src/core/indexing/index.ts` (ИЗМЕНИТЬ)

Добавить экспорт:

```typescript
export { keywordSearch } from "./storage/KeywordSearch"
```

---

## Проверка после реализации

1. Собрать: `node esbuild.mjs`
2. Запустить форк
3. Проиндексировать проект
4. В чате Shuncode спросить: `найди autofaq` — должны найтись файлы с "autofaq" в содержимом/пути
5. Спросить: `JWT token generation` — должны найтись и по смыслу, и по ключевому слову "jwt"
6. Спросить: `как работает FileWalker` — semantic должен найти по смыслу, keyword по имени файла

## Параметры для тюнинга

- `SEMANTIC_WEIGHT` / `KEYWORD_WEIGHT` — веса каналов (сейчас 0.65/0.35)
- `threshold` в `keywordSearch` — минимальный keyword-score (сейчас 0.15)
- `candidateCount` — сколько кандидатов брать из каждого канала (сейчас topK * 2)
