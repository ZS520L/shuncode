# Shuncode AI — Дорожная карта (Roadmap)

> **Цель:** Shuncode AI = полный аналог Cursor. VSCode форк трогаем минимально, вся логика в `extensions/shuncode/`.

*Создано: 2026-02-06 | Обновлено: 2026-03-01*

---

## Аудит: Shuncode AI vs Cursor

### 1. Инструменты (Tools)

| Cursor Tool | Shuncode AI Аналог | Статус |
|---|---|---|
| `Shell` (execute commands) | `execute_command` (BASH) | ✅ Есть |
| `Read` (read files) | `read_file` (FILE_READ) | ✅ Есть (+ чтение из буфера) |
| `Write` (create/overwrite files) | `write_to_file` (FILE_NEW) | ✅ Есть |
| `StrReplace` (edit files) | `replace_in_file` (FILE_EDIT) | ✅ Есть |
| `Grep` (ripgrep search) | `search_files` (SEARCH) | ✅ Есть |
| `Glob` (find files by pattern) | `list_files` (glob mode) | ✅ Есть (IMPL-06) |
| `Delete` (delete files) | `delete_file` (DeleteFileToolHandler) | ✅ Есть |
| `EditNotebook` (Jupyter) | `edit_notebook` (EDIT_NOTEBOOK) | ✅ Есть |
| `TodoWrite` (task management) | `focus_chain` (TODO) | ✅ Есть (свой аналог) |
| `ReadLints` (linter errors) | `read_diagnostics` (READ_DIAGNOSTICS) | ✅ Есть |
| `SemanticSearch` (search by meaning) | `codebase_search` | ✅ Есть (semantic index + hybrid search) |
| `WebSearch` (web search) | `web_search` (WEB_SEARCH) | ✅ Есть (локальный DuckDuckGo). IMPL-15 |
| `SwitchMode` (Plan/Debug/Ask) | `plan_mode_respond` / `act_mode_respond` | ✅ Есть (IMPL-07: 4 режима) |
| Context7 (library docs) | MCP tools | ✅ Через MCP |

**Shuncode AI имеет СВЕРХ Cursor:**
- `apply_patch` — патчи
- `web_fetch` — загрузка URL (✅ локальный Puppeteer/Chromium). IMPL-15
- `browser_action` — Puppeteer
- `new_task` — создание подзадач
- `condense` / `summarize_task` — сжатие контекста
- `report_bug` / `new_rule` — правила и баги
- `generate_explanation` — объяснение изменений
- `use_skill` — навыки
- `delete_block` / `replace_text` — упрощённое редактирование для слабых моделей
- MCP tools (`use_mcp_tool`, `access_mcp_resource`, `load_mcp_documentation`)

---

### 2. Режимы работы

| Cursor | Shuncode AI | Статус |
|---|---|---|
| Agent Mode (default) | Act Mode | ✅ Есть |
| Plan Mode | Plan Mode | ✅ Есть |
| Debug Mode | Debug Mode | ✅ Есть (IMPL-07) |
| Ask Mode (read-only) | Ask Mode | ✅ Есть (IMPL-07) |
| Dynamic SwitchMode | Plan ↔ Act ↔ Debug ↔ Ask | ✅ Есть |

---

### 3. Системный промпт

| Функция Cursor | Shuncode AI | Статус |
|---|---|---|
| Модульные компоненты | Components + Templates | ✅ Есть (мощнее) |
| Варианты для моделей | 11 вариантов | ✅ Есть (мощнее) |
| Git commit инструкции | rules.ts + generic/template | ✅ Есть (IMPL-03) |
| Git PR инструкции (gh CLI) | rules.ts | ✅ Есть (IMPL-03) |
| Parallel tool calls rules | rules.ts | ✅ Есть (IMPL-03) |
| Linting workflow | rules.ts | ✅ Есть (IMPL-03) |
| Tone/style instructions | generic/template | ✅ Есть (IMPL-12) |
| Workspace rules (.cursor/rules/) | user_instructions + .shuncode/rules | ✅ Есть (IMPL-08) |
| Code citing format | rules.ts `<code_citing>` | ✅ Есть (2026-02-18) |
| Inline line numbers | ReadFileToolHandler `addLineNumbers()` | ✅ Есть (2026-02-18) |
| Terminal monitoring | getEnvironmentDetails `# User Terminals` | ✅ Есть (2026-02-18) |
| MCP instructions section | MCP component | ✅ Есть |

