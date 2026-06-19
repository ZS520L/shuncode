# IMPL-14 — Multi-Step Workflow Engine

> Workflow с упорядоченными шагами: визуальный редактор, пошаговое выполнение, прогресс.

**Статус:** 📋 Планирование
**Приоритет:** Высокий
**Оценка:** 15-20 рабочих дней

---

## 1. Цель

Переработать систему Workflow из "один .md файл = одна инструкция" в полноценный **multi-step pipeline**: упорядоченный список шагов, каждый из которых агент выполняет последовательно. Пользователь видит прогресс по шагам, может включать/выключать отдельные шаги, менять их порядок, редактировать промпт каждого шага через визуальный редактор.

### Зачем

Текущие workflow — это по сути просто правила (rules) с другим названием. Один файл, одна инструкция, агент сам решает что делать. Нет структуры, нет контроля, нет прогресса. Multi-step workflow даёт:

- **Предсказуемость** — агент идёт по чёткому плану, а не импровизирует
- **Контроль** — каждый шаг можно включить/выключить/пропустить
- **Прозрачность** — пользователь видит на каком шаге агент, что уже сделано
- **Переиспользуемость** — один раз настроил workflow, используешь на любом проекте
- **Сложные сценарии** — 15-20 шагов за одну итерацию, невозможно описать одним промптом

---

## 2. Как это работает (User Story)

### 2.1. Создание workflow

1. Пользователь нажимает **"+ New Workflow"** в панели Workflows (или создаёт файл вручную)
2. Открывается **Workflow Editor** — полноценный визуальный редактор в webview
3. Пользователь задаёт:
   - **Название** workflow (например "New Feature Module")
   - **Иконку** (опционально, из codicon набора)
   - **Описание** (опционально, пара предложений что делает workflow)
4. Добавляет **шаги** через кнопку **"+ Add Step"**:
   - Каждый шаг имеет **название** (например "Create Feature Plan")
   - Каждый шаг имеет **промпт/инструкцию** — то, что будет подставлено агенту
   - Каждый шаг имеет **toggle** вкл/выкл (по умолчанию вкл)
   - Каждый шаг имеет **toggle видимости** (показывать вывод в чате или выполнять "тихо")
5. Шаги можно **перетаскивать** (↑↓) для изменения порядка
6. Шаги можно **удалять** (🗑)
7. Каждый шаг можно **раскрыть** (>) для редактирования его промпта
8. Workflow сохраняется в файл формата `.yaml` или `.json`

### 2.2. Запуск workflow

1. Пользователь пишет в чат: `/new-feature-module создай модуль авторизации`
2. Система находит workflow "new-feature-module" по имени файла (как сейчас)
3. **Вместо** подстановки всего содержимого как одной инструкции — запускается **WorkflowOrchestrator**
4. Orchestrator:
   - Показывает в чате **карточку прогресса**: список всех шагов с чекбоксами
   - Фильтрует шаги: пропускает выключенные
   - Последовательно выполняет каждый включённый шаг
   - На каждом шаге:
     a. Обновляет карточку прогресса (текущий шаг подсвечен)
     b. Формирует промпт шага + контекст от предыдущих шагов
     c. Запускает agent loop (вызывает `recursivelyMakeShuncodeRequests`)
     d. Дожидается завершения (агент закончил использовать тулы)
     e. Отмечает шаг как завершённый
     f. Если шаг "тихий" (visibility off) — сворачивает его вывод в UI
   - После всех шагов — показывает итоговый статус

### 2.3. Прогресс и контроль во время выполнения

- В чате отображается **виджет прогресса** (как todo-list):
  ```
  ⚡ Workflow: New Feature Module
  ✅ Create Feature Plan
  ✅ Refine Plan Against Rules
  🔄 Implement Contracts  ← текущий шаг
  ⬜ Implement Domain
  ⬜ Implement Service
  ⬜ Implement Endpoint
  ...
  ```
- Пользователь может **остановить** workflow в любой момент (стандартная кнопка Cancel)
- После остановки пользователь может **продолжить** с того шага, где остановился (resume)

### 2.4. Тихий режим (visibility / silent mode)

Кнопка "глазик" (👁) на каждом шаге управляет **видимостью вывода** в чате:

- **Видимый** (глазик открыт, по умолчанию) — весь вывод агента на этом шаге показывается в чате как обычно (текст, использование тулов, файлы)
- **Тихий** (глазик закрыт) — агент работает, но его вывод на этом шаге **свёрнут** в компактный блок. Пользователь видит только "✅ Lint Check — выполнено за 12с". По клику можно развернуть и посмотреть детали.

Это полезно для "технических" шагов вроде Lint Check, Restore Dependencies, Build Project — пользователю не интересно смотреть на вывод линтера, но важно знать что он прошёл.

---

## 3. Формат хранения workflow

### 3.1. Файловая структура

Workflow хранятся там же, где и сейчас:

```
# Глобальные (для всех проектов)
~/Documents/Shuncode/Workflows/
  new-feature-module.yaml
  refactor-module.yaml
  fix-bug.yaml

# Локальные (для конкретного проекта)
<project>/.shuncoderules/workflows/
  deploy-pipeline.yaml
  code-review.yaml
```

### 3.2. Формат файла: YAML

