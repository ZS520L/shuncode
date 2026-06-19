# План 3: Rerank Rules [ВЫПОЛНЕНО]

## Статус: ВЫПОЛНЕНО (2026-02-06)

## Цель

После объединения результатов hybrid-поиска (План 2) применить набор простых правил для пересортировки. Результат: точнее top-5 результатов, меньше шума от документации/конфигов.

## Важно

- Реализовать ПОСЛЕ Плана 2 (Hybrid Search) — rerank работает поверх merged-результатов
- НЕ МЕНЯТЬ интерфейс `IndexSearchResult`
- НЕ МЕНЯТЬ `VectorSearch.ts`, `KeywordSearch.ts`, `IndexStorage.ts`
- Один новый файл + одна правка в `SearchEngine.ts`

## Файлы

### Файл 1: `src/core/indexing/Reranker.ts` (НОВЫЙ)

Создать новый файл.

```typescript
/**
 * Reranker — пересортировка результатов поиска по набору эвристических правил.
 *
 * Применяется ПОСЛЕ hybrid merge (semantic + keyword).
 * Не использует ML — только быстрые текстовые правила.
 */
import type { IndexSearchResult } from "@shared/IndexingTypes"

/**
 * Извлечь ключевые токены из запроса.
 * Нижний регистр, без коротких слов.
 */
function extractQueryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s\-_.,;:!?(){}[\]<>"'`/\\|@#$%^&*+=~]+/)
    .filter((t) => t.length > 2)
}

/**
 * Правило 1: Бонус за точное совпадение токенов запроса в содержимом.
 *
 * Если в content чанка есть ТОЧНОЕ совпадение токена (не как подстрока,
 * а как отдельное слово/идентификатор), бонус выше.
 *
 * @returns число от 0 до 0.15
 */
function exactTokenBonus(result: IndexSearchResult, tokens: string[]): number {
  if (tokens.length === 0) return 0
  const contentLower = result.content.toLowerCase()

  let matches = 0
  for (const token of tokens) {
    // Проверить как отдельное слово (граница: не буква/цифра/подчёркивание)
    const regex = new RegExp(`(?<![a-z0-9_])${escapeRegex(token)}(?![a-z0-9_])`)
    if (regex.test(contentLower)) {
      matches++
    }
  }

  return (matches / tokens.length) * 0.15
}

/**
 * Правило 2: Бонус за совпадение в имени файла / пути.
 *
 * Если путь к файлу содержит токены запроса — это сильный сигнал.
 * Пример: запрос "jwt" → файл "JwtBearer.cs" → бонус.
 *
 * @returns число от 0 до 0.10
 */
function pathBonus(result: IndexSearchResult, tokens: string[]): number {
  if (tokens.length === 0) return 0
  const pathLower = result.filePath.toLowerCase()

  let matches = 0
  for (const token of tokens) {
    if (pathLower.includes(token)) {
      matches++
    }
  }

  return (matches / tokens.length) * 0.10
}

/**
 * Правило 3: Бонус за "кодовые сигналы".
 *
 * Если чанк содержит определения (class, function, export, interface),
 * он более ценен чем комментарий или конфиг.
 *
 * @returns 0 или 0.05
 */
function codeSignalBonus(result: IndexSearchResult): number {
  const content = result.content
  const hasDefinition = /^(export\s+)?(function|class|interface|enum|struct|impl|def|async\s+function)\s/m.test(content)
  return hasDefinition ? 0.05 : 0
}

/**
 * Правило 4: Штраф за "шумные" файлы.
 *
 * README, документация, миграции, тесты — менее полезны для general-purpose запросов.
 * Штраф мягкий — они всё равно могут попасть в top при высоком score.
 *
 * @returns число от -0.08 до 0
 */
function noisePenalty(result: IndexSearchResult): number {
  const pathLower = result.filePath.toLowerCase()

  // README / docs
  if (pathLower.includes("readme") || pathLower.includes("/docs/") || pathLower.includes("\\docs\\")) {
    return -0.05
  }

  // Миграции
  if (pathLower.includes("migration") || pathLower.includes("/migrations/") || pathLower.includes("\\migrations\\")) {
    return -0.04
  }

  // Тестовые файлы (мягкий штраф)
  if (pathLower.includes(".test.") || pathLower.includes(".spec.") || pathLower.includes("__tests__")) {
    return -0.03
  }

  // Конфиги
  if (pathLower.endsWith(".json") || pathLower.endsWith(".yaml") || pathLower.endsWith(".yml") || pathLower.endsWith(".toml")) {
    return -0.02
  }

  return 0
}

