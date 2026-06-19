# Diff System v4 — Проектный документ

> Статус: 🔵 В разработке
> Дата: 2026-02-19

---

## Проблемы v3 (почему переделываем)

### 1. Два несовместимых потока записи
Tool handlers (`WriteToFileToolHandler`, `ApplyPatchHandler`) пишут файлы **напрямую**, а потом просят DiffSystem "нарисовать" визуальные зоны через `showDiffVisualization()`. Это создаёт рассинхрон между реальным содержимым файла и данными в DiffStore.

### 2. Наслоение диффов (Overlap)
При повторном `write_to_file` на тот же файл старые pending хунки не инвалидируются. Новые хунки создаются поверх старых → визуальная каша.

### 3. Нет надёжного отката (Retry/Delete)
`rollbackFromMessage()` реверсит хунки поблочно через `rejectAllForResponseGroup`. Не откатывает accepted хунки. Ломается при ручных правках пользователя.

### 4. Три состояния файла не учитываются
Файл может быть: на диске / в buffer (открыт) / в buffer (unsaved). AI пишет поверх unsaved без предупреждения. Принудительно сохраняет чужие несохранённые правки.

### 5. Потеря отступов
`lineTrimmedFallbackMatch` в `diff.ts` находит блок по обрезанным строкам, но REPLACE контент вставляется с отступами модели, а не оригинальными.

---

## Область видимости: DiffSystem и Task

### Как устроено у Cursor (и у нас)

Диффы **принадлежат файлам, а не задачам**. При переключении задач (табов чата):
- Pending хунки в файлах **остаются** видимыми — это правильно
- Файл один, buffer один, изменения реальны
- View Zones пересоздаются через `onDidChangeVisibleTextEditors`

### Почему НЕ нужен clearAll() при переключении задач

1. **Файл — единый источник истины.** Если AI в Task A изменил строки 5-10, эти строки РЕАЛЬНО изменены в файле. Переключение на Task B не отменяет эти изменения.
2. **Юзер должен видеть pending хунки** независимо от активной задачи — чтобы Accept/Reject.
3. **Cursor так и работает** — диффы видны всегда, пока не resolved.

### Что нужно: taskId для rollback scoping

Единственная причина привязки к задаче — **rollback**. Когда юзер нажимает "Повторить" в Task B, система должна откатить только хунки Task B, не трогая Task A.

```typescript
interface ResponseGroup {
  id: string;
  taskId: string;            // NEW: для scoped rollback
  chatMessageTs: number;
  description?: string;
  status: ResponseGroupStatus;
  createdAt: number;
  resolvedAt?: number;
}
```

**Rollback по messageTs** уже фильтрует правильно: `getResponseGroupsFromMessageTs(messageTs)` вернёт только группы с `chatMessageTs >= messageTs`. Разные задачи имеют разные timestamps → не пересекаются.

Но для дополнительной безопасности `taskId` в ResponseGroup гарантирует, что rollback задачи B **никогда** не затронет хунки задачи A, даже при совпадении timestamps.

### Overlap между задачами

Task A оставила pending хунк H1 на строках 5-10 файла foo.ts.
Task B хочет изменить строки 8-12 того же файла.

→ Стандартная overlap detection: reject H1 → apply H2.
→ Юзер теряет возможность reject H1 отдельно — но это логично: новое изменение заменило старое.

### При переключении задач

```
clearTask():
  → DiffSystem.finishCheckpoint()  // закрыть текущий ResponseGroup
  → НЕ чистить данные

initTask(taskId):
  → DiffSystem.setCurrentTaskId(taskId)  // для новых ResponseGroups
  → View Zones восстановятся автоматически (onDidChangeVisibleTextEditors)
```

### VS Code документная модель (для справки)

```
TextDocument (buffer)     — один на файл, shared
TextEditor (view)         — один на каждый видимый редактор файла
View Zone / Inset         — привязан к TextEditor, не к документу

foo.ts открыт в 2 split panels:
  → 1 TextDocument
  → 2 TextEditor
  → View Zones создаются для обоих через restoreZonesForEditors()
```

---

## Архитектура v4

### Ключевое изменение: ОДИН путь записи

**v3 (сломано):**
```
Tool Handler → пишет файл сам → showDiffVisualization() (визуальный оверлей)
```

**v4 (правильно):**
```
Tool Handler → вычисляет блоки → DiffSystem.replaceLines() / deleteLines() / addLines()
                                  → HunkApplier (атомарно: пишет + трекает + пересчитывает)
```

`showDiffVisualization()` **удаляется**. Все записи в файлы — только через HunkApplier.

### Архитектурная схема v4

