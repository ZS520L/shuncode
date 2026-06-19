# IMPL-17 — Multi-Agent System (мультиагентная система с динамическими воркерами)

> Главная модель сама решает когда нужно разбить задачу на подзадачи, спавнит N воркеров-аналитиков, ждёт результатов, синтезирует ответ.

**Статус:** 📋 Планирование
**Приоритет:** Средний
**Оценка:** 18-25 рабочих дней
**Зависимости:** Нет (IMPL-14 опционально для workflow-интеграции)

---

## 1. Цель

Добавить **мультиагентную систему**, в которой главная модель (оркестратор) может:

- Проанализировать задачу и решить — нужна ли декомпозиция
- Создать N воркеров (1–4) через tool call `spawn_workers`
- Дождаться ответов от всех воркеров
- Синтезировать финальный результат на основе их ответов

### Ключевые принципы

1. **Воркеры = аналитики.** Воркеры **НЕ** редактируют файлы, не запускают терминал, не вызывают инструменты. Они получают контекст (файлы, описание задачи) и возвращают **сжатый аналитический ответ**. Все действия выполняет только оркестратор.

2. **Модель решает сама.** Не три фиксированных агента, не YAML-конфигурация. Оркестратор получает tool `spawn_workers` и сам решает: нужны ли воркеры, сколько, с каким контекстом.

3. **Два слота моделей.** Оркестратор = текущая модель пользователя (plan/act). Воркер = отдельная настраиваемая модель (дешевле). Если воркер не настроен — используется та же модель что и оркестратор.

4. **Пользовательский контроль.** Перед спавном воркеров — подтверждение от пользователя. Прозрачность: видно сколько воркеров, что делают, сколько стоит.

### Зачем

- **Скорость:** параллельный анализ N файлов/модулей вместо последовательного
- **Качество:** каждый воркер фокусируется на своей подзадаче, не теряет контекст
- **Экономия:** воркеры на дешёвой модели, оркестратор на дорогой только для синтеза и принятия решений
- **Масштабируемость:** "проанализируй 5 модулей на баги" → 5 параллельных воркеров вместо одного последовательного прохода

### Результат

- Новый tool `spawn_workers` в системном промпте оркестратора
- Настройка Worker модели в Settings
- UI: подтверждение спавна + прогресс воркеров
- Auto-routing condense/summarize на Worker модель (бонус)

---

## 2. Как это работает (User Story)

### 2.1. Настройка

1. Пользователь открывает Settings → **Multi-Agent** (новая секция)
2. Включает toggle `Enable Multi-Agent Mode`
3. Настраивает Worker модель:

```
┌─────────────────────────────────────────────────────┐
│  Multi-Agent                                        │
│                                                     │
│  ☑ Enable Multi-Agent Mode                          │
│                                                     │
│  Orchestrator: (your current model)                 │
│  ┌─────────────────────────────────────────────┐    │
│  │ OpenAI / gpt-4.1            [configured ✓]  │    │
│  └─────────────────────────────────────────────┘    │
│  ℹ Uses your current Act Mode model                 │
│                                                     │
│  Worker Model (for sub-agents):                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ OpenAI / gpt-4.1-mini                       │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  Max Workers: [4 ▾]                                 │
│  ☑ Ask before spawning workers                      │
│  ☑ Auto-route condense/summarize to Worker model    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

4. Оркестратор = текущая модель пользователя (plan/act mode), не дублируется
5. Worker = отдельный выбор провайдера + модели
6. Если Worker не настроен — `spawn_workers` использует ту же модель что и оркестратор

### 2.2. Использование — простой сценарий

Пользователь пишет: *"Проанализируй модули auth, billing и notifications на предмет утечек памяти"*

**Без мультиагентности:** модель последовательно читает каждый модуль, теряет контекст, долго.

**С мультиагентностью:**

```
1. Оркестратор получает задачу
2. Оркестратор решает: задача декомпозируема, нужно 3 воркера
3. Оркестратор вызывает spawn_workers:

   spawn_workers({
     workers: [
       {
         task: "Проанализируй модуль auth на утечки памяти",
         context_files: ["src/auth/**/*.ts"],
         max_tokens: 2000
       },
       {
         task: "Проанализируй модуль billing на утечки памяти",
         context_files: ["src/billing/**/*.ts"],
         max_tokens: 2000
       },
       {
         task: "Проанализируй модуль notifications на утечки памяти",
         context_files: ["src/notifications/**/*.ts"],
         max_tokens: 2000
       }
     ]
   })