Выбираем YAML (а не JSON), потому что:
- Поддержка многострочного текста через `|` — критично для промптов
- У нас уже есть `js-yaml` в зависимостях (используется в `frontmatter.ts`)
- YAML читабелен для людей — можно редактировать в обычном текстовом редакторе
- Frontmatter в .md файлах уже парсится через YAML

### 3.3. Схема файла

```yaml
# new-feature-module.yaml
name: "New Feature Module"
description: "Полный цикл создания нового модуля: от планирования до тестирования"
icon: "symbol-module"  # codicon name, опционально
version: 1             # версия схемы, для миграций

steps:
  - name: "Create Feature Plan"
    enabled: true
    visible: true
    prompt: |
      Проанализируй требования пользователя и создай детальный план реализации.
      План должен включать:
      1. Список файлов, которые нужно создать
      2. Структуру данных (интерфейсы, типы)
      3. Зависимости между компонентами
      4. Порядок реализации
      
      Результат оформи в виде чеклиста.

  - name: "Refine Plan Against Rules"
    enabled: true
    visible: true
    prompt: |
      Проверь созданный план на соответствие правилам проекта (shuncode rules).
      Если есть конфликты — скорректируй план.
      Убедись что:
      - Naming conventions соблюдены
      - Архитектурные паттерны проекта учтены
      - Зависимости совместимы

  - name: "Implement Contracts"
    enabled: true
    visible: true
    prompt: |
      Реализуй интерфейсы и типы согласно плану.
      Создай необходимые файлы с контрактами (interfaces, types, DTOs).
      Не реализуй бизнес-логику на этом этапе — только контракты.

  - name: "Implement Domain"
    enabled: true
    visible: true
    prompt: |
      Реализуй доменную логику согласно плану и созданным контрактам.
      Создай модели, сервисы, хелперы.

  - name: "Implement Service"
    enabled: true
    visible: true
    prompt: |
      Реализуй сервисный слой. Подключи доменную логику к внешним зависимостям.

  - name: "Implement Endpoint"
    enabled: true
    visible: true
    prompt: |
      Реализуй API endpoint / UI компонент согласно плану.

  - name: "Register in DI"
    enabled: true
    visible: true
    prompt: |
      Зарегистрируй все новые сервисы и зависимости в DI контейнере проекта.
      Обнови конфигурацию, если требуется.

  - name: "Auto-Fix Scripts"
    enabled: false
    visible: false
    prompt: |
      Запусти auto-fix скрипты проекта (prettier, eslint --fix и т.п.).

  - name: "Lint Check"
    enabled: true
    visible: false   # тихий — вывод линтера не интересен
    prompt: |
      Запусти линтер проекта и проверь что нет ошибок.
      Если есть ошибки — выведи список.

  - name: "Fix Lint Issues"
    enabled: true
    visible: true
    prompt: |
      Исправь все ошибки линтера, найденные на предыдущем шаге.
      Если ошибок не было — сообщи что всё чисто.

  - name: "Build Project"
    enabled: true
    visible: false   # тихий
    prompt: |
      Запусти сборку проекта. Проверь что сборка проходит без ошибок.

  - name: "Fix Build Errors"
    enabled: true
    visible: true
    prompt: |
      Исправь все ошибки сборки, найденные на предыдущем шаге.
      Если ошибок не было — сообщи что всё чисто.

  - name: "Test"
    enabled: true
    visible: true
    prompt: |
      Запусти тесты проекта. Если тесты не проходят — исправь.
      Если тестов нет — напиши базовые тесты для нового функционала.

  - name: "Cleanup"
    enabled: true
    visible: false
    prompt: |
      Удали временные файлы, если создавались.
      Проверь что не осталось TODO/FIXME в новом коде.
      Подведи итог: что было создано, что изменено.
```

### 3.4. Обратная совместимость со старыми workflow

Старые workflow — это обычные `.md` файлы с текстом (или frontmatter + markdown). Они **продолжают работать** как раньше: один файл = одна инструкция в `<explicit_instructions>`. Новый формат `.yaml` — это расширение, не замена.

Логика определения типа:
- Файл `.yaml` / `.yml` → новый multi-step workflow
- Файл `.md` → старый single-prompt workflow (legacy, работает как раньше)

---

## 4. Архитектура (Backend)

### 4.1. Модель данных

#### Новые типы (`src/shared/workflow-types.ts` — новый файл)

