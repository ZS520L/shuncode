# IMPL-13: Реальные исправления качества поиска

> Проблема: слабая локальная embedding-модель (`paraphrase-multilingual-MiniLM-L12-v2`, 384-dim, WASM) не предназначена для поиска по коду. Результаты semantic search на уровне шума.
>
> Этот план содержит 6 задач. Каждая задача — самостоятельная, можно делать по одной. Порядок = приоритет.

---

## ЗАДАЧА 1: Обогащение чанков метаданными перед embedding

### Суть проблемы
Сейчас в embedding идёт голый код без контекста. Модель не знает, из какого файла этот код. Запрос "autofaq" не совпадёт семантически с кодом `class AutofaqService { ... }`, если модель не видит имя файла.

### Что делать
**Файл:** `vscode/extensions/shuncode/src/core/indexing/IndexingService.ts`

**Найти** в методе `startIndexing()` (примерно строка 354-358):
```typescript
const content = await fs.promises.readFile(file.absPath, "utf-8")
const hash = crypto.createHash("md5").update(content).digest("hex")
const chunks = await chunkFile(file.relPath, content)
for (const chunk of chunks) {
    allChunks.push({ chunk, fileHash: hash })
}
```

**Заменить на:**
```typescript
const content = await fs.promises.readFile(file.absPath, "utf-8")
const hash = crypto.createHash("md5").update(content).digest("hex")
const chunks = await chunkFile(file.relPath, content)
for (const chunk of chunks) {
    // Prepend file metadata to chunk content for better embedding quality.
    // The embedding model will associate the code with its file path and language.
    // This is critical for weak models that can't infer context from code alone.
    chunk.content = `// File: ${chunk.filePath}\n// Language: ${chunk.language}\n${chunk.content}`
    allChunks.push({ chunk, fileHash: hash })
}
```

**Также** в методе `onFileChanged()` (примерно строка 237-239):
```typescript
const chunks = await chunkFile(relPath, content)
if (chunks.length === 0) return
```

**Заменить на:**
```typescript
const chunks = await chunkFile(relPath, content)
if (chunks.length === 0) return

// Prepend file metadata for better embedding quality
for (const chunk of chunks) {
    chunk.content = `// File: ${chunk.filePath}\n// Language: ${chunk.language}\n${chunk.content}`
}
```

### Проверка
После изменения: пересобрать extension (`node esbuild.mjs`), перезагрузить Extension Host, переиндексировать (кнопка "Reindex"). Запросить "autofaq" — файлы с "autofaq" в пути должны получить более высокий semantic score.

### Важно
- НЕ менять `chunk.content` для `KeywordSearch` — keyword search работает по оригинальному контенту, а `getChunks()` вернёт уже обогащённые чанки. Это ОК — keyword search ищет по `content`, а там теперь есть и путь файла.
- Обогащение добавляет ~50-100 символов к каждому чанку. Это незначительно.

---

## ЗАДАЧА 2: Усечение чанков вместо пропуска в embedding

### Суть проблемы
Сейчас в `LocalEmbeddingProvider.ts` чанки > 10000 символов полностью пропускаются (возвращается zero-vector). Эти чанки потом фильтруются в `IndexingService` и НЕ попадают в индекс. Данные теряются.

### Что делать
**Файл:** `vscode/extensions/shuncode/src/core/indexing/providers/LocalEmbeddingProvider.ts`

**Найти** (строки 67-79):
```typescript
const results: number[][] = []
const MAX_CHUNK_CHARS = 10000 // Skip chunks that are too large (causes stack overflow in tokenizer)

