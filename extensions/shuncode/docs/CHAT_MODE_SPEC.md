# Спецификация: Режим «Chat» (Чат)

> Статус: **Запланировано** (ориентировочно — март 2026)  
> Автор идеи: @Admin  
> Дата: 2026-02-28

---

## 1. Концепция

Новый пятый режим работы Shuncode AI — **«Chat»** (Чат).

### Суть
Модель по умолчанию **просто разговаривает**. Не лезет в файлы, не сканирует проект, не запускает поиск. Инструменты чтения и поиска **доступны**, но модель использует их **только если пользователь явно попросит** — "почитай вот этот файл", "найди в проекте", "погугли".

### Отличие от других режимов
| Режим | Поведение модели | Инструменты |
|-------|-----------------|-------------|
| **Act** | Проактивно исследует проект, пишет код, выполняет команды | Все |
| **Plan** | Проактивно исследует проект, строит план | Чтение + plan_mode_respond |
| **Ask** | Проактивно исследует проект, отвечает на вопросы (read-only) | Только чтение |
| **Debug** | Проактивно исследует проект, систематическая отладка | Все |
| **Chat** ⭐ | **Просто отвечает. НЕ лезет в проект без просьбы** | Чтение (по запросу) |

### Ключевое отличие Chat от Ask
- **Ask**: модель **проактивно** читает файлы и ищет по проекту, чтобы ответить.
- **Chat**: модель **НЕ** лезет в проект сама. Отвечает из своих знаний. Инструменты использует **только по явной просьбе** пользователя.

### Преимущества
1. **Экономия токенов** — модель не тратит ходы на исследование проекта.
2. **Скорость** — мгновенные ответы без ожидания tool calls.
3. **Дешёвые/слабые модели** — GigaChat, YandexGPT и другие смогут нормально работать в чате.
4. **Фокус на диалоге** — когда нужно просто обсудить идею, спросить совет, порассуждать.

---

## 2. Детальный план изменений

### 2.1. Тип `Mode` — добавить `"chat"`

**Файл:** `src/shared/storage/types.ts`

```typescript
// БЫЛО:
export type Mode = "plan" | "act" | "ask" | "debug"

// СТАЛО:
export type Mode = "plan" | "act" | "ask" | "debug" | "chat"
```

Обновить вспомогательные функции:

```typescript
export function getApiSettingsMode(mode: Mode): "plan" | "act" {
    // chat использует настройки plan (read-only, дешёвая модель)
    return mode === "plan" || mode === "ask" || mode === "chat" ? "plan" : "act"
}

export function isReadOnlyMode(mode: Mode): boolean {
    return mode === "plan" || mode === "ask" || mode === "chat"
}
```

> **Почему `plan` для API settings?** Chat — read-only режим, модель не пишет файлы. Логично использовать те же настройки модели, что и для Plan/Ask (обычно более дешёвая модель).

---

### 2.2. Константы режимов в UI — добавить "chat" в переключатель

**Файл:** `webview-ui/src/components/chat/chat-text-area/ChatTextArea.styles.ts`

```typescript
// БЫЛО:
export const MODE_COLORS: Record<string, string> = {
    plan: "var(--vscode-activityWarningBadge-background)",
    act: "var(--vscode-focusBorder)",
    ask: "var(--vscode-charts-green, #89d185)",
    debug: "var(--vscode-errorForeground, #f14c4c)",
}

export const MODE_KEYS = ["plan", "act", "ask", "debug"] as const

// СТАЛО:
export const MODE_COLORS: Record<string, string> = {
    plan: "var(--vscode-activityWarningBadge-background)",
    act: "var(--vscode-focusBorder)",
    ask: "var(--vscode-charts-green, #89d185)",
    debug: "var(--vscode-errorForeground, #f14c4c)",
    chat: "var(--vscode-charts-purple, #b180d7)",  // Фиолетовый — диалог (✅ реализовано)
}

export const MODE_KEYS = ["plan", "act", "ask", "debug", "chat"] as const
```

---

### 2.3. Локализация — добавить строки для нового режима