```typescript
/**
 * Один шаг workflow.
 */
export interface WorkflowStep {
  /** Название шага для отображения */
  name: string
  /** Промпт/инструкция для агента */
  prompt: string
  /** Включён ли шаг (выключенные пропускаются) */
  enabled: boolean
  /** Показывать ли вывод в чате (false = тихий режим, свёрнутый блок) */
  visible: boolean
}

/**
 * Определение workflow (содержимое .yaml файла).
 */
export interface WorkflowDefinition {
  /** Название workflow */
  name: string
  /** Описание (опционально) */
  description?: string
  /** Иконка codicon (опционально) */
  icon?: string
  /** Версия схемы */
  version: number
  /** Упорядоченный список шагов */
  steps: WorkflowStep[]
}

/**
 * Статус выполнения одного шага.
 */
export type WorkflowStepStatus =
  | "pending"    // ещё не начат
  | "running"    // выполняется
  | "completed"  // успешно завершён
  | "failed"     // завершён с ошибкой
  | "skipped"    // пропущен (disabled)

/**
 * Состояние выполнения workflow (runtime).
 */
export interface WorkflowExecutionState {
  /** ID workflow execution (ulid) */
  executionId: string
  /** Определение workflow */
  definition: WorkflowDefinition
  /** Путь к файлу workflow */
  filePath: string
  /** Индекс текущего шага (0-based) */
  currentStepIndex: number
  /** Статусы каждого шага */
  stepStatuses: WorkflowStepStatus[]
  /** Общий статус: running | completed | failed | cancelled */
  overallStatus: "running" | "completed" | "failed" | "cancelled"
  /** Время начала */
  startedAt: number
  /** Время завершения каждого шага (для отображения длительности) */
  stepTimings: Array<{ startedAt?: number; completedAt?: number }>
  /** Пользовательский ввод (то, что пользователь написал после /workflow-name) */
  userInput: string
}
```

#### Protobuf (`proto/shuncode/workflow.proto` — новый файл)

```protobuf
syntax = "proto3";
package shuncode;

import "shuncode/common.proto";

// Service for workflow operations
service WorkflowService {
  // Load workflow definition from file
  rpc loadWorkflow(StringRequest) returns (WorkflowDefinitionProto);
  
  // Save workflow definition to file
  rpc saveWorkflow(SaveWorkflowRequest) returns (Empty);
  
  // Create a new workflow file from template
  rpc createWorkflow(CreateWorkflowRequest) returns (WorkflowFileInfo);
  
  // Delete a workflow file
  rpc deleteWorkflow(DeleteWorkflowRequest) returns (Empty);
  
  // Get execution state of running workflow
  rpc getWorkflowExecution(StringRequest) returns (WorkflowExecutionStateProto);
}

message WorkflowStepProto {
  string name = 1;
  string prompt = 2;
  bool enabled = 3;
  bool visible = 4;
}

message WorkflowDefinitionProto {
  string name = 1;
  string description = 2;
  string icon = 3;
  int32 version = 4;
  repeated WorkflowStepProto steps = 5;
  string file_path = 6;  // полный путь к файлу
}

message SaveWorkflowRequest {
  Metadata metadata = 1;
  string file_path = 2;
  WorkflowDefinitionProto definition = 3;
}

message CreateWorkflowRequest {
  Metadata metadata = 1;
  string filename = 2;      // имя файла без расширения
  bool is_global = 3;       // глобальный или локальный
}

message DeleteWorkflowRequest {
  Metadata metadata = 1;
  string file_path = 2;
  bool is_global = 3;
}

message WorkflowFileInfo {
  string file_path = 1;
  string display_name = 2;
  bool already_exists = 3;
}

// Runtime execution state
message WorkflowStepStatusProto {
  string status = 1;   // pending | running | completed | failed | skipped
  int64 started_at = 2;
  int64 completed_at = 3;
}

message WorkflowExecutionStateProto {
  string execution_id = 1;
  WorkflowDefinitionProto definition = 2;
  int32 current_step_index = 3;
  repeated WorkflowStepStatusProto step_statuses = 4;
  string overall_status = 5;
  int64 started_at = 6;
  string user_input = 7;
}
```

### 4.2. WorkflowParser (`src/core/workflow/WorkflowParser.ts` — новый файл)

Отвечает за чтение/запись `.yaml` файлов workflow.

```typescript
import * as yaml from "js-yaml"
import fs from "fs/promises"
import { WorkflowDefinition, WorkflowStep } from "@shared/workflow-types"

/**
 * Парсит .yaml файл workflow в WorkflowDefinition.
 * Валидирует структуру. Выбрасывает ошибку при невалидном формате.
 */
export async function parseWorkflowFile(filePath: string): Promise<WorkflowDefinition> {
  const content = await fs.readFile(filePath, "utf8")
  const parsed = yaml.load(content) as Record<string, unknown>
  
  // Валидация обязательных полей
  if (!parsed.name || typeof parsed.name !== "string") {
    throw new Error(`Workflow file ${filePath}: missing or invalid "name"`)
  }
  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error(`Workflow file ${filePath}: missing or empty "steps"`)
  }
  
  const steps: WorkflowStep[] = parsed.steps.map((step: any, index: number) => {
    if (!step.name || typeof step.name !== "string") {
      throw new Error(`Workflow file ${filePath}: step ${index} missing "name"`)
    }
    if (!step.prompt || typeof step.prompt !== "string") {
      throw new Error(`Workflow file ${filePath}: step ${index} missing "prompt"`)
    }
    return {
      name: step.name,
      prompt: step.prompt.trim(),
      enabled: step.enabled !== false,  // default true
      visible: step.visible !== false,  // default true
    }
  })
  
  return {
    name: parsed.name as string,
    description: (parsed.description as string) || undefined,
    icon: (parsed.icon as string) || undefined,
    version: (parsed.version as number) || 1,
    steps,
  }
}

/**
 * Сериализует WorkflowDefinition в YAML и записывает в файл.
 */
export async function saveWorkflowFile(
  filePath: string, 
  definition: WorkflowDefinition,
): Promise<void> {
  const content = yaml.dump(definition, {
    lineWidth: -1,       // не оборачивать строки
    noRefs: true,        // не использовать YAML ссылки
    quotingType: '"',    // двойные кавычки
    forceQuotes: false,  // кавычки только когда нужно
  })
  await fs.writeFile(filePath, content, "utf8")
}

/**
 * Определяет, является ли файл multi-step workflow (YAML) или legacy (MD).
 */
export function isMultiStepWorkflow(filePath: string): boolean {
  return filePath.endsWith(".yaml") || filePath.endsWith(".yml")
}
```

