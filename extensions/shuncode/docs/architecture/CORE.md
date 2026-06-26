# Core модуль

Точка входа расширения: `extension.ts` → controller → task

## Структура

```
src/core/
├── controller/    # gRPC обработчики, управление задачами
├── task/          # AI задачи: API запросы + выполнение инструментов
├── diff-v2/       # Inline Diff System V4 (snapshot-based)
├── session/       # ApprovalGate (ask/response flow)
├── indexing/      # Семантическая индексация (Tree-sitter + embeddings)
├── prompts/       # Система промптов (TemplateEngine + PromptBuilder)
├── api/           # API провайдеры (OpenAI, Anthropic, Gemini, ...)
├── workspace/     # Multi-root workspace resolver
├── context/       # Context management (файлы, правила, focus chain)
├── hooks/         # Lifecycle hooks (TaskStart, TaskComplete, ...)
├── ignore/        # .shuncodeignore controller
├── mentions/      # @-упоминания в чате
└── permissions/   # Контроль доступа: CommandPermissionController + CommandSafetyClassifier
```

## Ключевые подсистемы

### Task lifecycle
```
Controller.initTask()
    → new Task(taskId, ...)
    → Task.startTask() / resumeTaskFromHistory()
        → say("text", task) → startCheckpoint(messageTs)
        → recursivelyMakeSkycodRequests() — main AI loop
            → attemptApiRequest() — stream chunks
            → parseAssistantMessage()
            → executeTool() — write_to_file, replace_text, bash, etc.
            → ask("completion_result") — wait for user
        → User feedback → startCheckpoint(feedbackTs) — new RG
```

### DiffSystem V4 (`src/core/diff-v2/`)
Cursor-like inline diffs с per-message snapshots. См. [DIFF_SYSTEM.md](../DIFF_SYSTEM.md).

> **⚠️ Legacy Cline Checkpoints (`src/integrations/checkpoints/`) — ВРЕМЕННО ОТКЛЮЧЕНЫ (2026-02-25)**
> Старая система shadow-git чекпоинтов унаследована от Cline. Создавала теневой git-репозиторий
> для каждой задачи, что вызывало тормоза и баннер "Инициализация контрольных точек занимает
> больше времени". Заменена DiffSystem V2 (snapshot-based, без git). Код не удалён — закомментирован
> с пометкой `[SHUNCODE] TEMPORARILY DISABLED`. Файлы в `integrations/checkpoints/` не трогались.
> Затронутые файлы: `core/task/index.ts`, `core/controller/index.ts`,
> `core/controller/checkpoints/checkpointRestore.ts`, `core/controller/checkpoints/checkpointDiff.ts`,
> `core/controller/task/taskCompletionViewChanges.ts`, `core/controller/task/explainChanges.ts`,
> `webview-ui/src/components/chat/task-header/TaskHeader.tsx`.

```
DiffSystem (facade)
├── DiffStore — ResponseGroups, FileChanges, Hunks (workspaceState)
├── FileSnapshotStorage — per-message file snapshots (disk)
├── HunkApplier — applies changes, reads actual file for removedLines
├── HunkReverter — reject/accept with \n EOL, parent status cascade
├── PositionTracker — recalculates positions after edits
├── SystemEditGuard — distinguishes system edits from manual
├── InlineDiffRenderer — reactive View Zones + green decorations
└── KeyboardNavigation — cross-file hunk navigation
```

### ApprovalGate (`src/core/session/ApprovalGate.ts`)
Promise-based ask/response замена pWaitFor. Early response queue решает race condition при resend.

### Controller (`src/core/controller/index.ts`)
- `initTask()` → создание задачи, DiffSystem.setCurrentTaskId
- `cancelTask()` → abort + re-init from history
- `clearTask()` → finishCheckpoint + cleanup
- `deleteFromMessage()` → rollbackFromMessage + truncate history
- `retryFromMessage()` → rollback + truncate + auto-resend
- Free request limit (50) с auth prompt

### ToolExecutor (`src/core/task/ToolExecutor.ts`)
- Lightweight mode restrictions (XS models: no BASH, no FILE_EDIT)
- Runtime tool blocking for weak models
- EditNotebook (edit_notebook) — Jupyter .ipynb cell editing (insert/replace)

### Permissions (`src/core/permissions/`)
Контроль доступа к действиям агента.

- **CommandPermissionController** — env-based разрешения для команд
- **CommandSafetyClassifier** — классификация shell-команд на safe/unsafe (whitelist-подход):
  - safe = read-only (ls, cat, git status, npm test, grep, find, ...)
  - unsafe = всё остальное (rm, npm install, git push, curl, sudo, ...)
  - Pipe/chain: ВСЕ сегменты должны быть safe
  - Redirect (>, >>) = всегда unsafe

### AutoApprove (`src/core/task/tools/autoApprove.ts`)
Решает, нужно ли спрашивать пользователя перед выполнением инструмента.

Настройки в `AutoApprovalSettings.actions`:
| Настройка | Тип | Default | Описание |
|---|---|---|---|
| `readFiles` | boolean | true | Чтение файлов (dead code в UI) |
| `editFiles` | boolean | true | Редактирование файлов (dead code в UI) |
| `executeSafeCommands` | boolean | true | Безопасные команды |
| `executeAllCommands` | boolean | false | Все команды |
| `deleteFiles` | boolean | false | Удаление файлов |
| `editNotebooks` | boolean | false | Jupyter блокноты |
| `useBrowser` | boolean | true | Браузер |
| `useMcp` | boolean | true | MCP серверы |

YOLO Mode → всё auto-approve, без вопросов.

## Состояние

### GlobalState (persists across sessions)
```typescript
interface GlobalState {
  apiProvider?: string
  freeRequestCount?: number
  // ... настройки
}
```

### Secrets (secure storage)
```typescript
context.secrets.store("apiKey", value)
context.secrets.get("apiKey")
```

### Task State (per task, filesystem)
```
~/.shuncode/tasks/{taskId}/
├── api_conversation_history.json
└── shuncode_messages.json
```
> `checkpoints/` — legacy Cline shadow-git, временно отключено (см. выше).

### DiffStore (per workspace, workspaceState)
```
shuncode.diff.v3.responseGroups  — ResponseGroup[]
shuncode.diff.v3.fileChanges     — FileChangeRecord[]
shuncode.diff.v3.hunks           — Hunk[]
```

### Snapshots (per workspace, globalStorage)
```
globalStorage/snapshots/{responseGroupId}/{hash}.snapshot
```

### Index State (per workspace)
```
~/.shuncode/indexing/{workspace-hash}/index.db (SQLite)
```

---

*Последнее обновление: 2026-03-02*
