# Как работает MCP в Shuncode

## Что такое MCP

**MCP (Model Context Protocol)** — протокол, через который AI получает доступ к внешним инструментам. MCP-сервер — это локальная программа, которая предоставляет AI набор **tools** (инструментов) и **resources** (ресурсов).

Аналогия: MCP — это как USB-порт для AI. Подключил сервер → AI получил новые возможности.

## Архитектура

```
┌─────────────┐     gRPC      ┌─────────────┐    stdio/SSE    ┌─────────────┐
│  Webview UI  │◄────────────►│   McpHub     │◄──────────────►│ MCP Server  │
│  (React)     │              │  (Extension) │                │ (npx/node)  │
└─────────────┘              └─────────────┘                └─────────────┘
```

- **Webview UI** — интерфейс, где пользователь видит чат и настройки MCP
- **McpHub** — backend-сервис, управляет подключениями к MCP-серверам
- **MCP Server** — внешняя программа (запускается через `npx`, `node`, `python` и т.д.)

### Ключевые файлы

| Файл | Назначение |
|------|-----------|
| `shuncode_mcp_settings.json` | Конфиг MCP-серверов (команда, аргументы, env) |
| `services/mcp/McpHub.ts` | Управление подключениями, запуск/остановка серверов |
| `core/prompts/system-prompt/components/mcp.ts` | Инъекция MCP-тулов в системный промпт AI |
| `core/task/tools/handlers/UseMcpToolHandler.ts` | Обработка вызовов `use_mcp_tool` от AI |
| `core/task/tools/handlers/AccessMcpResourceHandler.ts` | Обработка вызовов `access_mcp_resource` от AI |
| `core/controller/mcp/downloadMcp.ts` | Установка MCP-серверов из маркетплейса |

## Пример: Context7

Context7 — MCP-сервер, который даёт AI доступ к актуальной документации библиотек. Разберём полный цикл.

### 1. Установка

При клике "Установить" в маркетплейсе вызывается `downloadMcp.ts`:

1. Загружает информацию о сервере (API → статический каталог)
2. Парсит README, ищет JSON-блок с `"mcpServers"`
3. Находит конфиг: `{"command": "npx", "args": ["-y", "@upstash/context7-mcp"]}`
4. Если `requiresApiKey: false` — убирает placeholder-ключи из аргументов
5. Записывает конфиг в `shuncode_mcp_settings.json`
6. McpHub подхватывает изменения через file watcher и запускает сервер

Результат в `shuncode_mcp_settings.json`:
```json
{
  "mcpServers": {
    "github.com/upstash/context7-mcp": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### 2. Подключение

McpHub при старте (или по file watcher) делает:
1. Читает `shuncode_mcp_settings.json`
2. Для каждого сервера запускает процесс (`npx -y @upstash/context7-mcp`)
3. Устанавливает stdio-соединение (stdin/stdout)
4. Запрашивает список tools и resources у сервера
5. Сохраняет подключение в `connections[]`

### 3. Инъекция в промпт AI

Когда пользователь пишет сообщение, `mcp.ts` формирует секцию системного промпта:

```
## Connected MCP Servers

Server: github.com/upstash/context7-mcp

### Tools
- resolve-library-id: Resolves a package name to a Context7-compatible library ID...
  Parameters:
    - query (required): The user's original question or task
    - libraryName (required): Library name to search for

- query-docs: Retrieves documentation and code examples...
  Parameters:
    - libraryId (required): Context7-compatible library ID
    - query (required): The question or task
```

AI видит доступные инструменты и их параметры в своём системном промпте.

### 4. Вызов инструмента

Когда AI решает использовать Context7, он генерирует XML-блок:

```xml
<use_mcp_tool>
  <server_name>github.com/upstash/context7-mcp</server_name>
  <tool_name>resolve-library-id</tool_name>
  <arguments>{"query": "React documentation", "libraryName": "react"}</arguments>
</use_mcp_tool>
```

Обработка:
1. `UseMcpToolHandler` парсит XML
2. Проверяет auto-approve (или показывает кнопку "Одобрить" пользователю)
3. Вызывает `McpHub.callTool(serverName, toolName, args)`
4. McpHub отправляет запрос MCP-серверу через stdio
5. Получает ответ (JSON с результатами)
6. Передаёт результат обратно AI

### 5. Получение документации

AI видит результат `resolve-library-id`:
```json
{
  "libraryId": "/facebook/react",
  "name": "React",
  "version": "v18.3.1"
}
```

Затем вызывает второй инструмент:
```xml
<use_mcp_tool>
  <server_name>github.com/upstash/context7-mcp</server_name>
  <tool_name>query-docs</tool_name>
  <arguments>{"libraryId": "/facebook/react", "query": "hooks useEffect examples"}</arguments>
</use_mcp_tool>
```

Получает актуальные примеры кода и документацию, которые использует в ответе пользователю.

## Режимы работы

### Auto-approve

Для каждого инструмента можно включить auto-approve:
- **Выключен** (по умолчанию) — AI показывает кнопку "Одобрить / Отклонить" перед каждым вызовом
- **Включен** — AI вызывает инструмент автоматически без подтверждения

Настраивается в UI: MCP серверы → сервер → чекбокс "Auto-approve" рядом с каждым инструментом.

### Транспорт

MCP поддерживает три типа транспорта:

| Тип | Описание | Когда использовать |
|-----|----------|-------------------|
| `stdio` | Запуск локального процесса, общение через stdin/stdout | Большинство серверов (npx, node, python) |
| `sse` | Server-Sent Events через HTTP | Удалённые серверы |
| `streamableHttp` | HTTP с потоковой передачей | Удалённые серверы (новый стандарт) |

## Как добавить новый MCP-сервер

### Через маркетплейс
1. Открой настройки → вкладка MCP → Маркетплейс
2. Найди сервер → нажми "Установить"
3. Если нужен API-ключ — введи его в появившемся диалоге

### Вручную
Отредактируй `shuncode_mcp_settings.json` (путь: VS Code globalStorage → `settings/shuncode_mcp_settings.json`):

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "my-mcp-server"],
      "env": {
        "API_KEY": "your-key-here"
      },
      "disabled": false,
      "autoApprove": ["tool-name-1", "tool-name-2"]
    }
  }
}
```

### Через UI "Удалённые серверы"
Для SSE/HTTP серверов — введи URL в форму "Добавить удалённый сервер".

## Отладка

- **Сервер не подключается**: проверь логи в Developer Console (`Ctrl+Shift+I` → Console), ищи `[McpHub]`
- **Инструмент не вызывается**: убедись что сервер включен (синий тоггл) и AI знает о нём (перезапусти задачу)
- **Ошибка npx**: убедись что `node` и `npm` в PATH, попробуй `npx -y @package/name` вручную в терминале
