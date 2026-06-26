# Shuncode — План тестирования

## Текущее состояние (обновлено 2026-02-20)

- **865 тестов** проходят (`npm run test:unit`)
- **217 новых тестов** для DiffSystem V4 + ApprovalGate + handlers
- **48 prompt snapshots** обновлены
- **2 старых теста** починены (`openFileRelativePath`)
- **Framework**: mocha + chai/should + sinon (unit), playwright (e2e)

---

## ПРИОРИТЕТ 1: DiffSystem V4 — МАКСИМАЛЬНОЕ ПОКРЫТИЕ

> Ключевая система. Должна работать идеально. Все edge cases.

---

### 1.1 `DiffStore.test.ts` — хранилище данных

**ResponseGroup CRUD:**
- [ ] createResponseGroup — создаёт RG с правильными полями
- [ ] createResponseGroup — chatMessageTs, taskId, status='active'
- [ ] getResponseGroup — найти по id
- [ ] getResponseGroup — undefined для несуществующего id
- [ ] updateResponseGroupStatus — меняет статус + resolvedAt

**ResponseGroup queries (rollback logic):**
- [ ] getResponseGroupsFromMessageTs — primary: chatMessageTs >= ts
- [ ] getResponseGroupsFromMessageTs — primary: sorted by chatMessageTs ascending
- [ ] getResponseGroupsFromMessageTs — fallback: active RGs with chatMessageTs < ts
- [ ] getResponseGroupsFromMessageTs — fallback only active (не rejected/partial)
- [ ] getResponseGroupsFromMessageTs — taskId filter включён
- [ ] getResponseGroupsFromMessageTs — taskId=undefined: не фильтрует
- [ ] getResponseGroupsFromMessageTs — returns empty when nothing matches
- [ ] getResponseGroupsFromMessageTs — multiple RGs: returns all matching, sorted

**FileChange CRUD:**
- [ ] createFileChange — creates with responseGroupId, fsPath, kind
- [ ] createFileChange — idempotent: same (rgId, fsPath) returns existing id
- [ ] getFileChangesByResponseGroup — returns all for RG
- [ ] updateFileChangeStatus — changes status

**Hunk CRUD:**
- [ ] createHunk — creates with all fields, status='pending', createdAt
- [ ] createHunk — fires 'hunkAdded' event
- [ ] createHunk — resets RG status from 'rejected' to 'active'
- [ ] createHunk — resets RG status from 'partial' to 'active'
- [ ] createHunk — does NOT reset if already 'active'
- [ ] getHunk — find by id
- [ ] getHunk — undefined for missing id
- [ ] updateHunkStatus — 'pending' → 'accepted'
- [ ] updateHunkStatus — 'pending' → 'rejected'
- [ ] updateHunkStatus — fires 'hunkRemoved' event on non-pending
- [ ] updateHunkPosition — updates currentStartLine/currentEndLine
- [ ] updateHunkPosition — fires 'hunkPositionChanged' event

**Hunk queries:**
- [ ] getPendingHunksByFile — filters by fsPath (case insensitive) + status='pending'
- [ ] getPendingHunksByFile — empty for file with no hunks
- [ ] getPendingHunksByFile — empty for file with only accepted hunks
- [ ] getHunksByResponseGroup — all hunks for RG regardless of status
- [ ] getHunksByFileChange — all hunks for FC
- [ ] getPendingCount — total count
- [ ] hasPendingChangesForFile — boolean
- [ ] getFilesWithPendingChanges — unique file paths

**Bulk operations:**
- [ ] clearAll — empties all stores, fires 'cleared' event
- [ ] cleanupOrphanedResponseGroups — removes RGs without pending hunks
- [ ] cleanupOrphanedResponseGroups — keeps RGs WITH pending hunks
- [ ] cleanupOrphanedResponseGroups — counts correct

**Event system:**
- [ ] onDidChange — fires for hunkAdded
- [ ] onDidChange — fires for hunkRemoved
- [ ] onDidChange — fires for hunkPositionChanged
- [ ] onDidChange — fires for hunkUpdated
- [ ] onDidChange — fires for cleared
- [ ] onDidChange — fires for responseGroupChanged

