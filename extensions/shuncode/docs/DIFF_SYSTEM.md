# Shuncode AI — Inline Diff System v4

## Обзор

Cursor-like inline diff система. AI вносит изменения напрямую в файлы, пользователь контролирует через Accept/Reject кнопки в редакторе. Per-message snapshots обеспечивают точный откат.

---

## Архитектура v4

```
DiffSystem (facade) — src/core/diff-v2/DiffSystem.ts
├── Storage
│   ├── DiffStore (единое хранилище: ResponseGroups, FileChanges, Hunks)
│   ├── FileSnapshotStorage (per-message снапшоты для отката)
│   └── PendingChangesStorage (bridge → webview PendingChangesBar)
├── Engine
│   ├── HunkApplier (применение изменений, создание Hunk записей)
│   ├── HunkReverter (accept/reject, откат файлов)
│   ├── PositionTracker (пересчёт позиций после правок/reject)
│   └── SystemEditGuard (отличает системные записи от ручных)
└── UI
    ├── InlineDiffRenderer (реактивные View Zones + зелёные декорации)
    └── KeyboardNavigation (кросс-файловая навигация по диффам)
```

---

## Что нового в v4 (vs v3)

| Фича | v3 | v4 |
|---|---|---|
| Снапшоты | Нет | Per-message: каждое сообщение = свой снапшот |
| Rollback | Hunk-by-hunk | Snapshot-based + per-group hunk filtering |
| Per-message rollback | Нет | Да: удаление msg2 не трогает msg1 |
| Overlap detection | Strict (`<`/`>`) | Inclusive (`<=`/`>=`), adjacent тоже |
| removedLines | Из diff computation | Из реального файла (MISMATCH protection) |
| HunkReverter EOL | `\r\n` на Windows | Всегда `\n` (VS Code нормализует) |
| No-op detection | Нет | Да: модель получает ошибку если файл не изменился |
| Навигация | Только в файле | Кросс-файловая (стрелки `< >` переходят между файлами) |
| Chat preview | Только для write_to_file | Для всех tool types (fallback из hunk data) |
| ApprovalGate | pWaitFor polling | Promise-based + early response queue |
| Orphaned RGs | Накапливаются | Cleanup при старте |

---

## Поток данных

```
User message → say("text") → startCheckpoint(messageTs)
                                    ↓
                            ResponseGroup created
                            (snapshot saved before first edit)
                                    ↓
AI Tool (write_to_file / replace_text / delete_block)
  → DiffSystem.replaceLines() / deleteLines() / addLines()
    → preSaveAndSnapshot() — idempotent per RG
    → applyWithOverlapCheck() — auto-reject adjacent/overlapping hunks
    → HunkApplier.applyReplacement() — writes file + creates Hunk
      → removedLines = actual file content (not diff computation)
      → DiffStore.createHunk() — fires hunkAdded event
        → InlineDiffRenderer (реактивно создаёт View Zones)
        → PendingChangesStorage (синхронизация → webview)

User feedback → startCheckpoint(feedbackTs) — NEW RG + snapshot
  → AI processes feedback → edits go into new RG
```

---

## Per-message Rollback

```
Message 1 → RG1 (snapshot A) → hunks 1, 2, 3
Message 2 → RG2 (snapshot B) → hunks 4, 5
Message 3 → RG3 (snapshot C) → hunk 6

Delete message 2:
  → rollbackFromMessage(ts2)
  → finds RG2, RG3 (chatMessageTs >= ts2)
  → restores file from snapshot B
  → marks only RG2+RG3 hunks as rejected
  → RG1 hunks remain pending ✓
```

Checkpoints создаются в двух местах:
- `Task.startTask()` — первое сообщение
- `AttemptCompletionHandler` + `Task.resumeTaskFromHistory()` — follow-up сообщения

---

## Три типа diff-блоков

### DELETION
```
┌──────────────────────────────┐
│ удалённая строка (красная)   │  ← View Zone
└──────────────────────────────┘
┌──────────────────────────────┐
│ [✓ Принять] [✗ Отклонить]   │  ← View Zone (buttons)
└──────────────────────────────┘
```