---

### 4. Diff система

| Функция Cursor | Shuncode AI | Статус |
|---|---|---|
| Inline diff в редакторе | View Zones (webview insets) | ✅ Есть |
| Accept/Reject кнопки | InlineDiffRenderer | ✅ Есть |
| 3 типа (Del/Add/Replace) | DiffSystem v3 | ✅ Есть |
| Sticky zones | PositionTracker | ✅ Есть |
| Persistence | DiffStore + PendingChangesStorage | ✅ Есть |
| Pending Changes panel | PendingChangesBar (с навигацией < >) | ✅ Есть |
| Keyboard shortcuts | KeyboardNavigation (Alt+]/[, Ctrl+Shift+Y/N) | ✅ Есть |
| Мёрж перекрывающихся хунков | DiffSystem.mergeOverlapping | ✅ Есть |
| Auto-remove no-op хунков | DiffSystem.checkAutoRemove | ✅ Есть |
| Per-block applyEdit | WriteToFileToolHandler (bottom-to-top) | ✅ Есть |
| Per-block EditCard в чате | EditCard.tsx + formatBlockPreview | ✅ Есть |
| Чтение из буфера (unsaved) | ReadFileToolHandler + WriteToFileToolHandler | ✅ Есть |
| Context key `hasPendingHunks` | DiffSystem | ✅ Есть |
| Undo/Redo для Accept/Reject | — | ❌ НЕТ (архитектурно сложно) |

---

### 5. Chat UI

| Функция | Статус |
|---|---|
| ProcessBlock (сворачиваемый "Thinking") | ✅ Есть |
| EditCard (per-block якоря на diff) | ✅ Есть |
| PendingChangesBar (Accept All / Reject All) | ✅ Есть |
| Навигация по хункам (< >) в PendingChangesBar | ✅ Есть |
| EditCard без ограничений высоты | ✅ Есть |
| TurnBlock (sticky user headers, CSS scroll) | ✅ Есть (2026-02-17) |
| Collapsed/expanded user messages | ✅ Есть (2026-02-17) |
| Edit & Resend user messages | ✅ Есть (2026-02-17) |
| Error display for API failures | ✅ Есть (2026-02-17) |

---

### 6. Инфраструктура

| Функция | Статус |
|---|---|
| gRPC/Protobuf communication | ✅ |
| React Webview UI (232+ компонентов) | ✅ |
| Tree-sitter валидация (16 языков) | ✅ |
| MCP Hub | ✅ |
| 40+ API провайдеров (вкл. GigaChat, YandexGPT) | ✅ |
| Telemetry (PostHog + OpenTelemetry) | ✅ |
| Feature flags (PostHog) | ✅ |
| Voice/Dictation | ✅ |
| Worktrees | ✅ |
| Auth (OCA) | ✅ |
| Browser/Puppeteer | ✅ |
| i18n (RU + EN) | ✅ (IMPL-11) |
| Worker Threads для индексации | ✅ (IMPL-10) |

---

## Дорожная карта

### ✅ Приоритет 1 — Критическое (ВЫПОЛНЕНО)

- [x] **P1-1: Delete File Tool** ✅ (2026-02-07)
- [x] **P1-2: Улучшить системный промпт** ✅ (IMPL-03 + IMPL-12)
- [x] **P1-3: Diff система — баг-фикс** ✅ (2026-02-06)
- [x] **P1-4: Cursor-style execution flow** ✅ (2026-02-06)
- [x] **P1-5: Diff система v3 — полная переработка** ✅ (2026-02-09)
- [x] **P1-6: Keyboard shortcuts для diff** ✅ (2026-02-08)
- [x] **P1-7: Chat UI — EditCard + ProcessBlock** ✅ (2026-02-09)