```
┌─────────────────────────────────────────────────────────────────┐
│                          DiffSystem (facade)                     │
│                    src/core/diff-v2/DiffSystem.ts                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─── Storage ─────────────────────────────────────────────┐    │
│  │                                                          │    │
│  │  DiffStore            FileSnapshotStorage                │    │
│  │  (ResponseGroups,     (полные снэпшоты файлов            │    │
│  │   FileChanges,         для надёжного отката)             │    │
│  │   Hunks)                                                 │    │
│  │                       PendingChangesStorage              │    │
│  │                       (bridge → webview)                 │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─── Engine ──────────────────────────────────────────────┐    │
│  │                                                          │    │
│  │  HunkApplier          PositionTracker                    │    │
│  │  (ЕДИНСТВЕННЫЙ        (пересчёт позиций                  │    │
│  │   путь записи         после каждого хунка)               │    │
│  │   в файлы)                                               │    │
│  │                                                          │    │
│  │  HunkReverter         SystemEditGuard                    │    │
│  │  (accept/reject       (защита от ложных                  │    │
│  │   единичных хунков)    onDidChange)                      │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─── UI ──────────────────────────────────────────────────┐    │
│  │  InlineDiffRenderer   KeyboardNavigation                 │    │
│  │  (реактивные          (Tab / shortcuts)                  │    │
│  │   View Zones)                                            │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Система снэпшотов

### Зачем
Надёжный откат при Retry/Delete. Вместо поблочного реверса хунков — восстановление полного содержимого файла из снэпшота.

### Когда создаём снэпшот
**Ровно один момент:** перед первым хунком AI для файла в новом ResponseGroup.

### Порядок при AI-правке файла (5 шагов)

```
1. ОТКРЫТЬ    → doc = openTextDocument(fsPath)
2. СОХРАНИТЬ  → if (doc.isDirty) doc.save()     // сохраняем юзерское
3. СНЭПШОТ   → snapshot = doc.getText()          // фиксируем состояние
4. ПРИМЕНИТЬ  → HunkApplier.applyXxx()            // AI-изменения
5. СОХРАНИТЬ  → doc.save()                        // сохраняем AI-правку
```

### Когда удаляем снэпшоты
Когда ВСЕ pending хунки для файла resolved (accepted / rejected). 0 pending → delete snapshots.

### Структура данных

```typescript
interface FileSnapshot {
  id: string;
  fsPath: string;
  content: string;                    // полное содержимое buffer
  timestamp: number;
  responseGroupId: string;            // к какому checkpoint привязан
  messageTs: number;                  // привязка к сообщению чата
  pendingHunkPositions: Array<{       // позиции существующих хунков на момент снэпшота
    hunkId: string;
    currentStartLine: number;
    currentEndLine: number;
  }>;
}
```

### Rollback (Retry/Delete) — подтверждено экспериментом на Cursor

**Эксперимент (2026-02-19):**
Tab A сделал правку строки 6 и строки 44. Tab B сделал правку строки 26.
Хронология: Tab A шаг 1 → Tab B шаг 1 → Tab A шаг 2.
Откат в Tab B → файл восстановлен по снэпшоту Tab B.
Результат: строка 6 (Tab A шаг 1) **осталась** (была ДО снэпшота Tab B),
строка 44 (Tab A шаг 2) **снесена** (была ПОСЛЕ снэпшота Tab B).
**ВСЕ диффы во ВСЕХ табах удалены — файл чистый, ни одного pending хунка.**

**Вывод: Cursor при откате:**
1. Восстанавливает файл из снэпшота (полный контент)
2. Удаляет ВСЕ pending хунки для этого файла — из ВСЕХ задач
3. Чистый лист — никаких stale зон

```
rollbackFromMessage(messageTs):
  1. Найти все файлы, затронутые в ResponseGroups с ts >= messageTs
  2. Для каждого файла:
     a) Найти снэпшот с этим messageTs
     b) Записать snapshot.content в файл (editGuard!)
     c) Удалить ВСЕ pending хунки этого файла (из ВСЕХ задач!)
     d) Удалить ВСЕ View Zones этого файла
  3. Удалить ResponseGroups с ts >= messageTs (текущей задачи)
  4. Удалить снэпшоты с ts >= messageTs (текущей задачи)
```

**Почему чистим ВСЕ хунки файла, а не только свои:**
- После восстановления снэпшота позиции чужих хунков невалидны
- removedLines/addedLines чужих хунков не соответствуют содержимому файла
- Попытка Accept/Reject невалидного хунка → мусор
- Cursor так и делает — проще и надёжнее

### Нагрузка
- Средний файл: 20-50 КБ
- 60 файлов × 50 КБ = 3 МБ
- 5 сообщений × 3 МБ = 15 МБ максимум
- Операции (getText/writeFile): мгновенные

---

## Поток записи: Tool Handler → DiffSystem → HunkApplier

### write_to_file

```
WriteToFileToolHandler.executeNativeDiff():
  1. originalContent = doc.getText()
  2. newContent = block.params.content (с фиксами модели)
  3. Проверка размера: если изменено > 60% строк при файле > 20 строк → ошибка модели
  4. changes = diff.diffLines(originalContent, newContent)
  5. diffBlocks = buildDiffBlocks(changes)  // как сейчас
  6. Для каждого блока (сверху вниз):
     if (replacement) → DiffSystem.replaceLines(fsPath, startLine, removedLines, addedLines)
     if (deletion)    → DiffSystem.deleteLines(fsPath, startLine, count)
     if (addition)    → DiffSystem.addLines(fsPath, afterLine, newLines)