### ADDITION
```
│ 24 │ новая строка (зелёная)   │  ← TextEditorDecoration
┌──────────────────────────────┐
│ [✓ Принять] [✗ Отклонить]   │  ← View Zone (buttons)
└──────────────────────────────┘
```

### REPLACEMENT
```
┌──────────────────────────────┐
│ старая строка (красная)      │  ← View Zone (deletion)
├──────────────────────────────┤
│ 24 │ новая строка (зелёная)  │  ← TextEditorDecoration
┌──────────────────────────────┐
│ [✓ Принять] [✗ Отклонить]   │  ← View Zone (buttons)
└──────────────────────────────┘
```

---

## Accept / Reject

### Accept
1. Файл не трогается (новый код уже на месте)
2. `store.updateHunkStatus('accepted')` → fires `hunkRemoved`
3. `InlineDiffRenderer` удаляет View Zones + зелёные декорации
4. Snapshot cleanup если 0 pending hunks

### Reject
1. `HunkReverter.reject()` — `cleanLines = removedLines.map(l => l.replace(/\r$/, ''))`
2. `applyEdit(uri, range, cleanLines.join('\n') + '\n')` — всегда `\n`
3. `PositionTracker.recalculate()` сдвигает оставшиеся хунки
4. `store.updateHunkStatus('rejected')` → fires `hunkRemoved`
5. Parent status cascade: all rejected → RG='rejected', mixed → RG='partial'

---

## Overlap Detection

При применении нового hunk'а, `applyWithOverlapCheck` ищет пересекающиеся или смежные pending hunks:

```typescript
const overlapping = pendingHunks.filter(h =>
  h.currentStartLine <= endLine && h.currentEndLine >= startLine
);
```

Overlapping/adjacent hunks auto-reject'ятся bottom-to-top перед применением нового.

---

## No-op Detection

Если после DiffSystem операций файл не изменился (overlap auto-reject + re-apply = same content):
- Модель получает `toolError("No changes were made to the file")`
- `consecutiveMistakeCount++`
- Карточка "Изменён" НЕ создаётся

---

## Защита данных

### removedLines — из реального файла
`HunkApplier.applyReplacement` читает `actualRemovedLines = lines.slice(startIdx, ...)` из файла, а не доверяет caller'у. Это гарантирует что красная зона показывает реальный оригинал.

### SystemEditGuard
Защищает от ложных `onDidChangeTextDocument`:
- `withSystemEdit(fn)` — Set-based tokens, thread-safe
- Nested calls корректно отслеживаются

### ApprovalGate — early response queue
Решает race condition: если webview отправляет ответ ДО того как Task дошёл до `ask()`, ответ ставится в очередь и доставляется при вызове `waitForResponse()`.

---

## Тесты

**217 тестов** покрывают всю DiffSystem:

| Компонент | Тесты |
|-----------|-------|
| SystemEditGuard | 10 |
| ApprovalGate | 18 |
| PositionTracker | 13 |
| DiffStore | 36 |
| FileSnapshotStorage | 27 |
| HunkApplier | 26 (включая bad AI input) |
| HunkReverter | 22 |
| DiffSystem (интеграция) | 37 |
| WriteToFileToolHandler | 17 |
| KeyboardNavigation | 11 |

Запуск: `npm run test:unit -- --grep "DiffSystem|DiffStore|Hunk|Snapshot|Position|Guard|Gate|Navigation|WriteToFile"`

---

## Команды

| Команда | Описание |
|---------|----------|
| `shuncode.diff.accept` | Принять одно изменение |
| `shuncode.diff.reject` | Отклонить одно изменение |
| `shuncode.diff.acceptAllInFile` | Принять все в текущем файле |
| `shuncode.diff.rejectAllInFile` | Отклонить все в текущем файле |
| `shuncode.diff.nextHunk` | Следующий hunk (кросс-файловый) |
| `shuncode.diff.prevHunk` | Предыдущий hunk (кросс-файловый) |
| `shuncode.diff.clearAll` | Очистить все pending changes |

---

## Proposed API

`vscode.window.createWebviewTextEditorInset` (Proposed API `editorInsets`).

```json
"enabledApiProposals": ["editorInsets"]
```

---

*Последнее обновление: 2026-02-24 — v4 architecture*
