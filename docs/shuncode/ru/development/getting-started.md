> **English version:** [getting-started.md](../../development/getting-started.md)

# Руководство по разработке

## Требования

- Node.js 20+
- Python 3.x (для сборки нативных модулей VS Code)
- C++ build tools (Visual Studio Build Tools на Windows)
- Git

## Быстрый старт

```bash
# Клонирование
git clone https://github.com/RuslanSinkevich/shuncode.git
cd shuncode/vscode

# Установка зависимостей
npm install

# Запуск в режиме разработки
# Windows:
.\scripts\code.bat
# macOS/Linux:
./scripts/code.sh
```

## Сборка расширения

```bash
# Сборка webview UI
cd vscode/extensions/shuncode/webview-ui
npm run build

# Сборка бэкенда расширения
cd ..
node esbuild.mjs
```

## Проверка типов

```bash
npm run compile
# или
npx tsc --noEmit
```

## gRPC / Protobuf коммуникация

Расширение и webview общаются через gRPC-подобный протокол.

### Proto-файлы

Расположение: `proto/shuncode/*.proto`

```protobuf
service MyService { }      // PascalCase
rpc myMethod() { }         // camelCase
message MyMessage { }      // PascalCase
```

### После изменения Proto-файлов

```bash
npm run protos
```

Генерирует типы в:

- `src/shared/proto/`
- `src/generated/grpc-js/`
- `src/generated/nice-grpc/`
- `src/generated/hosts/`

### Добавление нового RPC-метода

1. Добавить в `.proto` файл
2. Создать обработчик в `src/core/controller/<domain>/`
3. Вызвать из webview: `UiServiceClient.myMethod(request)`

## GlobalState

### Добавление нового ключа

1. Добавить поле в `GLOBAL_STATE_FIELDS` в `src/shared/storage/state-keys.ts`:

   ```typescript
   const GLOBAL_STATE_FIELDS = {
     myKey: { default: undefined as string | undefined },
   } satisfies FieldDefinitions
   ```

2. Считать в `getStateToPostToWebview`:

   ```typescript
   myKey: stateManager.getGlobalStateKey("myKey"),
   ```

3. Использовать:

   ```typescript
   controller.stateManager.setGlobalState("myKey", value)
   controller.stateManager.getGlobalStateKey("myKey")
   ```

## Добавление API-провайдера

Три места для proto-конвертации (иначе сбросится на Anthropic):

1. `proto/shuncode/models.proto` — добавить в enum `ApiProvider`
2. `convertApiProviderToProto()` в `src/shared/proto-conversions/models/api-configuration-conversion.ts`
3. `convertProtoToApiProvider()` в том же файле

Дополнительно:

- `src/shared/api.ts` — union type и модели
- `src/shared/providers/providers.json` — для выпадающего списка
- `src/core/api/index.ts` — обработчик в `createHandlerForProvider()`
- Webview-компоненты

## Changesets

Для значимых пользовательских изменений:

```bash
npm run changeset
```

Создавать только **patch** версии. Пропускать для мелких фиксов, внутренних рефакторингов и невидимых UI-изменений.

## Регенерация снапшотов

После изменения промптов:

```bash
UPDATE_SNAPSHOTS=true npm run test:unit
```

## См. также

- [Добавление инструментов](./adding-tools.md)
- [Сетевые запросы](./network.md)
- [Добавление настроек](./adding-settings.md)
- [Патчи форка](./fork-patches.md)
