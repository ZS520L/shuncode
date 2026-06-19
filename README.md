# ShunCode AI

**AI-powered code editor built on VS Code — open-source alternative to Cursor**

ShunCode is a fork of VS Code with a deeply integrated AI agent. Unlike extensions (Copilot, Continue, etc.), the AI is part of the editor itself — giving full control over UX, performance, and security.

<p align="center">
  <img src="./docs/shuncode/home.png" alt="ShunCode AI in action" width="900">
</p>

<p align="center">
  <a href="https://shuncode-ai.ru/en">Website</a> ·
  <a href="https://shuncode-ai.ru/ru">Сайт (RU)</a> ·
  <a href="#documentation">Docs (EN)</a> ·
  <a href="./docs/shuncode/ru/architecture/overview.md">Docs (RU)</a> ·
  <a href="https://github.com/RuslanSinkevich/shuncode">GitHub</a>
</p>

---

## Features

### AI Agent with 30+ Tools

| Capability | Description |
|-----------|-------------|
| **Read & edit files** | Full file creation, block replacement, patches |
| **Execute commands** | Terminal: build, test, git, npm, Docker |
| **Semantic search** | Search by meaning across the entire codebase (local embeddings) |
| **Regex search** | Fast pattern matching via ripgrep |
| **Web search** | Search the internet for information |
| **Browser automation** | Puppeteer: screenshots, clicks, form filling |
| **MCP integrations** | Connect external services (Context7, databases, APIs) |
| **Diagnostics** | Read ESLint, TypeScript, and other linter errors |
| **Jupyter Notebooks** | Create and edit notebook cells |

### 5 Operating Modes

| Mode | Purpose | Tools |
|------|---------|-------|
| **Act** | Default. Execute tasks, edit files, run commands | All |
| **Ask** | Explore code, answer questions | Read-only |
| **Plan** | Gather info, design approach | Read-only + `plan_mode_respond` |
| **Debug** | Systematic debugging with runtime evidence | Read-only + `execute_command` |
| **Chat** | General conversation, any topic | Read-only (on explicit request) |

The agent can dynamically switch between modes during a conversation.

### Inline Diff System v4

- Changes from AI displayed **directly in the editor** (green = added, red = removed)
- **Accept / Reject** buttons per change block
- Per-message snapshots for precise rollback
- Cross-file navigation between pending changes
- 217 unit tests covering the entire diff engine

### Semantic Code Search

- **Local embedding index** of the entire project (transformers.js, WASM, offline)
- Hybrid retrieval: semantic + keyword + rerank
- Incremental updates via FileWatcher
- Optional remote API (OpenAI-compatible)

### 40+ API Providers

- **OpenAI** — GPT-4o, o1, o3
- **Anthropic** — Claude Sonnet, Opus, Haiku
- **Google** — Gemini 2.5 Pro/Flash
- **GigaChat** — native function calls (Sber)
- **YandexGPT** — YandexGPT 5 Pro/Lite
- **Open-source** — Qwen, DeepSeek, Llama, Mistral
- **OpenRouter** — 200+ models aggregator
- Any **OpenAI-compatible** API (Ollama, LM Studio, vLLM)

### Voice Input

Offline speech recognition (Whisper, 50+ languages). No internet required.

### Lightweight Mode

Simplified prompts and tools for weaker/free models. 11 prompt variants optimized for specific model families.

---

## Quick Start

```bash
# Clone
git clone https://github.com/RuslanSinkevich/shuncode.git
cd shuncode

# Install
npm install

# Launch (development mode)
# Windows:
.\scripts\code.bat
# macOS/Linux:
./scripts/code.sh
```

### Building the Extension

```bash
cd extensions/shuncode/webview-ui
npm run build          # UI

cd ..
node esbuild.mjs      # Backend
```

Open the ShunCode panel in the sidebar → configure your API provider → start coding.

---

## Architecture

```
┌──────────────────────────────────────────────┐
│  VS Code Fork                                 │
│  ┌──────────────────────────────────────┐    │
│  │  ShunCode Extension                        │    │
│  │  ┌────────┐ ┌──────┐ ┌───────────┐  │    │
│  │  │ Agent  │ │ Diff │ │ Indexing  │  │    │
│  │  │ Loop   │ │ v4   │ │ (SQLite)  │  │    │
│  │  └───┬────┘ └──────┘ └───────────┘  │    │
│  │      ↓                               │    │
│  │  ┌────────┐ ┌──────┐ ┌───────────┐  │    │
│  │  │ 40+   │ │ MCP  │ │ Prompts   │  │    │
│  │  │ APIs  │ │ Hub  │ │ Engine    │  │    │
│  │  └────────┘ └──────┘ └───────────┘  │    │
│  └──────────────────────────────────────┘    │
│                    ↕ gRPC                     │
│  ┌──────────────────────────────────────┐    │
│  │  Webview UI (React, 230+ components) │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

| Component | Technology |
|-----------|-----------|
| Editor | VS Code fork |
| Communication | gRPC + Protobuf |
| Chat UI | React (230+ components) |
| Code parsing | Tree-sitter (16 languages) |
| Search | Embedding index + ripgrep |
| Analytics | PostHog + OpenTelemetry (opt-in) |

---

## Design Philosophy

ShunCode treats the LLM API's `system` and `tools` fields as a **programmable runtime**, not fixed strings. Three pillars:

### 1. Customizable System Prompt

```
Template (editable) + Variables ({{mode}}, {{pinnedMemory}}, {{SKILLS_SECTION}}...)
  → Component Pipeline (agent role, skills index, system info, rules...)
  → Runtime Context (cwd, os, git, open tabs, mode...)
  → Final system prompt