### 4.3. WorkflowOrchestrator (`src/core/workflow/WorkflowOrchestrator.ts` — новый файл)

Ключевой компонент. Оркестрирует последовательное выполнение шагов workflow. Работает как надстройка над существующим `initiateTaskLoop` / `recursivelyMakeShuncodeRequests`.

#### Принцип работы

```
Пользователь: /new-feature-module создай модуль авторизации
                              │
                    ┌─────────▼──────────┐
                    │  parseSlashCommands │  ← определяет что это multi-step workflow
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │ WorkflowOrchestrator│  ← создаётся, привязывается к Task
                    │   .start()          │
                    └─────────┬──────────┘
                              │
           ┌──────────────────▼──────────────────┐
           │  Цикл по шагам (filteredSteps)      │
           │                                      │
           │  ┌─── Step 1: "Create Feature Plan" │
           │  │    → формирует prompt             │
           │  │    → запускает initiateTaskLoop   │
           │  │    → ждёт завершения              │
           │  │    → отмечает как completed       │
           │  │                                    │
           │  ├─── Step 2: "Refine Plan"          │
           │  │    → то же самое                   │
           │  │    → контекст от Step 1 сохранён  │
           │  │                                    │
           │  ├─── Step 3: "Implement Contracts"  │
           │  │    ...                              │
           │  └─── Step N: "Cleanup"              │
           │                                      │
           └──────────────────┬──────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   Завершение       │
                    │   Итоговый статус  │
                    └────────────────────┘
```

#### Ключевое архитектурное решение: как связать шаги

Между шагами нужно передавать контекст. Варианты:

**Вариант A (выбранный): Общая conversation history**
Все шаги работают **в одной conversation history**. Каждый шаг — это новое сообщение в рамках одной и той же беседы. Агент видит всё, что делал на предыдущих шагах, потому что conversation history накапливается.

Плюсы:
- Простая реализация — не нужно придумывать формат передачи контекста
- Агент имеет полный контекст всех предыдущих шагов
- Работает с существующим `recursivelyMakeShuncodeRequests` без изменений

Минусы:
- Context window может переполниться на 15+ шагах
- Решение: auto-condense между шагами при необходимости (уже есть механизм)

**Вариант B (отвергнутый): Изолированные контексты + summary**
Каждый шаг в отдельной conversation history, между шагами передаётся summary предыдущего.

Минусы:
- Потеря деталей при суммаризации
- Сложная реализация
- Агент не может сослаться на конкретный файл, который создал 3 шага назад

#### Псевдокод оркестратора

```typescript
export class WorkflowOrchestrator {
  private definition: WorkflowDefinition
  private executionState: WorkflowExecutionState
  private task: Task
  
  constructor(task: Task, definition: WorkflowDefinition, userInput: string) {
    this.task = task
    this.definition = definition
    this.executionState = {
      executionId: ulid(),
      definition,
      filePath: "",
      currentStepIndex: 0,
      stepStatuses: definition.steps.map(s => s.enabled ? "pending" : "skipped"),
      overallStatus: "running",
      startedAt: Date.now(),
      stepTimings: definition.steps.map(() => ({})),
      userInput,
    }
  }
  
  /**
   * Запускает выполнение workflow.
   * Вызывается из Task вместо обычного initiateTaskLoop.
   */
  async execute(): Promise<void> {
    // 1. Показать карточку прогресса в чате
    await this.emitProgressCard()
    
    const enabledSteps = this.definition.steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.enabled)
    
    for (const { step, index } of enabledSteps) {
      if (this.task.taskState.abort) {
        this.executionState.overallStatus = "cancelled"
        break
      }
      
      // 2. Обновить статус шага → running
      this.executionState.currentStepIndex = index
      this.executionState.stepStatuses[index] = "running"
      this.executionState.stepTimings[index].startedAt = Date.now()
      await this.emitProgressCard()
      
      // 3. Сформировать промпт для шага
      const stepPrompt = this.buildStepPrompt(step, index, enabledSteps.length)
      
      // 4. Запустить agent loop для этого шага
      try {
        await this.executeStep(stepPrompt)
        this.executionState.stepStatuses[index] = "completed"
      } catch (error) {
        this.executionState.stepStatuses[index] = "failed"
        this.executionState.overallStatus = "failed"
        // Показать ошибку, но не падать — позволить пользователю решить
        break
      }
      
      this.executionState.stepTimings[index].completedAt = Date.now()
      await this.emitProgressCard()
      
      // 5. Auto-condense если context window заполняется
      await this.maybeCondenseContext()
    }
    
    // 6. Итоговый статус
    if (this.executionState.overallStatus === "running") {
      this.executionState.overallStatus = "completed"
    }
    await this.emitProgressCard()
  }
  
  /**
   * Формирует промпт для конкретного шага.
   */
  private buildStepPrompt(step: WorkflowStep, stepIndex: number, totalSteps: number): string {
    return [
      `<workflow_step step="${stepIndex + 1}" total="${totalSteps}" name="${step.name}">`,
      step.prompt,
      `</workflow_step>`,
      ``,
      `<workflow_context>`,
      `You are executing step ${stepIndex + 1} of ${totalSteps} in the "${this.definition.name}" workflow.`,
      `Current step: "${step.name}"`,
      `User's original request: "${this.executionState.userInput}"`,
      ``,
      `IMPORTANT: Focus ONLY on the current step's instructions. Do NOT skip ahead to later steps.`,
      `When you have completed this step, call attempt_completion to signal that you are done with this step.`,
      `</workflow_context>`,
    ].join("\n")
  }
  
  /**
   * Выполняет один шаг workflow через существующий agent loop.
   * 
   * Ключевая идея: шаг — это по сути новое "сообщение пользователя"
   * с инструкцией шага. Агент обрабатывает его как обычный запрос,
   * используя тулы, и завершает через attempt_completion.
   */
  private async executeStep(stepPrompt: string): Promise<void> {
    const userContent: ShuncodeContent[] = [
      { type: "text", text: stepPrompt }
    ]
    
    // Используем существующий механизм:
    // - recursivelyMakeShuncodeRequests выполняет agent loop
    // - Агент работает пока не вызовет attempt_completion или не перестанет юзать тулы
    // - Conversation history накапливается (контекст от предыдущих шагов сохранён)
    await this.task.initiateStepLoop(userContent)
  }
}
```

### 4.4. Интеграция с Task (`src/core/task/index.ts` — изменения)

#### Новые поля в Task

```typescript
class Task {
  // ... существующие поля ...
  
