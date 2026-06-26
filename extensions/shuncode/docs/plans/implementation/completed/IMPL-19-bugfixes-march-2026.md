# IMPL-19 — Баг-фиксы и доработки (Март 2026)

> Серия исправлений багов и UX-улучшений, выполненных в одной сессии.

---

## Выполненные задачи

### 1. rejectAll при удалённом файле

**Проблема:** `rejectAllPendingChanges` падал с `CodeExpectedError` при попытке открыть файл, который уже был удалён (например, `test-shuncode.ts`).

**Решение:** В `HunkReverter.reject()` добавлен `try/catch` вокруг `vscode.workspace.openTextDocument(uri)`. Если файл не существует — hunk помечается как `rejected` без ошибки.

**Файлы:**
- `src/core/diff-v2/engine/HunkReverter.ts`

---

### 2. Баг 7: Qwen не использует codebase_search

**Проблема:** Qwen-модель не вызывала `codebase_search` автоматически — только при явном указании пользователя.

**Причина:** Qwen-специфичный промпт в `overrides.ts` хардкодил список инструментов, пропуская `codebase_search`.

**Решение:** `QWEN_TOOL_USE_TEMPLATE` переписан с плейсхолдерами (`{{TOOLS_SECTION}}`, `{{TOOL_USE_FORMATTING_SECTION}}`, `{{TOOL_USE_GUIDELINES_SECTION}}`), чтобы все зарегистрированные инструменты подставлялись динамически.

**Файлы:**
- `src/core/prompts/system-prompt/variants/qwen/overrides.ts`

---

### 3. Баг 3: Поповер подтверждения "Отклонить всё"

**Проблема:** Кнопка "Отменить всё" сразу отклоняла все изменения без подтверждения.

**Решение:** Добавлен Radix UI Popover с подтверждением (Отмена / Отклонить), i18n-ключи для всех текстов.

**Дополнительные фиксы:**
- Прозрачность на светлых темах — применены явные VS Code CSS-переменные (`--vscode-editorWidget-background/foreground/border`)
- Лишний отступ сверху — убрана стрелка Radix Arrow, заменена обёртка `<p>` → `<div>`, переключено на прямое использование `PopoverPrimitive` вместо кастомной обёртки

**Файлы:**
- `webview-ui/src/components/chat/pending-changes/PendingChangesBar.tsx`
- `webview-ui/src/i18n/locales/en.json`
- `webview-ui/src/i18n/locales/ru.json`

---

### 4. Баг 11: Стриминг превью при создании файла

**Проблема:** При создании нового файла (`write_to_file`) не было live-превью содержимого во время стриминга.

**Решение:**
- `handlePartialBlock` в `WriteToFileToolHandler.ts` включён — показывает `EditCard` с наполняющимся содержимым
- Убрано мерцание (удалён `removeLastPartialMessageIfExistsWithType`)
- Ограничение высоты `max-h-[200px]` + внутренний скролл
- Авто-скролл до конца через `useRef` + `useEffect`
- Новые файлы показываются plain text (без `+` префиксов), зелёный — только в редакторе

**Файлы:**
- `src/core/task/tools/handlers/WriteToFileToolHandler.ts`
- `webview-ui/src/components/chat/chat-view/components/messages/EditCard.tsx`

---

### 5. Баг 5: Diff-ссылки — перекос при редактировании

**Проблема:** Ссылки в EditCard указывали на статичные номера строк, которые становились неактуальными после последующих правок.

**Решение:**
- `hunkId` сохраняется в `WriteDiffBlock` и передаётся в `ShuncodeSayTool`
- `EditCard.handleClick` формирует URL как `path?hunk=<hunkId>`
- `openFileRelativePath.ts` парсит `hunkId`, достаёт актуальный `currentStartLine` из `DiffStore`

**Файлы:**
- `src/core/task/tools/handlers/WriteToFileToolHandler.ts`
- `src/shared/ExtensionMessage.ts`
- `src/core/controller/file/openFileRelativePath.ts`
- `webview-ui/src/components/chat/chat-view/components/messages/EditCard.tsx`

---

### 6. Thinking-блоки пустые

**Проблема:** Модель (Qwen3.5 через OpenAI Compatible) выводила рассуждения прямо в чат белым текстом, а блок "Думает..." был всегда пуст.

**Причина:** Модель отправляла `<thinking>...</thinking>`, а `ThinkTagStreamParser` искал только `<think>...</think>`.

**Решение:**
- `ThinkTagStreamParser` расширен для поддержки обоих тегов (`<think>` и `<thinking>`)
- Парсер подключён ко всем провайдерам: `openai.ts`, `openrouter.ts`, `qwen.ts`
- Промпт Qwen: убраны инструкции "summarize plan", добавлено явное указание "use `<think>` for reasoning"
- `attempt_completion` — добавлен Qwen-вариант без `<thinking>` в описании
- Qwen3 через OpenAI Compatible: `/think\n` prefix в последнем user-сообщении

**Файлы:**
- `src/core/api/transform/think-tag-parser.ts` (новый общий модуль)
- `src/core/api/providers/openai.ts`
- `src/core/api/providers/openrouter.ts`
- `src/core/api/providers/qwen.ts`
- `src/core/prompts/system-prompt/variants/qwen/overrides.ts`
- `src/core/prompts/system-prompt/tools/attempt_completion.ts`

---

## Статус: ✅ Всё выполнено и проверено