**Файл:** `webview-ui/src/i18n/locales/en.json`

Добавить:
```json
"mode.chat": "Chat",
"chat.modeChatDescription": "answer questions without proactively exploring the project"
```

**Файл:** `webview-ui/src/i18n/locales/ru.json`

Добавить:
```json
"mode.chat": "Чат",
"chat.modeChatDescription": "отвечать на вопросы не исследуя проект самостоятельно"
```

---

### 2.4. Системный промпт — секция ACT_VS_PLAN — добавить описание Chat Mode

**Файл:** `src/core/prompts/system-prompt/components/act_vs_plan_mode.ts`

В шаблонный текст `getActVsPlanModeTemplateText` добавить секцию Chat Mode:

```typescript
// После описания DEBUG MODE добавить:
`- CHAT MODE: A conversational mode for general discussion and questions.
 - In CHAT MODE, you are a conversational assistant. Your primary role is to TALK, not to explore the project.
 - DO NOT proactively use any tools (read_file, search_files, list_files, etc.) unless the user EXPLICITLY asks you to.
 - Examples of explicit requests: "read file X", "search the project for Y", "look at the code in Z", "google this", "find where function F is defined".
 - If the user just asks a question ("how does React context work?", "what's the best way to structure a monorepo?"), answer from your knowledge WITHOUT using tools.
 - If the user references something in the project but doesn't ask you to look at it, answer based on conversation context. Only use tools if the user clearly wants you to examine the actual code.
 - You CANNOT modify files, create files, delete files, or run terminal commands in this mode.
 - Keep responses concise and focused on the conversation.`
```

---

### 2.5. Environment details — передача текущего режима

**Файл:** `src/core/task/index.ts`

В метод `getEnvironmentDetails()` (строки ~3497-3512) добавить case для chat:

```typescript
details += "\n\n# Current Mode"
const mode = this.stateManager.getGlobalSettingsKey("mode")
switch (mode) {
    case "plan":
        details += "\nPLAN MODE\n" + formatResponse.planModeInstructions()
        break
    case "ask":
        details += "\nASK MODE (read-only - no file modifications or commands allowed)"
        break
    case "debug":
        details += "\nDEBUG MODE (systematic debugging: gather evidence → hypothesize → test → fix)"
        break
    // ДОБАВИТЬ:
    case "chat":
        details += "\nCHAT MODE (conversational - answer from knowledge, use tools ONLY if user explicitly asks)"
        break
    default:
        details += "\nACT MODE"
        break
}
```

---

### 2.6. Ограничение инструментов — ToolExecutor

**Файл:** `src/core/task/ToolExecutor.ts`

#### 2.6.1. Добавить массив запрещённых инструментов для Chat Mode

```typescript
/**
 * Tools that are restricted in chat mode.
 * Chat mode blocks everything that modifies state AND proactive exploration.
 * Tools are still available but the system prompt tells the model to only use them on explicit request.
 * This is a safety net in case the model ignores the prompt instruction.
 */
private static readonly CHAT_MODE_RESTRICTED_TOOLS: ShuncodeDefaultTool[] = [
    // Write/modify tools — полностью запрещены
    ShuncodeDefaultTool.FILE_NEW,
    ShuncodeDefaultTool.FILE_EDIT,
    ShuncodeDefaultTool.NEW_RULE,
    ShuncodeDefaultTool.APPLY_PATCH,
    ShuncodeDefaultTool.EDIT_NOTEBOOK,
    ShuncodeDefaultTool.BASH,
    ShuncodeDefaultTool.BROWSER,
    ShuncodeDefaultTool.MCP_USE,
    ShuncodeDefaultTool.FILE_DELETE,
    ShuncodeDefaultTool.DELETE_BLOCK,
    ShuncodeDefaultTool.REPLACE_TEXT,
]
```

> **Важно:** Инструменты чтения (read_file, search_files, list_files, codebase_search, glob, web_search, web_fetch) **НЕ блокируются** на уровне ToolExecutor. Ограничение по ним — через промпт ("не используй без просьбы"). Если модель всё-таки вызовет read_file — ничего страшного, пусть прочитает. Главное — не даём модифицировать.

