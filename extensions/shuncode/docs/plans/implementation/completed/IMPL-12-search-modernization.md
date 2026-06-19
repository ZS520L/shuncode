# IMPL-12: Модернизация поиска — подробная инструкция

## Зачем это нужно (контекст)

Shuncode AI использует **два механизма поиска** по кодовой базе:

1. **`codebase_search`** — семантический поиск (по смыслу).
   Как в Cursor: файлы нарезаются на куски (функции, классы), каждый кусок превращается в вектор (embedding) через AI-модель, хранится в индексе. При поиске запрос тоже превращается в вектор, и ищутся ближайшие по смыслу куски. Работает **быстро** (вся тяжёлая работа — на этапе индексации, а поиск — простое сравнение векторов).

2. **`search_files`** — grep/regex поиск (по тексту, через ripgrep).
   Каждый раз при вызове ripgrep пробегает по файлам на диске. На больших проектах (40k+ файлов) — дорого по CPU.

**Принцип Cursor**: Agent использует оба механизма вместе. Семантический поиск для поиска по смыслу ("где обработка авторизации?"), grep — для точных паттернов (`TODO:`, `functionName(`). Семантический поиск быстрее и дешевле, потому что тяжёлые вычисления делаются при индексации, а не в рантайме.

**Проблема**: слабые модели склонны использовать `search_files` с широкими regex на весь проект → CPU 100%, долгие ответы, плохие результаты. Нужно направить модель на `codebase_search` как первый инструмент.

---

## Что уже сделано ✅

### ✅ Этап 1 — Порядок инструментов (все 11 вариантов + шаблон)

`CODEBASE_SEARCH` переставлен **перед** `SEARCH` в массиве `.tools()` всех 12 файлов.

**Проверено**: во всех файлах `variants/*/config.ts` и `config.template.ts` порядок такой:
```
ShuncodeDefaultTool.CODEBASE_SEARCH,
ShuncodeDefaultTool.SEARCH,
```

### ✅ Этап 1.1 — Фикс бага xs

В `variants/xs/config.ts` добавлены:
- `ShuncodeDefaultTool.LIST_FILES`
- `ShuncodeDefaultTool.LIST_CODE_DEF`

Ранее промпт xs упоминал эти инструменты, но они не были зарегистрированы.

### ✅ Этап 2 — Guardrails в SearchFilesToolHandler

В `src/core/task/tools/handlers/SearchFilesToolHandler.ts` реализовано:

1. **`SAFE_FILE_PATTERN`** (строка 22): если модель даёт широкий запрос без `file_pattern`, автоматически применяется паттерн:
   ```
   *.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,cs,rb,php,vue,svelte,c,cpp,h,hpp}
   ```

2. **`isBroadRegex()`** (строка 229): детектирует слишком общие regex (< 3 символов, или литералы < 6 символов без метасимволов).

3. **`buildIndexShortlistPaths()`** (строка 191): если запрос широкий (корень проекта + нет file_pattern + broad regex), сначала запрашивает у семантического индекса топ-8 кандидатов и сужает поиск ripgrep до директорий этих кандидатов — стратегия `index_first`.

4. **Телеметрия**: при срабатывании guardrail логируются события `search_guardrail_triggered`, `search_files_safe_profile_applied`.

### ✅ Этап 3 — Оптимизация ripgrep

В `src/services/ripgrep/index.ts` реализовано:

| Параметр | Значение | Строка | Что делает |
|----------|----------|--------|------------|
| `RG_MAX_COUNT` | 500 | 59 | `--max-count 500` — ripgrep останавливает обход файла после 500 совпадений |
| `RG_THREADS` | 4 | 60 | `--threads 4` — не больше 4 потоков, чтобы один search не сжирал все ядра |
| `RG_TIMEOUT_MS` | 15000 | 61 | Если ripgrep не завершился за 15 сек → `rgProcess.kill()` + ошибка "timed out" |
| `--fixed-strings` | авто | 63-66, 145-147 | `isLikelyLiteralPattern()` — если regex без метасимволов, добавляется `--fixed-strings` для ускорения |
| `MAX_RESULTS` | 300 | 58 | Лимит на количество результатов в выводе |
| `MAX_BYTE_SIZE` | 0.25 MB | 199-200 | Лимит на размер выходных данных |

### ✅ Этап 5 (частично) — Телеметрия поиска

Реализованы методы в `TelemetryService.ts`:
- `captureSearchGuardrailTriggered()`
- `captureSearchStrategyChosen()`
- `captureSearchFilesProfileApplied()`
- `captureSearchFilesTimeout()`

---

## Что осталось сделать ❌

### Задача A: Усилить промпт generic-варианта

**Статус**: единственный вариант с неявной инструкцией по приоритету поиска.

**Файл**: `src/core/prompts/system-prompt/variants/generic/template.ts`

**Текущий текст** (строка 83):
```typescript
- Prefer using codebase_search (for semantic/conceptual questions) and search_files (for exact patterns) and list_files to discover information instead of asking the user. Only use ask_followup_question when the information cannot be found in the codebase.
```