```

### replace_in_file

```
WriteToFileToolHandler.executeNativeDiff():
  1. originalContent = doc.getText()
  2. result = constructNewFileContent(diffContent, originalContent, !block.partial)
  3. Используем result.replacements для построения блоков
  4. Для каждого replacement:
     → Вычислить startLine, removedLines, addedLines
     → DiffSystem.replaceLines(fsPath, startLine, removedLines, addedLines)
```

### apply_patch

```
ApplyPatchHandler.prepareFileChangeWithNativeDiff():
  1. НЕ пишем файл напрямую
  2. Для каждого chunk:
     → DiffSystem.replaceLines(targetPath, lineNumber, chunk.delLines, chunk.insLines)
```

### delete_block / replace_text

Уже используют `DiffSystem.deleteLines()` / `DiffSystem.replaceLines()` — не требуют изменений.

---

## Overlap Detection: что делать когда блоки перекрываются

### Когда возникает overlap

**Сценарий 1: Один tool call, несколько блоков**

```
Tool: write_to_file → diff.diffLines() → 3 diff blocks
  Block A: строки 5-8     → HunkApplier.applyReplacement() → Hunk H1
  Block B: строки 15-20   → HunkApplier.applyReplacement() → Hunk H2
  Block C: строки 30-32   → HunkApplier.applyReplacement() → Hunk H3
```

Блоки применяются **сверху вниз**. После каждого — PositionTracker сдвигает нижние.
**Overlap невозможен** — PositionTracker это гарантирует.

**Сценарий 2: Два tool call подряд на один файл**

```
Tool call 1: replace_in_file → Hunk H1 (строки 10-15), Hunk H2 (строки 25-30)
Tool call 2: replace_in_file → Hunk H3 хочет строки 12-18 ← OVERLAP с H1!
```

**Сценарий 3: write_to_file после replace_in_file**

```
Tool call 1: replace_in_file → Hunk H1 (строки 10-15)
Tool call 2: write_to_file  → перезаписывает ВЕСЬ файл
  → diff.diffLines() → новые блоки, которые ПЕРЕКРЫВАЮТ H1
```

**Сценарий 4: Модель "исправляет свою ошибку"**

```
Tool call 1: replace_in_file → Hunk H1 (строки 10-15) — неправильно
Tool call 2: replace_in_file → хочет исправить строки 10-15 — правильно
  → ПОЛНЫЙ overlap с H1
```

**Сценарий 5: Частичное перекрытие снизу**

```
Pending: Hunk H1 (строки 10-15, addedLines = 6 строк)
Новый:   Хочет изменить строки 13-20
  → Строки 13-15 перекрываются с H1
```

### Визуальный пример overlap

```
Файл ДО AI:                    После tool call 1:        После tool call 2:
  1: function foo() {            1: function foo() {       1: function foo() {
  2:   const a = 1;              2:   const a = 1;         2:   const a = 1;
  3:   const b = 2;              3:   const b = 99;  [H1]  3:   const b = 99;  [H1] ← СТАРЫЙ pending
  4:   const c = 3;              4:   const c = 99;  [H1]  4:   const c = 42;  [H3] ← НОВЫЙ хочет сюда!
  5:   return a + b + c;         5:   return a + b + c;    5:   const d = 7;   [H3]
  6: }                           6: }                      6:   return a + b + c;
                                                           7: }
```

H3 хочет изменить строку 4 (в текущем состоянии), но строка 4 уже часть H1.
**Без overlap detection** → два набора кнопок Accept/Reject на одних строках → каша.

### Стратегия: Reject старых overlapping → Apply нового

```typescript
// В DiffSystem, перед вызовом HunkApplier:

