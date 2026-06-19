> **English version:** [adding-settings.md](../../development/adding-settings.md)

# Добавление настроек

Полное руководство по добавлению новой настройки в Shuncode AI.

## Архитектура

Настройки проходят через несколько уровней:

```
┌──────────────────────────────────────────────────────────────┐
│  Webview UI (React)                                          │
│  SettingsSection.tsx → updateSetting() → gRPC-клиент         │
└──────────────────────────────────────────────────────────────┘
                              ↓ gRPC
┌──────────────────────────────────────────────────────────────┐
│  Extension Host (Node.js)                                    │
│  StateService → updateSettings.ts → StateManager / VS Code   │
└──────────────────────────────────────────────────────────────┘
```

## Шаги

### 1. Proto-файл

**Файл:** `proto/shuncode/state.proto`

```protobuf
message UpdateSettingsRequest {
  optional bool my_new_setting = 42;  // следующий свободный номер
}
```

### 2. Регенерация Proto

```bash
npm run protos
```

### 3. Интерфейс состояния расширения

**Файл:** `src/shared/ExtensionMessage.ts`

```typescript
export interface ExtensionState {
  myNewSetting?: boolean
}
```

### 4. Обработка в StateService

**Файл:** `src/core/controller/state/updateSettings.ts`

```typescript
if (request.myNewSetting !== undefined) {
  controller.stateManager.setGlobalState("myNewSetting", !!request.myNewSetting)
}
```

### 5. (Опционально) VS Code Configuration

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

### 6. Чтение в Controller

**Файл:** `src/core/controller/index.ts` — `getStateToPostToWebview()`

```typescript
myNewSetting: this.stateManager.getGlobalStateKey("myNewSetting"),
```

### 7. Значение по умолчанию в Webview

**Файл:** `webview-ui/src/context/ExtensionStateContext.tsx`

```typescript
const [state, setState] = useState<ExtensionState>({
  myNewSetting: true,
})
```

### 8. UI-компонент

Выберите подходящий раздел в `webview-ui/src/components/settings/sections/`:

```tsx
const { myNewSetting } = useExtensionState()

<VSCodeCheckbox
  checked={myNewSetting}
  onChange={(e: any) => updateSetting("myNewSetting", e.target.checked === true)}>
  Подпись настройки
</VSCodeCheckbox>
```

## Чеклист

- [ ] Добавлено поле в `proto/shuncode/state.proto`
- [ ] Выполнена команда `npm run protos`
- [ ] Добавлено поле в интерфейс `ExtensionState`
- [ ] Добавлена обработка в `updateSettings.ts`
- [ ] (Опционально) Добавлено в конфигурацию `package.json`
- [ ] Добавлено чтение в `getStateToPostToWebview()`
- [ ] Добавлено значение по умолчанию в `ExtensionStateContext.tsx`
- [ ] Добавлен UI в соответствующий раздел настроек
- [ ] Проверено: значение сохраняется между сессиями