4. UI показывает: "Агент хочет запустить 3 воркера. [Allow] [Deny]"
5. Пользователь нажимает Allow
6. 3 воркера запускаются параллельно
7. UI показывает прогресс: "Workers: 1/3 done... 2/3 done... 3/3 done"
8. Оркестратор получает 3 сжатых ответа
9. Оркестратор синтезирует итоговый ответ + предлагает фиксы
```

### 2.3. Использование — модель решает НЕ спавнить

Пользователь пишет: *"Добавь комментарий к функции calculateTotal"*

Оркестратор: задача тривиальная, декомпозиция не нужна. Просто выполняет сам. `spawn_workers` не вызывается.

### 2.4. Что видит пользователь в чате

```
┌──────────────────────────────────────────────────┐
│  You: Проанализируй auth, billing, notifications │
│       на утечки памяти                           │
├──────────────────────────────────────────────────┤
│  Assistant:                                      │
│  Задача требует анализа трёх независимых модулей.│
│  Запускаю параллельный анализ.                   │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  🔄 Sub-agents (3)              [Allowed]  │  │
│  │                                            │  │
│  │  ✅ auth analysis      — 1,247 tokens      │  │
│  │  ✅ billing analysis   — 1,891 tokens      │  │
│  │  🔄 notifications...   — running           │  │
│  │                                            │  │
│  │  Model: gpt-4.1-mini                       │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  [после завершения всех воркеров]                │
│                                                  │
│  На основании анализа трёх модулей:              │
│  1. auth — обнаружена утечка в SessionManager... │
│  2. billing — чисто, проблем нет                 │
│  3. notifications — EventEmitter не очищает...   │
│                                                  │
│  Предлагаю следующие исправления:                │
│  ...                                             │
└──────────────────────────────────────────────────┘
```

---

## 3. Архитектура

### 3.1. Общая схема

```
User Query
    ↓
Orchestrator (current plan/act model)
    ↓
[Analyzes task]
    ↓
Decision: needs sub-agents?
    ├── NO → execute normally (as today)
    └── YES → spawn_workers tool call
                ↓
         ┌──────────────────┐
         │  User Approval   │
         │  [Allow] [Deny]  │
         └──────────────────┘
                ↓ (allowed)
         ┌──────┬──────┬──────┐
         │ W1   │ W2   │ W3   │  ← parallel, Worker model
         │ READ │ READ │ READ │  ← read-only, no tools
         │ ONLY │ ONLY │ ONLY │
         └──┬───┴──┬───┴──┬───┘
            │      │      │
            ↓      ↓      ↓
         [compressed responses]
                ↓
         Orchestrator receives results
                ↓
         Synthesizes final answer
                ↓
         Executes actions (write files, run commands, etc.)
```

### 3.2. Модели: два слота

| Слот | Роль | Источник настроек |
|------|------|-------------------|
| **Orchestrator** | Основная модель. Принимает решения, вызывает инструменты, пишет файлы. | Текущие `actMode*` / `planMode*` настройки (без изменений) |
| **Worker** | Аналитик. Read-only, без инструментов. Получает контекст, возвращает текстовый ответ. | Новые `workerSlot*` настройки |

Orchestrator = текущая модель пользователя. Нет нового слота, нет дублирования. Worker — единственный новый слот.

### 3.3. Ограничения Worker модели

Worker **НЕ имеет** доступа к:
- `write_to_file` / `apply_diff`
- `execute_command`
- `browser_action`
- `spawn_workers` (нет рекурсивного спавна)
- Любым другим tool'ам

Worker **имеет** доступ к:
- Контекст файлов, переданных оркестратором (через содержимое в промпте)
- Системный промпт с инструкциями по формату ответа

Worker получает:
1. Компактный системный промпт: "Ты аналитик. Прочитай контекст, ответь на вопрос. Формат: сжатый, структурированный ответ."
2. Контекст файлов (содержимое файлов, встроенное в промпт оркестратором)
3. Описание подзадачи от оркестратора

Worker возвращает:
- Текстовый ответ (ограничен по `max_tokens`)

### 3.4. Почему воркеры без tool'ов

1. **Нет конфликтов** — два воркера не могут отредактировать один файл
2. **Простота** — не нужна изоляция, sandbox, мёрж результатов
3. **Предсказуемость** — воркер не может сломать проект
4. **Безопасность** — воркер не может запустить произвольную команду
5. **Дешевизна** — без tool calling, чистый text completion, меньше токенов

---

## 4. Tool: `spawn_workers`

### 4.1. Определение инструмента

```typescript
export const spawnWorkersTool: ToolDefinition = {
  name: "spawn_workers",
  description: `Launch parallel analytical sub-agents to process independent sub-tasks.
Each worker receives context and a task description, analyzes it, and returns a compressed response.
Workers are READ-ONLY — they cannot edit files, run commands, or use tools.

USE WHEN:
- Task is naturally decomposable into independent analytical sub-tasks
- Multiple files/modules need independent analysis
- Gathering information from several unrelated sources
- Comparative analysis of multiple components

DO NOT USE WHEN:
- Task is simple and does not benefit from parallelism
- Sub-tasks are dependent on each other (result of one needed for another)
- Task requires immediate file editing without prior analysis
- There is only one thing to analyze`,

  parameters: {
    type: "object",
    required: ["workers"],
    properties: {
      workers: {
        type: "array",
        description: "Array of worker sub-tasks (1-4 workers)",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          required: ["task"],
          properties: {
            task: {
              type: "string",
              description: "Clear, specific task description for the worker. Include what to analyze and what to return.",
            },
            context_files: {
              type: "array",
              description: "File paths or glob patterns to include as context. Contents will be read and passed to the worker.",
              items: { type: "string" },
            },
            context_text: {
              type: "string",
              description: "Additional text context to pass to the worker (code snippets, data, instructions).",
            },
            max_response_tokens: {
              type: "number",
              description: "Maximum tokens for worker's response. Default: 2000. Range: 500-4000.",
              default: 2000,
            },
          },
        },
      },
    },
  },
}
```

### 4.2. Пример вызова оркестратором

```xml
<tool_call>
<spawn_workers>
{
  "workers": [
    {
      "task": "Проанализируй модуль аутентификации. Найди: 1) потенциальные утечки памяти 2) незакрытые подписки 3) неочищенные таймеры. Верни список проблем с указанием файла и строки.",
      "context_files": ["src/auth/SessionManager.ts", "src/auth/TokenRefresher.ts", "src/auth/AuthProvider.ts"]
    },
    {
      "task": "Проанализируй модуль биллинга. Найди: 1) потенциальные утечки памяти 2) незакрытые подписки 3) неочищенные таймеры. Верни список проблем с указанием файла и строки.",
      "context_files": ["src/billing/**/*.ts"]
    }
  ]
}
</spawn_workers>
</tool_call>
```

### 4.3. Формат результата (что получает оркестратор)

```xml
<tool_result>
<spawn_workers_result>
<worker index="0" status="completed" tokens_used="1247">
## Auth Module Analysis