#### 2.6.2. Добавить проверку в метод `processToolCall()`

В методе `processToolCall()` (после блока проверки ask mode, ~строка 442), добавить:

```typescript
// Logic for chat-mode tool call restrictions
if (
    currentMode === "chat" &&
    block.name &&
    ToolExecutor.CHAT_MODE_RESTRICTED_TOOLS.includes(block.name)
) {
    const errorMessage = `Tool '${block.name}' is not available in CHAT MODE. CHAT MODE is conversational -- you can only read files, search, and answer questions. Suggest switching to Act mode to make changes.`
    await this.removeLastPartialMessageIfExistsWithType("say", "error")
    await this.say("error", errorMessage)
    if (!block.partial) {
        this.pushToolResult(formatResponse.toolError(errorMessage), block)
    }
    return true
}
```

---

### 2.7. Protobuf — добавить режим в proto схему (если требуется)

Проверить файлы:
- `proto/shuncode/state.proto` — если `Mode` определён как enum, добавить `CHAT = 4;`
- `proto/shuncode/models.proto` — если там есть ссылки на Mode

После изменений выполнить:
```bash
cd vscode/extensions/shuncode
npm run protos
```

---

### 2.8. Webview state — убедиться что "chat" корректно передаётся

**Файл:** `webview-ui/src/context/ExtensionStateContext.tsx`

Проверить, что тип `Mode` импортируется из `@shared/storage/types` — если да, изменение автоматически подхватится.

---

### 2.9. Валидация — проверить все места, где mode сравнивается

Выполнить grep по проекту:

```bash
grep -rn "mode.*===.*\"plan\"\|mode.*===.*\"act\"\|mode.*===.*\"ask\"\|mode.*===.*\"debug\"" src/
```

Для каждого найденного места решить: нужно ли добавить обработку `"chat"`. Основные паттерны:

| Паттерн | Действие для `chat` |
|---------|-------------------|
| `mode === "plan"` | Обычно НЕ добавлять (chat — не plan) |
| `mode === "act"` | Обычно НЕ добавлять (chat — не act) |
| `mode === "ask"` | **Возможно** добавить `\|\| mode === "chat"` (оба read-only) |
| `isReadOnlyMode(mode)` | Автоматически покроется (п.2.1) |
| `getApiSettingsMode(mode)` | Автоматически покроется (п.2.1) |
| `switch(mode)` | Добавить `case "chat":` |

---

### 2.10. План/Act mode respond — поведение в Chat Mode

В Chat Mode модель должна использовать `plan_mode_respond` для ответов (аналогично Plan Mode). Это позволяет отправлять ответы напрямую пользователю.

**Файл:** `src/core/task/tools/handlers/PlanModeRespondHandler.ts`

Проверить, что `plan_mode_respond` работает при `mode === "chat"`. Если там есть проверка `mode === "plan" || mode === "ask"`, добавить `|| mode === "chat"`.

---

### 2.11. ModeSwitcher — тултипы и описания

**Файл:** `webview-ui/src/components/chat/chat-text-area/ModeSwitcher.tsx`

Компонент уже динамически генерирует тултипы через `t(`mode.${shownTooltipMode}`)` и `t(`chat.mode${...}Description`)`. Достаточно добавить строки локализации (п.2.3).

---

### 2.12. Горячие клавиши переключения режимов

Проверить файл, отвечающий за клавишу переключения Plan↔Act. Если она циклически переключает между режимами — добавить `chat` в цикл. Если переключает только Plan↔Act — оставить как есть, chat доступен через клик.

Поиск: `togglePlanAct` в коде.

---

## 3. Набор инструментов для Chat Mode

> **Принцип:** набор инструментов Chat Mode = Ask Mode. Отличие — только в поведении (Chat не проактивен).

### Доступные инструменты (разрешены, но используются ТОЛЬКО по запросу пользователя):

