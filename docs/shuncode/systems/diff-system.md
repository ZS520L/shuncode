> **Русская версия:** [diff-system.md](../ru/systems/diff-system.md)

# Inline Diff System v4

Cursor-like inline diff system. The AI agent writes changes directly to files, and the user controls them via Accept/Reject buttons rendered in the editor. Per-message snapshots enable precise rollback.

## Architecture

```
DiffSystem (facade) — src/core/diff-v2/DiffSystem.ts
├── Storage
│   ├── DiffStore (unified store: ResponseGroups, FileChanges, Hunks)
│   ├── FileSnapshotStorage (per-message snapshots for rollback)
│   └── PendingChangesStorage (bridge → webview PendingChangesBar)
├── Engine
│   ├── HunkApplier (applies changes, creates Hunk records)
│   ├── HunkReverter (accept/reject, file rollback)
│   ├── PositionTracker (recalculates positions after edits/reject)
│   └── SystemEditGuard (distinguishes system writes from manual edits)
└── UI
    ├── InlineDiffRenderer (reactive View Zones + green decorations)
    └── KeyboardNavigation (cross-file hunk navigation)
```

## What's New in v4

| Feature | v3 | v4 |
|---------|----|----|
| Snapshots | None | Per-message: each message = its own snapshot |
| Rollback | Hunk-by-hunk | Snapshot-based + per-group hunk filtering |
| Per-message rollback | No | Yes: deleting msg2 doesn't touch msg1 |
| Overlap detection | Strict (`<`/`>`) | Inclusive (`<=`/`>=`), adjacent hunks too |
| removedLines | From diff computation | From actual file content (MISMATCH protection) |
| EOL handling | `\r\n` on Windows | Always `\n` (VS Code normalizes) |
| No-op detection | No | Yes: model gets error if file unchanged |
| Navigation | Within file only | Cross-file (arrows navigate between files) |
| Chat preview | write_to_file only | All tool types (fallback from hunk data) |
| ApprovalGate | pWaitFor polling | Promise-based + early response queue |

## Data Flow

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
        → InlineDiffRenderer (reactively creates View Zones)
        → PendingChangesStorage (syncs → webview)
```

## Per-Message Rollback

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

## Diff Block Types

### Deletion
```
┌──────────────────────────────┐
│ deleted line (red)           │  ← View Zone
└──────────────────────────────┘
┌──────────────────────────────┐
│ [✓ Accept] [✗ Reject]       │  ← View Zone (buttons)
└──────────────────────────────┘
```

### Addition
```
│ 24 │ new line (green)        │  ← TextEditorDecoration
┌──────────────────────────────┐
│ [✓ Accept] [✗ Reject]       │  ← View Zone (buttons)
└──────────────────────────────┘
```

### Replacement
```
┌──────────────────────────────┐
│ old line (red)               │  ← View Zone (deletion)
├──────────────────────────────┤
│ 24 │ new line (green)        │  ← TextEditorDecoration
┌──────────────────────────────┐
│ [✓ Accept] [✗ Reject]       │  ← View Zone (buttons)
└──────────────────────────────┘
```

## Accept / Reject

**Accept:**
1. File is not modified (new code is already in place)
2. `store.updateHunkStatus('accepted')` → fires `hunkRemoved`
3. `InlineDiffRenderer` removes View Zones + green decorations
4. Snapshot cleanup when 0 pending hunks remain

**Reject:**
1. `HunkReverter.reject()` — restores original lines from `removedLines`
2. `PositionTracker.recalculate()` shifts remaining hunks
3. `store.updateHunkStatus('rejected')` → fires `hunkRemoved`
4. Parent status cascade: all rejected → RG='rejected', mixed → RG='partial'

## Safety Mechanisms

**removedLines from actual file:** `HunkApplier` reads `actualRemovedLines` from the file, not from the caller. Guarantees the red zone shows the real original.

**SystemEditGuard:** Distinguishes DiffSystem writes from manual user edits. Set-based tokens, thread-safe, supports nested calls.

**ApprovalGate — early response queue:** Solves race conditions when the webview sends a response before the Task reaches `ask()`.

## Tests

**217 tests** cover the entire DiffSystem:

| Component | Tests |
|-----------|-------|
| SystemEditGuard | 10 |
| ApprovalGate | 18 |
| PositionTracker | 13 |
| DiffStore | 36 |
| FileSnapshotStorage | 27 |
| HunkApplier | 26 |
| HunkReverter | 22 |
| DiffSystem (integration) | 37 |
| WriteToFileToolHandler | 17 |
| KeyboardNavigation | 11 |

## Commands

| Command | Description |
|---------|-------------|
| `shuncode.diff.accept` | Accept one change |
| `shuncode.diff.reject` | Reject one change |
| `shuncode.diff.acceptAllInFile` | Accept all in current file |
| `shuncode.diff.rejectAllInFile` | Reject all in current file |
| `shuncode.diff.nextHunk` | Next hunk (cross-file) |
| `shuncode.diff.prevHunk` | Previous hunk (cross-file) |
| `shuncode.diff.clearAll` | Clear all pending changes |

Uses `vscode.window.createWebviewTextEditorInset` (Proposed API `editorInsets`).
