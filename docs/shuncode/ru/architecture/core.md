> **English version:** [core.md](../../architecture/core.md)

# Модуль Core

Входная точка: `extension.ts` → Controller → Task

## Структура директорий

```
src/core/
├── controller/    # gRPC-обработчики, управление задачами
├── task/          # AI-задачи: API-запросы + выполнение инструментов
├── diff-v2/       # Inline Diff System v4 (на основе снапшотов)
├── session/       # ApprovalGate (механизм ask/response)
├── indexing/      # Семантическая индексация (Tree-sitter + эмбеддинги)
├── prompts/       # Система промптов (TemplateEngine + PromptBuilder)
├── api/           # API-провайдеры (OpenAI, Anthropic, Gemini, ...)
├── workspace/     # Multi-root workspace resolver
├── context/       # Управление контекстом (файлы, правила, цепочка фокуса)
├── hooks/         # Хуки жизненного цикла (TaskStart, TaskComplete, ...)
├── ignore/        # Контроллер .shuncodeignore
├── mentions/      # @-упоминания в чате
└── permissions/   # Контроль доступа: CommandPermissionController + CommandSafetyClassifier
```

## Ключевые подсистемы

### Жизненный цикл задачи

```
Controller.initTask()
    → new Task(taskId, ...)
    → Task.startTask() / resumeTaskFromHistory()
        → say("text", task) → startCheckpoint(messageTs)
        → recursivelyMakeShuncodeRequests() — основной цикл AI
            → attemptApiRequest() — потоковая передача чанков
            → parseAssistantMessage()
            → executeTool() — write_to_file, replace_text, bash и т.д.
            → ask("completion_result") — ожидание пользователя
        → Обратная связь → startCheckpoint(feedbackTs) — новая ResponseGroup
```

### DiffSystem v4 (`src/core/diff-v2/`)

Cursor-подобные inline-диффы с per-message снапшотами. См. [Diff-система](../systems/diff-system.md).

```
DiffSystem (фасад)
├── DiffStore — ResponseGroups, FileChanges, Hunks (workspaceState)
├── FileSnapshotStorage — per-message снапшоты файлов (диск)
├── HunkApplier — применяет изменения, читает реальный файл для removedLines
├── HunkReverter — reject/accept с \n EOL, каскад статуса родителя
├── PositionTracker — пересчёт позиций после правок
├── SystemEditGuard — отличает системные правки от ручных
├── InlineDiffRenderer — реактивные View Zones + зелёные декорации
└── KeyboardNavigation — кросс-файловая навигация по хункам
```

### ApprovalGate (`src/core/session/ApprovalGate.ts`)

Promise-based механизм ask/response, заменивший legacy pWaitFor-опрос. Включает очередь ранних ответов для обработки race condition при пересылке сообщений.

### Controller (`src/core/controller/index.ts`)

- `initTask()` — создание задачи, установка контекста DiffSystem
- `cancelTask()` — прерывание + повторная инициализация из истории
- `clearTask()` — завершение checkpoint + очистка
- `deleteFromMessage()` — откат + обрезка истории
- `retryFromMessage()` — откат + обрезка + автоматическая повторная отправка

### ToolExecutor (`src/core/task/ToolExecutor.ts`)

- Ограничения Lightweight-режима (XS-модели: без BASH, без FILE_EDIT)
- Рантайм-блокировка инструментов для слабых моделей
- EditNotebook — редактирование ячеек Jupyter `.ipynb` (вставка/замена)

### Permissions (`src/core/permissions/`)

Контроль доступа для действий агента:

- **CommandPermissionController** — разрешения команд на основе среды
- **CommandSafetyClassifier** — классификация shell-команд как safe/unsafe (подход whitelist):
  - `safe` = только чтение (ls, cat, git status, npm test, grep, find, ...)
  - `unsafe` = всё остальное (rm, npm install, git push, curl, sudo, ...)
  - Пайпы/цепочки: ВСЕ сегменты должны быть safe
  - Перенаправление (`>`, `>>`) = всегда unsafe

### AutoApprove (`src/core/task/tools/autoApprove.ts`)

Контролирует необходимость подтверждения пользователя перед выполнением инструмента.

| Настройка | Тип | По умолчанию | Описание |
|-----------|-----|-------------|----------|
| `executeSafeCommands` | boolean | true | Безопасные команды (только чтение) |
| `executeAllCommands` | boolean | false | Все команды |
| `deleteFiles` | boolean | false | Удаление файлов |
| `editNotebooks` | boolean | false | Jupyter-ноутбуки |
| `useBrowser` | boolean | true | Автоматизация браузера |
| `useMcp` | boolean | true | MCP-серверы |

## Управление состоянием

### GlobalState (сохраняется между сессиями)

```typescript
controller.stateManager.setGlobalState("key", value)
controller.stateManager.getGlobalStateKey("key")
```

### Secrets (безопасное хранилище)

```typescript
context.secrets.store("apiKey", value)
context.secrets.get("apiKey")
```

### Task State (по задаче, файловая система)

```
~/.shuncode/tasks/{taskId}/
├── api_conversation_history.json
└── shuncode_messages.json
```

### DiffStore (по workspace, workspaceState)

```
shuncode.diff.v3.responseGroups  — ResponseGroup[]
shuncode.diff.v3.fileChanges     — FileChangeRecord[]
shuncode.diff.v3.hunks           — Hunk[]
```
