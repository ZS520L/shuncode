# Добавление инструментов

Руководство по добавлению новых инструментов в Shuncode AI.

## Обзор

Инструменты (tools) — это действия, которые AI агент может выполнять: чтение файлов, выполнение команд, редактирование кода и т.д.

## Структура инструмента

```typescript
// src/core/prompts/system-prompt/tools/my_tool.ts
import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"

const id = ShuncodeDefaultTool.MY_TOOL

const generic: ShuncodeToolSpec = {
  variant: ModelFamily.GENERIC,
  id,
  name: "my_tool",
  description: "Описание инструмента и когда его использовать",
  parameters: [
    {
      name: "required_param",
      required: true,
      instruction: "Инструкция по параметру",
      usage: "Пример значения"
    },
    {
      name: "optional_param",
      required: false,
      instruction: "Опциональный параметр",
      usage: "Значение (optional)"
    }
  ],
  // Опционально: условное отображение
  contextRequirements: (ctx) => ctx.someCondition
}

export const my_tool_variants = [generic]
```

## Пошаговое руководство

### Шаг 1: Добавить ID в enum

```typescript
// src/shared/tools.ts
export enum ShuncodeDefaultTool {
  // ... существующие
  MY_TOOL = "my_tool"
}
```

### Шаг 2: Создать файл спецификации

```typescript
// src/core/prompts/system-prompt/tools/my_tool.ts
import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"

const id = ShuncodeDefaultTool.MY_TOOL

const generic: ShuncodeToolSpec = {
  variant: ModelFamily.GENERIC,
  id,
  name: "my_tool",
  description: `Делает X когда нужно Y.

КОГДА ИСПОЛЬЗОВАТЬ:
- Ситуация 1
- Ситуация 2

ОГРАНИЧЕНИЯ:
- Ограничение 1`,
  parameters: [
    {
      name: "input",
      required: true,
      instruction: "Входные данные для обработки",
      usage: "example_input"
    }
  ]
}

export const my_tool_variants = [generic]
```

### Шаг 3: Экспортировать

```typescript
// src/core/prompts/system-prompt/tools/index.ts
export * from "./my_tool"
```

### Шаг 4: Зарегистрировать варианты

```typescript
// src/core/prompts/system-prompt/tools/init.ts
import { my_tool_variants } from "./my_tool"

export function registerShuncodeToolSets(): void {
  const allToolVariants = [
    // ... существующие
    ...my_tool_variants
  ]

  allToolVariants.forEach((v) => {
    ShuncodeToolSet.register(v)
  })
}
```

### Шаг 5: Добавить в конфиги вариантов

```typescript
// src/core/prompts/system-prompt/variants/generic/config.ts
export const config = createVariant(ModelFamily.GENERIC)
  // ...
  .tools(
    // ... существующие
    ShuncodeDefaultTool.MY_TOOL
  )
  .build()
```

### Шаг 6: Создать хэндлер

```typescript
// src/core/task/tools/handlers/MyToolHandler.ts
import { ShuncodeDefaultTool } from "@shared/tools"
import type { ToolUse, ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

export class MyToolHandler implements IFullyManagedTool {
  readonly name = ShuncodeDefaultTool.MY_TOOL

  getDescription(block: ToolUse): string {
    return `[${block.name} for '${block.params.input}']`
  }

  async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
    const input: string | undefined = block.params.input

    // Логика инструмента
    const result = await doSomething(input)

    return result
  }
}
```

> **Два типа хэндлеров:**
> - `IFullyManagedTool` — хэндлер сам управляет UI (ask/say). Большинство инструментов.
> - `IToolHandler` + `IPartialBlockHandler` — для инструментов, которые обрабатывают partial-блоки (streaming). Например: `PlanModeRespondHandler`, `AttemptCompletionHandler`.

### Шаг 7: Зарегистрировать хэндлер

```typescript
// src/core/task/ToolExecutor.ts — метод registerToolHandlers()
import { MyToolHandler } from "./tools/handlers/MyToolHandler"

// В registerToolHandlers():
    this.coordinator.register(new MyToolHandler())
```

### Шаг 8: Добавить параметры в парсер

Если у инструмента новые параметры:

```typescript
// src/core/assistant-message/index.ts
export const toolParamNames = [
  // ... существующие
  "input",  // ваш новый параметр
] as const
```

## Продвинутые возможности

### Условные инструменты

Показывать инструмент только при определённых условиях:

```typescript
const tool: ShuncodeToolSpec = {
  // ...
  contextRequirements: (context) => {
    // Только если lightweightMode включён (упрощённые инструменты)
    return context.useSimplifiedEditTools === true
  }
}
```

> **Важно:** Не использовать `vscode.workspace.getConfiguration()` внутри `contextRequirements` — вызовет "vscode is not defined". Все условия читаются из `SystemPromptContext`.

### Варианты для разных моделей

```typescript
const generic: ShuncodeToolSpec = {
  variant: ModelFamily.GENERIC,
  // ... базовая версия
}

const nextGen: ShuncodeToolSpec = {
  ...generic,
  variant: ModelFamily.NEXT_GEN,
  // Можно переопределить description или parameters
  description: "Расширенное описание для умных моделей..."
}

export const my_tool_variants = [generic, nextGen]
```

### Зависимости параметров

```typescript
{
  name: "conditional_param",
  required: false,
  instruction: "Только если доступен TODO инструмент",
  usage: "value (optional)",
  dependencies: [ShuncodeDefaultTool.TODO]
}
```

## Approval Flow (разрешения)

Если инструмент выполняет опасное действие (удаление, запись, выполнение), нужно добавить approval:

```typescript
// В execute() хэндлера:
const autoApproveResult = config.autoApprover
  ? config.autoApprover.shouldAutoApproveTool(ShuncodeDefaultTool.MY_TOOL)
  : false
const didAutoApprove = autoApproveResult === true
  || (Array.isArray(autoApproveResult) && autoApproveResult[0])

if (didAutoApprove) {
  // Auto-approved: показать как info
  await config.callbacks.say("tool", message)
} else {
  // Спросить пользователя
  showNotificationForApproval("Shuncode wants to ...", config.autoApprovalSettings.enableNotifications)
  const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("tool", message, config)
  if (!didApprove) {
    return formatResponse.toolDenied()
  }
}
```

**Типы возврата `shouldAutoApproveTool()`:**
- `boolean` — для простых действий (deleteFiles, editNotebooks, useBrowser, useMcp)
- `[boolean, boolean]` — для действий с local/external разделением (readFiles, editFiles, BASH)
  - `[0]` = local/safe, `[1]` = external/all

**Добавление новой настройки approval:**
1. `src/shared/AutoApprovalSettings.ts` — добавить поле в `actions`
2. `src/core/task/tools/autoApprove.ts` — добавить case в `shouldAutoApproveTool()`
3. `webview-ui/src/components/chat/auto-approve-menu/constants.ts` — добавить в `ACTION_METADATA`
4. `webview-ui/src/i18n/locales/en.json` + `ru.json` — ключи для лейблов

## Лучшие практики

### Именование
- snake_case для ID и имён файлов
- Глагол в начале: `read_file`, `execute_command`, `delete_block`

### Описания
- Чётко указывать КОГДА использовать
- Указывать ограничения
- Примеры использования

### Параметры
- Понятные инструкции
- Примеры в `usage`
- Правильно помечать required/optional

### Тестирование
1. Unit тесты для спецификации
2. Проверка во всех вариантах моделей
3. Проверка хэндлера с разными входными данными

## Примеры существующих инструментов

| Инструмент | Файл | Назначение |
|------------|------|------------|
| `read_file` | `read_file.ts` | Чтение файлов |
| `write_to_file` | `write_to_file.ts` | Создание файлов |
| `replace_in_file` | `replace_in_file.ts` | Редактирование файлов |
| `execute_command` | `execute_command.ts` | Выполнение команд |
| `delete_block` | `delete_block.ts` | Удаление блоков кода |
| `replace_text` | `replace_text.ts` | Замена текста |
| `codebase_search` | `codebase_search.ts` | Семантический поиск |
| `edit_notebook` | `edit_notebook.ts` | Jupyter notebook editing |

## См. также

- [../architecture/PROMPTS.md](../architecture/PROMPTS.md) — Система промптов
- [GENERAL.md](./GENERAL.md) — Общие правила разработки