### Проблемы найдены: 2

1. **SessionManager.ts:45** — EventListener на `window.storage` не удаляется в `dispose()`. При каждом создании SessionManager добавляется новый listener.

2. **TokenRefresher.ts:78** — `setInterval` в `startAutoRefresh()` не очищается если `stopAutoRefresh()` не вызван до destroy.

### Рекомендации
- Добавить `removeEventListener` в `SessionManager.dispose()`
- Сохранить intervalId и очищать в деструкторе
</worker>

<worker index="1" status="completed" tokens_used="891">
## Billing Module Analysis

### Проблемы найдены: 0

Модуль чист. Все подписки корректно очищаются в `dispose()`. Таймеры отсутствуют. EventEmitter использует `once()` где возможно.
</worker>
</spawn_workers_result>
</tool_result>
```

---

## 5. Модель данных

### 5.1. Новые типы (`src/shared/multi-agent.ts` — новый файл)

```typescript
/**
 * Описание подзадачи для воркера. Формируется оркестратором через tool call.
 */
export interface WorkerTask {
  task: string
  contextFiles?: string[]
  contextText?: string
  maxResponseTokens?: number
}

/**
 * Результат выполнения одного воркера.
 */
export interface WorkerResult {
  index: number
  status: "completed" | "error" | "cancelled"
  response?: string
  tokensUsed?: number
  error?: string
  durationMs?: number
}

/**
 * Состояние группы воркеров (для UI).
 */
export interface WorkerGroupState {
  id: string
  workers: WorkerTaskState[]
  status: "pending_approval" | "running" | "completed" | "denied"
  totalTokensUsed: number
}

/**
 * Состояние одного воркера (для UI).
 */
export interface WorkerTaskState {
  index: number
  task: string
  status: "queued" | "running" | "completed" | "error"
  tokensUsed?: number
  durationMs?: number
}

/**
 * Настройки мультиагентной системы.
 */
export interface MultiAgentSettings {
  enabled: boolean
  maxWorkers: number
  askBeforeSpawning: boolean
  autoRouteCondenseToWorker: boolean
}

export const DEFAULT_MULTI_AGENT_SETTINGS: MultiAgentSettings = {
  enabled: false,
  maxWorkers: 4,
  askBeforeSpawning: true,
  autoRouteCondenseToWorker: false,
}
```

### 5.2. Новые настройки (`src/shared/storage/state-keys.ts`)

Добавить в `GLOBAL_STATE_FIELDS`:

```typescript
  // Multi-Agent
  multiAgentEnabled: { default: false as boolean },
  multiAgentSettings: { default: DEFAULT_MULTI_AGENT_SETTINGS as MultiAgentSettings },
```

Добавить в `API_HANDLER_SETTINGS_FIELDS`:

```typescript
  // Worker slot
  workerSlotApiProvider: { default: undefined as ApiProvider | undefined },
  workerSlotApiModelId: { default: undefined as string | undefined },
  workerSlotThinkingBudgetTokens: { default: undefined as number | undefined },
  workerSlotReasoningEffort: { default: undefined as string | undefined },
  workerSlotOpenRouterModelId: { default: undefined as string | undefined },
  workerSlotOpenRouterModelInfo: { default: undefined as ModelInfo | undefined },
  workerSlotOpenAiModelId: { default: undefined as string | undefined },
  workerSlotOpenAiModelInfo: { default: undefined as OpenAiCompatibleModelInfo | undefined },
  workerSlotOllamaModelId: { default: undefined as string | undefined },
  workerSlotLmStudioModelId: { default: undefined as string | undefined },
```

### 5.3. Protobuf (`proto/shuncode/state.proto`)

```protobuf
message MultiAgentSettings {
  bool enabled = 1;
  int32 max_workers = 2;
  bool ask_before_spawning = 3;
  bool auto_route_condense_to_worker = 4;
}

message WorkerSlotConfig {
  string provider = 1;
  string model_id = 2;
  int32 thinking_budget_tokens = 3;
  string reasoning_effort = 4;
}
```

---

## 6. Worker Agent (`src/core/multi-agent/WorkerAgent.ts` — новый файл)

### 6.1. Системный промпт воркера

```typescript
const WORKER_SYSTEM_PROMPT = `You are an analytical sub-agent. Your role is to analyze the provided context and answer the task precisely.

Rules:
- You are READ-ONLY. You cannot edit files, run commands, or use any tools.
- Respond with a structured, compressed analysis.
- Focus only on what was asked. Do not suggest unrelated improvements.
- Use specific file paths and line numbers when referencing code.
- Keep your response concise. Aim for clarity over verbosity.
- Use markdown formatting for structure (headers, lists, code blocks).
- If you cannot answer with the provided context, state what is missing.

Response format:
1. Brief summary (1-2 sentences)
2. Findings (numbered list with file:line references)
3. Recommendations (if asked)
`
```

### 6.2. Класс WorkerAgent

```typescript
import { ApiHandler } from "@core/api"
import { WorkerTask, WorkerResult } from "@shared/multi-agent"