  /** Оркестратор workflow (null если обычная задача, не workflow) */
  private workflowOrchestrator: WorkflowOrchestrator | null = null
  
  /**
   * Аналог initiateTaskLoop, но для одного шага workflow.
   * Отличие: при attempt_completion не завершает задачу, а завершает шаг.
   * Оркестратор потом запустит следующий шаг.
   */
  async initiateStepLoop(userContent: ShuncodeContent[]): Promise<void> {
    let nextUserContent = userContent
    while (!this.taskState.abort) {
      this._session?.pipeline.nextIteration()
      
      const didEndLoop = await this.recursivelyMakeShuncodeRequests(nextUserContent, false)
      
      if (didEndLoop) {
        // Шаг завершён (attempt_completion или max requests)
        break
      } else {
        nextUserContent = [{
          type: "text",
          text: formatResponse.noToolsUsed(this.useNativeToolCalls),
        }]
        this.taskState.consecutiveMistakeCount++
      }
    }
  }
}
```

#### Изменения в parseSlashCommands

В `src/core/slash-commands/index.ts` — определить, что workflow является multi-step:

```typescript
// В parseSlashCommands, после нахождения matchingWorkflow:

if (matchingWorkflow && !matchingWorkflow.isRemote) {
  // Проверяем: это multi-step workflow (YAML) или legacy (MD)?
  if (isMultiStepWorkflow(matchingWorkflow.fullPath)) {
    // Парсим как multi-step → возвращаем спец. маркер
    const definition = await parseWorkflowFile(matchingWorkflow.fullPath)
    return {
      processedText: textWithoutSlashCommand,
      needsShuncoderulesFileCheck: false,
      multiStepWorkflow: definition,  // новое поле
    }
  }
  
  // Legacy workflow — как раньше
  const workflowContent = (await fs.readFile(matchingWorkflow.fullPath, "utf8")).trim()
  // ... существующий код ...
}
```

### 4.5. Интеграция с Pipeline (`src/core/session/Pipeline.ts` — расширение)

Pipeline уже трекает итерации agent loop. Расширяем его для трекинга шагов workflow:

```typescript
export class Pipeline {
  // ... существующие поля ...
  
  /** Workflow execution state (null если обычная задача) */
  private _workflowState: WorkflowExecutionState | null = null
  
  get workflowState(): WorkflowExecutionState | null {
    return this._workflowState
  }
  
  /** Устанавливает workflow state для трекинга */
  setWorkflowState(state: WorkflowExecutionState): void {
    this._workflowState = state
    this.emitProgress()
  }
  
  /** Обновляет workflow state (прогресс по шагам) */
  updateWorkflowState(updater: (state: WorkflowExecutionState) => void): void {
    if (this._workflowState) {
      updater(this._workflowState)
      this.emitProgress()
    }
  }
}
```

### 4.6. Новое событие в SessionEvents

```typescript
// В SessionEvents.ts — добавить:

/** Обновление прогресса workflow */
export interface WorkflowProgressEvent {
  type: "workflow_progress"
  executionState: WorkflowExecutionState
}

// Добавить в SessionEvent union:
export type SessionEvent =
  | StateChangedEvent
  | MessageAddedEvent
  | MessageUpdatedEvent
  | ProgressEvent
  | ApprovalNeededEvent
  | ApprovalResolvedEvent
  | WorkflowProgressEvent  // NEW