async applyWithOverlapCheck(
  fsPath: string,
  startLine: number,       // 1-indexed, начало нового изменения
  endLine: number,         // 1-indexed exclusive, конец нового изменения
  operation: () => Promise<string>,  // () => hunkApplier.applyXxx()
): Promise<string> {
  const pendingHunks = this.store.getPendingHunksByFile(fsPath);

  // Найти все pending хунки, которые перекрываются с [startLine, endLine)
  const overlapping = pendingHunks.filter(h =>
    h.currentStartLine < endLine && h.currentEndLine > startLine
  );

  if (overlapping.length > 0) {
    console.log(`[DiffSystem] Overlap detected: ${overlapping.length} hunks conflict`);

    // Reject снизу вверх (чтобы позиции верхних не поехали)
    const sorted = [...overlapping].sort((a, b) => b.currentStartLine - a.currentStartLine);
    for (const old of sorted) {
      console.log(`[DiffSystem] Auto-rejecting overlapping hunk ${old.id} (lines ${old.currentStartLine}-${old.currentEndLine})`);
      await this.hunkReverter.reject(old.id);
      // reject() автоматически вызывает PositionTracker
      // → оставшиеся хунки сдвигаются
    }

    // После reject файл вернулся к оригиналу в этом диапазоне
    // → можно безопасно применить новый хунк
  }

  return await operation();
}
```

### Почему reject, а не merge

**Merge** (объединение хунков) — **отклоняем** по 3 причинам:

1. **Сложность**: Частичное перекрытие сверху, снизу, полное вложение, пересечение нескольких хунков — каждый вариант требует отдельной логики пересчёта removedLines/addedLines.

2. **Некорректный removedLines**: При merge нужно "сшить" оригинальные строки из двух хунков. Но если H1 уже изменил файл, оригинальные строки H1 (removedLines) могут быть на диске только в снэпшоте, а не в текущем файле.

3. **Непредсказуемый Reject**: Если юзер нажимает Reject на merged-хунк — к какому состоянию откатывать? К оригиналу до H1? Или к состоянию после H1? Пользователь не может это контролировать.

**Reject + Apply** — прямолинейно:
1. Restore original в перекрывающемся диапазоне (reject)
2. PositionTracker пересчитает всё
3. Apply новый хунк на чистый текст
4. Юзер видит только ОДИН набор кнопок Accept/Reject для свежего изменения

Пользователь теряет возможность Reject-нуть СТАРОЕ изменение отдельно — но это и **логично**: модель сама решила переписать свой предыдущий результат.

### Таблица всех overlap-сценариев

```
Обозначения:
  H_old = существующий pending хунк (строки S1..E1)
  H_new = новый хунк (строки S2..E2)

  Overlap condition: S1 < E2 AND E1 > S2
```

| # | Сценарий | Пример | Действие |
|---|----------|--------|----------|
| 1 | H_new полностью внутри H_old | H_old: 5-15, H_new: 8-12 | Reject H_old → Apply H_new |
| 2 | H_old полностью внутри H_new | H_old: 8-12, H_new: 5-15 | Reject H_old → Apply H_new |
| 3 | Частичное перекрытие сверху | H_old: 5-15, H_new: 10-20 | Reject H_old → Apply H_new |
| 4 | Частичное перекрытие снизу | H_old: 10-20, H_new: 5-15 | Reject H_old → Apply H_new |
| 5 | Точное совпадение | H_old: 5-15, H_new: 5-15 | Reject H_old → Apply H_new |
| 6 | Несколько старых хунков | H_old1: 5-10, H_old2: 12-18, H_new: 7-16 | Reject H_old1 + H_old2 → Apply H_new |
| 7 | Соседние (gap = 0) | H_old: 5-10, H_new: 10-15 | **НЕ overlap** (E1 = S2, НО условие `E1 > S2` ложно при `E1 == S2`) |
| 8 | Gap = 1 строка | H_old: 5-10, H_new: 11-15 | **НЕ overlap** — нормальное применение |

### Важно: порядок reject при нескольких overlapping

Если H_new перекрывает несколько старых хунков, reject выполняется **снизу вверх**:

```
Pending: H1 (5-10), H2 (12-18), H3 (20-25)
Новый:   H_new хочет строки 8-22
  → Overlapping: H1, H2, H3

Порядок reject:
  1. Reject H3 (20-25) → PositionTracker сдвигает ниже
  2. Reject H2 (12-18) → PositionTracker сдвигает ниже
  3. Reject H1 (5-10)  → PositionTracker сдвигает ниже

  Теперь файл чистый в диапазоне 8-22 → Apply H_new
```

Снизу вверх — потому что reject H3 сдвигает позиции НИЖЕ H3, но не трогает H2 и H1 (они выше). Если бы мы начали сверху — reject H1 сдвинул бы H2 и H3, и их позиции в нашем списке overlapping стали бы неактуальными.

### Граничный случай: overlap с accepted хунком

Если H_old уже `accepted` — перекрытие невозможно. Accepted хунк не отображается в UI, его removedLines/addedLines больше не влияют на файл. `getPendingHunksByFile()` не вернёт его.

### Граничный случай: overlap при DELETION

```
Pending: H1 = deletion, строки 10-10 (0 addedLines, removedLines = ["old"])
  → currentStartLine = 10, currentEndLine = 10 (start == end для deletion)

Новый: хочет строки 9-11
  → H1.currentStartLine (10) < 11 AND H1.currentEndLine (10) > 9?
  → 10 < 11 = true, 10 > 9 = true → OVERLAP ✓
  → Reject H1 (восстанавливает удалённую строку) → Apply новый
```

### Граничный случай: overlap при ADDITION

```
Pending: H1 = addition, строки 10-13 (3 addedLines, 0 removedLines)
  → currentStartLine = 10, currentEndLine = 13

Новый: хочет строки 11-14
  → 10 < 14 = true, 13 > 11 = true → OVERLAP ✓
  → Reject H1 (удаляет добавленные строки) → Apply новый