### ✅ Приоритет 2 — Важное (ВЫПОЛНЕНО)

- [x] **P2-1: Debug Mode** ✅ (IMPL-07)
- [x] **P2-2: Ask Mode** ✅ (IMPL-07)
- [x] **P2-3: Semantic Search** ✅ (2026-02-11)
- [x] **P2-4: Glob patterns** ✅ (IMPL-06)
- [x] **P2-5: Параллельное выполнение tool calls** — включен параллельный режим (IMPL-03 промпт + настройка)

### ✅ IMPL-планы (ВЫПОЛНЕНО)

- [x] **IMPL-01**: Мультиязычная embedding модель ✅
- [x] **IMPL-02**: Chat UX (scroll-to-top + ProcessBlock fix) ✅
- [x] **IMPL-03**: Системный промпт (git safety, linting, parallel tools) ✅
- [x] **IMPL-04**: Settings UI Redesign (9 табов + compact mode) ✅
- [x] **IMPL-05**: Repo Map (regex-сигнатуры экспортов) ✅
- [x] **IMPL-06**: Glob patterns ✅
- [x] **IMPL-07**: Debug + Ask Mode (4 режима) ✅
- [x] **IMPL-08**: Context Persistence (Changelog + Rules) ✅
- [x] **IMPL-10**: Worker Threads для индексации ✅
- [x] **IMPL-11**: i18n (RU + EN) ✅
- [x] **IMPL-12**: Модернизация поиска (guardrails, приоритет, telemetry) ✅
- [x] **IMPL-13**: Качество поиска (metadata, truncation, thresholds) ✅
- [x] **Chat UI**: TurnBlock архитектура, sticky headers, edit & resend ✅ (2026-02-17)
- [x] **Lightweight Mode**: Форсирование XS промпта для слабых моделей ✅ (2026-02-18)
- [x] **MCP для XS**: MCP tools доступны в XS варианте (низкий приоритет) ✅ (2026-02-18)
- [x] **DiffSystem V4**: Per-message snapshots, reliable rollback, CRLF fixes ✅ (2026-02-20)
- [x] **No-op detection**: Error feedback to model when file unchanged ✅ (2026-02-20)
- [x] **Cross-file navigation**: Стрелки < > переходят между файлами ✅ (2026-02-20)
- [x] **Diff preview для всех tools**: computeDiffBlocks + hunk fallback ✅ (2026-02-20)
- [x] **ApprovalGate early response**: Race condition fix для resend ✅ (2026-02-20)
- [x] **217 unit тестов** для DiffSystem V4 ✅ (2026-02-20)
- [x] **865 тестов passing** (все старые + новые) ✅ (2026-02-20)
- [x] **EditNotebook** — Jupyter notebook поддержка (edit_notebook tool) ✅ (2026-02-20)
- [x] **909 тестов passing** (865 + 44 EditNotebook) ✅ (2026-02-20)
- [x] **Голосовой ввод (Voice Input)** — локальная транскрипция речи ✅ (2026-02-21/22)
  
  - Офлайн распознавание (tiny/base/small модели)
  - Запись через ffmpeg (авто-определение микрофона на Windows через test recording)
  - Ручной выбор микрофона в настройках (native select, список устройств, пометка системного)
  - Ручной выбор сохраняется между сессиями — авто-выбор не перезаписывает
  - Кнопка «Обновить» для актуализации списка устройств и системного микрофона
  - Graceful stop через stdin "q" на Windows
  - Секция «Голос» в настройках (язык 50+, качество, микрофон, загрузка компонентов)
  - Анимация записи (пульсирующий 🔴 + таймер), Send заблокирован при записи/транскрипции
  - Загрузка компонентов одним архивом с CDN (shuncode-ai.ru) с Bearer JWT авторизацией
  - Неактивный микрофон в чате → клик → Settings → Voice → авторизация (воронка)
  - Проверка voiceReady через fs.existsSync в getState (прямая проверка файлов на диске)
  - Proto DictationSettings расширен: whisperModel, voiceReady, voiceDownloading (tag 4/5/6)
  - nginx auth-check поддерживает и cookie (браузер), и Bearer token (extension)
  - PulsingBorder удалён из ChatTextArea (бандл -50 КБ)
  - i18n: все строки на RU + EN
  - Бесплатно: tiny; Платно: base + small
