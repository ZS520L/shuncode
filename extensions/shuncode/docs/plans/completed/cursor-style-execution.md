# Cursor-style execution flow для Shuncode AI

## Как было (Shuncode, до 2026-02-06)

```
Модель решает вызвать инструмент
    → Handler показывает ask("command", ...) в UI
    → UI блокируется: "Выполнить команду" / "Отклонить"
    → Пользователь кликает
    → Инструмент выполняется
    → Результат возвращается модели
    → Модель решает следующий шаг
    → Снова ask...
```

Проблемы которые были:
- Каждый tool call блокировал до клика пользователя
- Нет параллельности (даже если модель хочет вызвать 3 инструмента)
- После "Task Completed" — ещё одно окно ask
- UX ощущался как "я слуга модели, кликаю кнопки"

## Как сейчас (Cursor-style, реализовано 2026-02-06)

```
Модель решает вызвать инструмент(ы)
    → Инструмент(ы) выполняются молча
    → В чате появляется блок "что сделано" (read-only, информативный)
    → Если файл изменён — в редакторе появляется diff с Accept/Reject
    → Результат возвращается модели
    → Модель продолжает
```

Ключевые отличия от старого Shuncode:
1. **Нет блокирующего ask перед выполнением** — инструмент выполняется сразу
2. **Чат показывает результат** — но как информацию, не как вопрос
3. **Контроль post-factum** — через diff Accept/Reject в редакторе
4. **Security checks остались** — shuncodeignore, command permissions проверяются ДО выполнения

## Как будет работать после реализации

### Сценарий 1: Модель редактирует файл
```
Пользователь: "Измени строку React 19.1.0 на React 19.2.0"

[Модель вызывает replace_in_file]
    → Handler выполняет замену СРАЗУ (без ask)
    → В чате: блок "✏️ Edited PROJECT_ANALYSIS.md" (collapsible, показывает diff)
    → В редакторе: View Zone с Accept/Reject
    → Результат уходит модели
    → Модель: "Готово, заменил React 19.1.0 на React 19.2.0"
```

### Сценарий 2: Модель выполняет команду
```
Пользователь: "Установи lodash"

[Модель вызывает execute_command: npm install lodash]
    → Handler выполняет СРАЗУ (без ask)
    → В чате: блок "⚡ Ran: npm install lodash" (collapsible, показывает вывод)
    → Результат уходит модели
    → Модель: "Установил lodash 4.17.21"
```

### Сценарий 3: Модель читает файл
```
[Модель вызывает read_file]
    → Handler читает СРАЗУ
    → В чате: блок "📄 Read package.json" (collapsible)
    → Результат уходит модели (пользователь даже не заметил)
```

### Сценарий 4: Опасная команда
```
[Модель вызывает execute_command: rm -rf node_modules]
    → Проверка commandPermissionController (SHUNCODE_COMMAND_PERMISSIONS)
    → Если запрещена → блокируется с ошибкой
    → Если разрешена → выполняется сразу (без ask)
    → В чате: блок с результатом
```

### Сценарий 5: Параллельные вызовы
```
[Модель вызывает одновременно: read_file A, read_file B, read_file C]
    → Все три выполняются параллельно
    → Результаты собираются
    → Отправляются модели одним пакетом
```

## Статус реализации

### ✅ Фаза 1: Auto-execute для всех инструментов (DONE 2026-02-06)

Из каждого handler-а убрана ветка `ask()` → всегда идём через `say()`.

**Изменённые файлы (9 handlers):**
- `ReadFileToolHandler.ts` — убран ask, всегда say("tool")
- `ListFilesToolHandler.ts` — убран ask, всегда say("tool")
- `SearchFilesToolHandler.ts` — убран ask, всегда say("tool")
- `ListCodeDefinitionNamesToolHandler.ts` — убран ask, всегда say("tool")
- `WebSearchToolHandler.ts` — убран ask, всегда say("tool")
- `WebFetchToolHandler.ts` — убран ask, всегда say("tool")
- `ExecuteCommandToolHandler.ts` — убран ask, всегда say("command") + auto-execute
- `ApplyPatchHandler.ts` — handleApproval всегда возвращает true
- `AttemptCompletionHandler.ts` — команда completion auto-execute (без ask("command"))

**Не тронуты (оставлен ask):**
- `BrowserToolHandler` — browser_action оставлен с ask
- `UseMcpToolHandler` — MCP tools оставлены с ask
- `AccessMcpResourceHandler` — MCP ресурсы оставлены с ask
- `AskFollowupQuestionToolHandler` — ask пользователю, должен быть
- `PlanModeRespondHandler` / `ActModeRespondHandler` — переключение режимов

**Уже были auto-execute (до изменений):**
- `WriteToFileToolHandler.ts` — был реализован ранее через DiffSystem V2
- `ReadDiagnosticsToolHandler.ts` — изначально без ask

### ✅ Фаза 4: Completion auto-execute (DONE 2026-02-06)

- `AttemptCompletionHandler` — команда при completion выполняется без ask
- `ask("completion_result")` оставлен для паузы цикла (ожидание нового сообщения от пользователя)

### ✅ Фаза 2: Информационные блоки в чате (DONE)

Реализованы ключевые элементы UX:
1. `ProcessBlock` (collapsible) для этапов выполнения
2. `EditCard` для file edits с preview
3. `PendingChangesBar` с aggregate actions и навигацией
4. Информативные tool-сообщения без блокирующего ask

### 🟨 Фаза 3: Параллельное выполнение (ЧАСТИЧНО)

Есть условная поддержка parallel tool calling в рантайме (зависит от настроек/семейства модели).
Полный безопасный pipeline с гарантированным `Promise.all` для независимых цепочек — отдельный этап.

## Что НЕ трогали

- `followup` ask — модель задаёт вопрос пользователю, это нужно
- `plan_mode_respond` / `act_mode_respond` — переключение режимов
- Diff Accept/Reject в редакторе — уже работает как в Cursor
- Checkpoint/rollback система — работает
- Security checks (shuncodeignore, command permissions) — остались на месте

*Последнее обновление: 2026-02-11*