| Инструмент | Назначение |
|------------|-----------|
| `read_file` | Чтение файла — если пользователь попросит |
| `search_files` | Поиск по файлам — если пользователь попросит |
| `list_files` | Список файлов — если пользователь попросит |
| `list_code_definition_names` | Список определений — если пользователь попросит |
| `codebase_search` | Семантический поиск — если пользователь попросит |
| `glob` | Поиск файлов по паттерну — если пользователь попросит |
| `web_search` | Поиск в интернете — если пользователь попросит |
| `web_fetch` | Загрузка URL — если пользователь попросит |
| `read_diagnostics` | Чтение ошибок линтера — если пользователь попросит |
| `focus_chain` | Цепочка фокуса — если пользователь попросит |
| `generate_explanation` | Генерация объяснений — если пользователь попросит |
| `use_skill` | Использование навыков — если пользователь попросит |
| `attempt_completion` | Завершение задачи |
| `plan_mode_respond` | Отправка ответа пользователю |
| `ask_followup_question` | Уточняющий вопрос |

### Запрещённые инструменты (блокируются на уровне ToolExecutor):

| Инструмент | Причина |
|------------|--------|
| `write_to_file` | Запись файлов запрещена |
| `replace_in_file` | Редактирование запрещена |
| `apply_patch` | Патчи запрещены |
| `execute_command` | Выполнение команд запрещено |
| `browser_action` | Браузер запрещён |
| `use_mcp_tool` | MCP инструменты могут иметь побочные эффекты |
| `edit_notebook` | Редактирование notebook запрещено |
| `delete_file` | Удаление файлов запрещено |
| `new_rule` | Создание правил запрещено |
| `delete_block` | Удаление блоков запрещено |
| `replace_text` | Замена текста запрещена |

---

## 4. Системный промпт для Chat Mode

Ключевая часть — в промпте должно быть чётко прописано поведение:

```
CHAT MODE: You are in CHAT MODE — a conversational assistant.

CRITICAL RULES FOR CHAT MODE:
1. Your PRIMARY function is to TALK. Answer questions, discuss ideas, explain concepts.
2. DO NOT use any tools unless the user EXPLICITLY asks you to examine the project, read a file, or search for something.
3. If the user asks a general question (e.g., "how does async/await work?"), answer from your knowledge. Do NOT search the project.
4. If the user says something like "look at file X" or "find where Y is defined" — THEN use the appropriate read-only tool.
5. You CANNOT modify any files. If the user asks for changes, explain what to do and suggest switching to Act mode.
6. Keep your responses focused and conversational. No unnecessary tool usage.
```

---

## 5. Порядок сборки после внесения изменений

```bash
# 1. Пересобрать proto типы (если менялись proto файлы)
cd vscode/extensions/shuncode
npm run protos

# 2. Пересобрать extension
node esbuild.mjs

# 3. Пересобрать webview UI
cd webview-ui
npm run build

# 4. Запустить форк для тестирования
cd vscode
.\scripts\code.bat
```

---

## 6. Чеклист для тестирования

- [ ] Кнопка "Chat" появляется в переключателе режимов
- [ ] Цвет кнопки — фиолетовый
- [ ] Тултип показывает описание режима (на рус/англ)
- [ ] При выборе Chat модель отвечает текстом без tool calls
- [ ] Если написать "прочитай файл package.json" — модель вызывает read_file
- [ ] Если написать "как работает React?" — модель отвечает БЕЗ tool calls
- [ ] Попытка модели записать файл — блокируется с ошибкой
- [ ] Попытка модели выполнить команду — блокируется с ошибкой
- [ ] API метрики (стоимость) корректно считаются
- [ ] Переключение Chat → Act работает
- [ ] Переключение Act → Chat работает
- [ ] Горячие клавиши не ломаются

---

## 7. Полный список затронутых файлов

