> **Русская версия:** [adding-settings.md](../ru/development/adding-settings.md)

# Adding Settings

Complete guide to adding a new setting to Shuncode AI.

## Architecture

Settings flow through multiple layers:

```
┌──────────────────────────────────────────────────────────────┐
│  Webview UI (React)                                          │
│  SettingsSection.tsx → updateSetting() → gRPC Client         │
└──────────────────────────────────────────────────────────────┘
                              ↓ gRPC
┌──────────────────────────────────────────────────────────────┐
│  Extension Host (Node.js)                                    │
│  StateService → updateSettings.ts → StateManager / VS Code   │
└──────────────────────────────────────────────────────────────┘
```

## Steps

### 1. Proto File

**File:** `proto/shuncode/state.proto`

```protobuf
message UpdateSettingsRequest {
  optional bool my_new_setting = 42;  // next free number
}
```

### 2. Regenerate Proto

```bash
npm run protos
```

### 3. Extension State Interface

**File:** `src/shared/ExtensionMessage.ts`

```typescript
export interface ExtensionState {
  myNewSetting?: boolean
}
```

### 4. Handle in StateService

**File:** `src/core/controller/state/updateSettings.ts`

```typescript
if (request.myNewSetting !== undefined) {
  controller.stateManager.setGlobalState("myNewSetting", !!request.myNewSetting)
}
```

### 5. (Optional) VS Code Configuration

**File:** `package.json`

```json
{
  "contributes": {
    "configuration": {
      "properties": {
        "shuncode.myNewSetting": {
          "type": "boolean",
          "default": true,
          "description": "Setting description"
        }
      }
    }
  }
}
```

### 6. Read in Controller

**File:** `src/core/controller/index.ts` — `getStateToPostToWebview()`

```typescript
myNewSetting: this.stateManager.getGlobalStateKey("myNewSetting"),
```

### 7. Webview Default Value

**File:** `webview-ui/src/context/ExtensionStateContext.tsx`

```typescript
const [state, setState] = useState<ExtensionState>({
  myNewSetting: true,
})
```

### 8. UI Component

Choose the appropriate section in `webview-ui/src/components/settings/sections/`:

```tsx
const { myNewSetting } = useExtensionState()

<VSCodeCheckbox
  checked={myNewSetting}
  onChange={(e: any) => updateSetting("myNewSetting", e.target.checked === true)}>
  Setting label
</VSCodeCheckbox>
```

## Checklist

- [ ] Added field to `proto/shuncode/state.proto`
- [ ] Ran `npm run protos`
- [ ] Added field to `ExtensionState` interface
- [ ] Added handling in `updateSettings.ts`
- [ ] (Optional) Added to `package.json` configuration
- [ ] Added reading in `getStateToPostToWebview()`
- [ ] Added default value in `ExtensionStateContext.tsx`
- [ ] Added UI in the appropriate settings section
- [ ] Tested: value persists across sessions