```

- **Template engine** with `{{variable}}` placeholders and built-in section components
- **Multi-profile support** — create, duplicate, and switch between prompt profiles
- **Friendly variables**: `{{memory}}` (pinned global memories), `{{mode}}`, `{{SKILLS_SECTION}}`, `{{mcpSettingsPath}}`
- Same template, different project → different resolved prompt

### 2. Configurable Tool Layer

```
Tool Registry (ShuncodeToolSet) + Override Layer (toolCustomizationSettings)
  → Mode Filters (ask/plan/lightweight hide dangerous tools)
  → Native Tool Spec (AnthropicTool / OpenAITool / GoogleTool)
```

- **Toggle** any built-in tool on/off from Settings
- **Rewrite descriptions and parameter instructions** for clearer model understanding
- **Safe by default**: ask/chat modes auto-hide write tools, lightweight mode hides complex tools
- Changes take effect immediately — no restart required

### 3. Open Extension Channels

| Channel | Mechanism | Loading |
|---------|-----------|---------|
| **MCP Servers** | MCP protocol (streamable-http, SSE, stdio) + marketplace + OAuth | Connected servers inject tools into the agent's tool list |
| **Skills** | Markdown files in `.shuncode/skills/` or `~/.shuncode/skills/` | Lightweight index in system prompt → `use_skill()` loads full instructions on demand |
| **Memories** | Global Rules `.md` files in `Documents/Shuncode/Rules/` | Structured `<记忆>` blocks injected via `{{pinnedMemory}}` |

This means third parties can extend the AI's capabilities **without touching ShunCode source code** — tools come from MCP servers, skills from `.md` files, all through standard interfaces.

---

## Comparison

| | ShunCode | Cursor | Claude Code |
|---|---|---|---|
| **License** | Apache 2.0 (open source) | Proprietary | Proprietary |
| **Model providers** | 20+ (Anthropic, OpenAI, Gemini, Ollama, local...) | Limited | Anthropic only |
| **System prompt** | Fully customizable (templates + variables + profiles) | Fixed | Partial (via CLAUDE.md) |
| **Tool customization** | Toggle + rewrite descriptions + parameters | ❌ | ❌ |
| **MCP** | Full protocol + marketplace + OAuth | Limited | ✅ |
| **Skills** | Progressive loading (index in prompt → load on demand) | ❌ | ❌ |
| **Modes** | 5 (act / plan / ask / debug / chat) | 2 (agent / ask) | 1 |
| **Memory system** | Global `<记忆>` blocks + CRUD tool | `.cursorrules` file | `CLAUDE.md` file |
| **Local models** | ✅ Ollama, LM Studio, vLLM | ❌ | ❌ |
| **Data privacy** | Fully local possible | Must use cloud | Must use Anthropic |
| **Editor** | VS Code fork (deep integration) | VS Code fork | CLI |

**Where Cursor wins**: tab completion speed, diff preview UX.

**Where Claude Code wins**: deepest Claude-native prompt optimization.

**Where ShunCode wins**: open-source, self-hostable, programmable — you control the runtime, not the other way around.

---

## Documentation

> **Документация на русском:** [docs/shuncode/ru/](./docs/shuncode/ru/architecture/overview.md)

### Architecture
- [Overview](./docs/shuncode/architecture/overview.md)
- [Core Module](./docs/shuncode/architecture/core.md)
- [Context Management](./docs/shuncode/architecture/context-management.md)

### Systems
- [Inline Diff System v4](./docs/shuncode/systems/diff-system.md)
- [Codebase Indexing](./docs/shuncode/systems/indexing-system.md)
- [MCP Integration](./docs/shuncode/systems/mcp.md)

### Development
- [Getting Started](./docs/shuncode/development/getting-started.md)
- [Adding Agent Tools](./docs/shuncode/development/adding-tools.md)
- [Network Requests](./docs/shuncode/development/network.md)
- [Adding Settings](./docs/shuncode/development/adding-settings.md)
- [VS Code Fork Patches](./docs/shuncode/development/fork-patches.md)

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, code style, and PR guidelines.

---

## Acknowledgments

ShunCode is built upon several open-source projects:

- [VS Code](https://github.com/microsoft/vscode) (MIT) — the editor foundation
- [Cline](https://github.com/cline/cline) (Apache 2.0) — initial extension architecture
- [Continue](https://github.com/continuedev/continue) (Apache 2.0) — local embedding pipeline
- [Kilocode](https://github.com/Kilo-Org/kilocode) (Apache 2.0 / MIT) — tool handling patterns

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for full attribution.

## License

[Apache License 2.0](./LICENSE)