/**
 * Правило 5: Бонус за несколько токенов подряд (фразовое совпадение).
 *
 * Если 2+ токена запроса идут подряд в content — это почти точное совпадение фразы.
 * Пример: запрос "jwt token generation" → в content есть "jwt token" подряд.
 *
 * @returns число от 0 до 0.10
 */
function phraseBonus(result: IndexSearchResult, tokens: string[]): number {
  if (tokens.length < 2) return 0
  const contentLower = result.content.toLowerCase()

  let consecutiveMatches = 0
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = tokens[i] + " " + tokens[i + 1]
    const bigramUnderscore = tokens[i] + "_" + tokens[i + 1]
    const bigramCamel = tokens[i] + tokens[i + 1]
    if (contentLower.includes(bigram) || contentLower.includes(bigramUnderscore) || contentLower.includes(bigramCamel)) {
      consecutiveMatches++
    }
  }

  if (consecutiveMatches === 0) return 0
  return Math.min((consecutiveMatches / (tokens.length - 1)) * 0.10, 0.10)
}

/**
 * Escape специальные символы для RegExp.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Применить rerank-правила к массиву результатов.
 *
 * @param results — массив IndexSearchResult (уже отсортированный после hybrid merge)
 * @param query — исходный запрос пользователя
 * @returns пересортированный массив
 */
export function rerank(results: IndexSearchResult[], query: string): IndexSearchResult[] {
  const tokens = extractQueryTokens(query)

  const reranked = results.map((r) => {
    const bonus =
      exactTokenBonus(r, tokens) +
      pathBonus(r, tokens) +
      codeSignalBonus(r) +
      noisePenalty(r) +
      phraseBonus(r, tokens)

    return {
      ...r,
      score: r.score + bonus,
    }
  })

  reranked.sort((a, b) => b.score - a.score)
  return reranked
}
```

---

### Файл 2: `src/core/indexing/SearchEngine.ts` (ИЗМЕНИТЬ)

1. Добавить импорт в начало:

```typescript
import { rerank } from "./Reranker"
```

2. В методе `search()` (который был изменён в Плане 2), после `mergeResults` добавить rerank.

Найти строку:

```typescript
return this.mergeResults(semanticResults, keywordResults, topK)
```

Заменить на:

```typescript
const merged = this.mergeResults(semanticResults, keywordResults, topK * 2)
return rerank(merged, query).slice(0, topK)
```

Пояснение: берём больше кандидатов из merge (topK * 2), прогоняем через rerank, затем обрезаем до topK. Это даёт rerank пространство для перестановки.

---

### Файл 3: `src/core/indexing/index.ts` (ИЗМЕНИТЬ)

Добавить экспорт:

```typescript
export { rerank } from "./Reranker"
```

---

## Проверка после реализации

1. Собрать: `node esbuild.mjs`
2. Запустить форк
3. Спросить в чате: `найди JwtBearer` — файл с "JwtBearer" в пути должен быть выше чем просто комментарий
4. Спросить: `autofaq operators orchestrator` — файл с "orchestrator" в пути должен быть в top-3
5. Спросить: `как работает индексация` — код `IndexingService.ts` должен быть выше чем `README.md` или `INDEXING_SYSTEM.md`

## Параметры для тюнинга

Все бонусы/штрафы — числа в функциях. Если нужно усилить/ослабить:

- `exactTokenBonus`: сейчас до +0.15 → увеличить если точные термины недостаточно поднимаются
- `pathBonus`: сейчас до +0.10 → увеличить если файлы с правильным именем слишком низко
- `codeSignalBonus`: сейчас +0.05 → увеличить если определения должны быть важнее
- `noisePenalty`: сейчас до -0.08 → увеличить если README/тесты засоряют результаты
- `phraseBonus`: сейчас до +0.10 → увеличить если фразовые совпадения должны доминировать
