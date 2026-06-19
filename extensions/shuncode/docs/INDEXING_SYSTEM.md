# Shuncode AI — Система индексации кодовой базы

## Обзор

Семантическая индексация кодовой базы для интеллектуального поиска по коду. Позволяет AI-модели получать релевантный контекст из проекта перед ответом.

Работает полностью локально по умолчанию (`transformers.js`, WASM), с опцией подключения удалённого API.

---

## Архитектура

```
IndexingService (оркестратор) — src/core/indexing/IndexingService.ts
├── FileWalker (обход файлов)
│   └── Учитывает .gitignore, ignoredPatterns, maxFileSize, бинарные файлы
├── CodeChunker (разбивка на чанки)
│   └── Tree-sitter chunking (с fallback на simple chunker)
├── EmbeddingRouter → выбор провайдера
│   ├── LocalEmbeddingProvider (transformers.js WASM + paraphrase-multilingual-MiniLM-L12-v2)
│   └── RemoteEmbeddingProvider (OpenAI-compatible /v1/embeddings API)
├── Storage
│   ├── IndexStorage (SQLite по умолчанию, JSON fallback при недоступном native)
│   └── VectorSearch (brute-force cosine similarity на in-memory векторах)
└── SearchEngine (hybrid search: semantic + keyword + rerank + форматирование для промптов)
```

## Структура файлов

```
src/core/indexing/
  index.ts                     — barrel exports
  types.ts                     — EmbeddingProvider, ChunkRow, IndexMetadata
  IndexingService.ts           — оркестратор (запуск, пауза, прогресс, FileWatcher)
  SearchEngine.ts              — фасад поиска + getContextForPrompt()
  searchEngineInstance.ts      — singleton экземпляр SearchEngine
  FileWalker.ts                — async generator обхода файлов
  CodeChunker.ts               — разбивка файлов на чанки
  EmbeddingRouter.ts           — фабрика провайдеров по конфигу
  progressCache.ts             — кэш прогресса индексации
  RepoMapGenerator.ts          — генерация карты репозитория
  providers/
    LocalEmbeddingProvider.ts  — transformers.js WASM (офлайн, без native-модулей)
    RemoteEmbeddingProvider.ts — HTTP клиент для OpenAI-совместимых API
  storage/
    IndexStorage.ts            — чтение/запись индекса (SQLite + JSON fallback)
    VectorSearch.ts            — cosine similarity поиск
    KeywordSearch.ts           — keyword поиск для hybrid retrieval
  workers/
    embedding-worker.ts        — Worker для эмбеддингов (разгрузка главного потока)
    EmbeddingWorkerManager.ts  — менеджер worker'ов
  TreeSitterChunker.ts         — AST-aware chunking через web-tree-sitter
  Reranker.ts                  — post-retrieval rerank rules

src/shared/IndexingTypes.ts    — типы, общие для backend и webview

vendor/modules/@xenova/transformers/         — vendored transformers.js runtime
models/paraphrase-multilingual-MiniLM-L12-v2/ — мультиязычная ONNX модель эмбеддингов
models/all-MiniLM-L6-v2/                     — legacy модель (не используется)
```

## Конфигурация (VS Code Settings)

Все настройки в `package.json` → `contributes.configuration`:

| Ключ | Тип | По умолчанию | Описание |
|------|-----|-------------|----------|
| `shuncode.indexing.mode` | `"off" \| "local" \| "remote"` | `"local"` | Режим индексации |
| `shuncode.indexing.remoteApiUrl` | `string` | `""` | URL удалённого API |
| `shuncode.indexing.remoteApiKey` | `string` | `""` | API ключ |
| `shuncode.indexing.remoteModel` | `string` | `"text-embedding-3-small"` | Модель |
| `shuncode.indexing.maxFileSize` | `number` | `102400` | Макс. размер файла (байт) |
| `shuncode.indexing.ignoredPatterns` | `string[]` | `[node_modules, .git, ...]` | Игнорируемые паттерны |

## Хранение индекса

Индекс хранится локально в `~/.shuncode/indexing/{workspace-hash}/`.

Основной backend:
- `index.db` (SQLite) — метаданные, чанки, и векторы (BLOB)

Fallback backend (если native SQLite недоступен в runtime):
- `index.json` — метаданные
- `chunks.json` — массив метаданных чанков
- `vectors.bin` — Float32Array векторы

## Embedding провайдеры

### Локальный (по умолчанию)

- **Библиотека**: `@xenova/transformers` (transformers.js)
- **Backend**: WASM (без native-модулей, работает в любом окружении)
- **Модель**: `paraphrase-multilingual-MiniLM-L12-v2` (мультиязычная, поддержка русского)
- **Размерность**: 384
- **Скорость**: ~50-100 чанков/сек
- **Источник**: портировано из Continue (open-source IDE)

### Удалённый

- **Протокол**: OpenAI Embeddings API (`POST /v1/embeddings`)
- **Совместимость**: OpenAI, Voyage AI, HuggingFace TEI, vLLM, любой OpenAI-compatible
- **Батчинг**: до 100 текстов за запрос

## UI — Таб "Индексация" в настройках

Расположение: `webview-ui/src/components/settings/sections/IndexingSettingsSection.tsx`

