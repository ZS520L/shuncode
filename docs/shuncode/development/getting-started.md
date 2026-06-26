> **Русская версия:** [getting-started.md](../ru/development/getting-started.md)

# Development Guide

## Prerequisites

- Node.js 20+
- Python 3.x (for VS Code native module builds)
- C++ build tools (Visual Studio Build Tools on Windows)
- Git

## Quick Start

```bash
# Clone
git clone https://github.com/RuslanSinkevich/shuncode.git
cd shuncode/vscode

# Install dependencies
npm install

# Launch in development mode
# Windows:
.\scripts\code.bat
# macOS/Linux:
./scripts/code.sh
```

## Building the Extension

```bash
# Build the webview UI
cd vscode/extensions/shuncode/webview-ui
npm run build

# Build the extension backend
cd ..
node esbuild.mjs
```

## Type Checking

```bash
npm run compile
# or
npx tsc --noEmit
```

## gRPC / Protobuf Communication

The extension and webview communicate via a gRPC-like protocol.

### Proto Files

Location: `proto/shuncode/*.proto`

```protobuf
service MyService { }      // PascalCase
rpc myMethod() { }         // camelCase
message MyMessage { }      // PascalCase
```

### After Changing Proto Files

```bash
npm run protos
```

Generates types in:
- `src/shared/proto/`
- `src/generated/grpc-js/`
- `src/generated/nice-grpc/`
- `src/generated/hosts/`

### Adding a New RPC Method

1. Add to the `.proto` file
2. Create a handler in `src/core/controller/<domain>/`
3. Call from webview: `UiServiceClient.myMethod(request)`

## GlobalState

### Adding a New Key

1. Add a field to `GLOBAL_STATE_FIELDS` in `src/shared/storage/state-keys.ts`:
   ```typescript
   const GLOBAL_STATE_FIELDS = {
     myKey: { default: undefined as string | undefined },
   } satisfies FieldDefinitions
   ```

2. Read in `getStateToPostToWebview`:
   ```typescript
   myKey: stateManager.getGlobalStateKey("myKey"),
   ```

3. Use:
   ```typescript
   controller.stateManager.setGlobalState("myKey", value)
   controller.stateManager.getGlobalStateKey("myKey")
   ```

## Adding an API Provider

Three places for proto conversion (otherwise it resets to Anthropic):

1. `proto/shuncode/models.proto` — add to `ApiProvider` enum
2. `convertApiProviderToProto()` in `src/shared/proto-conversions/models/api-configuration-conversion.ts`
3. `convertProtoToApiProvider()` in the same file

Additionally:
- `src/shared/api.ts` — union type and models
- `src/shared/providers/providers.json` — for the dropdown
- `src/core/api/index.ts` — handler in `createHandlerForProvider()`
- Webview components

## Changesets

For significant user-facing changes:

```bash
npm run changeset
```

Create **patch** versions only. Skip for minor fixes, internal refactors, and invisible UI changes.

## Regenerating Snapshots

After changing prompts:

```bash
UPDATE_SNAPSHOTS=true npm run test:unit
```

## See Also

- [Adding Tools](./adding-tools.md)
- [Network Requests](./network.md)
- [Adding Settings](./adding-settings.md)
- [Fork Patches](./fork-patches.md)
