# IMPL-03: Улучшение системного промпта

> Приоритет: КРИТИЧЕСКИЙ (P1-2 из ROADMAP)
> Оценка: 4-6 часов
> Зависимости: нет

---

## Цель

Добавить в системный промпт секции из Cursor, которые улучшают качество работы ИИ: git safety, параллельные tool calls, linting workflow, code citing, tone/style.

## Результат

- ИИ не ломает git (не делает force push, не amend чужие коммиты)
- ИИ проверяет lint после редактирования файлов
- ИИ делает независимые tool calls параллельно
- ИИ не начинает ответы с "Great", "Certainly" (уже есть, но усилить)

---

## Файлы

- `src/core/prompts/system-prompt/components/rules.ts` — основные правила

---

## Шаг 1: Добавить секции в rules.ts

**Файл:** `src/core/prompts/system-prompt/components/rules.ts`

Найти конец строки `getRulesTemplateText` (длинный template literal, перед закрывающим обратным апострофом `` ` ``).

**Найти последнюю строку правил** (заканчивается на `MCP operations should be used one at a time...`):

```
- MCP operations should be used one at a time, similar to other tool usage. Wait for confirmation of success before proceeding with additional operations.`
```

**Вставить ПЕРЕД закрывающим апострофом** (т.е. перед `` ` `` на этой строке) следующие правила:

```

- LINTING WORKFLOW: After editing code files, if a linting/diagnostic tool is available (read_diagnostics), check the edited file for errors. If you introduced new errors, fix them immediately. Do not leave files with syntax or lint errors that you caused.
- PARALLEL TOOL CALLS: When you need to perform multiple independent operations (e.g., reading several files, searching in different directories), issue them together rather than sequentially. However, if operations depend on each other (e.g., read a file then edit it based on contents), they must be sequential.
- GIT SAFETY: Never run destructive git commands (push --force, hard reset, rebase -i) unless the user explicitly requests them. Never amend commits you did not create. Never skip git hooks (--no-verify). Always use the dedicated file editing tools instead of git commands to modify files.
- COMMUNICATION STYLE: Be direct and technical. Never start messages with filler words like "Great", "Certainly", "Okay", "Sure", "Of course". State what you did or will do. Example: instead of "Great, I've updated the CSS", say "Updated the CSS to fix the layout issue."
- When committing code with git, write concise commit messages that focus on WHY the change was made, not WHAT was changed (the diff shows that). Use conventional format when possible.
```

**ВАЖНО:** Эти строки нужно добавить ВНУТРИ template literal, перед закрывающим `` ` ``. Не создавай новую строку после `` ` `` — это сломает синтаксис.

---

## Шаг 2: Проверить компиляцию

```bash
cd vscode/extensions/shuncode
node esbuild.mjs
```

Ошибок быть не должно. Если есть — проблема скорее всего в экранировании обратных апострофов или кавычек внутри template literal.

---

## Шаг 3: Проверить что правила попадают в промпт

Можно временно добавить `console.log` в функцию `getRulesSection`:

```typescript
export async function getRulesSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	// ... existing code ...
	const result = new TemplateEngine().resolve(template, context, { ... })
	console.log("[RULES] Length:", result.length) // Временно — убрать после проверки
	return result
}
```

Запустить Shuncode AI, отправить сообщение, в Output (Extension Host) увидеть длину правил. Должна быть больше чем раньше.

---

## Проверка

1. Собрать расширение, запустить Shuncode AI
2. Попросить ИИ: "сделай git commit" — должен использовать безопасные команды, не force push
3. Попросить отредактировать файл — после редактирования должен проверить lint
4. Попросить прочитать 3 файла — должен выполнить 3 read_file параллельно (если модель поддерживает)
5. Проверить что ответы не начинаются с "Great", "Certainly"
