# Shuncode AI

AI-ассистент для разработки, интегрированный в VS Code.

## Возможности

- **Автономное выполнение задач**: Агент анализирует код, выполняет команды и редактирует файлы
- **Семантическая индексация**: Умный поиск по всей кодовой базе (SQLite + Local Embeddings)
- **Inline Diff система v4**: Визуализация изменений прямо в редакторе (Cursor-style, per-message snapshots)
- **Поддержка MCP серверов**: Расширение функциональности через Model Context Protocol
- **Мультипровайдерная архитектура**: Anthropic, OpenRouter, OpenAI, LiteLLM и 40+ других
- **Проверка синтаксиса**: Валидация кода через Tree-sitter перед применением изменений
- **Голосовой ввод**: Офлайн распознавание речи (Whisper, 50+ языков)
- **4 режима работы**: Act, Plan, Debug, Ask — с динамическим переключением
- **Jupyter Notebooks**: Создание и редактирование ячеек через AI
- **Система баннеров**: Серверные баннеры и модалки для пользователей

## Быстрый старт

1. Соберите расширение: см. [BUILD.md](./BUILD.md)
2. Откройте панель Shuncode AI в боковой панели VS Code
3. Настройте API провайдер в настройках
4. Введите задачу и нажмите Enter

## Документация

### Сборка и настройка
- [BUILD.md](./BUILD.md) — Инструкции по сборке
  - [ADDING_SETTINGS.md](./ADDING_SETTINGS.md) — Добавление настроек

### Архитектура
- [architecture/OVERVIEW.md](./architecture/OVERVIEW.md) — Общий обзор
- [architecture/CORE.md](./architecture/CORE.md) — Core модуль
- [architecture/PROMPTS.md](./architecture/PROMPTS.md) — Система промптов
- [architecture/CHAT_PIPELINE_ARCHITECTURE.md](./architecture/CHAT_PIPELINE_ARCHITECTURE.md) — Пайплайн чата (целевая архитектура)

### Подсистемы
- [DIFF_SYSTEM.md](./DIFF_SYSTEM.md) — Inline Diff система v4
- [INDEXING_SYSTEM.md](./INDEXING_SYSTEM.md) — Семантическая индексация
- [BANNER_SYSTEM.md](./BANNER_SYSTEM.md) — Система баннеров (клиент)
- [architecture/CONTEXT_MANAGEMENT.md](./architecture/CONTEXT_MANAGEMENT.md) — Управление контекстом (сжатие, суммаризация)
- [mcp/how-mcp-works.md](./mcp/how-mcp-works.md) — Как работает MCP

### Разработка
- [development/GENERAL.md](./development/GENERAL.md) — Общие правила
- [development/TOOLS.md](./development/TOOLS.md) — Добавление инструментов
- [development/NETWORK.md](./development/NETWORK.md) — Сетевые запросы

### VS Code Fork
- [VSCODE_FORK_PATCHES.md](./VSCODE_FORK_PATCHES.md) — Патчи ядра VS Code

### Правила для AI агента
- [agent-rules/general.md](./agent-rules/general.md) — Общие правила
- [agent-rules/network.md](./agent-rules/network.md) — Сетевые правила
- [agent-rules/protobuf.md](./agent-rules/protobuf.md) — Protobuf правила

### Планы
- [plans/ROADMAP.md](./plans/ROADMAP.md) — Дорожная карта
- [plans/REGISTRATION_GATE.md](./plans/REGISTRATION_GATE.md) — Стратегия регистрации
- [plans/grant-fasie-start-ai.md](./plans/grant-fasie-start-ai.md) — Грант Фонда Бортника
- [plans/implementation/](./plans/implementation/) — Планы реализации (IMPL)

## Структура проекта

```
shuncode/
├── src/                    # Исходный код расширения
│   ├── core/               # Ядро: controller, task, prompts, diff, indexing
│   ├── services/           # Сервисы: MCP, auth, banner, telemetry
│   ├── shared/             # Общие типы и утилиты
│   └── extension.ts        # Точка входа
├── webview-ui/             # React UI для панели
├── proto/                  # Protobuf определения
├── vendor/                 # Transformers.js runtime (WASM)
├── models/                 # Embedding модели (ONNX)
├── docs/                   # Документация (этот файл)
└── package.json            # Манифест расширения
```

## Технологии

- **TypeScript** — основной язык
- **React** — UI компоненты
- **gRPC/Protobuf** — коммуникация extension ↔ webview
- **esbuild** — сборка
- **Tree-sitter** — парсинг и валидация кода
- **SQLite + transformers.js** — семантическая индексация

## Лицензия

Проприетарная лицензия. Все права защищены.