**Моки**: In-memory Map для workspaceState (implements vscode.Memento)

---

### 1.2 `FileSnapshotStorage.test.ts` — снапшоты файлов

**Save:**
- [ ] saveBeforeAI — saves snapshot with correct fields
- [ ] saveBeforeAI — idempotent: same (fsPath, rgId) returns same id
- [ ] saveBeforeAI — different rgId creates new snapshot
- [ ] saveBeforeAI — content is exact (не обрезает, не меняет)
- [ ] saveBeforeAI — persists to disk (file exists after save)

**Lookup — getSnapshotForRollback:**
- [ ] exact match: messageTs === snapshot.messageTs
- [ ] first >= match: finds earliest snapshot at or after target
- [ ] fallback < match: finds latest snapshot before target
- [ ] priority: exact > >= > <
- [ ] no match: returns undefined
- [ ] path normalization: Windows backslash `\` → forward slash `/`
- [ ] path normalization: case insensitive (D:\File.ts === d:\file.ts)
- [ ] multiple snapshots: correct one returned
- [ ] empty chain: returns undefined

**Lookup — other methods:**
- [ ] hasSnapshotForResponseGroup — true/false
- [ ] getSnapshotsFromMessageTs — filters >= ts
- [ ] getSnapshotCount — correct count

**Delete:**
- [ ] deleteSnapshotsFromMessageTs — removes all >= ts
- [ ] deleteSnapshotsFromMessageTs — keeps < ts
- [ ] deleteSnapshotsFromMessageTs — disk cleanup
- [ ] cleanupForFile — removes ALL for file
- [ ] cleanupForFile — disk cleanup

**Disk persistence:**
- [ ] persistToDisk — writes header JSON + content
- [ ] loadFromDisk — reconstructs chain from disk files
- [ ] loadFromDisk — handles corrupt files gracefully (skip)
- [ ] loadFromDisk — handles missing directory
- [ ] loadFromDisk — deduplicates by responseGroupId
- [ ] Round-trip: save → restart → load → getSnapshot returns correct content

**Edge cases:**
- [ ] Very large file content (>1MB)
- [ ] Empty file content
- [ ] Unicode content (кириллица, emoji)
- [ ] File path with spaces
- [ ] File path with special characters

**Моки**: Real fs в temp directory (os.tmpdir())

---

### 1.3 `HunkApplier.test.ts` — применение изменений

**applyReplacement:**
- [ ] Replaces lines correctly in file
- [ ] Returns hunk id
- [ ] Creates FileChange record
- [ ] Creates Hunk record with correct fields
- [ ] removedLines = actual file lines (NOT caller's originalLines)
- [ ] MISMATCH: logs warning when caller != file content
- [ ] Handles single line replacement
- [ ] Handles multi-line replacement (3→5 lines)
- [ ] Handles replacement that reduces lines (5→2)
- [ ] Triggers positionTracker.recalculate when delta != 0
- [ ] Does NOT trigger recalculate when delta = 0
- [ ] Invalid startLine throws error
- [ ] startLine > lineCount throws error

**applyDeletion:**
- [ ] Removes correct lines from file
- [ ] Returns { hunkId, deletedContent }
- [ ] removedLines from actual file
- [ ] Single line deletion
- [ ] Multi-line deletion
- [ ] Triggers positionTracker with negative delta

**applyAddition:**
- [ ] Inserts lines at correct position
- [ ] afterLine=0: inserts at beginning
- [ ] afterLine=lineCount: inserts at end
- [ ] Multiple lines insertion
- [ ] Triggers positionTracker

**File I/O:**
- [ ] readFile — normalizes CRLF to LF
- [ ] readFile — falls back to fs when vscode.openTextDocument fails
- [ ] readFile — throws for non-existent file
- [ ] writeFile — uses editGuard.withSystemEdit
- [ ] writeFile — writes through vscode.WorkspaceEdit when doc is open
- [ ] writeFile — falls back to fs.writeFileSync when doc not open

**CRLF edge cases:**
- [ ] File with CRLF: readFile returns LF content
- [ ] File with mixed LF/CRLF: all normalized to LF
- [ ] File with only LF: no change

**Моки**: vscode.workspace.openTextDocument, vscode.WorkspaceEdit, editGuard, DiffStore, PositionTracker

---

### 1.4 `HunkReverter.test.ts` — откат изменений

**reject — replacement:**
- [ ] Replaces added content with removedLines
- [ ] Correct range calculation: currentStartLine → currentEndLine
- [ ] Uses \n (NOT \r\n) for WorkspaceEdit
- [ ] Strips trailing \r from removedLines
- [ ] End-of-file edge case: uses rangeIncludingLineBreak
- [ ] Triggers positionTracker when delta != 0
- [ ] Updates hunk status to 'rejected'
- [ ] Updates parent statuses (FileChange, ResponseGroup)

**reject — deletion:**
- [ ] Inserts removedLines back at correct position
- [ ] Correct insert position
- [ ] Triggers positionTracker with positive delta

**reject — addition:**
- [ ] Removes added lines
- [ ] Correct delete range
- [ ] Triggers positionTracker with negative delta

**reject — error handling:**
- [ ] Throws for non-existent hunk
- [ ] Throws for already accepted hunk
- [ ] Throws for already rejected hunk
- [ ] applyEdit failure: logs error (not crash)

**accept:**
- [ ] Does NOT modify file
- [ ] Updates hunk status to 'accepted'
- [ ] Updates parent statuses

**Bulk operations:**
- [ ] acceptAllForFile — bottom-to-top order
- [ ] rejectAllForFile — bottom-to-top order
- [ ] acceptAllForResponseGroup
- [ ] rejectAllForResponseGroup
- [ ] Partial failure: continues with remaining hunks

**Parent status cascade:**
- [ ] All hunks accepted → FileChange='accepted', RG='accepted'
- [ ] All hunks rejected → FileChange='rejected', RG='rejected'
- [ ] Mixed → RG='partial'
- [ ] Pending hunks remain → no status change

**Моки**: vscode.workspace, vscode.WorkspaceEdit, editGuard, DiffStore, PositionTracker

---

### 1.5 `PositionTracker.test.ts` — пересчёт позиций

- [ ] recalculate — shifts hunks below edit point
- [ ] recalculate — does NOT shift the triggering hunk itself
- [ ] recalculate — positive delta (lines added)
- [ ] recalculate — negative delta (lines removed)
- [ ] recalculate — only affects hunks in same file
- [ ] recalculate — does not affect hunks above edit point
- [ ] Multiple recalculations stack correctly
- [ ] Zero delta: no-op

**Моки**: DiffStore

---

### 1.6 `SystemEditGuard.test.ts` — защита от ложных manual edits

- [ ] isSystemEdit — false by default
- [ ] withSystemEdit — isSystemEdit=true during execution
- [ ] withSystemEdit — isSystemEdit=false after completion
- [ ] withSystemEdit — isSystemEdit=false even after error
- [ ] Nested withSystemEdit — counter works correctly
- [ ] begin/end tokens — manual API

**Моки**: нет (чистая логика)

---

### 1.7 `DiffSystem.test.ts` — фасад (ИНТЕГРАЦИОННЫЕ ТЕСТЫ)

**Lifecycle:**
- [ ] initialize — sets initialized flag
- [ ] initialize — idempotent (double call)
- [ ] ensureInitialized — throws when not initialized
- [ ] setCurrentTaskId — stores taskId
- [ ] dispose — cleans up

**Checkpoint management:**
- [ ] startCheckpoint — creates ResponseGroup with messageTs
- [ ] startCheckpoint — finishes previous checkpoint
- [ ] startCheckpoint — auto-generates ts if not provided
- [ ] finishCheckpoint — clears currentResponseGroupId
- [ ] ensureResponseGroup — auto-creates if none

**Pre-save & Snapshot:**
- [ ] preSaveAndSnapshot — saves dirty file before edit
- [ ] preSaveAndSnapshot — takes snapshot of current content
- [ ] preSaveAndSnapshot — idempotent per RG (skip if exists)
- [ ] getCurrentMessageTs — returns RG's chatMessageTs

**Apply changes:**
- [ ] replaceLines — full flow: snapshot → overlap check → apply → hunk
- [ ] deleteLines — full flow
- [ ] addLines — full flow
- [ ] Multiple changes to same file in one RG
- [ ] Changes to different files in one RG

**Overlap detection:**
- [ ] Overlapping hunks: auto-reject old before applying new
- [ ] Adjacent hunks (touching boundaries): also auto-reject
- [ ] Non-overlapping hunks: no auto-reject
- [ ] Multiple overlapping hunks: all rejected bottom-to-top

**Rollback — rollbackFromMessage:**
- [ ] Single RG, single file — snapshot restore
- [ ] Single RG, multiple files — all files restored
- [ ] Multiple RGs — all reverted
- [ ] Per-group hunk filtering — only reverted RG's hunks rejected
- [ ] Earlier RG's hunks STAY pending
- [ ] Snapshot not found — fallback to hunk reject
- [ ] Empty groups — returns empty array
- [ ] taskId filter — only current task's RGs
- [ ] Snapshot cleanup after rollback
- [ ] Renderer cleanup after rollback

**Rollback — edge cases:**
- [ ] Rollback after some hunks manually accepted
- [ ] Rollback after some hunks manually rejected
- [ ] Rollback with overlap auto-rejected hunks
- [ ] Double rollback (same messageTs)
- [ ] Rollback with 0 affected files

**Accept / Reject single:**
- [ ] acceptChange — accepts + snapshot cleanup
- [ ] rejectChange — rejects + renderer refresh + snapshot cleanup
- [ ] acceptAllForFile
- [ ] rejectAllForFile

**No-op / validation:**
- [ ] validateChangeSize — rejects >60% change in files >20 lines
- [ ] validateChangeSize — allows small files
- [ ] validateChangeSize — allows <60% changes

**Manual edit handling:**
- [ ] handleManualEdit — edit inside hunk: schedules auto-remove check
- [ ] handleManualEdit — edit outside hunk: recalculates positions
- [ ] handleManualEdit — system edit: ignored (editGuard)
- [ ] Auto-remove: content matches original → hunk removed

**Snapshot cleanup:**
- [ ] checkSnapshotCleanup — 0 pending hunks → cleanup
- [ ] checkSnapshotCleanup — pending hunks remain → no cleanup

**Моки**: Full mock stack или in-memory implementations

---

## ПРИОРИТЕТ 2: ApprovalGate + Chat flow

### 2.1 `ApprovalGate.test.ts`

**Normal flow:**
- [ ] waitForResponse → handleResponse → resolves promise
- [ ] Correct AskResult fields (response, text, images, files)

**Early response (race condition):**
- [ ] handleResponse before waitForResponse → queued
- [ ] waitForResponse finds early response → immediate resolve
- [ ] Multiple early responses → FIFO order
- [ ] Early response with askTs → queued
- [ ] Early response without askTs → queued

**Edge cases:**
- [ ] handleResponse with askTs — exact match
- [ ] handleResponse without askTs — resolves last pending
- [ ] Multiple pending asks — old ones rejected
- [ ] rejectAll — cancels all pending + clears early responses
- [ ] clear — silently drops all
- [ ] hasPending — true/false
- [ ] pendingCount — correct count

**Моки**: нет (чистая логика)

---

### 2.2 `deleteFromMessage.test.ts`
- [ ] Calls rollbackFromMessage with correct ts
- [ ] Truncates shuncodeMessages at correct index
- [ ] Truncates API history
- [ ] Calls cancelTask
- [ ] Handles missing message gracefully

### 2.3 `retryFromMessage.test.ts`
- [ ] Saves original message text before rollback
- [ ] Calls rollbackFromMessage
- [ ] Truncates messages
- [ ] cancelTask + wait for ready
- [ ] Auto-responds with original text

---

## ПРИОРИТЕТ 3: Tool handlers

### 3.1 `WriteToFileToolHandler.test.ts`
- [ ] writeFileAndVisualizeDiff — computes correct diff blocks
- [ ] computeDiffBlocks — CRLF normalization
- [ ] computeDiffBlocks — replacement detection (removed + added)
- [ ] computeDiffBlocks — deletion detection (removed only)
- [ ] computeDiffBlocks — addition detection (added only)
- [ ] Fallback preview — re-reads actual file content
- [ ] Fallback preview — latest hunk data when file unchanged
- [ ] formatBlockPreview — correct +/- format
- [ ] No-op detection — returns toolError
- [ ] No-op detection — increments consecutiveMistakeCount
- [ ] cumulativeOffset — correct position tracking across blocks

---

## ПРИОРИТЕТ 4: UI

### 4.1 `KeyboardNavigation.test.ts`
- [ ] nextHunk — moves to next hunk in file
- [ ] nextHunk — wraps to first hunk when at end
- [ ] nextHunk — cross-file: opens next file with pending hunks
- [ ] prevHunk — moves to previous hunk
- [ ] prevHunk — wraps to last hunk when at beginning
- [ ] prevHunk — cross-file: opens previous file
- [ ] No pending hunks — no-op
- [ ] getCurrentHunk — returns containing hunk
- [ ] getCurrentHunk — returns nearest hunk when cursor between hunks

---

## ПРИОРИТЕТ 5: Ревизия старых тестов

| Файл | Статус | Действие |
|------|--------|----------|
| `test/e2e/diff.test.ts` | Рудимент | Удалить или переписать для V4 |
| `integrations/editor/__tests__/DiffViewProvider.test.ts` | Проверить | Может быть рудимент старого провайдера |
| `core/task/multifile-diff.test.ts` | Проверить | showChangedFilesDiff — используется ли |
| `core/assistant-message/diff*.test.ts` | Актуальны | Оставить (constructNewFileContent) |

---

## Стек и подход

- **Unit тесты**: mocha + chai/should + sinon
- **Моки VS Code API**: sinon stubs для vscode.workspace, vscode.window
- **In-memory workspaceState**: простой Map с get/update
- **Temp filesystem**: для FileSnapshotStorage (os.tmpdir())
- **Без playwright** для unit тестов

## Оценка трудоёмкости

| Блок | Тестов | Сложность |
|------|--------|-----------|
| DiffStore | ~35 | Средняя (нужен mock workspaceState) |
| FileSnapshotStorage | ~25 | Средняя (реальный fs в tmp) |
| HunkApplier | ~20 | Высокая (vscode mocks) |
| HunkReverter | ~25 | Высокая (vscode mocks) |
| PositionTracker | ~8 | Низкая |
| SystemEditGuard | ~6 | Низкая |
| DiffSystem (интеграция) | ~35 | Высокая (всё вместе) |
| ApprovalGate | ~12 | Низкая (чистая логика) |
| deleteFromMessage | ~5 | Средняя |
| retryFromMessage | ~5 | Средняя |
| WriteToFileToolHandler | ~11 | Высокая |
| KeyboardNavigation | ~9 | Средняя |
| **ИТОГО** | **~196** | |

## Порядок реализации

1. Mock-утилиты (vscode mocks, in-memory workspaceState, tmp fs helper)
2. SystemEditGuard.test.ts (самый простой, 0 зависимостей)
3. ApprovalGate.test.ts (чистая логика)
4. PositionTracker.test.ts (только DiffStore mock)
5. DiffStore.test.ts (in-memory workspaceState)
6. FileSnapshotStorage.test.ts (real fs в tmp)
7. HunkApplier.test.ts (vscode mocks + DiffStore)
8. HunkReverter.test.ts (vscode mocks + DiffStore)
9. DiffSystem.test.ts (интеграция всего)
10. WriteToFileToolHandler.test.ts
11. deleteFromMessage + retryFromMessage
12. KeyboardNavigation.test.ts
13. Ревизия старых тестов
