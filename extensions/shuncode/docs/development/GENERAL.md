# Общие правила разработки

Важные паттерны и подводные камни при разработке Shuncode AI.

## Сборка

- Проверка сборки: `npm run compile` или `npx tsc --noEmit`
- Быстрая сборка: `node esbuild.mjs`
- Генерация proto: `npm run protos`

## gRPC/Protobuf коммуникация

Extension и webview общаются через gRPC-подобный протокол.

### Proto файлы

Расположение: `proto/shuncode/*.proto`

```protobuf
// Именование
service MyService { }      // PascalCase
rpc myMethod() { }         // camelCase
message MyMessage { }      // PascalCase
```

### После изменения proto

```bash
npm run protos
```

Генерирует типы в:
- `src/shared/proto/`
- `src/generated/grpc-js/`
- `src/generated/nice-grpc/`
- `src/generated/hosts/`

### Добавление нового RPC метода

1. Добавить в `.proto` файл
2. Создать хэндлер в `src/core/controller/<domain>/`
3. Вызвать из webview: `UiServiceClient.myMethod(request)`

## GlobalState

### Добавление нового ключа

1. **Добавить поле** в `GLOBAL_STATE_FIELDS` в `src/shared/storage/state-keys.ts`:
   ```typescript
   const GLOBAL_STATE_FIELDS = {
     // ... существующие
     myKey: { default: undefined as string | undefined },
   } satisfies FieldDefinitions
   ```
   > `GlobalState` — это `type`, автоматически выведенный из `GLOBAL_STATE_FIELDS`. Интерфейс не нужно редактировать вручную.

2. **Чтение** в `src/core/storage/utils/state-helpers.ts` (если нужно в `getStateToPostToWebview`):
   ```typescript
   myKey: stateManager.getGlobalStateKey("myKey"),
   ```

3. **Использование**:
   ```typescript
   controller.stateManager.setGlobalState("myKey", value)
   controller.stateManager.getGlobalStateKey("myKey")
   ```

### Кэш StateManager

StateManager использует in-memory кэш, заполняемый при инициализации.

**Исключение**: Состояние, нужное сразу при запуске (до готовности кэша) — читать напрямую:

```typescript
// При старте в common.ts
const value = context.globalState.get<string>("myKey")

// После инициализации — через StateManager
controller.stateManager.getGlobalStateKey("myKey")
```

## Добавление API провайдера

Три места для proto конверсии (иначе сбросится на Anthropic):

1. `proto/shuncode/models.proto` — добавить в enum `ApiProvider`
2. `convertApiProviderToProto()` в `src/shared/proto-conversions/models/api-configuration-conversion.ts`
3. `convertProtoToApiProvider()` там же

Дополнительно:
- `src/shared/api.ts` — union type и модели
- `src/shared/providers/providers.json` — для dropdown
- `src/core/api/index.ts` — хэндлер в `createHandlerForProvider()`
- Webview компоненты

## Инструменты в системном промпте

**Всегда ищите похожие инструменты и следуйте их паттерну!**

1. Добавить в `ShuncodeDefaultTool` enum
2. Создать файл в `src/core/prompts/system-prompt/tools/`
3. Зарегистрировать в `tools/init.ts`
4. Добавить в конфиги вариантов (`variants/*/config.ts`)
5. Создать хэндлер
6. Подключить в `ToolExecutor.ts`

## Slash-команды

Три места:
- `src/core/slash-commands/index.ts` — определения
- `src/core/prompts/commands.ts` — интеграция в промпт
- `webview-ui/src/utils/slash-commands.ts` — автодополнение

## ChatRow состояния

При отмене задачи статус не обновляется автоматически. Проверяйте:

```typescript
const wasCancelled =
  status === "generating" &&
  (!isLast ||
    lastModifiedMessage?.ask === "resume_task" ||
    lastModifiedMessage?.ask === "resume_completed_task")
```

## Changesets

При значимых user-facing изменениях:

```bash
npm run changeset
```

Создавать только **patch** версии. Пропускать для:
- Мелких фиксов
- Внутренних рефакторингов
- Незаметных UI изменений

## Feature Flags

Пример добавления: #

## Регенерация снапшотов

После изменения промптов:

```bash
UPDATE_SNAPSHOTS=true npm run test:unit
```

## См. также

- [NETWORK.md](./NETWORK.md) — сетевые запросы
- [TOOLS.md](./TOOLS.md) — добавление инструментов
- [../ADDING_SETTINGS.md](../ADDING_SETTINGS.md) — добавление настроек