```

### Лимит на размер изменений

```typescript
// В DiffSystem, перед применением блоков от write_to_file:
function validateChangeSize(
  originalContent: string,
  diffBlocks: DiffBlock[],
  fsPath: string
): { ok: boolean; error?: string } {
  const originalLineCount = originalContent.split('\n').length;

  // Не проверяем маленькие файлы (< 20 строк)
  if (originalLineCount < 20) return { ok: true };

  // Считаем затронутые строки
  let changedLines = 0;
  for (const block of diffBlocks) {
    changedLines += Math.max(block.removedLines.length, block.addedLines.length);
  }

  const changePercent = changedLines / originalLineCount;

  if (changePercent > 0.6) {
    return {
      ok: false,
      error: `Too many changes: ${Math.round(changePercent * 100)}% of file modified ` +
             `(${changedLines}/${originalLineCount} lines). ` +
             `Use replace_in_file with targeted SEARCH/REPLACE blocks instead of rewriting the entire file. ` +
             `Each change should modify only the specific lines that need to change.`
    };
  }

  return { ok: true };
}
```

Применяется ТОЛЬКО к `write_to_file` (полная перезапись). `replace_in_file` и `apply_patch` по определению точечные.

---

## Детальная проработка: переход writeFileAndVisualizeDiff → HunkApplier

### Текущий поток (v3, сломанный)

```
WriteToFileToolHandler.writeFileAndVisualizeDiff():
  1. diff.diffLines(original, new) → массив diffBlocks
  2. Для каждого блока (СНИЗУ ВВЕРХ):
     → vscode.workspace.applyEdit() — пишет напрямую в buffer
  3. doc.save()
  4. Для каждого блока (СВЕРХУ ВНИЗ):
     → diffSystem.showDiffVisualization() — ТОЛЬКО визуал, НЕ пишет файл
       → store.createHunk() → renderer создаёт View Zones
```

**Проблема**: шаг 2 и шаг 4 — это ДВА РАЗНЫХ потока. Файл уже записан на шаге 2.
`showDiffVisualization` на шаге 4 просто "рисует" зоны поверх. Но:
- Если второй tool call на тот же файл → старые хунки НЕ знают что файл изменился
- removedLines в старых хунках указывают на строки, которых уже нет
- Reject старого хунка пытается восстановить `removedLines` → но файл другой → МУСОР

### Новый поток (v4)

```
WriteToFileToolHandler.executeNativeDiff():
  1. originalContent = doc.getText()
  2. newContent = params.content (с фиксами модели)
  3. validateChangeSize(originalContent, diffBlocks) → если >60% → ошибка модели
  4. diffBlocks = computeDiffBlocks(originalContent, newContent)
  5. Для каждого блока (СВЕРХУ ВНИЗ):
     → diffSystem.applyWithOverlapCheck(fsPath, start, end, () => {
         if (replacement) → hunkApplier.applyReplacement(...)
         if (deletion)    → hunkApplier.applyDeletion(...)
         if (addition)    → hunkApplier.applyAddition(...)
       })
     → HunkApplier:
       a) Читает текущий файл из buffer
       b) Splice строк
       c) Записывает через editGuard.withSystemEdit()
       d) Создаёт Hunk в DiffStore
       e) PositionTracker.recalculate() — сдвигает ВСЕ нижние хунки
     → InlineDiffRenderer реактивно создаёт View Zones
```

**Ключевое отличие**: НЕТ двойной записи. Каждый блок — атомарная операция: прочитал → изменил → записал → создал хунк → пересчитал позиции.

### Пошаговый пример: два tool call на один файл

```
Файл (6 строк):
  1: function foo() {
  2:   const a = 1;
  3:   const b = 2;
  4:   const c = 3;
  5:   return a + b + c;
  6: }

═══ Tool call 1: replace_in_file — меняем строку 3 ═══

  diffSystem.replaceLines("foo.ts", 3, ["  const b = 2;"], ["  const b = 99;"])
    → HunkApplier:
      - splice(2, 1, "  const b = 99;")
      - writeFile()
      - createHunk(H1): start=3, end=4, removed=["  const b = 2;"], added=["  const b = 99;"]
      - delta = 0 → PositionTracker: ничего не сдвигает
    → InlineDiffRenderer: View Zone для H1

Файл после:
  1: function foo() {
  2:   const a = 1;
  3:   const b = 99;  ← [H1 pending, зелёная]
  4:   const c = 3;
  5:   return a + b + c;
  6: }

