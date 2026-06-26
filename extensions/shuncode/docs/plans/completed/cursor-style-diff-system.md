# Inline Diff система - План реализации

## Статус: ✅ Базовая реализация завершена

---

## Что реализовано

### Phase 1: ViewZoneManager ✅
- [x] `createDeletionZone()` - красные строки + опционально кнопки
- [x] `createButtonsZone()` - только кнопки Accept/Reject
- [x] `createUnifiedDiffZone()` - автоматически выбирает тип
- [x] Поддержка нескольких View Zone на один pendingId
- [x] `hasZonesFor()` - проверка существования зон

### Phase 2: DiffSystem ✅
- [x] Логика создания View Zones по типу (DELETION, ADDITION, REPLACEMENT)
- [x] Интеграция с `PendingChangesStorage`
- [x] Автоматическое сохранение при создании pending change
- [x] Автоматическое удаление при Accept/Reject

### Phase 3: Sticky Zones ✅
- [x] `updateGhostPosition()` с учётом позиции редактирования
- [x] Редактирование выше зоны - все зоны сдвигаются
- [x] Редактирование внутри зелёной (replacement) - только кнопки сдвигаются

### Phase 4: Persistence ✅
- [x] `PendingChangesStorage` - сохранение в globalState
- [x] Восстановление View Zones при открытии файла
- [x] Автоматическое обновление при изменениях

### Phase 5: UI Panel ✅
- [x] `PendingChangesBar` - React компонент в sidebar
- [x] Компактный вид: `> N файлов +X -Y | Отменить Принять`
- [x] Развёрнутый вид: список файлов со статистикой
- [x] gRPC методы: `acceptAllPendingChanges`, `rejectAllPendingChanges`
- [x] Локализация на русский

---

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                        DiffSystem                            │
│  (src/core/diff-v2/DiffSystem.ts)                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ DiffApplier  │  │ DiffReverter │  │ PositionTracker  │   │
│  │              │  │              │  │                  │   │
│  │ - Применяет  │  │ - Accept     │  │ - Пересчёт       │   │
│  │   изменения  │  │ - Reject     │  │   позиций        │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    Storage Layer                      │   │
│  │  ┌────────────────┐  ┌─────────────────────────────┐ │   │
│  │  │ StateStorage   │  │ PendingChangesStorage       │ │   │
│  │  │ (workspaceState)│ │ (globalState - для webview) │ │   │
│  │  └────────────────┘  └─────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                      UI Layer                         │   │
│  │  ┌─────────────────┐  ┌────────────────────────────┐ │   │
│  │  │ ViewZoneManager │  │ DecorationController       │ │   │
│  │  │ (webview insets)│  │ (зелёные подсветки)        │ │   │
│  │  └─────────────────┘  └────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Webview (sidebar)                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              PendingChangesBar.tsx                    │   │
│  │  - Список файлов с pending changes                    │   │
│  │  - Кнопки Отменить / Принять                         │   │
│  │  - gRPC: acceptAllPendingChanges, rejectAllPendingChanges│
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Три типа diff-блоков

### DELETION
```
┌─────────────────────────────────────┐
│    │ - удалённая строка   [красная] │ ← View Zone
│    │ [Accept] [Reject]              │
└─────────────────────────────────────┘
```

### ADDITION
```
│ 24 │ новая строка         [зелёная] │ ← реальный код
├─────────────────────────────────────┤
│    │ [Accept] [Reject]              │ ← View Zone (только кнопки)
└─────────────────────────────────────┘
```

### REPLACEMENT
```
┌─────────────────────────────────────┐
│    │ - старая строка      [красная] │ ← View Zone (deletion, без кнопок)
├─────────────────────────────────────┤
│ 24 │ новая строка         [зелёная] │ ← реальный код
├─────────────────────────────────────┤
│    │ [Accept] [Reject]              │ ← View Zone (только кнопки)
└─────────────────────────────────────┘
```

---

## Ключевые файлы

| Файл | Описание |
|------|----------|
| `src/core/diff-v2/DiffSystem.ts` | Главный фасад |
| `src/core/diff-v2/ui/ViewZoneManager.ts` | View Zones (webview insets) |
| `src/core/diff-v2/storage/PendingChangesStorage.ts` | globalState persistence |
| `webview-ui/src/components/chat/pending-changes/PendingChangesBar.tsx` | Sidebar UI |
| `src/core/controller/ui/acceptAllPendingChanges.ts` | gRPC handler |
| `src/core/controller/ui/rejectAllPendingChanges.ts` | gRPC handler |
| `proto/shuncode/ui.proto` | gRPC определения |

---

## TODO (будущие улучшения)

### Улучшения UX
- [x] Keyboard shortcuts для Accept/Reject
- [ ] Status bar индикатор количества pending changes
- [ ] Подсветка синтаксиса в красных строках View Zone

### Расширенная функциональность
- [ ] Checkpoint-based grouping (группировка по сессиям агента)
- [ ] Diff preview перед применением
- [ ] Undo/Redo для Accept/Reject

### Производительность
- [ ] Batch updates для множественных View Zone
- [ ] Debounce для sticky zones при быстром редактировании

---

*Последнее обновление: 2026-02-11*
