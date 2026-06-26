# Добавление настроек в Shuncode AI

Это руководство описывает полный процесс добавления новой настройки в расширение Shuncode AI.

## Обзор архитектуры

Настройки в Shuncode AI проходят через несколько слоёв:

```
┌─────────────────────────────────────────────────────────────────┐
│  Webview UI (React)                                             │
│  FeatureSettingsSection.tsx → updateSetting() → gRPC Client     │
└─────────────────────────────────────────────────────────────────┘
                              ↓ gRPC
┌─────────────────────────────────────────────────────────────────┐
│  Extension Host (Node.js)                                       │
│  StateService → updateSettings.ts → StateManager / VS Code API  │
└─────────────────────────────────────────────────────────────────┘
```

## Шаги добавления настройки

### 1. Proto файл (определение типа)

**Файл:** `proto/shuncode/state.proto`

Добавьте поле в `UpdateSettingsRequest`:

```protobuf
message UpdateSettingsRequest {
  // ... существующие поля ...
  optional bool my_new_setting = 42;  // Следующий свободный номер
}
```

**Важно:** Номера полей должны быть уникальными и последовательными.

### 2. Регенерация Proto

```powershell
npm run protos
```

Это обновит:
- `webview-ui/src/services/grpc-client.ts`
- `src/generated/hosts/vscode/protobus-*.ts`
- `src/shared/proto/shuncode/state.ts`

### 3. Extension State (интерфейс)

**Файл:** `src/shared/ExtensionMessage.ts`

Добавьте поле в `ExtensionState`:

```typescript
export interface ExtensionState {
  // ... существующие поля ...
  myNewSetting?: boolean
}
```

### 4. Обработка в StateService

**Файл:** `src/core/controller/state/updateSettings.ts`

Добавьте обработку нового поля:

```typescript
// Вариант A: Сохранение в GlobalState (для внутренних настроек)
if (request.myNewSetting !== undefined) {
  controller.stateManager.setGlobalState("myNewSetting", !!request.myNewSetting)
}

// Вариант B: Сохранение в VS Code Configuration (для настроек видимых в Settings UI)
if (request.myNewSetting !== undefined) {
  const config = vscode.workspace.getConfiguration("shuncode")
  await config.update("myNewSetting", !!request.myNewSetting, vscode.ConfigurationTarget.Global)
}
```

### 5. (Опционально) VS Code Configuration

Если настройка должна быть видна в стандартных настройках VS Code:

**Файл:** `package.json`

```json
{
  "contributes": {
    "configuration": {
      "properties": {
        "shuncode.myNewSetting": {
          "type": "boolean",
          "default": true,
          "description": "Описание настройки"
        }
      }
    }
  }
}
```

### 6. Чтение настройки в Controller

**Файл:** `src/core/controller/index.ts`

В методе `getStateToPostToWebview()`:

```typescript
// Из GlobalState:
myNewSetting: this.stateManager.getGlobalStateKey("myNewSetting"),

// Или из VS Code Configuration:
myNewSetting: vscode.workspace.getConfiguration("shuncode").get<boolean>("myNewSetting", true),
```

### 7. Webview Context (default values)

**Файл:** `webview-ui/src/context/ExtensionStateContext.tsx`

Добавьте default value в начальное состояние:

```typescript
const [state, setState] = useState<ExtensionState>({
  // ... существующие поля ...
  myNewSetting: true,  // default value
})
```

### 8. UI компонент

**Файл:** Подходящая секция в `webview-ui/src/components/settings/sections/` (выбрать по смыслу)

Доступные секции: `ApiConfigurationSection`, `GeneralSettingsSection`, `EditingSection`, `TerminalSettingsSection`, `BrowserSettingsSection`, `ContextSection`, `PermissionsSection`, `ExperimentsSection`, `DebugSection`, `IndexingSettingsSection`, `McpSection`, `VoiceSection`.

```tsx
const { myNewSetting } = useExtensionState()

// В JSX:
<VSCodeCheckbox
  checked={myNewSetting}
  onChange={(e: any) => {
    const checked = e.target.checked === true
    updateSetting("myNewSetting", checked)
  }}>
  Название настройки
</VSCodeCheckbox>
<p className="text-xs text-(--vscode-descriptionForeground)">
  Описание настройки
</p>
```

### 9. Использование настройки в коде

```typescript
// В Extension Host:
const config = vscode.workspace.getConfiguration("shuncode")
const myNewSetting = config.get<boolean>("myNewSetting", true)

// Или через StateManager:
const myNewSetting = this.stateManager.getGlobalStateKey("myNewSetting")
```

## Типы настроек

### Boolean (чекбокс)
```protobuf
optional bool setting_name = N;
```

### String (текстовое поле)
```protobuf
optional string setting_name = N;
```

### Number (числовое поле)
```protobuf
optional int32 setting_name = N;
optional double setting_name = N;
```

### Enum (выпадающий список)
```protobuf
enum MyEnum {
  VALUE_ONE = 0;
  VALUE_TWO = 1;
}
optional MyEnum setting_name = N;
```

## Пример: Полный workflow

Добавляем настройку `lightweightMode`:

1. **proto/shuncode/state.proto:**
   ```protobuf
   optional bool lightweight_mode = 45;
   ```

2. **npm run protos**

3. **src/shared/ExtensionMessage.ts:**
   ```typescript
   lightweightMode?: boolean
   ```

4. **src/shared/storage/state-keys.ts** (добавить в `GLOBAL_SETTINGS_FIELDS`):
   ```typescript
   lightweightMode: { default: false as boolean },
   ```

5. **src/core/controller/state/updateSettings.ts:**
   ```typescript
   if (request.lightweightMode !== undefined) {
     controller.stateManager.setGlobalState("lightweightMode", !!request.lightweightMode)
   }
   ```

6. **src/core/controller/index.ts** (`getStateToPostToWebview`):
   ```typescript
   lightweightMode: this.stateManager.getGlobalSettingsKey("lightweightMode"),
   ```

7. **webview-ui/src/context/ExtensionStateContext.tsx:**
   ```typescript
   lightweightMode: false,
   ```

8. **webview-ui/src/components/settings/ApiOptions.tsx:**
   ```tsx
   const { lightweightMode } = useExtensionState()

   <VSCodeCheckbox
     checked={lightweightMode}
     onChange={(e) => updateSetting("lightweightMode", (e.target as HTMLInputElement).checked)}>
     {t("provider.lightweightMode")}
   </VSCodeCheckbox>
   ```

## Чеклист

- [ ] Добавлено поле в `proto/shuncode/state.proto`
- [ ] Выполнен `npm run protos`
- [ ] Добавлено поле в `ExtensionState` интерфейс
- [ ] Добавлена обработка в `updateSettings.ts`
- [ ] (Опционально) Добавлено в `package.json` configuration
- [ ] Добавлено чтение в `getStateToPostToWebview()`
- [ ] Добавлен default value в `ExtensionStateContext.tsx`
- [ ] Добавлен UI в подходящую секцию настроек
- [ ] Протестировано: значение сохраняется и восстанавливается