═══ Tool call 2: replace_in_file — меняем строки 3-4 (OVERLAP с H1!) ═══

  diffSystem.applyWithOverlapCheck("foo.ts", 3, 5, () => ...)
    → Overlap detected: H1 (3-4) перекрывается с [3, 5)
    → Reject H1:
      - Файл: splice(2, 1, "  const b = 2;") — восстанавливаем оригинал
      - writeFile()
      - PositionTracker: delta=0 (1 строка removed, 1 restored)
      - store.updateHunkStatus(H1, 'rejected')
      - InlineDiffRenderer: удаляем View Zone H1

    Файл после reject:
      1: function foo() {
      2:   const a = 1;
      3:   const b = 2;   ← оригинал восстановлен
      4:   const c = 3;
      5:   return a + b + c;
      6: }

    → Теперь apply: hunkApplier.applyReplacement("foo.ts", 3,
        ["  const b = 2;", "  const c = 3;"],
        ["  const b = 42;", "  const c = 7;"])
      - splice(2, 2, "  const b = 42;", "  const c = 7;")
      - writeFile()
      - createHunk(H2): start=3, end=5, removed=2 строки, added=2 строки
      - delta = 0
      - InlineDiffRenderer: View Zone для H2

Файл после:
  1: function foo() {
  2:   const a = 1;
  3:   const b = 42;   ← [H2 pending, зелёная]
  4:   const c = 7;    ← [H2 pending, зелёная]
  5:   return a + b + c;
  6: }

Юзер видит ОДИН чистый хунк H2. Без наслоений.
```

### Пошаговый пример: write_to_file после replace_in_file

```
Исходный файл (5 строк):
  1: const x = 1;
  2: const y = 2;
  3: const z = 3;
  4: console.log(x);
  5: console.log(y);

═══ Tool call 1: replace_in_file → H1 на строке 2 ═══

Pending:  H1 (строки 2-3, removed=["const y = 2;"], added=["const y = 99;"])

═══ Tool call 2: write_to_file → перезаписывает ВЕСЬ файл ═══

  newContent =
    const x = 1;
    const y = 99;     ← совпадает с H1
    const z = 3;
    console.log(x);
    console.log(z);   ← изменение: y → z

  diffBlocks = diff.diffLines(original, new):
    Block 1: replacement, строка 2 в оригинале (y=2 → y=99)
    Block 2: replacement, строка 5 в оригинале (log(y) → log(z))

  validateChangeSize: 2/5 = 40% < 60% → OK

  Block 1: applyWithOverlapCheck("file.ts", 2, 3, ...)
    → Overlap: H1 (2-3) перекрывает [2, 3)
    → Reject H1 → файл: y=2 (оригинал)
    → Apply: replace строку 2 → y=99 → Hunk H3

  Block 2: applyWithOverlapCheck("file.ts", 5, 6, ...)
    → Нет overlap
    → Apply: replace строку 5 → log(z) → Hunk H4

Результат: H3 и H4 — два чистых хунка. Нет наслоений.
```

---

## Accept / Reject единичных хунков

### Accept (без изменений от v3)
1. Файл не трогается (новый код уже на месте)
2. `store.updateHunkStatus('accepted')` → fires `hunkRemoved`
3. InlineDiffRenderer удаляет View Zones + зелёные декорации
4. Проверка: 0 pending в файле → удалить снэпшоты

### Reject (без изменений от v3, + валидация)
1. **Валидация**: прочитать текущие строки в диапазоне хунка из buffer
   - Если совпадают с `addedLines` → стандартный reject
   - Если НЕ совпадают → юзер редактировал внутри хунка → показать предупреждение?
     (На будущее. Пока — просто reject, логировать warning)
2. `HunkReverter.reject()` → заменяет addedLines на removedLines
3. `PositionTracker.recalculate()` сдвигает оставшиеся хунки
4. `store.updateHunkStatus('rejected')` → fires `hunkRemoved`
5. InlineDiffRenderer удаляет зоны
6. Проверка: 0 pending в файле → удалить снэпшоты

---

## Обработка ручных правок пользователя

### Правка ВСНУТРИ хунка (зелёная зона)
- `handleManualEdit()` → обнаруживает что edit внутри pending хунка
- `scheduleAutoRemoveCheck()` → через 500ms проверяет:
  - Если текущие строки == removedLines → хунк auto-removed (юзер отменил вручную)
  - Если нет → хунк остаётся, но addedLines в store устарели
- PositionTracker пересчитывает позиции хунков ниже (при delta != 0)

### Правка ВНЕ хунков
- PositionTracker сдвигает все pending хунки ниже точки правки
- Снэпшот НЕ создаётся (создаётся только перед AI-правками)

### Ctrl+Z
- VS Code откатывает applyEdit в buffer
- `onDidChangeTextDocument` → `handleManualEdit` → auto-remove check
- Если юзер отменил один хунк целиком через Ctrl+Z → хунк auto-removed

### Ctrl+S (сохранение пользователем)
- Обычное сохранение. Снэпшот НЕ создаётся.
- Состояние pending хунков не меняется.

### Закрытие файла без сохранения
- Buffer сбрасывается к дисковому состоянию
- При повторном открытии — DiffSystem восстанавливает View Zones
- Если позиции поехали (из-за утерянных unsaved правок) — при rollback
  снэпшот восстановит правильное состояние

---

## Порядок применения блоков

### Несколько блоков в одном файле (один tool call)

**Сверху вниз**, каждый через HunkApplier:

```
Блок 1: строки 5-8   → HunkApplier.applyReplacement()  → hunk H1
                        → PositionTracker: если delta != 0, сдвигает всё ниже