// Process one chunk at a time to avoid blocking the extension host
for (let i = 0; i < texts.length; i++) {
    const text = texts[i]

    // Skip chunks that are too large - they cause stack overflow in tokenizer
    if (text.length > MAX_CHUNK_CHARS) {
        console.warn(`[Shuncode Indexing] Skipping chunk ${i}: too large (${text.length} chars > ${MAX_CHUNK_CHARS})`)
        // Push zero vector as placeholder to maintain array alignment
        results.push(new Array(this.dimensions).fill(0))
        continue
    }
```

**Заменить на:**
```typescript
const results: number[][] = []
// MiniLM model has ~512 token context window.
// ~4 chars per token on average → ~2000 chars is a safe limit.
// We TRUNCATE instead of skipping, so data still enters the index.
const MAX_EMBED_CHARS = 2000

// Process one chunk at a time to avoid blocking the extension host
for (let i = 0; i < texts.length; i++) {
    let text = texts[i]

    // Truncate text that exceeds model's effective context window.
    // The model only sees the first ~512 tokens anyway — truncating explicitly
    // is better than letting the tokenizer silently truncate or crash.
    if (text.length > MAX_EMBED_CHARS) {
        text = text.slice(0, MAX_EMBED_CHARS)
    }
```

### Проверка
После изменения: пересобрать extension, переиндексировать. В логах НЕ должно быть "Skipping chunk N: too large". Все чанки должны получить ненулевые embeddings.

### Важно
- Удалить строку `console.warn(...)` и строку `results.push(new Array(this.dimensions).fill(0))` и строку `continue` — они больше не нужны.
- НЕ удалять блок `catch` ниже — он обрабатывает другие ошибки embedding.

---

## ЗАДАЧА 3: Уменьшить MAX_CHUNK_LINES до 35

### Суть проблемы
Модель `paraphrase-multilingual-MiniLM-L12-v2` видит максимум ~512 токенов. При 60 строках кода это ~1200-4000 символов, из которых модель обрабатывает только начало. Меньшие чанки = больше данных реально проиндексировано.

### Что делать
**Файл:** `vscode/extensions/shuncode/src/core/indexing/CodeChunker.ts`

**Найти** (строка 18):
```typescript
const MAX_CHUNK_LINES = 60
```

**Заменить на:**
```typescript
const MAX_CHUNK_LINES = 35
```

**Файл:** `vscode/extensions/shuncode/src/core/indexing/TreeSitterChunker.ts`

**Найти** (строка 10):
```typescript
const MAX_CHUNK_LINES = 80
```

**Заменить на:**
```typescript
const MAX_CHUNK_LINES = 45
```

### Проверка
После изменения: пересобрать, переиндексировать. Количество чанков увеличится (это нормально). Каждый чанк будет меньше и лучше покрыт embedding-моделью.

### Важно
- TreeSitter чанки оставляем чуть больше (45 vs 35), потому что tree-sitter делает осмысленные чанки (функция целиком), а simple chunker режет по пустым строкам.
- Не менять `MIN_CHUNK_LINES` и `OVERLAP_LINES`.

---

## ЗАДАЧА 4: File-path search — отдельный этап поиска по именам файлов

### Суть проблемы
Если пользователь ищет "autofaq", а в проекте есть файл `autofaq.service.ts` — этот файл должен быть в топе результатов НЕЗАВИСИМО от embedding score. Сейчас file-path search существует только как бонус в `KeywordSearch` и `Reranker`, но не как отдельный этап.

### Что делать
**Файл:** `vscode/extensions/shuncode/src/core/indexing/SearchEngine.ts`

**Найти** (строка 1-10):
```typescript
/**
 * SearchEngine — public API for semantic codebase search.
 *
 * Wraps IndexingService.search() and provides additional utilities
 * like formatting results for injection into AI prompts.
 */
import type { IndexSearchResult } from "@shared/IndexingTypes"
import type { IndexingService } from "./IndexingService"
import { rerankResults } from "./Reranker"
import { keywordSearch } from "./storage/KeywordSearch"
```

**Заменить на:**
```typescript
/**
 * SearchEngine — public API for semantic codebase search.
 *
 * Wraps IndexingService.search() and provides additional utilities
 * like formatting results for injection into AI prompts.
 */
import type { IndexSearchResult } from "@shared/IndexingTypes"
import type { IndexingService } from "./IndexingService"
import { rerankResults } from "./Reranker"
import { keywordSearch } from "./storage/KeywordSearch"
import type { ChunkRow } from "./types"
```

**Далее** добавить новую функцию ПЕРЕД `export class SearchEngine` (перед строкой 57):

```typescript
/**
 * Search for chunks whose file path contains one of the query tokens.
 * This is a fast, exact-match search that does not depend on embeddings.
 * Ensures that files named after the search term always appear in results.
 */
function filePathSearch(chunks: ChunkRow[], query: string, topK: number): IndexSearchResult[] {
	const tokens = query
		.toLowerCase()
		.split(/[\s\-_.,;:!?()[\]{}<>"/\\|@#$%^&*+=~`']+/)
		.filter((t) => t.length >= 3)

	if (tokens.length === 0) {
		return []
	}

	const scored: Array<{ chunk: ChunkRow; score: number }> = []

	for (const chunk of chunks) {
		const pathLower = chunk.filePath.toLowerCase()
		const fileName = pathLower.split(/[/\\]/).pop() || ""
		let score = 0

		for (const token of tokens) {
			// Strong match: token is in filename (e.g. "autofaq" in "autofaq.service.ts")
			if (fileName.includes(token)) {
				score += 1.0
			}
			// Weaker match: token is in directory path
			else if (pathLower.includes(token)) {
				score += 0.3
			}
		}

		if (score > 0) {
			// Normalize by number of tokens
			scored.push({ chunk, score: score / tokens.length })
		}
	}

	scored.sort((a, b) => b.score - a.score)
	return scored.slice(0, topK).map(({ chunk, score }) => ({
		filePath: chunk.filePath,
		content: chunk.content,
		startLine: chunk.startLine,
		endLine: chunk.endLine,
		score,
		language: chunk.language,
	}))
}
```

**Далее** в методе `search()` класса `SearchEngine`, **после** строки с `keywordResults` (после `console.log` keyword) добавить file-path search:

**Найти:**
```typescript
		const merged = this.mergeResults(semanticResults, keywordResults, candidateCount, nonLatin, mixedQuery)
```

**Заменить на:**
```typescript
		// File-path search: find chunks by matching query tokens against file names.
		// This catches cases where the embedding model fails but the file is clearly named.
		const filePathResults = filePathSearch(chunks, query, candidateCount)

		const merged = this.mergeResults(semanticResults, keywordResults, filePathResults, candidateCount, nonLatin, mixedQuery)
```

**Далее** изменить сигнатуру и тело `mergeResults`:

**Найти всё определение `mergeResults`** (строки 133-185) и **заменить на:**
```typescript
	private mergeResults(
		semanticResults: IndexSearchResult[],
		keywordResults: IndexSearchResult[],
		filePathResults: IndexSearchResult[],
		topK: number,
		nonLatinQuery: boolean = false,
		mixedQuery: boolean = false,
	): IndexSearchResult[] {
		const semMax = semanticResults.length > 0 ? Math.max(semanticResults[0].score, 1e-6) : 1
		const kwMax = keywordResults.length > 0 ? Math.max(keywordResults[0].score, 1e-6) : 1
		const fpMax = filePathResults.length > 0 ? Math.max(filePathResults[0].score, 1e-6) : 1
		const merged = new Map<
			string,
			{
				result: IndexSearchResult
				semScore: number
				kwScore: number
				fpScore: number
			}
		>()

		for (const result of semanticResults) {
			const key = `${result.filePath}:${result.startLine}:${result.endLine}`
			merged.set(key, {
				result,
				semScore: result.score / semMax,
				kwScore: 0,
				fpScore: 0,
			})
		}

		for (const result of keywordResults) {
			const key = `${result.filePath}:${result.startLine}:${result.endLine}`
			const existing = merged.get(key)
			if (existing) {
				existing.kwScore = result.score / kwMax
			} else {
				merged.set(key, {
					result,
					semScore: 0,
					kwScore: result.score / kwMax,
					fpScore: 0,
				})
			}
		}

		for (const result of filePathResults) {
			const key = `${result.filePath}:${result.startLine}:${result.endLine}`
			const existing = merged.get(key)
			if (existing) {
				existing.fpScore = result.score / fpMax
			} else {
				merged.set(key, {
					result,
					semScore: 0,
					kwScore: 0,
					fpScore: result.score / fpMax,
				})
			}
		}

		// Weights: semantic + keyword + file-path
		// File-path gets fixed weight (always valuable for exact identifier matches)
		const SEMANTIC_WEIGHT = nonLatinQuery ? (mixedQuery ? 0.60 : 0.75) : 0.50
		const KEYWORD_WEIGHT = nonLatinQuery ? (mixedQuery ? 0.20 : 0.10) : 0.30
		const FILEPATH_WEIGHT = nonLatinQuery ? (mixedQuery ? 0.20 : 0.15) : 0.20

		const finalResults = Array.from(merged.values()).map(({ result, semScore, kwScore, fpScore }) => ({
			...result,
			score: SEMANTIC_WEIGHT * semScore + KEYWORD_WEIGHT * kwScore + FILEPATH_WEIGHT * fpScore,
		}))

		finalResults.sort((a, b) => b.score - a.score)
		return finalResults.slice(0, topK)
	}
```

### Проверка
Пересобрать extension. Запросить "autofaq". Файлы с "autofaq" в имени должны быть в топ-3 результатов даже если semantic score низкий.

### Важно
- Веса: semantic=0.50, keyword=0.30, filepath=0.20 для Latin-запросов. Filepath даёт 20% итогового score.
- Для non-Latin запросов semantic вес выше, потому что keyword и filepath бесполезны для кириллицы.

---

## ЗАДАЧА 5: Вернуть нормальные threshold'ы

### Суть проблемы
Предыдущая модель снизила threshold'ы (VectorSearch: 0.2→0.1, KeywordSearch: 0.15→0.05), чтобы "получить больше результатов". Со слабой embedding-моделью это даёт шум вместо качества.

### Что делать
**Файл:** `vscode/extensions/shuncode/src/core/indexing/storage/VectorSearch.ts`

**Найти** (строка 46):
```typescript
	threshold: number = 0.1,
```

**Заменить на:**
```typescript
	threshold: number = 0.15,
```

**Файл:** `vscode/extensions/shuncode/src/core/indexing/storage/KeywordSearch.ts`

**Найти** (строка 49):
```typescript
	threshold: number = 0.05,
```

**Заменить на:**
```typescript
	threshold: number = 0.1,
```

### Проверка
Пересобрать. Результатов может быть меньше, но они будут более релевантные.

---

## ЗАДАЧА 6: Убрать verbose logging, добавить debug-флаг

### Суть проблемы
В `SearchEngine.ts` 6 вызовов `console.log` на КАЖДЫЙ поисковый запрос. В продакшене это мусор.

### Что делать
**Файл:** `vscode/extensions/shuncode/src/core/indexing/SearchEngine.ts`

Добавить в начало файла (после импортов, перед функциями):
```typescript
/** Enable verbose search logging via VS Code setting */
function isDebugEnabled(): boolean {
	try {
		const vscode = require("vscode")
		return vscode.workspace.getConfiguration("shuncode.indexing").get("debug", false)
	} catch {
		return false
	}
}
```

Затем **заменить** ВСЕ 6 вызовов `console.log(...)` внутри метода `search()` на:
```typescript
if (isDebugEnabled()) console.log(...)
```

То есть каждый `console.log(` заменить на `if (isDebugEnabled()) console.log(`.

Конкретно строки:
- `console.log(`[Shuncode Search] Query:...` → `if (isDebugEnabled()) console.log(`[Shuncode Search] Query:...`
- `console.log(`[Shuncode Search] Semantic:...` → `if (isDebugEnabled()) console.log(`[Shuncode Search] Semantic:...`
- `console.log(`[Shuncode Search] Keyword:...` → `if (isDebugEnabled()) console.log(`[Shuncode Search] Keyword:...`
- `console.log(`[Shuncode Search] Merged:...` → `if (isDebugEnabled()) console.log(`[Shuncode Search] Merged:...`
- `console.log(`[Shuncode Search] Reranked:...` → `if (isDebugEnabled()) console.log(`[Shuncode Search] Reranked:...`
- `console.log(`[Shuncode Search] Final:...` → `if (isDebugEnabled()) console.log(`[Shuncode Search] Final:...`

### Проверка
По умолчанию логи не выводятся. Для отладки: `shuncode.indexing.debug: true` в настройках.

---

## Порядок сборки и проверки

После КАЖДОЙ задачи:
1. `cd vscode/extensions/shuncode && node esbuild.mjs` — пересобрать extension
2. В VS Code: Ctrl+Shift+P → "Developer: Reload Window"
3. После задач 1, 2, 3: нужна переиндексация (вкладка Indexing → Reindex)
4. Проверить запрос "autofaq" — должны быть файлы с autofaq в топе

## Что НЕ входит в этот план

- Замена embedding-модели на серверную (text-embedding-3-small) — отдельный IMPL, требует UI для выбора модели
- ANN-индекс вместо brute-force — не нужен до 100K+ чанков
- Замена локальной модели на code-специфичную — требует исследования совместимости с transformers.js WASM