- [x] **Ребрендинг остатков Cline** — замена иконок терминала, SVG логотипа, шрифтовых иконок на Shuncode ✅ (2026-03-01)
  - Иконка терминала: `ThemeIcon("shuncode-icon")` вместо Cline robot
  - Шрифтовые файлы `shuncode-bot.woff`/`.ttf` пересозданы из SVG логотипа "S"
  - SVG `ShuncodeCompactIcon.tsx` заменён на логотип Shuncode
  - Заголовок таба чата: `{ value: 'Shuncode', original: 'Shuncode' }` (без localize2, чтобы русская локализация не перезаписывала)
- [x] **GigaChat интеграция** — нативные function calls для GigaChat-2 Pro / Max ✅ (2026-03-01)
  - Нативный формат `function_call` / `functions` вместо XML
  - Конвертация OpenAI `tool_calls` → GigaChat `function_call` (1:1, не массив)
  - Конвертация `tool` role → `function` role с JSON content `{ result: "..." }`
  - `toolCallIdToNameMap` для маппинга ID → имя функции
  - GigaChat-2 Lite удалён (слишком слабая для agentic tasks)
  - Кастомный промпт-вариант `gigachat/` удалён, используется `generic` + `xs`
- [x] **YandexGPT интеграция** — новый провайдер через OpenAI-совместимый API ✅ (2026-03-01)
  - `src/core/api/providers/yandexgpt.ts` — API handler
  - `webview-ui/.../YandexGPTProvider.tsx` — UI компонент настроек
  - Модели: YandexGPT 5 Pro, YandexGPT 5 Lite (32K контекст)
  - Авторизация: `Authorization: Api-Key <key>` + `x-folder-id: <folder_id>`
  - Proto: `yandex_gpt_api_key`, `yandex_gpt_folder_id` в `state.proto` и `models.proto`
  - Локализация: все строки на RU + EN
- [x] **API cost fix** — стоимость не откатывается при удалении/повторе сообщений ✅ (2026-03-01)
  - `deleteFromMessage.ts` и `retryFromMessage.ts` сохраняют метрики через `deleted_api_reqs`
  - `getApiMetrics.ts` суммирует `deleted_api_reqs` записи
- [x] **Дефолтный провайдер** — OpenAI Native вместо Anthropic/OpenRouter ✅ (2026-03-01)
  - `DEFAULT_API_PROVIDER = "openai-native"` в `api.ts`
  - Fallback в proto-конвертациях и `normalizeApiConfiguration` → `openai-native`
- [x] **Кнопка Resend** — показывается только при изменении текста сообщения ✅ (2026-03-01)

---

### Приоритет 3 — Следующие задачи

- [x] **Локальные web_search и web_fetch** — IMPL-15 ✅ (2026-03-07)
  - web_search → локальный DuckDuckGo scraping
  - web_fetch → локальный UrlContentFetcher (Puppeteer/Chromium)
  - Убрана зависимость от серверного бэкенда и авторизации
  - Подробный план: [implementation/IMPL-15-local-web-tools.md](./implementation/IMPL-15-local-web-tools.md)

- [ ] **Shell Diff Tracking** — IMPL-16 (~6-20ч)
  - Shell-команды меняют файлы молча, diff-система не видит изменения
  - Snapshot до/после + unified diff + новый тип `external_modification`
  - Accept/Reject для shell-изменений, откат через git checkout
  - Подробный план: [implementation/IMPL-16-shell-diff-tracking.md](./implementation/IMPL-16-shell-diff-tracking.md)

