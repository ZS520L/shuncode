> **Русская версия:** [overview.md](../ru/architecture/overview.md)

# Architecture Overview

Shuncode AI is a VS Code extension consisting of three major subsystems:

- **Core Extension** — Node.js backend: agent loop, tool execution, API providers, diff engine
- **Webview UI** — React frontend: chat interface, settings, history
- **Indexing Subsystem** — semantic code search with local embeddings

## High-Level Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  VS Code Extension Host                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Core Extension                                          │   │
│  │  ┌──────────────┐  ┌────────────┐  ┌─────────────────┐  │   │
│  │  │ Extension.ts │→ │ Webview    │→ │ Controller      │  │   │
│  │  │ (entry point)│  │ Provider   │  │ (coordinator)   │  │   │
│  │  └──────────────┘  └────────────┘  └────────┬────────┘  │   │
│  │                                              ↓           │   │
│  │  ┌──────────────┐  ┌────────────┐  ┌─────────────────┐  │   │
│  │  │ Indexing     │← │ Task       │← │ API Handlers    │  │   │
│  │  │ (semantic)   │  │ (agent)    │  │ (40+ providers) │  │   │
│  │  └──────────────┘  └────────────┘  └─────────────────┘  │   │
│  │          ↑                                  ↓           │   │
│  │  ┌───────┴──────┐                  ┌─────────────────┐  │   │
│  │  │ Storage      │                  │ McpHub          │  │   │
│  │  │ (SQLite/JSON)│                  │ (MCP servers)   │  │   │
│  │  └──────────────┘                  └─────────────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↕ gRPC / postMessage               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Webview UI (React)                                      │   │
│  │  ┌──────────────────┐  ┌─────────────────────────────┐  │   │
│  │  │ ExtensionState   │→ │ React Components            │  │   │
│  │  │ Context          │  │ (Chat, Settings, History)   │  │   │
│  │  └──────────────────┘  └─────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### Extension Entry (`src/extension.ts`)

Activation point. Creates the WebviewProvider and registers commands.

### WebviewProvider (`src/core/webview/index.ts`)

Manages the webview lifecycle: HTML generation with CSP headers, message routing, HMR for development.

### Controller (`src/core/controller/index.ts`)

Central coordinator:
- State management (GlobalState, Secrets)
- Task creation and lifecycle
- MCP server coordination
- State synchronization with the webview

### Task (`src/core/task/index.ts`)

Executes AI agent tasks:
- API requests to model providers
- Tool execution (files, terminal, browser, MCP)
- Response streaming and parsing
- Context management

### API Handlers (`src/core/api/`)

40+ model providers: Anthropic (Claude), OpenAI (GPT-4o, o1, o3), Google (Gemini), OpenRouter, AWS Bedrock, Ollama, LM Studio, GigaChat, YandexGPT, and any OpenAI-compatible API.

### McpHub (`src/services/mcp/McpHub.ts`)

MCP server manager: connects to external MCP servers, manages tools and resources, handles auto-approval settings.

## Data Flows

### Task Execution

```
User Input → Controller.initTask()
                    ↓
            Task.initiateTaskLoop()
                    ↓
            attemptApiRequest() → API Provider
                    ↓
            Stream Response → parseAssistantMessage()
                    ↓
            Tool Execution → presentAssistantMessage()
                    ↓
            Tool Result → Continue Loop or Complete
```

### State Synchronization

```
Extension State Change
        ↓
Controller.postStateToWebview()
        ↓
gRPC Message → Webview
        ↓
ExtensionStateContext.setState()
        ↓
React Components Re-render
```

## Data Storage

| Type | Storage | Purpose |
|------|---------|---------|
| API keys | VS Code Secrets | Secure credential storage |
| Settings | GlobalState | Persistent user preferences |
| Task history | Filesystem | JSON files per taskId (`~/.shuncode/tasks/`) |
| Search index | SQLite | Embeddings and chunk metadata (`~/.shuncode/indexing/`) |

## Operating Modes

| Mode | Purpose | Tools Available |
|------|---------|----------------|
| **Act** (default) | Execute tasks, edit files, run commands | All |
| **Ask** | Explore code, answer questions | Read-only |
| **Plan** | Gather info, ask questions, design approach | Read-only + `plan_mode_respond` |
| **Debug** | Systematic debugging with runtime evidence | Read-only + `execute_command` |
| **Chat** | General conversation, any topic | Read-only (only on explicit request) |

The agent can dynamically switch between modes during a conversation.

## See Also

- [Core Module](./core.md)
- [Diff System](../systems/diff-system.md)
- [Indexing System](../systems/indexing-system.md)