Блок 2: строки 15-20 → HunkApplier.applyReplacement()  → hunk H2
                        → PositionTracker: сдвигает всё ниже H2
Блок 3: строки 30-32 → HunkApplier.applyReplacement()  → hunk H3
```

Каждый последующий блок видит актуальные позиции (после пересчёта).

### Несколько файлов (один tool call)

Последовательно. Каждый файл — отдельный проход через 5 шагов (открыть → сохранить юзерское → снэпшот → применить → сохранить).

### Несколько tool call подряд на один файл

Каждый tool call — новые хунки поверх предыдущих. PositionTracker корректирует. При overlap — reject старых.

---

## Что удаляется из v3

| Компонент | Причина удаления |
|-----------|------------------|
| `DiffSystem.showDiffVisualization()` | Заменяется прямыми вызовами HunkApplier |
| `DiffSystem.mergeWithExistingHunk()` | Merge заменяется на reject + apply |
| Прямая запись файлов в `WriteToFileToolHandler` | Всё через DiffSystem |
| Прямая запись файлов в `ApplyPatchHandler` | Всё через DiffSystem |

---

## Что добавляется в v4

| Компонент | Назначение |
|-----------|------------|
| Расширенный `FileSnapshotStorage` | Цепочка снэпшотов на файл с привязкой к messageTs |
| `validateChangeSize()` | Лимит >60% изменений для write_to_file |
| Overlap detection в HunkApplier | Reject overlapping хунков перед применением нового |
| Pre-save logic | Сохранение юзерских unsaved правок перед AI-записью |
| Snapshot cleanup | Удаление снэпшотов при 0 pending |

---

## Взаимодействие overlap detection и снэпшотов

### Проблема: reject при overlap создаёт "третье" состояние

```
Snapshot S0 = файл ДО всех AI правок
Tool call 1 → Hunk H1 (строки 3-5)
  → Файл = S1 (= S0 + H1)
Tool call 2 → хочет строки 4-6 (overlap с H1)
  → Reject H1 → файл возвращается к S0 (в диапазоне 3-5)
  → Apply H2 → файл = S2 (= S0 + H2)
```

Снэпшот S0 остаётся валидным! При rollback → восстанавливаем S0 → всё чисто.

### Проблема: reject при overlap и пользовательские правки

```
Snapshot S0 = файл ДО AI правок
Tool call 1 → Hunk H1 (строки 3-5)
Юзер правит строку 7 (ВНЕ хунка) → файл = S1' (S1 + user edit)
Tool call 2 → overlap с H1
  → Reject H1: восстанавливает строки 3-5 к оригиналу
  → Строка 7 с юзерской правкой НЕ затрагивается (reject точечный)
  → Apply H2 → файл = S2' (S0[3-5] + user_edit[7] + H2)
```

Юзерская правка на строке 7 **сохраняется** — reject трогает только свой диапазон.
Но при rollback → восстанавливаем S0 → юзерская правка **теряется**.

**Решение**: перед rollback проверяем isDirty. Если файл грязный — save + предупреждение.
Но более надёжно: снэпшот содержит полное состояние на момент начала tool call,
включая юзерские правки (потому что мы делаем `doc.save()` перед снэпшотом).

### Последовательность с учётом overlap и снэпшотов

```
Tool call на файл foo.ts:
  1. doc = openTextDocument(foo.ts)
  2. if (doc.isDirty) doc.save()          // сохраняем юзерское
  3. if (нет снэпшота для foo.ts в этом ResponseGroup):
     snapshot = doc.getText()              // фиксируем состояние
     snapshotStorage.save(rgId, foo.ts, snapshot)
  4. Для каждого diff block:
     a) applyWithOverlapCheck() → reject overlapping → apply new
  5. doc.save()                            // сохраняем AI-правку
```

## Что НЕ меняется

| Компонент | Почему остаётся |
|-----------|-----------------|
| DiffStore | Структура данных (ResponseGroups, FileChanges, Hunks) корректна |
| InlineDiffRenderer | Реактивная модель (onDidChange → View Zones) работает |
| PositionTracker | Пересчёт позиций корректен |
| HunkReverter (accept/reject) | Логика accept/reject единичных хунков корректна |
| SystemEditGuard | Защита от ложных onDidChange нужна |
| KeyboardNavigation | UX не меняется |
| PendingChangesBar (webview) | UI не меняется |

---

## Потеря отступов / форматирования

### Где теряются отступы

**Источник 1: `lineTrimmedFallbackMatch` в `diff.ts`**

```
SEARCH блок от модели:          Оригинал в файле:
  const b = 2;                    ····const b = 2;     (4 пробела)

