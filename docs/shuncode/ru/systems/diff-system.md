> **English version:** [diff-system.md](../../systems/diff-system.md)

# Inline Diff System v4

Cursor-подобная inline diff система. AI-агент записывает изменения напрямую в файлы, а пользователь управляет ими через кнопки Accept/Reject, отрисованные в редакторе. Per-message снапшоты обеспечивают точный откат.

## Архитектура

```
DiffSystem (фасад) — src/core/diff-v2/DiffSystem.ts
├── Storage
│   ├── DiffStore (единое хранилище: ResponseGroups, FileChanges, Hunks)
│   ├── FileSnapshotStorage (per-message снапшоты для отката)
│   └── PendingChangesStorage (мост → webview PendingChangesBar)
├── Engine
│   ├── HunkApplier (применение изменений, создание записей Hunk)
│   ├── HunkReverter (accept/reject, откат файлов)
│   ├── PositionTracker (пересчёт позиций после правок/reject)
│   └── SystemEditGuard (отличает системные записи от ручных правок)
└── UI
    ├── InlineDiffRenderer (реактивные View Zones + зелёные декорации)
    └── KeyboardNavigation (кросс-файловая навигация по хункам)
```

## Что нового в v4

| Функция | v3 | v4 |
|---------|----|----|
| Снапшоты | Нет | Per-message: каждое сообщение = свой снапшот |
| Откат | По хункам | На основе снапшотов + фильтрация хунков по группе |
| Per-message откат | Нет | Да: удаление msg2 не затрагивает msg1 |
| Детекция перекрытий | Строгая (`<`/`>`) | Включительная (`<=`/`>=`), смежные хунки тоже |
| removedLines | Из вычисления diff | Из реального содержимого файла (защита от MISMATCH) |
| Обработка EOL | `\r\n` на Windows | Всегда `\n` (VS Code нормализует) |
| Детекция no-op | Нет | Да: модель получает ошибку если файл не изменился |
| Навигация | Только внутри файла | Кросс-файловая (стрелки навигируют между файлами) |
| Превью в чате | Только write_to_file | Все типы инструментов (fallback из данных хунка) |
| ApprovalGate | pWaitFor polling | Promise-based + очередь ранних ответов |

## Поток данных

```
Сообщение пользователя → say("text") → startCheckpoint(messageTs)
                                              ↓
                                      ResponseGroup создана
                                      (снапшот сохранён перед первой правкой)
                                              ↓
AI Tool (write_to_file / replace_text / delete_block)
  → DiffSystem.replaceLines() / deleteLines() / addLines()
    → preSaveAndSnapshot() — идемпотентно для RG
    → applyWithOverlapCheck() — авто-reject смежных/перекрывающихся хунков
    → HunkApplier.applyReplacement() — запись файла + создание Hunk
      → removedLines = реальное содержимое файла (не вычисление diff)
      → DiffStore.createHunk() — вызывает событие hunkAdded
        → InlineDiffRenderer (реактивно создаёт View Zones)
        → PendingChangesStorage (синхронизация → webview)
```

## Per-Message откат

```
Message 1 → RG1 (снапшот A) → хунки 1, 2, 3
Message 2 → RG2 (снапшот B) → хунки 4, 5
Message 3 → RG3 (снапшот C) → хунк 6

Удаление message 2:
  → rollbackFromMessage(ts2)
  → находит RG2, RG3 (chatMessageTs >= ts2)
  → восстанавливает файл из снапшота B
  → отмечает только хунки RG2+RG3 как rejected
  → хунки RG1 остаются pending ✓
```

## Типы diff-блоков

### Удаление
```
┌──────────────────────────────┐
│ удалённая строка (красная)   │  ← View Zone
└──────────────────────────────┘
┌──────────────────────────────┐
│ [✓ Принять] [✗ Отклонить]   │  ← View Zone (кнопки)
└──────────────────────────────┘
```

### Добавление
```
│ 24 │ новая строка (зелёная)  │  ← TextEditorDecoration
┌──────────────────────────────┐
│ [✓ Принять] [✗ Отклонить]   │  ← View Zone (кнопки)
└──────────────────────────────┘
```

### Замена
```
┌──────────────────────────────┐
│ старая строка (красная)      │  ← View Zone (удаление)
├──────────────────────────────┤
│ 24 │ новая строка (зелёная)  │  ← TextEditorDecoration
┌──────────────────────────────┐
│ [✓ Принять] [✗ Отклонить]   │  ← View Zone (кнопки)
└──────────────────────────────┘
```

## Accept / Reject

**Accept:**
1. Файл не модифицируется (новый код уже на месте)
2. `store.updateHunkStatus('accepted')` → вызывает `hunkRemoved`
3. `InlineDiffRenderer` удаляет View Zones + зелёные декорации
4. Очистка снапшота когда 0 pending хунков осталось

**Reject:**
1. `HunkReverter.reject()` — восстанавливает оригинальные строки из `removedLines`
2. `PositionTracker.recalculate()` сдвигает оставшиеся хунки
3. `store.updateHunkStatus('rejected')` → вызывает `hunkRemoved`
4. Каскад статуса родителя: все rejected → RG='rejected', смешанные → RG='partial'

## Механизмы безопасности

**removedLines из реального файла:** `HunkApplier` читает `actualRemovedLines` из файла, а не от вызывающего кода. Гарантирует что красная зона показывает реальный оригинал.

**SystemEditGuard:** Отличает записи DiffSystem от ручных правок пользователя. Set-based токены, потокобезопасность, поддержка вложенных вызовов.

**ApprovalGate — очередь ранних ответов:** Решает race condition когда webview отправляет ответ до того, как Task достигнет `ask()`.

## Тесты

**217 тестов** покрывают всю DiffSystem:

| Компонент | Тестов |
|-----------|--------|
| SystemEditGuard | 10 |
| ApprovalGate | 18 |
| PositionTracker | 13 |
| DiffStore | 36 |
| FileSnapshotStorage | 27 |
| HunkApplier | 26 |
| HunkReverter | 22 |
| DiffSystem (интеграция) | 37 |
| WriteToFileToolHandler | 17 |
| KeyboardNavigation | 11 |

## Команды

| Команда | Описание |
|---------|----------|
| `shuncode.diff.accept` | Принять одно изменение |
| `shuncode.diff.reject` | Отклонить одно изменение |
| `shuncode.diff.acceptAllInFile` | Принять все в текущем файле |
| `shuncode.diff.rejectAllInFile` | Отклонить все в текущем файле |
| `shuncode.diff.nextHunk` | Следующий хунк (кросс-файлово) |
| `shuncode.diff.prevHunk` | Предыдущий хунк (кросс-файлово) |
| `shuncode.diff.clearAll` | Очистить все ожидающие изменения |

Использует `vscode.window.createWebviewTextEditorInset` (Proposed API `editorInsets`).