export class WorkerAgent {
  constructor(
    private apiHandler: ApiHandler,
    private task: WorkerTask,
    private index: number,
    private onProgress?: (state: WorkerTaskState) => void,
  ) {}

  /**
   * Выполняет задачу воркера. Собирает контекст, отправляет запрос, возвращает результат.
   */
  async execute(fileContents: Map<string, string>): Promise<WorkerResult> {
    const startTime = Date.now()

    try {
      this.onProgress?.({ index: this.index, task: this.task.task, status: "running" })

      // Собираем контекст в текст
      const contextBlock = this.buildContextBlock(fileContents)

      // Формируем сообщения
      const messages: Array<{ role: string; content: string }> = [
        { role: "system", content: WORKER_SYSTEM_PROMPT },
        { role: "user", content: `${contextBlock}\n\n## Task\n\n${this.task.task}` },
      ]

      // Вызываем API (без tool calling, чистый text completion)
      let response = ""
      let tokensUsed = 0

      const stream = this.apiHandler.createMessage(
        WORKER_SYSTEM_PROMPT,
        [{ role: "user", content: [{ type: "text", text: `${contextBlock}\n\n## Task\n\n${this.task.task}` }] }],
      )

      for await (const chunk of stream) {
        if (chunk.type === "text") {
          response += chunk.text
        }
        if (chunk.type === "usage") {
          tokensUsed = (chunk.inputTokens ?? 0) + (chunk.outputTokens ?? 0)
        }
      }

      const duration = Date.now() - startTime
      this.onProgress?.({
        index: this.index,
        task: this.task.task,
        status: "completed",
        tokensUsed,
        durationMs: duration,
      })

      return {
        index: this.index,
        status: "completed",
        response: this.truncateResponse(response),
        tokensUsed,
        durationMs: duration,
      }
    } catch (error) {
      const duration = Date.now() - startTime
      this.onProgress?.({
        index: this.index,
        task: this.task.task,
        status: "error",
      })

      return {
        index: this.index,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        durationMs: duration,
      }
    }
  }

  private buildContextBlock(fileContents: Map<string, string>): string {
    if (fileContents.size === 0 && !this.task.contextText) {
      return ""
    }

    let block = "## Context\n\n"

    for (const [path, content] of fileContents) {
      block += `### ${path}\n\`\`\`\n${content}\n\`\`\`\n\n`
    }

    if (this.task.contextText) {
      block += `### Additional Context\n${this.task.contextText}\n\n`
    }

    return block
  }

  private truncateResponse(response: string): string {
    const maxChars = (this.task.maxResponseTokens ?? 2000) * 4
    if (response.length > maxChars) {
      return response.substring(0, maxChars) + "\n\n[Response truncated]"
    }
    return response
  }
}
```

### 6.3. WorkerOrchestrator — управление группой воркеров

```typescript
import { WorkerAgent } from "./WorkerAgent"
import { WorkerTask, WorkerResult, WorkerGroupState } from "@shared/multi-agent"
import { ApiHandler } from "@core/api"

export class WorkerOrchestrator {
  constructor(
    private workerApiHandler: ApiHandler,
    private onGroupProgress?: (state: WorkerGroupState) => void,
  ) {}

  /**
   * Запускает группу воркеров параллельно и ждёт результатов.
   */
  async executeAll(
    tasks: WorkerTask[],
    fileReader: (paths: string[]) => Promise<Map<string, string>>,
  ): Promise<WorkerResult[]> {
    const groupId = Date.now().toString(36)

    // Собираем контексты файлов для всех воркеров
    const allFilePaths = tasks.flatMap(t => t.contextFiles ?? [])
    const allFileContents = await fileReader(allFilePaths)

    // Создаём воркеров
    const workers = tasks.map((task, index) => {
      // Фильтруем файлы для конкретного воркера
      const workerFiles = new Map<string, string>()
      for (const pattern of task.contextFiles ?? []) {
        for (const [path, content] of allFileContents) {
          if (this.matchesPattern(path, pattern)) {
            workerFiles.set(path, content)
          }
        }
      }

      return new WorkerAgent(
        this.workerApiHandler,
        task,
        index,
        (state) => this.emitProgress(groupId, tasks, state),
      )
    })

    // Запускаем параллельно
    const results = await Promise.all(
      workers.map((worker, index) => {
        const workerFiles = this.getFilesForWorker(tasks[index], allFileContents)
        return worker.execute(workerFiles)
      })
    )

    return results
  }

  private getFilesForWorker(
    task: WorkerTask,
    allFiles: Map<string, string>,
  ): Map<string, string> {
    const workerFiles = new Map<string, string>()
    for (const pattern of task.contextFiles ?? []) {
      for (const [path, content] of allFiles) {
        if (this.matchesPattern(path, pattern)) {
          workerFiles.set(path, content)
        }
      }
    }
    return workerFiles
  }

