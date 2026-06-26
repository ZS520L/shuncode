> **Русская версия:** [context-management.md](../ru/architecture/context-management.md)

# Context Management

How Shuncode handles chat history accumulation, when and why context compression happens.

## The Problem

During extended chat sessions, message history grows continuously: every user prompt, model response, and tool call result accumulates in `apiConversationHistory`. Models have limited context windows (64k–200k tokens), and exceeding the limit causes API errors.

## Two Compression Strategies

### 1. Legacy Truncation

Active when `useAutoCondense = false` or the model doesn't support summarization.

**Algorithm:**
1. After each API request, checks if `totalTokens >= maxAllowedSize`
2. If threshold exceeded — first attempts to optimize file reads (`attemptFileReadOptimizationCore`): duplicate reads of the same file are replaced with stubs
3. If optimization saved < 30% — performs truncation: removes messages from the middle of history (preserves first user/assistant pair and recent messages)
4. Inserts a notice into the first assistant message about deleted history

**Buffer calculation** (reserves space for response generation):

```
contextWindow  64k  → maxAllowed = 64k  - 27k = 37k
contextWindow 128k  → maxAllowed = 128k - 30k = 98k
contextWindow 200k  → maxAllowed = 200k - 40k = 160k
default             → maxAllowed = max(contextWindow - 40k, contextWindow * 0.8)
```

### 2. Auto-Condensation (Summarization)

Active when `useAutoCondense = true` AND the model supports tool calls.

**Algorithm:**
1. Before each API request, checks `shouldCompactContextWindow()`
2. If threshold exceeded — first attempts file read optimization
3. If insufficient — appends a `summarizeTask` prompt to the user message
4. The model generates a structured summary via `summarize_task` tool call:
   - Primary task and user intentions
   - Technical decisions and patterns
   - Modified files and key code
   - Unresolved tasks and next step
   - "Required Files" list for automatic re-reading
5. `SummarizeTaskHandler` replaces the entire old history with the summary as a continuation prompt, and automatically re-reads up to 8 files from the Required Files list

**Threshold configuration:**
- `autoCondenseThreshold` — value from 0 to 1, default **0.75**
- UI: click the context window progress bar in the chat header
- Keyboard: ←/→ (5% step), Shift+←/→ (10% step)

## Error Handling

If context still overflows despite optimizations, `context-error-handling.ts` detects provider-specific errors (OpenAI, Anthropic, OpenRouter, Bedrock, etc.) and triggers graceful recovery.

## Key Files

| File | Purpose |
|------|---------|
| `src/core/context/context-management/ContextManager.ts` | Main logic: threshold check, file optimization, truncation |
| `src/core/context/context-management/context-window-utils.ts` | `contextWindow` and `maxAllowedSize` calculation |
| `src/core/context/context-management/context-error-handling.ts` | Provider error detection |
| `src/core/prompts/contextManagement.ts` | `summarizeTask` prompt for LLM summarization |
| `src/core/task/tools/handlers/SummarizeTaskHandler.ts` | `summarize_task` tool call handler |