- [ ] **Inline Edit (Ctrl+K)** — IMPL-09 (~8-16ч)
  - Редактирование выделенного кода без чата
  - Подробный план: [implementation/IMPL-09-inline-edit.md](./implementation/IMPL-09-inline-edit.md)

- [ ] **Chat Mode** — пятый режим: чистый диалог без проактивного исследования проекта
  - Модель просто разговаривает, не лезет в файлы без явной просьбы
  - Инструменты чтения доступны, но используются ТОЛЬКО по запросу пользователя
  - Модификация файлов/команд запрещена (аналог Ask, но без проактивности)
  - Идеален для дешёвых/слабых моделей и обсуждения идей
  - Подробная спецификация: [CHAT_MODE_SPEC.md](../CHAT_MODE_SPEC.md)

- [ ] **Multi-Model System** — IMPL-17 (~15-20 дней)
  - Три слота моделей: Primary (дорогая), Secondary (default), Utility (дешёвая)
  - Per-step модель в workflow YAML (зависит от IMPL-14)
  - Автоматический routing: condense/summarize → Utility, lint/build → Utility
  - Lazy handler map в Task, обратная совместимость через getter/setter
  - Подробный план: [implementation/IMPL-17-multi-model-system.md](./implementation/IMPL-17-multi-model-system.md)

- [ ] **Голосовой ввод — стриминг** — текст по мере речи (фаза 2)
  - VAD или timer-based chunking + параллельная транскрипция
  - Отложено: whisper теряет контекст при разрезании предложений

### ✅ Запуск продукта (ВЫПОЛНЕНО)

- [x] **Registration Gate + Сайт** — shuncode-web (Next.js 16 + Auth.js v5), лендинг, auth (Яндекс ID / Google / Email + password), личный кабинет, админ-панель, система баннеров, защищённые скачивания, Docker-деплой на VPS ✅ (2026-02-22/23)
  - Лендинг (hero, фичи, скачать, i18n ru/en, тёмная/светлая тема)
  - OAuth: Yandex ID, Google, Email magic link, Credentials (email + password, scrypt)
  - Extension auth flow: browser OAuth → auth code → JWT (access 10 мин + refresh 30 дней)
  - Личный кабинет: профиль, лицензия
  - Админ-панель: пользователи, баннеры, лицензии, бан
  - Документация: Fumadocs MDX (ru/en)
  - Защищённые скачивания: nginx auth_request, Bearer JWT + cookie
  - Деплой: Docker (nginx + Next.js + PostgreSQL), Let's Encrypt SSL
  - Домен: shuncode-ai.ru (HTTPS)
- [x] **Free-trial gate** — 20 сообщений без авторизации, баннер на стартовом экране + Account view, VS Code notification при лимите ✅ (2026-02-24)
- [ ] **Грант Фонда Бортника** — заявка Старт-ИИ-1. Подробности: [grant-fasie-start-ai.md](./grant-fasie-start-ai.md)

---

## Справка: Инструменты Cursor и их параметры

```
Shell: command, working_directory, timeout, is_background, description
Read: path, offset, limit
Write: path, contents
StrReplace: path, old_string, new_string, replace_all
Delete: path
Glob: glob_pattern, target_directory
Grep: pattern, path, glob, type, output_mode, -A, -B, -C, -i, multiline, head_limit, offset
EditNotebook: target_notebook, cell_idx, is_new_cell, cell_language, old_string, new_string
TodoWrite: todos[{id, content, status}], merge
ReadLints: paths[]
SemanticSearch: query, target_directories[], num_results
WebSearch: search_term, explanation
SwitchMode: target_mode_id, explanation
```

## Справка: Режимы

- **Act Mode** — default, полный доступ к инструментам, модификация кода
- **Plan Mode** — read-only, проектирование подхода, без изменений
- **Debug Mode** — систематическая отладка с runtime evidence
- **Ask Mode** — read-only, исследование кода, ответы на вопросы
- **Chat Mode** — *(запланировано)* чистый диалог, инструменты только по явной просьбе

*Последнее обновление: 2026-03-10*