  private matchesPattern(path: string, pattern: string): boolean {
    if (pattern.includes("*")) {
      // Glob matching — используем micromatch или простой regex
      const regex = new RegExp(
        "^" + pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$"
      )
      return regex.test(path)
    }
    return path === pattern || path.endsWith(pattern)
  }

  private emitProgress(
    groupId: string,
    tasks: WorkerTask[],
    workerState: any,
  ): void {
    // Emit progress to UI via onGroupProgress callback
  }
}
```

---

## 7. Обработка `spawn_workers` в Task

### 7.1. Регистрация tool'а

В `getAvailableTools()` (или эквивалент) — добавить `spawn_workers` **только если**:

```typescript
function shouldIncludeSpawnWorkers(config: ApiConfiguration, settings: MultiAgentSettings): boolean {
  if (!settings.enabled) return false

  // Только для достаточно умных моделей
  const model = getCurrentModelInfo()
  if (model && isWeakModel(model)) return false

  return true
}

/**
 * Слабые модели не получают spawn_workers — они будут злоупотреблять.
 * Список минимальных моделей, которым доступен мультиагентный режим.
 */
function isWeakModel(model: ModelInfo): boolean {
  const weakPatterns = [
    "mini", "nano", "micro", "haiku", "flash-lite",
    "gpt-3.5", "gpt-4o-mini",
  ]
  const modelId = model.id.toLowerCase()
  return weakPatterns.some(p => modelId.includes(p))
}
```

### 7.2. Обработка tool call в Task

В `presentAssistantMessage()` или `handleToolUse()`, при получении `spawn_workers`:

```typescript
case "spawn_workers": {
  const params = JSON.parse(toolInput) as { workers: WorkerTask[] }
  const settings = this.stateManager.getGlobalSettingsKey("multiAgentSettings")

  // Проверяем лимит
  if (params.workers.length > settings.maxWorkers) {
    return toolError(`Maximum ${settings.maxWorkers} workers allowed, got ${params.workers.length}`)
  }

  // Запрашиваем подтверждение у пользователя (если включено)
  if (settings.askBeforeSpawning) {
    const approved = await this.askUserApproval("spawn_workers", {
      workerCount: params.workers.length,
      tasks: params.workers.map(w => w.task),
      model: this.getWorkerModelName(),
    })
    if (!approved) {
      return toolResult("User denied worker spawning. Proceed without sub-agents.")
    }
  }

  // Создаём handler для Worker модели
  const workerHandler = this.getWorkerApiHandler()

  // Создаём оркестратор
  const orchestrator = new WorkerOrchestrator(
    workerHandler,
    (state) => this.emitWorkerProgress(state),
  )

  // Запускаем воркеров
  const results = await orchestrator.executeAll(
    params.workers,
    (paths) => this.readFilesForWorkers(paths),
  )

  // Форматируем результат для оркестратора
  return toolResult(this.formatWorkerResults(results))
}
```

### 7.3. Worker API Handler

```typescript
class Task {
  private _workerApiHandler?: ApiHandler

  getWorkerApiHandler(): ApiHandler {
    if (this._workerApiHandler) return this._workerApiHandler

    const config = this.stateManager.getApiConfiguration()
    const workerProvider = config.workerSlotApiProvider

    if (!workerProvider) {
      // Worker не настроен — используем текущую модель
      this._workerApiHandler = this.api
      return this._workerApiHandler
    }

    // Создаём handler для Worker слота
    this._workerApiHandler = buildApiHandlerForWorkerSlot(config)
    return this._workerApiHandler
  }

  invalidateWorkerHandler(): void {
    this._workerApiHandler = undefined
  }
}
```

### 7.4. Чтение файлов для воркеров

```typescript
private async readFilesForWorkers(paths: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()

  for (const pathOrGlob of paths) {
    if (pathOrGlob.includes("*")) {
      // Glob — resolve через workspace
      const files = await this.globFiles(pathOrGlob)
      for (const file of files) {
        const content = await this.readFileContent(file)
        if (content) result.set(file, content)
      }
    } else {
      const content = await this.readFileContent(pathOrGlob)
      if (content) result.set(pathOrGlob, content)
    }
  }

  // Ограничение: максимум ~100K символов на воркера (≈25K токенов)
  // Если контекст слишком большой — обрезаем с предупреждением
  return this.truncateContextIfNeeded(result)
}
```

---

## 8. Изменения в `buildApiHandler` (`src/core/api/index.ts`)

### Новая функция: `buildApiHandlerForWorkerSlot`

```typescript
/**
 * Создаёт ApiHandler для Worker слота.
 * Если workerSlotApiProvider не задан — fallback на текущую actMode модель.
 */