```

---

## 5. Архитектура (Frontend / Webview UI)

### 5.1. Компоненты

#### 5.1.1. WorkflowProgressCard (`webview-ui/src/components/workflow/WorkflowProgressCard.tsx`)

Виджет прогресса, встраивается в поток чата. Показывает список шагов с их статусами.

```
┌─────────────────────────────────────────┐
│ ⚡ New Feature Module                   │
│                                         │
│ ✅ Create Feature Plan         3.2s     │
│ ✅ Refine Plan Against Rules   1.8s     │
│ 🔄 Implement Contracts         ...      │
│ ⬜ Implement Domain                     │
│ ⬜ Implement Service                    │
│ ⬜ Implement Endpoint                   │
│ ⬜ Register in DI                       │
│ ── Auto-Fix Scripts            skipped  │
│ ⬜ Lint Check                  🔇       │  ← 🔇 = тихий режим
│ ⬜ Fix Lint Issues                      │
│ ⬜ Build Project               🔇       │
│ ⬜ Fix Build Errors                     │
│ ⬜ Test                                 │
│ ⬜ Cleanup                     🔇       │
│                                         │
│ Step 3/14 • Elapsed: 28s                │
└─────────────────────────────────────────┘
```

Иконки статусов:
- ⬜ `pending` — серый квадрат
- 🔄 `running` — спиннер (анимация)
- ✅ `completed` — зелёная галочка
- ❌ `failed` — красный крест
- ── `skipped` — зачёркнутый, серый текст

#### 5.1.2. WorkflowEditor (`webview-ui/src/components/workflow/WorkflowEditor.tsx`)

Полноценный редактор workflow. Открывается в webview при создании/редактировании workflow.

Структура:

```
┌──────────────────────────────────────────────────────┐
│  Edit Workflow: New Feature Module                   │
│                                                       │
│  Workflow Name                    Icon                │
│  ┌──────────────────────────┐    ┌────┐              │
│  │ New Feature Module       │    │ ⚙  │              │
│  └──────────────────────────┘    └────┘              │
│                                                       │
│  Description                                          │
│  ┌──────────────────────────────────────────────┐    │
│  │ Full cycle of creating a new module...        │    │
│  └──────────────────────────────────────────────┘    │
│                                                       │
│  Workflow Steps ⓘ                                    │
│  Define the sequence of steps that will be executed   │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │ 📋 Create Feature Plan                         │  │
│  │   Run ●  👁  ↑  ↓  >  🗑                      │  │
│  ├────────────────────────────────────────────────┤  │
│  │ 📋 Refine Plan Against Rules                   │  │
│  │   Run ●  👁  ↑  ↓  >  🗑                      │  │
│  ├────────────────────────────────────────────────┤  │
│  │ 📋 Implement Contracts                [expanded]│  │
│  │   Run ●  👁  ↑  ↓  ∨  🗑                      │  │
│  │  ┌──────────────────────────────────────────┐  │  │
│  │  │ Реализуй интерфейсы и типы согласно     │  │  │
│  │  │ плану. Создай необходимые файлы с       │  │  │
│  │  │ контрактами (interfaces, types, DTOs).  │  │  │
│  │  │ Не реализуй бизнес-логику...            │  │  │
│  │  └──────────────────────────────────────────┘  │  │
│  ├────────────────────────────────────────────────┤  │
│  │ ...                                             │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │              + Add Step                    ▾   │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│            [Cancel]           [Save Workflow]          │
└──────────────────────────────────────────────────────┘
```

Элементы управления каждого шага:
- **Run** (toggle) — зелёный/серый, включает/выключает шаг
- **👁** (toggle) — глазик, видимость вывода в чате
- **↑** — переместить шаг вверх
- **↓** — переместить шаг вниз
- **>** / **∨** — развернуть/свернуть текстовое поле с промптом
- **🗑** — удалить шаг

#### 5.1.3. WorkflowStepOutput (`webview-ui/src/components/workflow/WorkflowStepOutput.tsx`)

Обёртка для вывода агента на каждом шаге. Если шаг в тихом режиме — показывает свёрнутый блок. По клику раскрывается.

```
┌─────────────────────────────────────────┐
│ ✅ Lint Check — completed in 12s    [▸] │  ← тихий, свёрнутый
└─────────────────────────────────────────┘

↓ клик на [▸]

