# Общие правила для AI агента

Этот файл содержит важные знания о кодовой базе — неочевидные паттерны, которые экономят время.

## Когда добавлять сюда

- Пользователю пришлось вмешаться и исправить
- Понадобилось много итераций чтобы что-то заработало
- Что-то работает не так как ожидалось
- Изменение затронуло файлы, которые не очевидны

## Важные моменты

### Сборка

- Это VS Code расширение — проверяй `package.json` для скриптов
- `npm run compile` — полная проверка
- `node esbuild.mjs` — быстрая сборка

### gRPC/Protobuf

Proto файлы в `proto/shuncode/*.proto`:
- После изменений: `npm run protos`
- Генерация в: `src/shared/proto/`, `src/generated/`
- Новые enum значения требуют обновления конверсий в `src/shared/proto-conversions/`

### Добавление API провайдера

**Три обязательных места** (иначе сбросится на Anthropic):
1. `proto/shuncode/models.proto` — enum `ApiProvider`
2. `convertApiProviderToProto()` в `api-configuration-conversion.ts`
3. `convertProtoToApiProvider()` там же

### Инструменты в промпте

**Всегда смотри похожие инструменты!**

Полная цепочка:
1. `ShuncodeDefaultTool` enum
2. Файл в `tools/`
3. Регистрация в `init.ts`
4. Добавление в `variants/*/config.ts`
5. Хэндлер
6. `ToolExecutor.ts`

### GlobalState

При добавлении ключа:
1. Поле в `GLOBAL_STATE_FIELDS` в `state-keys.ts` (тип `GlobalState` выводится автоматически)
2. Чтение через `stateManager.getGlobalStateKey("myKey")`
3. Запись через `stateManager.setGlobalState("myKey", value)`

**Частая ошибка**: Добавить в `state-helpers.ts` return без добавления в `GLOBAL_STATE_FIELDS` — типы не совпадут.

### Состояние при отмене

Статус не обновляется при отмене задачи. Проверять:
```typescript
const wasCancelled = status === "generating" && (!isLast || lastMessage?.ask === "resume_task")
```

### Сетевые запросы

**НЕ использовать** глобальный `fetch` или дефолтный `axios`!

```typescript
import { fetch } from '@/shared/net'
import { getAxiosSettings } from '@/shared/net'
```

## Responses API (OpenAI Codex, OpenAI Native)

Требуют native tool calling. XML не работает.

Проверить:
1. Провайдер в `isNextGenModelProvider()` в `model-utils.ts`
2. Модель имеет `apiFormat: ApiFormat.OPENAI_RESPONSES`

## Changesets

При user-facing изменениях: `npm run changeset` (только patch).

Пропускать для мелких фиксов и рефакторингов.