export function buildApiHandlerForWorkerSlot(
  configuration: ApiConfiguration,
): ApiHandler {
  const provider = configuration.workerSlotApiProvider

  if (!provider) {
    return buildApiHandler(configuration, "act")
  }

  const slotConfig: ApiConfiguration = {
    ...configuration,
    actModeApiProvider: provider,
    actModeApiModelId: configuration.workerSlotApiModelId,
    actModeThinkingBudgetTokens: configuration.workerSlotThinkingBudgetTokens,
    actModeReasoningEffort: configuration.workerSlotReasoningEffort,
    actModeOpenRouterModelId: configuration.workerSlotOpenRouterModelId,
    actModeOpenRouterModelInfo: configuration.workerSlotOpenRouterModelInfo,
    actModeOpenAiModelId: configuration.workerSlotOpenAiModelId,
    actModeOpenAiModelInfo: configuration.workerSlotOpenAiModelInfo as any,
    actModeOllamaModelId: configuration.workerSlotOllamaModelId,
    actModeLmStudioModelId: configuration.workerSlotLmStudioModelId,
  }

  return buildApiHandler(slotConfig, "act")
}
```

**Почему подставляем в `actMode*`:** `createHandlerForProvider` уже умеет читать `actMode*` поля. Подставляем значения Worker слота и вызываем существующий `buildApiHandler`. Минимальное изменение.

---

## 9. Auto-routing condense/summarize

Бонус: если включен `autoRouteCondenseToWorker`, операции condense/summarize используют Worker модель вместо основной. Экономия 60-80% на рутинных операциях.

### Реализация в `attemptApiRequest`

```typescript
async *attemptApiRequest(previousApiReqIndex: number): ApiStream {
  const multiAgentSettings = this.stateManager.getGlobalSettingsKey("multiAgentSettings")

  // Auto-routing для condense/summarize
  const useWorkerForCondense =
    multiAgentSettings?.enabled &&
    multiAgentSettings?.autoRouteCondenseToWorker &&
    this.taskState.currentlySummarizing

  const handler = useWorkerForCondense
    ? this.getWorkerApiHandler()
    : this.api

  // ... используем handler вместо this.api для createMessage ...
}
```

---

## 10. Изменения в системном промпте

### 10.1. Добавление описания `spawn_workers` в capabilities

В `getSystemPromptParts()`, если мультиагентность включена:

```typescript
if (multiAgentEnabled && !isWeakModel) {
  parts.push(`
## Multi-Agent Capabilities

You have access to the \`spawn_workers\` tool that launches parallel analytical sub-agents.

### When to use spawn_workers:
- Analyzing multiple independent files/modules for the same criteria
- Gathering information from several unrelated parts of the codebase
- Comparative analysis of different implementations
- Any task that can be decomposed into independent analytical sub-tasks

### When NOT to use spawn_workers:
- Simple, single-file tasks
- Tasks where sub-tasks depend on each other
- When you need to edit files (workers are read-only analysts)
- When there is only one thing to analyze

### How it works:
1. You call spawn_workers with an array of sub-tasks
2. Each worker receives the context you specify and analyzes it independently
3. Workers return compressed analytical responses
4. You receive all responses and synthesize the final answer
5. Only YOU can edit files and run commands — workers are read-only

### Cost awareness:
Each worker is a separate API call. Only spawn workers when parallelism provides real value.
`)
}
```

### 10.2. Промпт для воркера

Воркер получает свой собственный короткий системный промпт (см. раздел 6.1). Он **не получает** полный системный промпт оркестратора — это экономит токены и предотвращает попытки воркера использовать инструменты.

---

## 11. UI компоненты

### 11.1. Подтверждение спавна (`WorkerApprovalBlock.tsx`)

```
┌──────────────────────────────────────────────────┐
│  🤖 Agent wants to spawn 3 sub-agents            │
│                                                   │
│  1. Analyze auth module for memory leaks          │
│  2. Analyze billing module for memory leaks       │
│  3. Analyze notifications for memory leaks        │
│                                                   │
│  Model: gpt-4.1-mini                              │
│  Estimated cost: ~$0.003                          │
│                                                   │
│  [Allow]  [Deny]                                  │
└──────────────────────────────────────────────────┘
```

### 11.2. Прогресс воркеров (`WorkerProgressBlock.tsx`)

Встраивается в чат как collapsible блок:

```
┌──────────────────────────────────────────────────┐
│  ▼ Sub-agents (3)                    ✅ Complete  │
│                                                   │
│  ✅ auth analysis       1,247 tok    1.2s         │
│  ✅ billing analysis      891 tok    0.8s         │
│  ✅ notifications       1,456 tok    1.5s         │
│                                                   │
│  Total: 3,594 tokens | Model: gpt-4.1-mini       │
└──────────────────────────────────────────────────┘
```

Состояния:
- 🔄 Running — воркер выполняется
- ✅ Complete — воркер завершён
- ❌ Error — воркер завершился с ошибкой
- ⏳ Queued — воркер в очереди

### 11.3. Settings секция (`MultiAgentSection.tsx`)

**Файл:** `webview-ui/src/components/settings/sections/MultiAgentSection.tsx`

См. макет в разделе 2.1. Компоненты:
- Toggle `multiAgentEnabled`
- `ApiProviderSelector` для Worker модели (переиспользуем существующий)
- Number input для `maxWorkers` (1-4)
- Toggle `askBeforeSpawning`
- Toggle `autoRouteCondenseToWorker`

---

## 12. Детальные изменения по файлам

### Новые файлы

| Файл | Описание |
|------|----------|
| `src/shared/multi-agent.ts` | Типы: WorkerTask, WorkerResult, MultiAgentSettings |
| `src/core/multi-agent/WorkerAgent.ts` | Класс воркера: получает контекст, вызывает API, возвращает результат |
| `src/core/multi-agent/WorkerOrchestrator.ts` | Управление группой воркеров: параллельный запуск, сбор результатов |
| `src/core/multi-agent/index.ts` | Реэкспорт |
| `webview-ui/src/components/chat/WorkerApprovalBlock.tsx` | UI: подтверждение спавна воркеров |
| `webview-ui/src/components/chat/WorkerProgressBlock.tsx` | UI: прогресс-бар воркеров в чате |
| `webview-ui/src/components/settings/sections/MultiAgentSection.tsx` | UI: настройки мультиагентности |

### Изменяемые файлы

| Файл | Что меняется |
|------|-------------|
| `src/shared/storage/state-keys.ts` | Добавить `workerSlot*`, `multiAgentEnabled`, `multiAgentSettings` |
| `src/core/api/index.ts` | Добавить `buildApiHandlerForWorkerSlot()` |
| `src/core/task/index.ts` | `getWorkerApiHandler()`, `invalidateWorkerHandler()`, обработка `spawn_workers` в tool handler |
| `src/core/task/index.ts` | `attemptApiRequest` — auto-routing condense на Worker |
| `src/core/prompts/sections/tools.ts` | Добавить `spawn_workers` tool definition |
| `src/core/prompts/system.ts` | Добавить Multi-Agent Capabilities секцию |
| `src/core/controller/state/updateSettings.ts` | `invalidateWorkerHandler()` при смене настроек |
| `src/core/tools/index.ts` | Добавить обработчик `spawn_workers` |
| `proto/shuncode/state.proto` | `MultiAgentSettings`, `WorkerSlotConfig` |
| `webview-ui/src/components/settings/SettingsView.tsx` | Добавить MultiAgentSection |
| `webview-ui/src/components/chat/ChatMessage.tsx` | Рендеринг WorkerApprovalBlock и WorkerProgressBlock |
| `webview-ui/src/i18n/locales/ru.json` | Переводы Multi-Agent UI |
| `webview-ui/src/i18n/locales/en.json` | Переводы Multi-Agent UI |

---

## 13. Пошаговый план реализации

### Фаза 1: Типы и настройки (2-3 дня)

1. Создать `src/shared/multi-agent.ts` с типами
2. Добавить настройки в `state-keys.ts`: `multiAgentEnabled`, `multiAgentSettings`, `workerSlot*`
3. Protobuf: `MultiAgentSettings`, `WorkerSlotConfig`
4. Прокинуть настройки через gRPC (proto → webview → extension)

### Фаза 2: Worker Agent + Orchestrator (4-5 дней)

1. Создать `WorkerAgent` — выполнение одной задачи через API
2. Создать `WorkerOrchestrator` — параллельный запуск + сбор результатов
3. Создать `buildApiHandlerForWorkerSlot()` в `api/index.ts`
4. Unit-тесты:
   - WorkerAgent: формирование промпта, обработка ответа, truncation
   - WorkerOrchestrator: параллельный запуск, обработка ошибок одного воркера
   - buildApiHandlerForWorkerSlot: fallback при отсутствии настроек

### Фаза 3: Интеграция с Task (4-5 дней)

1. Добавить `spawn_workers` tool definition в систему промптов
2. Реализовать обработчик `spawn_workers` в Task
3. Добавить `getWorkerApiHandler()` и `invalidateWorkerHandler()` в Task
4. Реализовать `readFilesForWorkers()` — чтение файлов по glob'ам
5. Реализовать `formatWorkerResults()` — форматирование результатов для оркестратора
6. Добавить `isWeakModel()` — фильтрация слабых моделей
7. Тесты: full flow spawn → execute → return results

### Фаза 4: UI — подтверждение и прогресс (3-4 дня)

1. `WorkerApprovalBlock.tsx` — диалог подтверждения
2. `WorkerProgressBlock.tsx` — прогресс в чате
3. Интеграция в `ChatMessage.tsx`
4. Механизм approval через webview ↔ extension messaging

### Фаза 5: Settings UI (3-4 дня)

1. `MultiAgentSection.tsx` — секция настроек
2. Переиспользовать `ApiProviderSelector` для Worker модели
3. Интеграция в `SettingsView.tsx`
4. i18n: переводы RU + EN

### Фаза 6: Auto-routing condense + полировка (2-3 дня)

1. Auto-route condense/summarize → Worker модель
2. Edge cases: Worker модель недоступна, таймаут воркера, слишком большой контекст
3. Обновить snapshot-тесты промптов
4. Обновить документацию

---

## 14. Edge Cases и обработка ошибок

### 14.1. Worker модель не настроена

Если `workerSlotApiProvider` не задан — используется текущая модель (оркестратор). Функциональность работает, просто без экономии.

### 14.2. Один воркер упал

Остальные воркеры продолжают работать (`Promise.allSettled`). Оркестратор получает результаты успешных воркеров + ошибку по упавшему:

```xml
<worker index="2" status="error">
Error: Rate limit exceeded. Try again in 30 seconds.
</worker>
```

Оркестратор решает: повторить, проигнорировать, или сообщить пользователю.

### 14.3. Слишком большой контекст

Если суммарный размер файлов для одного воркера > 100K символов (~25K токенов):
- Обрезаем до лимита с предупреждением
- В ответе воркеру добавляется: `[Context truncated: showing first N of M files]`

### 14.4. Пользователь отклонил спавн

Оркестратор получает: `"User denied worker spawning. Proceed without sub-agents."`
Модель продолжает работу самостоятельно — выполняет задачу последовательно.

### 14.5. Слабая модель пытается спавнить

`spawn_workers` не добавляется в системный промпт для слабых моделей. Если каким-то образом модель всё равно вызовет — возвращаем ошибку:
`"spawn_workers is not available for this model. Handle the task directly."`

### 14.6. Рекурсивный спавн

Воркер **не получает** tool `spawn_workers`. Рекурсия невозможна по дизайну.

### 14.7. Отмена задачи пользователем

Если пользователь нажал Stop/Cancel во время выполнения воркеров:
- `AbortController` прерывает все текущие API-вызовы воркеров
- Оркестратор получает результаты завершённых + cancelled для прерванных
- Общая задача останавливается (как сейчас)

### 14.8. Обратная совместимость

- `multiAgentEnabled = false` (default) → `spawn_workers` не добавляется в промпт, всё работает как раньше
- Существующий код не затрагивается: `this.api` продолжает работать для оркестратора
- Worker handler — отдельное поле, не влияет на основной `api`

---

## 15. Интеграция с IMPL-14 (Workflow Steps)

> Опционально. Работает и без IMPL-14.

Если IMPL-14 реализован, workflow шаг может использовать мультиагентность:

```yaml
steps:
  - name: "Analyze All Modules"
    prompt: |
      Проанализируй все модули в src/modules/ на предмет:
      - Утечки памяти
      - Незакрытые подписки
      - Дублирование кода
      Используй spawn_workers для параллельного анализа каждого модуля.
