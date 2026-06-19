> **Русская версия:** [core.md](../ru/architecture/core.md)

# Core Module

Entry point: `extension.ts` → Controller → Task

## Directory Structure

```
src/core/
├── controller/    # gRPC handlers, task management
├── task/          # AI tasks: API requests + tool execution
├── diff-v2/       # Inline Diff System v4 (snapshot-based)
├── session/       # ApprovalGate (ask/response flow)
├── indexing/      # Semantic indexing (Tree-sitter + embeddings)
├── prompts/       # Prompt system (TemplateEngine + PromptBuilder)
├── api/           # API providers (OpenAI, Anthropic, Gemini, ...)
├── workspace/     # Multi-root workspace resolver
├── context/       # Context management (files, rules, focus chain)
├── hooks/         # Lifecycle hooks (TaskStart, TaskComplete, ...)
├── ignore/        # .shuncodeignore controller
├── mentions/      # @-mentions in chat
└── permissions/   # Access control: CommandPermissionController + CommandSafetyClassifier
```

## Key Subsystems

### Task Lifecycle

```
Controller.initTask()
    → new Task(taskId, ...)
    → Task.startTask() / resumeTaskFromHistory()
        → say("text", task) → startCheckpoint(messageTs)
        → recursivelyMakeShuncodeRequests() — main AI loop
            → attemptApiRequest() — stream chunks
            → parseAssistantMessage()
            → executeTool() — write_to_file, replace_text, bash, etc.
            → ask("completion_result") — wait for user
        → User feedback → startCheckpoint(feedbackTs) — new ResponseGroup
```

### DiffSystem v4 (`src/core/diff-v2/`)

Cursor-like inline diffs with per-message snapshots. See [Diff System](../systems/diff-system.md).

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

Promise-based ask/response mechanism replacing the legacy pWaitFor polling. Includes an early response queue to handle race conditions during message resend.

### Controller (`src/core/controller/index.ts`)

- `initTask()` — create task, set DiffSystem context
- `cancelTask()` — abort + re-init from history
- `clearTask()` — finish checkpoint + cleanup
- `deleteFromMessage()` — rollback + truncate history
- `retryFromMessage()` — rollback + truncate + auto-resend

### ToolExecutor (`src/core/task/ToolExecutor.ts`)

- Lightweight mode restrictions (XS models: no BASH, no FILE_EDIT)
- Runtime tool blocking for weak models
- EditNotebook — Jupyter `.ipynb` cell editing (insert/replace)

### Permissions (`src/core/permissions/`)

Access control for agent actions:

- **CommandPermissionController** — environment-based command permissions
- **CommandSafetyClassifier** — classifies shell commands as safe/unsafe (whitelist approach):
  - `safe` = read-only (ls, cat, git status, npm test, grep, find, ...)
  - `unsafe` = everything else (rm, npm install, git push, curl, sudo, ...)
  - Pipes/chains: ALL segments must be safe
  - Redirect (`>`, `>>`) = always unsafe

### AutoApprove (`src/core/task/tools/autoApprove.ts`)

Controls whether user confirmation is required before tool execution.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `executeSafeCommands` | boolean | true | Safe commands (read-only) |
| `executeAllCommands` | boolean | false | All commands |
| `deleteFiles` | boolean | false | File deletion |
| `editNotebooks` | boolean | false | Jupyter notebooks |
| `useBrowser` | boolean | true | Browser automation |
| `useMcp` | boolean | true | MCP servers |

## State Management

### GlobalState (persists across sessions)

```typescript
controller.stateManager.setGlobalState("key", value)
controller.stateManager.getGlobalStateKey("key")
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

### DiffStore (per workspace, workspaceState)

```
shuncode.diff.v3.responseGroups  — ResponseGroup[]
shuncode.diff.v3.fileChanges     — FileChangeRecord[]
shuncode.diff.v3.hunks           — Hunk[]
```
