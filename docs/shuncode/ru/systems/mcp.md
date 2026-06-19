> **English version:** [mcp.md](../../systems/mcp.md)

# Model Context Protocol (MCP)

MCP — протокол, который даёт AI-агенту доступ к внешним инструментам и ресурсам. MCP-сервер — это локальная программа, предоставляющая набор **инструментов** и **ресурсов** агенту.

Можно представить MCP как USB-порт для AI: подключаете сервер → AI получает новые возможности.

## Архитектура

```
┌─────────────┐     gRPC      ┌─────────────┐    stdio/SSE    ┌─────────────┐
│  Webview UI  │◄────────────►│   McpHub     │◄──────────────►│ MCP Server  │
│  (React)     │              │  (Extension) │                │ (npx/node)  │
└─────────────┘              └─────────────┘                └─────────────┘
```

## Ключевые файлы

| Файл | Назначение |
|------|-----------|
| `shuncode_mcp_settings.json` | Конфиг MCP-серверов (command, args, env) |
| `services/mcp/McpHub.ts` | Управление подключениями, старт/стоп серверов |
| `core/prompts/system-prompt/components/mcp.ts` | Инъекция MCP-инструментов в системный промпт AI |
| `core/task/tools/handlers/UseMcpToolHandler.ts` | Обработка вызовов `use_mcp_tool` от AI |
| `core/task/tools/handlers/AccessMcpResourceHandler.ts` | Обработка вызовов `access_mcp_resource` |
| `core/controller/mcp/downloadMcp.ts` | Установка MCP-серверов из маркетплейса |

## Как это работает

### 1. Установка

При установке из маркетплейса, `downloadMcp.ts`:
1. Получает информацию о сервере из каталога
2. Парсит README для JSON-конфиг блока с `"mcpServers"`
3. Записывает конфиг в `shuncode_mcp_settings.json`
4. McpHub подхватывает изменения через file watcher и запускает сервер

### 2. Подключение

McpHub при запуске (или через file watcher):
1. Читает `shuncode_mcp_settings.json`
2. Запускает процесс для каждого сервера (напр. `npx -y @upstash/context7-mcp`)
3. Устанавливает stdio-подключение (stdin/stdout)
4. Запрашивает доступные инструменты и ресурсы
5. Сохраняет подключение в `connections[]`

### 3. Инъекция в промпт

Когда пользователь отправляет сообщение, `mcp.ts` генерирует секцию системного промпта:
```
## Connected MCP Servers

Server: github.com/upstash/context7-mcp

### Tools
- resolve-library-id: Resolves a package name to a Context7-compatible library ID
  Parameters:
    - query (required): The user's original question
    - libraryName (required): Library name to search for
```

### 4. Вызов инструмента

Когда AI решает использовать MCP-инструмент, он генерирует:
```xml
<use_mcp_tool>
  <server_name>github.com/upstash/context7-mcp</server_name>
  <tool_name>resolve-library-id</tool_name>
  <arguments>{"query": "React docs", "libraryName": "react"}</arguments>
</use_mcp_tool>
```

`UseMcpToolHandler` → проверяет auto-approve → вызывает `McpHub.callTool()` → возвращает результат AI.

## Типы транспорта

| Тип | Описание | Когда использовать |
|-----|---------|-------------------|
| `stdio` | Локальный процесс, общение через stdin/stdout | Большинство серверов (npx, node, python) |
| `sse` | Server-Sent Events по HTTP | Удалённые серверы |
| `streamableHttp` | HTTP с потоковой передачей | Удалённые серверы (новый стандарт) |

## Добавление MCP-сервера

### Через маркетплейс
Настройки → вкладка MCP → Маркетплейс → Установить

### Вручную
Отредактируйте `shuncode_mcp_settings.json`:
```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "my-mcp-server"],
      "env": { "API_KEY": "your-key-here" },
      "disabled": false,
      "autoApprove": ["tool-name-1"]
    }
  }
}
```

### Через UI
Для SSE/HTTP серверов — введите URL в форме "Add Remote Server".

## Auto-Approve

Настройка для каждого инструмента:
- **Выключено** (по умолчанию) — AI показывает кнопки Approve/Reject перед каждым вызовом
- **Включено** — AI вызывает инструмент автоматически без подтверждения