Компоненты:
1. **Селектор режима** — Выключено / Локально / Удалённый API
2. **Настройки удалённого API** (показывается при mode=remote) — URL, Key, Model
3. **Статус индексации** — прогресс-бар, счётчики, кнопки Переиндексировать/Очистить/Пауза
4. **Дополнительные настройки** — макс. размер файла, игнорируемые паттерны

Сообщения webview → extension:
- `{ type: "updateIndexingConfig", indexingConfigUpdate: { key, value } }` — обновление настройки
- `{ type: "indexingCommand", indexingCommandAction: "reindex" | "clear" | "pause" | "resume" }` — команда

## Команды (Command Palette)

| Команда | ID | Описание |
|---------|------|----------|
| Переиндексировать | `shuncode.indexing.reindex` | Полная переиндексация |
| Очистить индекс | `shuncode.indexing.clear` | Удаление всего индекса |
| Приостановить | `shuncode.indexing.pause` | Пауза индексации |
| Продолжить | `shuncode.indexing.resume` | Возобновление после паузы |

## StatusBar

При индексации показывается прогресс в правой части статус-бара.
Иконки: `$(sync~spin)` (индексация), `$(database)` (готово), `$(error)` (ошибка), `$(debug-pause)` (пауза).

## Интеграция с AI промптами

Интеграция выполнена как отдельный инструмент агента `codebase_search`:

- Tool ID: `ShuncodeDefaultTool.CODEBASE_SEARCH`
- Prompt spec: `src/core/prompts/system-prompt/tools/codebase_search.ts`
- Handler: `src/core/task/tools/handlers/CodebaseSearchToolHandler.ts`
- Регистрация handler: `src/core/task/ToolExecutor.ts`
- Доступ к `SearchEngine`: `src/core/indexing/searchEngineInstance.ts`
- Подключение в variant tools: `src/core/prompts/system-prompt/variants/*/config.ts`

Во время выполнения handler вызывает `SearchEngine.getContextForPrompt(query)` и возвращает `<codebase_context>` с релевантными чанками.

Пример вывода:
```
<codebase_context>
The following code snippets from the user's codebase are semantically relevant to the current query.
Use them as additional context when answering.

// File: src/core/auth/AuthService.ts (lines 15-45) [score: 0.872]
export class AuthService {
  async login(username: string, password: string) {
    ...
  }
}

// File: src/utils/jwt.ts (lines 1-20) [score: 0.734]
import jwt from 'jsonwebtoken'
...
</codebase_context>
```

## Процесс индексации

1. **Обход файлов** — `FileWalker` рекурсивно обходит workspace, пропуская ignored, бинарные, слишком большие
2. **Чанкинг** — `CodeChunker` пытается tree-sitter chunker, при ошибке безопасно откатывается на simple chunker
3. **Эмбеддинг** — батчами по 32 чанка через выбранный провайдер
4. **Сохранение** — в SQLite (`index.db`) или в JSON fallback
5. **FileWatcher** — отслеживает изменения и обновляет инкрементально

## Инкрементальное обновление

- `FileSystemWatcher` следит за create/change/delete событиями
- change/create события дебаунсятся (burst-safe), чтобы не переиндексировать файл на каждое быстрое сохранение
- При изменении файла: удаляются старые чанки, файл перечанкивается и переэмбеддится
- При удалении: чанки удаляются из индекса
- Сравнение по MD5-хэшу содержимого файла

## Поиск

- **Hybrid retrieval**: semantic (`VectorSearch`) + keyword (`KeywordSearch`)
- **Rerank**: пост-обработка топ-кандидатов правилами релевантности
- Это снижает шум на русских/смешанных запросах и улучшает precision top-N

## Производительность

| Проект | Файлов | Чанков | Индексация (локально) | Поиск |
|--------|--------|--------|----------------------|-------|
| Маленький (~100 файлов) | ~100 | ~500 | ~30 сек | <10ms |
| Средний (~2000 файлов) | ~2000 | ~10K | ~5 мин | ~30ms |
| Большой (~10000 файлов) | ~10K | ~50K | ~20 мин | ~80ms |

Поиск — brute-force cosine similarity. Для проектов до 50K чанков это <100ms — достаточно быстро.

## Ограничения текущей версии

- **Модель**: `paraphrase-multilingual-MiniLM-L12-v2` — general-purpose мультиязычная, не специализирована на коде. Для лучшего качества можно подключить удалённый API с code-specific моделью.
- **Поиск**: brute-force vector scan. На очень больших индексах (>100K чанков) нужен ANN backend.
- **SQLite native**: зависит от совместимости Electron/Node ABI. При недоступности используется JSON fallback.
- **Tree-sitter coverage**: качество зависит от доступности WASM парсеров для конкретного языка.

## Как расширить

### Добавить новый embedding провайдер

1. Создать класс, реализующий `EmbeddingProvider` из `src/core/indexing/types.ts`
2. Добавить вариант в `EmbeddingRouter.ts`
3. Добавить опцию в `shuncode.indexing.mode` enum в `package.json`
4. Добавить UI в `IndexingSettingsSection.tsx`

### Следующий шаг по производительности

Добавить ANN backend (sqlite-vec / hnsw / внешний векторный движок) для ускорения top-K на очень больших индексах.