Модель забыла отступ. lineTrimmedFallbackMatch находит совпадение по trim().
REPLACE контент вставляется КАК ЕСТЬ — без отступа.
```

**Источник 2: `write_to_file` — модель генерирует весь файл**

Модель копирует файл, но где-то теряет/добавляет пробелы. `diff.diffLines` находит разницу,
но разница включает строки с изменённым отступом. Визуально — "изменение", хотя логически код тот же.

**Источник 3: `apply_patch` — V4A diff формат**

Модель генерирует patch с `+` строками. Отступы в `+` строках зависят от модели.

### Стратегия исправления

**Для `replace_in_file` (lineTrimmedFallbackMatch):**

Когда SEARCH блок найден через trimmed match:
1. Определить отступ оригинальной строки: `indent = line.match(/^\s*/)[0]`
2. Определить отступ SEARCH строки: `searchIndent = searchLine.match(/^\s*/)[0]`
3. Delta = indent - searchIndent
4. Применить delta к каждой строке REPLACE блока

```typescript
// Пример:
// Оригинал:     "    const b = 2;"  (indent = 4)
// SEARCH:        "const b = 2;"     (indent = 0)
// REPLACE:       "const b = 99;"    (indent = 0)
// → Delta = +4
// → Результат:  "    const b = 99;" (indent = 4) ✓
```

**Для `write_to_file`:**

Не фиксим отступы автоматически — слишком рискованно. Вместо этого:
- Лимит на размер (>60%) предотвращает полную перезапись
- В промте модели: "PRESERVE exact indentation of the original file"

**Для `apply_patch`:**

Не фиксим — V4A формат уже содержит точные строки с правильным контекстом.
Если модель ошибается в отступах — это ошибка модели, не системы.

---

## План реализации (фазы)

### Фаза 0: taskId в ResponseGroup
- Добавить `taskId` в ResponseGroup (types.ts)
- `DiffSystem.setCurrentTaskId(taskId)` — для новых ResponseGroups
- В `Controller.initTask()` → вызвать `diffSystem.setCurrentTaskId(taskId)`
- В `Controller.clearTask()` → вызвать `diffSystem.finishCheckpoint()`
- `rollbackFromMessage` → дополнительный фильтр по taskId для безопасности
- **НЕ чистить** данные при переключении задач

### Фаза 1: FileSnapshotStorage v2
- Расширить для хранения цепочки снэпшотов
- API: `saveBeforeAI(fsPath, rgId, messageTs)`, `getSnapshot(fsPath, messageTs)`, `cleanupForFile(fsPath)`
- Хранение: в памяти + `globalStorageUri` для persistence

### Фаза 2: Единый путь записи
- Рефакторинг `WriteToFileToolHandler`:
  - Убрать `writeFileAndVisualizeDiff()`
  - Блоки применяются через `DiffSystem.replaceLines/deleteLines/addLines`
- Рефакторинг `ApplyPatchHandler`:
  - Убрать прямую запись через `workspace.fs.writeFile`
  - Chunks применяются через `DiffSystem.replaceLines/deleteLines`
- Pre-save logic: сохранять unsaved юзерские правки перед AI-записью
- Post-save: сохранять файл после батчи AI-хунков

### Фаза 3: Overlap detection
- В HunkApplier: проверка pending хунков перед применением
- Reject overlapping → apply new
- Лимит на размер (>60% для write_to_file)

### Фаза 4: Rollback через снэпшоты
- `rollbackFromMessage()` → восстановление из снэпшотов
- Удаление хунков + снэпшотов >= messageTs
- Восстановление позиций хунков из снэпшота
- Пересоздание View Zones для оставшихся хунков

### Фаза 5: Cleanup + стабилизация
- Cleanup снэпшотов при 0 pending
- Тестирование edge cases:
  - Ctrl+Z после AI-правки
  - Юзер редактирует внутри хунка
  - git checkout при pending хунках
  - 60+ файлов с pending
  - Retry после частичного accept
  - Concurrent tool calls
- Обновление документации DIFF_SYSTEM.md

---

## Файлы для изменения

| Файл | Тип изменения |
|------|---------------|
| `src/core/diff-v2/storage/types.ts` | Добавить `taskId` в ResponseGroup |
| `src/core/diff-v2/storage/DiffStore.ts` | Фильтрация по taskId, новые query-методы |
| `src/core/diff-v2/storage/FileSnapshotStorage.ts` | Расширение (цепочка снэпшотов с messageTs) |
| `src/core/diff-v2/DiffSystem.ts` | taskId scope, overlap check, удалить showDiffVisualization |
| `src/core/diff-v2/engine/HunkApplier.ts` | Overlap detection, pre-save |
| `src/core/task/tools/handlers/WriteToFileToolHandler.ts` | Рефакторинг (через DiffSystem) |
| `src/core/task/tools/handlers/ApplyPatchHandler.ts` | Рефакторинг (через DiffSystem) |
| `src/core/controller/index.ts` | initTask → setCurrentTaskId, clearTask → finishCheckpoint |
| `src/core/controller/task/retryFromMessage.ts` | Snapshot-based rollback |
| `src/core/controller/task/deleteFromMessage.ts` | Snapshot-based rollback |

---

*Последнее обновление: 2026-02-19*
