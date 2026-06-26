> **Русская версия:** [adding-tools.md](../ru/development/adding-tools.md)

# Adding Agent Tools

Guide to adding new tools to the Shuncode AI agent.

## Overview

Tools are actions the AI agent can perform: reading files, executing commands, editing code, searching the codebase, etc.

## Tool Structure

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
  description: "Does X when Y is needed",
  parameters: [
    {
      name: "required_param",
      required: true,
      instruction: "What this parameter is for",
      usage: "example_value"
    }
  ],
  contextRequirements: (ctx) => ctx.someCondition // optional
}

export const my_tool_variants = [generic]
```

## Step-by-Step

### Step 1: Add ID to the enum

```typescript
// src/shared/tools.ts
export enum ShuncodeDefaultTool {
  MY_TOOL = "my_tool"
}
```

### Step 2: Create the tool spec file

Create `src/core/prompts/system-prompt/tools/my_tool.ts` with the structure above.

### Step 3: Export

```typescript
// src/core/prompts/system-prompt/tools/index.ts
export * from "./my_tool"
```

### Step 4: Register variants

```typescript
// src/core/prompts/system-prompt/tools/init.ts
import { my_tool_variants } from "./my_tool"

export function registerShuncodeToolSets(): void {
  const allToolVariants = [
    ...my_tool_variants
  ]
  allToolVariants.forEach((v) => ShuncodeToolSet.register(v))
}
```

### Step 5: Add to model variant configs

```typescript
// src/core/prompts/system-prompt/variants/generic/config.ts
export const config = createVariant(ModelFamily.GENERIC)
  .tools(ShuncodeDefaultTool.MY_TOOL)
  .build()
```

### Step 6: Create the handler

```typescript
// src/core/task/tools/handlers/MyToolHandler.ts
export class MyToolHandler implements IFullyManagedTool {
  readonly name = ShuncodeDefaultTool.MY_TOOL

  getDescription(block: ToolUse): string {
    return `[${block.name} for '${block.params.input}']`
  }

  async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
    const input: string | undefined = block.params.input
    const result = await doSomething(input)
    return result
  }
}
```

Two handler types:
- **`IFullyManagedTool`** — handler manages its own UI (ask/say). Most tools use this.
- **`IToolHandler` + `IPartialBlockHandler`** — for tools that process partial blocks during streaming.

### Step 7: Register the handler

```typescript
// src/core/task/ToolExecutor.ts
this.coordinator.register(new MyToolHandler())
```

### Step 8: Add parameters to the parser

```typescript
// src/core/assistant-message/index.ts
export const toolParamNames = [
  "input",  // your new parameter
] as const
```

## Approval Flow

For tools that perform dangerous actions (delete, write, execute):

```typescript
const autoApproveResult = config.autoApprover
  ? config.autoApprover.shouldAutoApproveTool(ShuncodeDefaultTool.MY_TOOL)
  : false

if (!didAutoApprove) {
  const didApprove = await ToolResultUtils.askApprovalAndPushFeedback(
    "tool", message, config
  )
  if (!didApprove) return formatResponse.toolDenied()
}
```

## Model-Specific Variants

```typescript
const generic: ShuncodeToolSpec = {
  variant: ModelFamily.GENERIC,
  // base version
}

const nextGen: ShuncodeToolSpec = {
  ...generic,
  variant: ModelFamily.NEXT_GEN,
  description: "Extended description for capable models..."
}

export const my_tool_variants = [generic, nextGen]
```

## Existing Tools

| Tool | File | Purpose |
|------|------|---------|
| `read_file` | `read_file.ts` | Read files |
| `write_to_file` | `write_to_file.ts` | Create files |
| `replace_in_file` | `replace_in_file.ts` | Edit files |
| `execute_command` | `execute_command.ts` | Run commands |
| `delete_block` | `delete_block.ts` | Delete code blocks |
| `codebase_search` | `codebase_search.ts` | Semantic search |
| `edit_notebook` | `edit_notebook.ts` | Jupyter notebook editing |