**Проблема**: нет слова "first" — модель не понимает, что `codebase_search` нужно вызывать ПЕРВЫМ.

**Что сделать**:
1. Открой файл `src/core/prompts/system-prompt/variants/generic/template.ts`
2. Найди строку 83 (внутри секции `<tool_usage>`)
3. Замени этот пункт на:

```typescript
- Tool routing policy for code discovery:
  - For understanding code, finding logic, or exploring: call codebase_search FIRST. It finds code by meaning and context, and is faster than grep because heavy computation happens at indexing time, not at search time.
  - For exact text patterns, identifiers, and regex: use search_files with a narrow path and file_pattern.
  - If codebase_search returns weak results, fall back to search_files with concrete keywords from the semantic results.
  - NEVER start with a broad search_files on the workspace root without file_pattern — use codebase_search or list_files first to narrow the scope.
```

**Как проверить**:
- Открой VS Code
- `Developer: Reload Window`
- Попроси модель (generic variant) найти какую-нибудь логику — она должна вызвать `codebase_search` первым

**Все остальные 10 вариантов уже имеют явное "first":**

| Вариант | Что написано | Файл |
|---------|-------------|------|
| devstral | "call `codebase_search` first" (через default rules.ts) | components/rules.ts:18 |
| next-gen | "prefer codebase_search first" | variants/next-gen/template.ts:62 |
| gpt-5 | "prefer codebase_search first" | variants/gpt-5/template.ts:66 |
| gemini-3 | "prefer codebase_search first" | variants/gemini-3/overrides.ts:137 |
| native-gpt-5 | "codebase_search first for semantic discovery" | variants/native-gpt-5/template.ts:73 |
| native-gpt-5-1 | "codebase_search first for semantic discovery" | variants/native-gpt-5-1/overrides.ts:56 |
| native-next-gen | "codebase_search first for semantic discovery" | variants/native-next-gen/template.ts:86 |
| xs | "codebase_search — Use first for where/how" | variants/xs/overrides.ts:91 |
| glm | "codebase_search first for semantic queries" | variants/glm/overrides.ts:8 |
| hermes | "codebase_search first for semantic queries" | variants/hermes/overrides.ts:19 |

---

### Задача B: Двухступенчатый поиск для слабых моделей (xs, glm, hermes)

**Статус**: не начато. Это **улучшение**, а не исправление бага. Можно отложить.

