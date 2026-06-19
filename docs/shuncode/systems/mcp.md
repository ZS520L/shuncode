> **Русская версия:** [mcp.md](../ru/systems/mcp.md)

# Model Context Protocol (MCP)

MCP is a protocol that gives the AI agent access to external tools and resources. An MCP server is a local program that provides a set of **tools** and **resources** to the agent.

Think of MCP as a USB port for AI: plug in a server → AI gains new capabilities.

## Architecture

```
┌─────────────┐     gRPC      ┌─────────────┐    stdio/SSE    ┌─────────────┐
│  Webview UI  │◄────────────►│   McpHub     │◄──────────────►│ MCP Server  │
│  (React)     │              │  (Extension) │                │ (npx/node)  │
└─────────────┘              └─────────────┘                └─────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `shuncode_mcp_settings.json` | MCP server config (command, args, env) |
| `services/mcp/McpHub.ts` | Connection management, server start/stop |
| `core/prompts/system-prompt/components/mcp.ts` | Injects MCP tools into the AI system prompt |
| `core/task/tools/handlers/UseMcpToolHandler.ts` | Handles `use_mcp_tool` calls from AI |
| `core/task/tools/handlers/AccessMcpResourceHandler.ts` | Handles `access_mcp_resource` calls |
| `core/controller/mcp/downloadMcp.ts` | Installs MCP servers from the marketplace |

## How It Works

### 1. Installation

When installing from the marketplace, `downloadMcp.ts`:
1. Fetches server info from the catalog
2. Parses the README for a JSON config block with `"mcpServers"`
3. Writes the config to `shuncode_mcp_settings.json`
4. McpHub picks up changes via file watcher and starts the server

### 2. Connection

McpHub on startup (or via file watcher):
1. Reads `shuncode_mcp_settings.json`
2. Spawns a process for each server (e.g. `npx -y @upstash/context7-mcp`)
3. Establishes stdio connection (stdin/stdout)
4. Queries available tools and resources
5. Stores the connection in `connections[]`

### 3. Prompt Injection

When the user sends a message, `mcp.ts` generates a system prompt section:
```
## Connected MCP Servers

Server: github.com/upstash/context7-mcp

### Tools
- resolve-library-id: Resolves a package name to a Context7-compatible library ID
  Parameters:
    - query (required): The user's original question
    - libraryName (required): Library name to search for
```

### 4. Tool Invocation

When the AI decides to use an MCP tool, it generates:
```xml
<use_mcp_tool>
  <server_name>github.com/upstash/context7-mcp</server_name>
  <tool_name>resolve-library-id</tool_name>
  <arguments>{"query": "React docs", "libraryName": "react"}</arguments>
</use_mcp_tool>
```

`UseMcpToolHandler` → checks auto-approve → calls `McpHub.callTool()` → returns result to AI.

## Transport Types

| Type | Description | When to use |
|------|-------------|-------------|
| `stdio` | Local process, communicates via stdin/stdout | Most servers (npx, node, python) |
| `sse` | Server-Sent Events over HTTP | Remote servers |
| `streamableHttp` | HTTP with streaming | Remote servers (new standard) |

## Adding an MCP Server

### Via Marketplace
Settings → MCP tab → Marketplace → Install

### Manually
Edit `shuncode_mcp_settings.json`:
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

### Via UI
For SSE/HTTP servers — enter URL in the "Add Remote Server" form.

## Auto-Approve

Per-tool setting:
- **Off** (default) — AI shows Approve/Reject buttons before each call
- **On** — AI calls the tool automatically without confirmation
