# Contributing to Shuncode

Thanks for your interest in contributing! This document explains how to get started.

## Development Setup

### Prerequisites

- **Node.js** 20+
- **Python** 3.x (for native module builds)
- **C++ Build Tools** (Visual Studio Build Tools on Windows, Xcode on macOS)
- **Git**

### Building from Source

```bash
# 1. Clone the repository
git clone https://github.com/RuslanSinkevich/shuncode.git
cd shuncode/vscode

# 2. Install dependencies
npm install

# 3. Launch in development mode
# Windows:
.\scripts\code.bat
# macOS/Linux:
./scripts/code.sh
```

### Building the Extension

```bash
# Build the webview UI
cd vscode/extensions/shuncode/webview-ui
npm run build

# Build the extension backend
cd ..
node esbuild.mjs
```

### Running Tests

```bash
cd vscode/extensions/shuncode
npm run test:unit
```

## Project Structure

```
vscode/
├── src/                          # VS Code core (patches marked with SHUNCODE_FORK)
├── extensions/shuncode/           # Shuncode AI extension
│   ├── src/                      # Extension backend (TypeScript)
│   │   ├── core/                 # Agent loop, diff, indexing, prompts, API
│   │   ├── services/             # MCP, auth, banner, telemetry
│   │   └── shared/               # Shared types and utilities
│   ├── webview-ui/               # React UI
│   ├── proto/                    # Protobuf definitions
│   └── docs/                     # Documentation
└── scripts/code.bat              # Dev launcher
```

## How to Contribute

### Reporting Bugs

Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Shuncode version, OS, model provider

### Suggesting Features

Open a discussion or issue. Describe the use case, not just the solution.

### Pull Requests

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Run `npx tsc --noEmit` to check types
5. Run tests: `npm run test:unit`
6. Submit a PR with a clear description

### Code Style

- **TypeScript** throughout
- Follow existing patterns — look at similar code first
- No unnecessary comments that just narrate what code does
- Use `@/shared/net` for all network requests (see [Network docs](./docs/development/network.md))

### Adding Agent Tools

See [Adding Tools](./docs/development/adding-tools.md) for a step-by-step guide.

### Adding Settings

See [Adding Settings](./docs/development/adding-settings.md) for the full workflow.

### Modifying Proto Files

After any `.proto` changes:
```bash
npm run protos
```

## Communication

- **Issues** — bug reports and feature requests
- **Discussions** — questions, ideas, and general conversation
- **Pull Requests** — code contributions

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](./LICENSE).
