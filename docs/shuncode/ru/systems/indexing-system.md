> **English version:** [indexing-system.md](../../systems/indexing-system.md)

# Система индексации кодовой базы

Семантическая индексация для интеллектуального поиска по коду. Позволяет AI-агенту извлекать релевантный контекст из всего проекта перед ответом.

По умолчанию работает полностью локально (transformers.js, WASM), с возможностью подключения удалённого API.

## Архитектура

```
IndexingService (оркестратор) — src/core/indexing/IndexingService.ts
├── FileWalker (обход файлов)
│   └── Учитывает .gitignore, ignoredPatterns, maxFileSize, бинарные файлы
├── CodeChunker (разбиение на чанки)
│   └── Tree-sitter чанкинг (с fallback на простой чанкер)
├── EmbeddingRouter → выбор провайдера
│   ├── LocalEmbeddingProvider (transformers.js WASM + multilingual MiniLM)
│   └── RemoteEmbeddingProvider (OpenAI-совместимый /v1/embeddings API)
├── Storage
│   ├── IndexStorage (SQLite по умолчанию, JSON fallback при недоступности нативного)
│   └── VectorSearch (brute-force cosine similarity на векторах в памяти)
└── SearchEngine (гибридный: semantic + keyword + rerank + форматирование промпта)
```

## Настройки

| Настройка | Тип | По умолчанию | Описание |
|-----------|-----|-------------|----------|
| `shuncode.indexing.mode` | `"off" \| "local" \| "remote"` | `"local"` | Режим индексации |
| `shuncode.indexing.remoteApiUrl` | string | `""` | URL удалённого API |
| `shuncode.indexing.remoteApiKey` | string | `""` | API-ключ |
| `shuncode.indexing.remoteModel` | string | `"text-embedding-3-small"` | Имя модели |
| `shuncode.indexing.maxFileSize` | number | `102400` | Макс. размер файла (байт) |
| `shuncode.indexing.ignoredPatterns` | string[] | `[node_modules, .git, ...]` | Игнорируемые паттерны |

## Хранилище индекса

Хранится локально в `~/.shuncode/indexing/{workspace-hash}/`.

Основной бэкенд:
- `index.db` (SQLite) — метаданные, чанки и векторы (BLOB)

Резервный бэкенд (при недоступности нативного SQLite):
- `index.json` — метаданные
- `chunks.json` — массив метаданных чанков
- `vectors.bin` — Float32Array векторов

## Провайдеры эмбеддингов

### Локальный (по умолчанию)

- **Библиотека:** `@xenova/transformers` (transformers.js)
- **Бэкенд:** WASM (без нативных модулей, работает в любой среде)
- **Модель:** `paraphrase-multilingual-MiniLM-L12-v2` (мультиязычная, поддержка русского)
- **Размерность:** 384
- **Скорость:** ~50–100 чанков/сек

### Удалённый

- **Протокол:** OpenAI Embeddings API (`POST /v1/embeddings`)
- **Совместим с:** OpenAI, Voyage AI, HuggingFace TEI, vLLM, любой OpenAI-совместимый эндпоинт
- **Батчинг:** до 100 текстов за запрос

## Пайплайн индексации

1. **Обход файлов** — `FileWalker` рекурсивно обходит workspace, пропуская игнорируемые/бинарные/слишком большие файлы
2. **Чанкинг** — `CodeChunker` использует Tree-sitter для AST-aware чанкинга, с fallback на простой чанкер при ошибках
3. **Эмбеддинг** — батчи по 32 чанка через выбранный провайдер
4. **Сохранение** — в SQLite (`index.db`) или JSON fallback
5. **FileWatcher** — отслеживает изменения и обновляет инкрементально

## Инкрементальные обновления

- `FileSystemWatcher` отслеживает события create/change/delete
- События change/create дебаунсятся (защита от burst)
- При изменении файла: старые чанки удаляются, файл заново чанкуется и эмбеддится
- При удалении файла: чанки удаляются из индекса
- Сравнение по MD5-хешу содержимого файла

## Поиск

- **Гибридное извлечение:** semantic (`VectorSearch`) + keyword (`KeywordSearch`)
- **Rerank:** пост-извлечение reranking для повышения точности
- Снижает шум на мультиязычных запросах

## Производительность

| Проект | Файлов | Чанков | Индексация (локально) | Поиск |
|--------|--------|--------|----------------------|-------|
| Малый (~100 файлов) | ~100 | ~500 | ~30 сек | <10мс |
| Средний (~2000 файлов) | ~2000 | ~10K | ~5 мин | ~30мс |
| Большой (~10000 файлов) | ~10K | ~50K | ~20 мин | ~80мс |

## Интеграция с агентом

Поиск доступен как инструмент `codebase_search`:
- **Tool ID:** `ShuncodeDefaultTool.CODEBASE_SEARCH`
- **Обработчик:** `src/core/task/tools/handlers/CodebaseSearchToolHandler.ts`
- Вызывает `SearchEngine.getContextForPrompt(query)` и возвращает `<codebase_context>` с релевантными чанками

## Команды

| Команда | Описание |
|---------|----------|
| `shuncode.indexing.reindex` | Полная переиндексация |
| `shuncode.indexing.clear` | Очистка всего индекса |
| `shuncode.indexing.pause` | Пауза индексации |
| `shuncode.indexing.resume` | Возобновление после паузы |

## Расширение

### Добавление нового провайдера эмбеддингов

1. Создать класс, реализующий `EmbeddingProvider` из `src/core/indexing/types.ts`
2. Добавить вариант в `EmbeddingRouter.ts`
3. Добавить опцию в enum `shuncode.indexing.mode` в `package.json`
4. Добавить UI в `IndexingSettingsSection.tsx`