| # | Файл | Что менять |
|---|------|-----------|
| 1 | `src/shared/storage/types.ts` | Добавить `"chat"` в тип `Mode`, обновить `getApiSettingsMode()` и `isReadOnlyMode()` |
| 2 | `webview-ui/src/components/chat/chat-text-area/ChatTextArea.styles.ts` | Добавить `chat` в `MODE_COLORS` и `MODE_KEYS` |
| 3 | `webview-ui/src/i18n/locales/en.json` | Добавить `mode.chat`, `chat.modeChatDescription` |
| 4 | `webview-ui/src/i18n/locales/ru.json` | Добавить `mode.chat`, `chat.modeChatDescription` |
| 5 | `src/core/prompts/system-prompt/components/act_vs_plan_mode.ts` | Добавить описание CHAT MODE в шаблон |
| 6 | `src/core/task/index.ts` | Добавить `case "chat":` в `getEnvironmentDetails()` |
| 7 | `src/core/task/ToolExecutor.ts` | Добавить `CHAT_MODE_RESTRICTED_TOOLS` и проверку в `processToolCall()` |
| 8 | `proto/shuncode/state.proto` | Добавить `CHAT = 4` в enum Mode (если есть) |
| 9 | `src/core/task/tools/handlers/PlanModeRespondHandler.ts` | Добавить `mode === "chat"` в проверки |
| 10 | `src/shared/storage/state-keys.ts` | Проверить дефолт для mode (оставить `"act"`) |

---

## 8. Цветная рамка ответа по режиму (✅ реализовано)

`PlanCompletionOutputRow` стал mode-aware: принимает `mode` и окрашивает рамку/фон/заголовок в цвет режима через `MODE_COLORS`.

### Цвета по режимам

| Режим | Цвет | CSS-переменная |
|-------|------|---------------|
| **Plan** | Оранжевый | `--vscode-activityWarningBadge-background` |
| **Act** | Синий | `--vscode-focusBorder` |
| **Ask** | Зелёный | `--vscode-charts-green` |
| **Debug** | Красный | `--vscode-errorForeground` |
| **Chat** | Фиолетовый | `--vscode-charts-purple` |

### Как работает

- `border-color`: `color-mix(in srgb, MODE_COLOR 40%, transparent)` — полупрозрачная рамка
- `background-color`: `color-mix(in srgb, MODE_COLOR 6%, transparent)` — едва заметный фоновый тинт
- `divider`: `color-mix(in srgb, MODE_COLOR 20%, transparent)` — разделитель между шапкой и контентом
- Заголовок (иконка + текст) окрашен в цвет режима
- Fallback (без mode): нейтральный серый (`border-description/50`, `bg-code`) — как было раньше

### Иконки и текст заголовка

| Режим | Иконка | Текст |
|-------|--------|-------|
| **Plan** | `NotepadTextIcon` | "Plan Created" / "План создан" |
| **Chat** | `MessageCircleIcon` | "Response" / "Ответ" |
| Прочие | `NotepadTextIcon` | "Plan Created" / "План создан" |

### Затронутые файлы

| Файл | Изменение |
|------|----------|
| `webview-ui/.../ChatTextArea.styles.ts` | `chat` в `MODE_COLORS` и `MODE_KEYS` |
| `webview-ui/.../PlanCompletionOutputRow.tsx` | Принимает `mode`, динамическая стилизация через `color-mix` |
| `webview-ui/.../ChatRow.tsx` | Пробрасывает `mode` в `PlanCompletionOutputRow` |
| `webview-ui/.../i18n/locales/en.json` | Ключи `chat.modeChatDescription`, `chat.modeResponse` |
| `webview-ui/.../i18n/locales/ru.json` | Ключи `chat.modeChatDescription`, `chat.modeResponse` |

---

## 9. Заметки

- **Режим Chat НЕ добавляется в горячую клавишу Plan↔Act** — он доступен только через клик в UI. Горячая клавиша остаётся для быстрого переключения между Plan и Act.
- **API settings** для Chat используют конфиг Plan (та же модель, те же настройки). Это значит, что пользователь может поставить дешёвую модель для Plan/Chat, а дорогую для Act/Debug.
- **Режим Chat подходит для:** общих вопросов по программированию, обсуждения архитектуры, объяснения концепций, brainstorming, и любых задач, где проект — контекст, а не цель.
