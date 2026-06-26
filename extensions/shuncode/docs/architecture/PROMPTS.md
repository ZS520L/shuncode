# Система промптов

Модульная система для построения системных промптов AI ассистента.

## Структура

```
src/core/prompts/system-prompt/
├── spec.ts                  # Интерфейс ShuncodeToolSpec
├── types.ts                 # Общие типы
├── index.ts                 # Barrel export
├── registry/
│   ├── ShuncodeToolSet.ts       # Управление инструментами
│   ├── PromptRegistry.ts    # Реестр промптов (singleton)
│   └── PromptBuilder.ts     # Сборка финального промпта
├── components/              # Переиспользуемые секции
│   ├── agent_role.ts        # Роль агента
│   ├── rules.ts             # Правила поведения
│   ├── capabilities.ts      # Возможности
│   ├── tool_use/            # Инструкции по инструментам (директория)
│   │   ├── index.ts
│   │   ├── tools.ts
│   │   ├── formatting.ts
│   │   ├── guidelines.ts
│   │   └── examples.ts
│   └── ...                  # system_info, skills, mcp, feedback и др.
├── templates/               # Шаблоны с плейсхолдерами
│   ├── TemplateEngine.ts    # Движок {{PLACEHOLDER}}
│   └── placeholders.ts      # Стандартные плейсхолдеры
├── tools/                   # Определения инструментов
│   ├── init.ts              # Регистрация инструментов
│   ├── index.ts             # Barrel export
│   └── [tool_name].ts       # Файлы инструментов (read_file, write_to_file, ...)
└── variants/                # Варианты для разных моделей/семейств
    ├── variant-builder.ts   # Билдер конфигурации варианта
    ├── generic/             # Дефолтный fallback
    ├── next-gen/            # Продвинутые модели (Claude 4, ...)
    ├── native-next-gen/     # С native tool calling
    ├── gpt-5/               # GPT-5
    ├── native-gpt-5/        # GPT-5 native tools
    ├── native-gpt-5-1/      # GPT-5.1 native tools
    ├── gemini-3/            # Gemini 3
    ├── devstral/            # Devstral
    ├── glm/                 # GLM
    ├── hermes/              # Hermes
    └── xs/                  # Маленькие модели (Qwen, ...)
```

## Ключевые концепции

### 1. PromptRegistry (Singleton)

Центральный менеджер всех вариантов промптов:

```typescript
const registry = PromptRegistry.getInstance()
await registry.load()

// Получить промпт для модели
const prompt = await registry.get(context)
```

### 2. PromptVariant

Конфигурация варианта промпта:

```typescript
interface PromptVariant {
  id: string                     // "next-gen", "generic", "xs"
  family: ModelFamily            // Семейство модели
  version: number
  tags: string[]                 // ["production", "beta"]

  baseTemplate: string           // Шаблон с {{PLACEHOLDER}}
  componentOrder: Section[]      // Порядок секций
  componentOverrides: {...}      // Кастомизация секций

  tools?: ShuncodeDefaultTool[]     // Список инструментов
  toolOverrides?: {...}          // Кастомизация инструментов
}
```

### 3. Компоненты

Функции генерирующие секции промпта:

```typescript
type ComponentFunction = (
  variant: PromptVariant,
  context: SystemPromptContext
) => Promise<string | undefined>

// Пример
export async function getRules(variant, context): Promise<string> {
  const template = variant.componentOverrides?.RULES?.template || defaultTemplate
  return new TemplateEngine().resolve(template, placeholders)
}
```

### 4. Шаблоны

Используют синтаксис `{{PLACEHOLDER}}`:

```markdown
You are Shuncode AI, a skilled software engineer...

====

{{TOOL_USE_SECTION}}

====

{{RULES_SECTION}}

====

{{SYSTEM_INFO_SECTION}}
```

### 5. Инструменты (Tools)

Каждый инструмент определяется через `ShuncodeToolSpec`:

```typescript
const generic: ShuncodeToolSpec = {
  variant: ModelFamily.GENERIC,
  id: ShuncodeDefaultTool.FILE_READ,
  name: "read_file",
  description: "Read file contents...",
  parameters: [
    {
      name: "path",
      required: true,
      instruction: "File path relative to {{CWD}}",
      usage: "src/index.ts"
    }
  ],
  // Условное отображение
  contextRequirements: (ctx) => ctx.someCondition
}

export const read_file_variants = [generic]
```

## Добавление нового инструмента

1. **Добавить в enum** (`src/shared/tools.ts`):
   ```typescript
   export enum ShuncodeDefaultTool {
     MY_TOOL = "my_tool"
   }
   ```

2. **Создать файл спецификации** (`src/core/prompts/system-prompt/tools/my_tool.ts`):
   ```typescript
   import { ModelFamily } from "@/shared/prompts"
   import { ShuncodeDefaultTool } from "@/shared/tools"
   import type { ShuncodeToolSpec } from "../spec"

   const id = ShuncodeDefaultTool.MY_TOOL

   const generic: ShuncodeToolSpec = {
     variant: ModelFamily.GENERIC,
     id,
     name: "my_tool",
     description: "Description...",
     parameters: [...]
   }

   export const my_tool_variants = [generic]
   ```

3. **Экспортировать** (`tools/index.ts`):
   ```typescript
   export * from "./my_tool"
   ```

4. **Зарегистрировать** (`tools/init.ts`):
   ```typescript
   import { my_tool_variants } from "./my_tool"

   const allToolVariants = [
     ...my_tool_variants,
     // ...
   ]
   ```

5. **Добавить в варианты** (`variants/generic/config.ts`):
   ```typescript
   .tools(
     ShuncodeDefaultTool.MY_TOOL,
     // ...
   )
   ```

6. **Создать хэндлер** (`src/core/task/tools/handlers/MyToolHandler.ts`)

7. **Зарегистрировать хэндлер** (`ToolExecutor.ts`)

## Семейства моделей

| Семейство | Модели | Особенности |
|-----------|--------|-------------|
| `GENERIC` | Все остальные | Дефолтный fallback |
| `NEXT_GEN` | Claude 4 и другие продвинутые | Продвинутые возможности |
| `NATIVE_NEXT_GEN` | Claude 4 с native tools | Native tool calling |
| `GPT_5` | GPT-5 | XML tool calling |
| `NATIVE_GPT_5` | GPT-5 | Native tool calling |
| `NATIVE_GPT_5_1` | GPT-5.1 | Native tool calling |
| `CLAUDE` | Claude 3.5/3 | Стандартный Claude |
| `GPT` | GPT-4o и др. | Стандартный GPT |
| `GEMINI` | Gemini 2.x | Стандартный Gemini |
| `GEMINI_3` | Gemini 3 | Native tool calling |
| `QWEN` | Qwen | — |
| `GLM` | GLM | — |
| `HERMES` | Hermes | — |
| `DEVSTRAL` | Devstral | — |
| `XS` | Маленькие модели | Компактный промпт |

## Условные инструменты

Инструменты могут показываться/скрываться через `contextRequirements`:

```typescript
const tool: ShuncodeToolSpec = {
  // ...
  contextRequirements: (context) => {
    // Показывать только если lightweightMode включён
    return context.useSimplifiedEditTools === true
  }
}
```

> **Важно:** Не использовать `vscode.workspace.getConfiguration()` в `contextRequirements` — это вызывает "vscode is not defined" при загрузке промптов. Все условия должны читаться из `SystemPromptContext`.

## Lightweight Mode

Настройка `lightweightMode` (галочка в провайдер-настройках) форсирует XS вариант промпта для любой модели:

- `PromptRegistry.getModelFamily()` возвращает `ModelFamily.XS` если `context.lightweightMode === true`
- `useSimplifiedEditTools` автоматически привязан к `lightweightMode` (не отдельная настройка)
- XS вариант: компактный промпт, 14 инструментов (вместо 20), упрощённые инструкции
- Сбрасывается при смене модели в `ModelPickerModal`

## См. также

- [../development/TOOLS.md](../development/TOOLS.md) — Подробное руководство
- [OVERVIEW.md](./OVERVIEW.md) — Общая архитектура