┌─────────────────────────────────────────┐
│ ✅ Lint Check — completed in 12s    [▾] │
│                                         │
│ > Running eslint...                     │
│ > 0 errors, 2 warnings                 │
│ > Done.                                 │
└─────────────────────────────────────────┘
```

### 5.2. Интеграция с существующим UI

#### В ShuncodeRulesToggleModal (вкладка Workflows)

Добавить кнопку **"Edit"** рядом с каждым `.yaml` workflow:
- Клик → открывает WorkflowEditor
- Обычные `.md` workflow показываются как раньше (toggle + open file)

#### В SlashCommandMenu

Без изменений — multi-step workflows уже будут появляться в списке слэш-команд через существующий механизм `getAvailableSlashCommands`.

#### В ChatView

Добавить рендеринг `WorkflowProgressCard` когда активен workflow. Компонент обновляется реактивно через `WorkflowProgressEvent` из SessionEvents.

---

## 6. Детальные изменения по файлам

### 6.1. Новые файлы

| Файл | Описание |
|-------|----------|
| `src/shared/workflow-types.ts` | Типы: WorkflowStep, WorkflowDefinition, WorkflowExecutionState |
| `src/core/workflow/WorkflowParser.ts` | Чтение/запись YAML файлов workflow |
| `src/core/workflow/WorkflowOrchestrator.ts` | Оркестратор последовательного выполнения шагов |
| `src/core/workflow/index.ts` | Реэкспорт |
| `proto/shuncode/workflow.proto` | Protobuf определения для WorkflowService |
| `webview-ui/src/components/workflow/WorkflowProgressCard.tsx` | Виджет прогресса |
| `webview-ui/src/components/workflow/WorkflowEditor.tsx` | Визуальный редактор workflow |
| `webview-ui/src/components/workflow/WorkflowStepRow.tsx` | Строка шага в редакторе |
| `webview-ui/src/components/workflow/WorkflowStepOutput.tsx` | Обёртка вывода шага (тихий/явный) |
| `webview-ui/src/components/workflow/index.ts` | Реэкспорт |

### 6.2. Изменяемые файлы

| Файл | Что меняется |
|-------|-------------|
| `src/core/slash-commands/index.ts` | Определение multi-step workflow, возврат `multiStepWorkflow` |
| `src/core/task/index.ts` | Поле `workflowOrchestrator`, метод `initiateStepLoop`, интеграция в `startTask` |
| `src/core/session/Pipeline.ts` | `workflowState`, `setWorkflowState`, `updateWorkflowState` |
| `src/core/session/SessionEvents.ts` | `WorkflowProgressEvent` |
| `src/core/session/Session.ts` | Форвард `WorkflowProgressEvent` |
| `src/core/controller/index.ts` | Обработчик gRPC для WorkflowService |
| `src/core/storage/disk.ts` | Без изменений (пути уже есть) |
| `proto/shuncode/file.proto` | Опционально: метод `loadWorkflow` |
| `webview-ui/src/components/shuncode-rules/ShuncodeRulesToggleModal.tsx` | Кнопка Edit для .yaml workflows |
| `webview-ui/src/components/chat/ChatView.tsx` | Рендеринг WorkflowProgressCard |
| `webview-ui/src/context/ExtensionStateContext.tsx` | `workflowExecutionState` |
| `webview-ui/src/i18n/locales/en.json` | Переводы для workflow UI |
| `webview-ui/src/i18n/locales/ru.json` | Переводы для workflow UI |
| `esbuild.mjs` | Добавить `js-yaml` в external (если ещё нет) |

---

## 7. Пошаговый план реализации

### Фаза 1: Модель данных и парсер (2-3 дня)

1. Создать `src/shared/workflow-types.ts` с типами
2. Создать `src/core/workflow/WorkflowParser.ts` — парсинг и сериализация YAML
3. Написать тесты для WorkflowParser:
   - Валидный YAML → WorkflowDefinition
   - Невалидный YAML → ошибка с понятным сообщением
   - Дефолтные значения (enabled=true, visible=true)
   - Пустые steps → ошибка
4. Убедиться что `js-yaml` доступен (уже есть в зависимостях)

### Фаза 2: Оркестратор (4-5 дней)

1. Создать `src/core/workflow/WorkflowOrchestrator.ts`
2. Добавить `initiateStepLoop` в Task
3. Интегрировать оркестратор в flow запуска задачи:
   - `parseSlashCommands` → определяет multi-step
   - `startTask` → создаёт WorkflowOrchestrator если multi-step
   - Вместо `initiateTaskLoop` → `orchestrator.execute()`
4. Реализовать передачу контекста между шагами (через общую conversation history)
5. Реализовать auto-condense между шагами при переполнении context window
6. Обработка Cancel: остановка текущего шага, graceful завершение
7. Обработка ошибок: пометить шаг как failed, остановить workflow
8. Написать интеграционные тесты

### Фаза 3: Pipeline и события (2 дня)

1. Расширить `Pipeline` — `workflowState`, методы обновления
2. Добавить `WorkflowProgressEvent` в `SessionEvents`
3. Прокинуть события через `Session` на фронтенд
4. Protobuf определения в `proto/shuncode/workflow.proto`
5. gRPC хендлеры для загрузки/сохранения workflow

### Фаза 4: WorkflowProgressCard (2-3 дня)

1. Создать `WorkflowProgressCard.tsx` — виджет прогресса
2. Интегрировать в ChatView — показывать при активном workflow
3. Стилизация: иконки статусов, анимация спиннера, тихий режим
4. Реактивное обновление через WorkflowProgressEvent
5. Свёрнутые блоки для тихих шагов (WorkflowStepOutput)

### Фаза 5: WorkflowEditor (5-7 дней)

1. Создать `WorkflowEditor.tsx` — полный визуальный редактор
2. Реализовать элементы управления:
   - Название и описание
   - Список шагов с toggle'ами
   - Раскрытие/свёртывание промпта шага
   - Перемещение шагов (↑↓)
   - Добавление/удаление шагов
3. Сохранение через gRPC → WorkflowParser → YAML файл
4. Кнопка "+ New Workflow" в ShuncodeRulesToggleModal
5. Кнопка "Edit" для существующих .yaml workflow
6. Создание workflow из шаблона

### Фаза 6: Полировка и тесты (2-3 дня)

1. i18n: добавить переводы (ru + en)
2. Edge cases:
   - Workflow с одним шагом
   - Workflow с 0 включённых шагов
   - Workflow прерван на последнем шаге
   - Context window переполнение на 20 шагах
   - Файл workflow изменён во время выполнения
3. Тесты:
   - Unit: WorkflowParser, WorkflowOrchestrator
   - Integration: полный цикл (запуск → шаги → завершение)
4. Обновить документацию
5. Обновить ROADMAP.md

---

## 8. Edge Cases и обработка ошибок

### 8.1. Context window overflow

На 15+ шагах conversation history может переполнить context window. Решение:

1. После каждого шага — проверять заполненность context window (уже есть `getContextWindowInfo`)
2. Если заполнено > 70% — автоматически запустить condense (summarize) conversation history
3. Summary сохраняет ключевую информацию: что создано, какие файлы изменены, текущий статус
4. Настройка `useAutoCondense` уже есть — переиспользуем

### 8.2. Cancel во время выполнения

1. Пользователь нажимает Cancel
2. `taskState.abort = true` → текущий agent loop прерывается
3. WorkflowOrchestrator ловит abort → устанавливает `overallStatus = "cancelled"`
4. Текущий шаг помечается как `failed`, остальные остаются `pending`
5. UI обновляется → показывает что workflow отменён

### 8.3. Resume после Cancel

Опция 1 (MVP): не поддерживаем resume — workflow запускается заново.
Опция 2 (будущее): сохраняем `executionState` в disk, при resume — начинаем с первого `pending` шага.

### 8.4. Шаг без результата

Если агент не использует никакие тулы и не вызывает attempt_completion — стандартный механизм `consecutiveMistakeCount` сработает. После N попыток — шаг помечается как failed.

### 8.5. Файл workflow удалён во время выполнения

Не критично — `WorkflowDefinition` уже загружен в память. Workflow доработает с загруженным определением.

---

## 9. Будущие улучшения (не в MVP)

Эти фичи **НЕ** входят в первую реализацию, но учтены в архитектуре:

1. **Условные шаги** — шаг выполняется только если предыдущий вернул определённый результат
2. **Параллельные шаги** — несколько шагов выполняются одновременно
3. **Вложенные workflow** — шаг может вызвать другой workflow
4. **Переменные** — `{{module_name}}`, `{{base_path}}` подставляются в промпты
5. **Шаблоны шагов** — библиотека готовых шагов (lint, build, test, deploy)
6. **Resume** — продолжение workflow после остановки
7. **Drag & Drop** — перетаскивание шагов мышкой (вместо кнопок ↑↓)
8. **Import/Export** — шаринг workflow через JSON/YAML
9. **Marketplace** — каталог готовых workflow от сообщества
10. **Разные модели на разных шагах** — дешёвая модель для lint check, дорогая для implement

---

## 10. Проверка (Definition of Done)

### Функциональная проверка

- [ ] Создать workflow через UI (кнопка "+ New Workflow")
- [ ] Добавить 5+ шагов в редакторе
- [ ] Включить/выключить шаги, изменить видимость
- [ ] Изменить порядок шагов (↑↓)
- [ ] Сохранить workflow, проверить что YAML файл корректный
- [ ] Запустить workflow через `/workflow-name задача`
- [ ] Убедиться что агент последовательно выполняет шаги
- [ ] Убедиться что контекст передаётся между шагами
- [ ] Проверить что выключенные шаги пропускаются
- [ ] Проверить тихий режим — вывод свёрнут, по клику раскрывается
- [ ] Проверить Cancel — workflow останавливается корректно
- [ ] Проверить что виджет прогресса обновляется в реальном времени
- [ ] Проверить что старые .md workflow продолжают работать

### Технические проверки

- [ ] Сборка extension: `node esbuild.mjs` — без ошибок
- [ ] Сборка webview: `npm run build` в webview-ui/ — без ошибок
- [ ] Тесты WorkflowParser — проходят
- [ ] Тесты WorkflowOrchestrator — проходят
- [ ] Запуск через `.\scripts\code.bat` — Shuncode работает
- [ ] Нет регрессий в существующем функционале (rules, slash commands)

---

## 11. Зависимости

- **js-yaml** — уже есть в зависимостях (используется в `frontmatter.ts`)
- **ulid** — уже есть (используется в Task)
- **Protobuf** — существующая инфраструктура gRPC
- **Pipeline/Session** — существующие классы, расширяем
- **Нет внешних новых зависимостей**

---

## 12. Риски

| Риск | Вероятность | Влияние | Митигация |
|------|------------|---------|-----------|
| Context window overflow на 15+ шагах | Высокая | Среднее | Auto-condense между шагами |
| Агент не понимает что нужно завершить шаг | Средняя | Среднее | Чёткие инструкции в промпте шага, attempt_completion |
| Слабые модели не справляются с multi-step | Высокая | Низкое | Это OK — workflow рассчитаны на сильные модели |
| UI редактора сложный, много edge cases | Средняя | Среднее | MVP: минимальный редактор, расширяем итерационно |
| Конфликт с focus chain / task progress | Низкая | Среднее | Workflow progress отдельный виджет, не пересекается |
