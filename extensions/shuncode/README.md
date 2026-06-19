# Shuncode AI

AI-ассистент для разработки, интегрированный в VS Code.

## Документация

Вся документация находится в папке [docs/](./docs/):

- [docs/README.md](./docs/README.md) — Главный README
- [docs/BUILD.md](./docs/BUILD.md) — Инструкции по сборке
- [docs/ADDING_SETTINGS.md](./docs/ADDING_SETTINGS.md) — Добавление настроек

### Архитектура
- [docs/architecture/OVERVIEW.md](./docs/architecture/OVERVIEW.md) — Общий обзор
- [docs/architecture/CORE.md](./docs/architecture/CORE.md) — Core модуль
- [docs/architecture/PROMPTS.md](./docs/architecture/PROMPTS.md) — Система промптов
- [docs/architecture/CHAT_PIPELINE_ARCHITECTURE.md](./docs/architecture/CHAT_PIPELINE_ARCHITECTURE.md) — Пайплайн чата

### Подсистемы
- [docs/DIFF_SYSTEM.md](./docs/DIFF_SYSTEM.md) — Inline Diff система v4
- [docs/INDEXING_SYSTEM.md](./docs/INDEXING_SYSTEM.md) — Семантическая индексация
- [docs/mcp/how-mcp-works.md](./docs/mcp/how-mcp-works.md) — Как работает MCP

### Разработка
- [docs/development/GENERAL.md](./docs/development/GENERAL.md) — Общие правила
- [docs/development/TOOLS.md](./docs/development/TOOLS.md) — Добавление инструментов
- [docs/development/NETWORK.md](./docs/development/NETWORK.md) — Сетевые запросы

### VS Code Fork
- [docs/VSCODE_FORK_PATCHES.md](./docs/VSCODE_FORK_PATCHES.md) — Патчи ядра

### Правила для AI
- [docs/agent-rules/](./docs/agent-rules/) — Правила для AI агента

### Планы
- [docs/plans/ROADMAP.md](./docs/plans/ROADMAP.md) — Дорожная карта
- [docs/plans/implementation/](./docs/plans/implementation/) — Планы реализации

## Быстрый старт

```powershell
# Установка зависимостей
npm install

# Генерация proto
npm run protos

# Сборка
node esbuild.mjs

# Запуск (из корня vscode)
.\scripts\code.bat --extensionDevelopmentPath="path\to\shuncode"
```

Подробнее: [docs/BUILD.md](./docs/BUILD.md)