```

Оркестратор получит промпт шага и сам решит использовать `spawn_workers`. Никаких изменений в WorkflowOrchestrator — это просто обычный tool call.

Дополнительно, в YAML можно указать модель для шага (из старого IMPL-17):

```yaml
steps:
  - name: "Quick Lint Check"
    model: "worker"    # использует Worker модель для этого шага
    prompt: "Запусти линтер..."
```

Значение `"worker"` — алиас для Worker слота. Но это опциональное расширение.

---

## 16. Будущие улучшения (не в MVP)

1. **Воркеры с ограниченными tool'ами** — read_file, search_files (но не write). Шаг 2 эволюции: воркеры сами собирают контекст вместо получения от оркестратора
2. **Воркеры-исполнители** — отдельный тип воркера с write-доступом, но с изоляцией (git worktree). Шаг 3 эволюции
3. **Cost tracking** — отдельная статистика расходов на воркеров vs оркестратора
4. **Smart model selection** — система рекомендует Worker модель на основании типа задачи
5. **Worker templates** — предустановленные типы воркеров (code-reviewer, security-auditor, performance-analyzer)
6. **Inter-worker communication** — воркеры могут уточнять информацию друг у друга (chain-of-workers)
7. **Adaptive spawning** — модель учится когда стоит спавнить на основании истории

---

## 17. Проверка (Definition of Done)

### Функциональная проверка

- [ ] Включить Multi-Agent Mode в настройках
- [ ] Настроить Worker модель (отличную от оркестратора)
- [ ] Дать задачу с анализом 3 модулей → модель вызывает spawn_workers
- [ ] UI показывает диалог подтверждения → нажать Allow
- [ ] 3 воркера запускаются параллельно, видно прогресс в чате
- [ ] Оркестратор получает результаты и синтезирует ответ
- [ ] Дать тривиальную задачу → модель НЕ использует spawn_workers
- [ ] Нажать Deny → модель продолжает работу самостоятельно
- [ ] Отключить Multi-Agent → spawn_workers не появляется в промпте
- [ ] Не настраивать Worker → используется модель оркестратора
- [ ] Включить auto-route condense → condense использует Worker модель
- [ ] Поставить слабую модель → spawn_workers недоступен

### Технические проверки

- [ ] Сборка extension: `node esbuild.mjs` — без ошибок
- [ ] Сборка webview: `npm run build` в webview-ui/ — без ошибок
- [ ] Unit-тесты WorkerAgent, WorkerOrchestrator — проходят
- [ ] Существующие тесты — без регрессий
- [ ] Запуск через `.\scripts\code.bat` — Shuncode работает
- [ ] Один воркер падает → остальные продолжают, оркестратор получает partial results
- [ ] Отмена задачи → все воркеры прерываются

---

## 18. Зависимости

- **IMPL-14 (Multi-Step Workflow)** — опционально (для workflow-интеграции в разделе 15)
- **Нет внешних новых зависимостей**
- **Protobuf** — существующая инфраструктура gRPC

---

## 19. Риски

| Риск | Вероятность | Влияние | Митигация |
|------|------------|---------|-----------|
| Модель злоупотребляет spawn_workers на простых задачах | Средняя | Среднее | Чёткий промпт + блокировка для слабых моделей + user approval |
| Контекст не помещается в лимит воркера | Средняя | Среднее | Truncation + предупреждение, оркестратор дробит на меньшие задачи |
| Стоимость непредсказуема для пользователя | Средняя | Высокое | Approval dialog с estimated cost + лимит maxWorkers |
| Качество ответов воркера на дешёвой модели недостаточно | Средняя | Среднее | Fallback на модель оркестратора, пользователь может выбрать модель |
| Race condition при параллельном чтении файлов | Низкая | Низкое | Файлы читаются один раз до запуска воркеров |
| Worker API rate limiting | Средняя | Среднее | Retry с backoff, partial results |
| Сложность реализации approval flow (webview ↔ extension) | Средняя | Среднее | Переиспользовать паттерн из tool approval (execute_command) |

---

*Создано: март 2026*
*Обновлено: март 2026 — переработано из мультимодельной маршрутизации в мультиагентную систему*