**Идея** (на основе Cursor's подхода):
Cursor использует семантический поиск как первый этап — он быстрый, потому что тяжёлые вычисления (embedding) делаются при индексации, а не в рантайме. Потом результаты семантического поиска уточняются grep'ом.

Мы хотим встроить это поведение в промпт слабых моделей:
- **Discover**: сначала `codebase_search` (или `list_files`) для получения shortlist директорий
- **Inspect**: потом `search_files` только по shortlist

**Что сделать** (3 подзадачи):

#### B.1 — Добавить правило в промпт xs

**Файл**: `src/core/prompts/system-prompt/variants/xs/overrides.ts`

Найди константу `XS_RULES` (строка 26). Внутри, после правила "Prefer list/search/read tools over asking" добавь новое правило:

```typescript
- ALWAYS narrow search scope before calling search_files. Use codebase_search or list_files first to identify relevant directories, then search_files only in those directories.
```

#### B.2 — Жёсткий guardrail для слабых моделей

**Файл**: `src/core/task/tools/handlers/SearchFilesToolHandler.ts`

Сейчас `execute()` применяет мягкий guardrail (safe file pattern + shortlist). Для слабых моделей добавить **жёсткий режим**:

1. Добавь метод для определения «слабой» модели:

```typescript
private isWeakModel(config: TaskConfig): boolean {
    const modelId = config.api.getModel().id.toLowerCase()
    return (
        modelId.includes("xs") ||
        modelId.includes("compact") ||
        modelId.includes("glm") ||
        modelId.includes("hermes") ||
        modelId.includes("qwen2") ||
        modelId.includes("phi-")
    )
}
```

2. В `execute()`, после блока `if (missingPattern && broadRegex && searchesWorkspaceRoot)` (строка 337), добавь:

```typescript
if (this.isWeakModel(config) && searchesWorkspaceRoot && missingPattern) {
    // Жёсткий режим для слабых моделей: запретить поиск по всему корню без file_pattern
    return `[Guardrail] Your search is too broad for the workspace root. Please:
1. Use codebase_search first to find relevant directories.
2. Then call search_files with a specific path and file_pattern.
Example: search_files with path="src/core" and file_pattern="*.ts"`
}
```

**Внимание**: это агрессивное изменение. Модель получит текстовый ответ вместо результатов поиска и должна будет сузить запрос. Нужно протестировать на реальных задачах.

#### B.3 — Auto-rewrite (path="." → shortlist из индекса)

Уже частично реализовано в `buildIndexShortlistPaths()`. Проверь, что он работает для path=`.` и path=корень проекта. Если `effectiveSearchPaths` остаётся пустым (индекс не готов), текущий код фоллбэчит на полный scan с safe file pattern — это нормально.

**Как проверить B.1–B.3**:
- Перебилдь extension: `node esbuild.mjs` в `extensions/shuncode/`
- `Developer: Reload Window`
- Используй xs-вариант (compact модель)
- Дай запрос "найди где обработка авторизации" — модель должна вызвать `codebase_search` первым
- Дай запрос с прямым search_files по корню без file_pattern — должен сработать guardrail

---

### Задача C: Расширить телеметрию

**Статус**: базовая телеметрия есть. Не хватает метрик latency и CPU.

**Файлы**:
- `src/services/telemetry/TelemetryService.ts`
- `src/core/task/tools/handlers/SearchFilesToolHandler.ts`
- `src/core/task/tools/handlers/CodebaseSearchToolHandler.ts`

**Что сделать**:

#### C.1 — Логировать latency search_files

В `SearchFilesToolHandler.ts`, переменная `searchDurationMs` уже считается (строка 370). Добавь логирование для p95 анализа:

```typescript
// После строки 370 (const searchDurationMs = ...)
if (searchDurationMs > 5000) {
    Logger.warn(`[Search] Slow search_files: ${Math.round(searchDurationMs)}ms, regex="${regex}", path="${relDirPath}", pattern="${effectiveFilePattern}"`)
}
```

#### C.2 — Логировать какой инструмент модель вызвала первым

Это делается на уровне TaskExecutor, а не SearchFilesToolHandler. Если ты хочешь видеть полную картину — нужно добавить счётчик в TaskExecutor, который отслеживает порядок вызовов инструментов в рамках одной задачи. Это сложная задача, **пропусти её** если нет опыта с TaskExecutor.

#### C.3 — Event для CPU-heavy запусков

Добавь в TelemetryService новый метод:

```typescript
public captureSearchSlowQuery(
    ulid: string,
    durationMs: number,
    scope: "workspace_root" | "subdir" | "multi_root",
    regex: string,
    filePattern: string | undefined,
): void {
    this.captureEvent("search_files_slow_query", {
        ulid,
        durationMs,
        scope,
        regexLength: regex.length,
        hasFilePattern: !!filePattern,
    })
}
```

И вызови его в `SearchFilesToolHandler.ts` после `searchDurationMs`:

```typescript
if (searchDurationMs > 5000) {
    telemetryService.captureSearchSlowQuery(config.ulid, searchDurationMs, scope, regex, effectiveFilePattern)
}
```

---

## Приоритет выполнения

| # | Задача | Сложность | Время | Эффект |
|---|--------|-----------|-------|--------|
| A | Промпт generic | Лёгкая | 15 мин | Высокий — закрывает последний вариант без "first" |
| B.1 | Правило в промпт xs | Лёгкая | 10 мин | Средний — улучшает поведение слабых моделей |
| C.1 | Лог медленных поисков | Лёгкая | 10 мин | Средний — видимость проблем |
| C.3 | Телеметрия slow query | Лёгкая | 15 мин | Средний — данные для анализа |
| B.2 | Жёсткий guardrail | Средняя | 30 мин | Высокий, но рискованный — может сломать легитимные поиски |
| B.3 | Auto-rewrite | — | — | Уже реализовано через buildIndexShortlistPaths() |
| C.2 | Порядок вызовов | Сложная | 1-2 часа | Низкий — аналитика, не функциональность |

**Минимальный rollout (30 минут)**: Задачи A + B.1 + C.1

**Полный rollout (2-3 часа)**: Всё вышеперечисленное

---

## Как собрать и проверить

1. Перебилдь extension:
   ```powershell
   cd D:\Users\Admin\Desktop\Shuncode\vscode\extensions\shuncode
   node esbuild.mjs
   ```

2. Перебилдь webview (только если трогал UI):
   ```powershell
   cd D:\Users\Admin\Desktop\Shuncode\vscode\extensions\shuncode\webview-ui
   npm run build
   ```

3. В VS Code: `Developer: Reload Window` (Ctrl+Shift+P → "Reload")

4. Тесты:
   - Задай вопрос "где обрабатывается авторизация" → должен вызваться `codebase_search` первым
   - Задай запрос на поиск конкретного текста `TODO:` → должен вызваться `search_files`
   - Посмотри лог в Output → Shuncode: нет ошибок, guardrail срабатывает при широких запросах

---

## Definition of Done

- [x] `CODEBASE_SEARCH` стоит перед `SEARCH` во всех 11 variant config + template ✅
- [x] Баг xs исправлен: `LIST_FILES` и `LIST_CODE_DEF` добавлены в `.tools()` ✅
- [x] В `ripgrep`-слое есть `--max-count`, `--threads`, таймаут ✅
- [x] `search_files` имеет guardrails (мягкий) и безопасный профиль ✅
- [x] Базовая телеметрия поиска работает ✅
- [x] **Задача A**: Промпт generic-варианта усилен с явным "first" ✅
- [x] **Задача B.1**: Промпт xs содержит правило "narrow scope before search_files" ✅
- [x] **Задача B.2**: Жёсткий guardrail для слабых моделей (опционально) ✅
- [x] **Задача C.1**: Лог медленных поисков (> 5 сек) ✅
- [x] **Задача C.3**: Телеметрия slow query ✅
