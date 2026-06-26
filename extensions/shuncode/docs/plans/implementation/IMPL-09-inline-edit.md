# IMPL-09: Inline Edit (Ctrl+K)

> Приоритет: ВЫСОКИЙ
> Оценка: 8-16 часов
> Зависимости: нет

---

## Цель

Добавить возможность редактирования выделенного кода прямо в редакторе (без чата). Пользователь выделяет код → нажимает Ctrl+K → пишет инструкцию → ИИ генерирует изменения inline.

## Результат

- `Ctrl+K` на выделенном коде открывает миниатюрное поле ввода прямо в редакторе
- Пользователь пишет инструкцию ("добавь обработку ошибок", "переименуй в X")
- ИИ генерирует diff для выделенного фрагмента
- Результат показывается как inline diff (через существующую diff систему)

---

## Архитектура

```
Ctrl+K → InlineEditWidget (input field в редакторе)
       → InlineEditController
       → LLM API (специальный компактный промпт)
       → Diff показывается через существующий DiffStore + InlineDiffRenderer
```

---

## Файлы для создания

1. `src/core/inline-edit/InlineEditController.ts` — основная логика
2. `src/core/inline-edit/InlineEditPrompt.ts` — промпт для inline edit
3. `src/core/inline-edit/InlineEditWidget.ts` — UI виджет (VS Code Decoration/ViewZone)

---

## Шаг 1: Зарегистрировать команду

**Файл:** `src/extension.ts` или `package.json`

В `package.json` (`contributes.commands` и `contributes.keybindings`):

```json
{
  "command": "shuncode.inlineEdit",
  "title": "Shuncode: Inline Edit",
  "key": "ctrl+k",
  "when": "editorTextFocus && editorHasSelection"
}
```

**ВАЖНО:** `Ctrl+K` может конфликтовать со встроенными VS Code bindings (Ctrl+K — это chord key). Рассмотреть альтернативу `Ctrl+Shift+K` или `Ctrl+K Ctrl+K`. Проверить конфликты:
```
Ctrl+K — chord prefix в VS Code (Ctrl+K, Ctrl+C = comment)
```

Безопасные варианты:
- `Ctrl+Shift+K` — свободен
- `Ctrl+K Enter` — chord (Ctrl+K, затем Enter)
- `Ctrl+I` — как в Cursor (но может быть занят)

Для первой версии: `Ctrl+Shift+K` — самый безопасный.

---

## Шаг 2: Создать InlineEditWidget

Это самая сложная часть. Нужен UI элемент прямо в редакторе.

**Вариант 1 (простой): InputBox**

Использовать `vscode.window.showInputBox()` — модальное окно с вводом текста. Не inline, но работает "из коробки":

```typescript
import * as vscode from "vscode"

export async function showInlineEditInput(): Promise<string | undefined> {
	return vscode.window.showInputBox({
		prompt: "Что сделать с выделенным кодом?",
		placeHolder: "Добавь обработку ошибок, переименуй, рефакторинг...",
	})
}
```

**Вариант 2 (красивый): View Zone**

Использовать `editor.changeViewZones()` для вставки HTML-виджета прямо между строками кода. Это то что делает Cursor. У нас уже есть механизм View Zones в DiffSystem.

Для первой версии — **Вариант 1 (InputBox).** Вариант 2 можно доделать потом.

---

## Шаг 3: Создать промпт для inline edit

**Файл:** `src/core/inline-edit/InlineEditPrompt.ts`

```typescript
/**
 * Build a compact prompt for inline code editing.
 * This prompt is much shorter than the main system prompt —
 * focused only on editing the selected code.
 */
export function buildInlineEditPrompt(
	instruction: string,
	selectedCode: string,
	filePath: string,
	language: string,
	beforeContext: string,  // ~10 lines before selection
	afterContext: string,   // ~10 lines after selection
): string {
	return `You are a code editor. Edit the selected code according to the instruction.

File: ${filePath}
Language: ${language}

Code before selection:
\`\`\`${language}
${beforeContext}
\`\`\`

Selected code (EDIT THIS):
\`\`\`${language}
${selectedCode}
\`\`\`

Code after selection:
\`\`\`${language}
${afterContext}
\`\`\`

Instruction: ${instruction}

Rules:
- Return ONLY the edited code that replaces the selection
- Do NOT include the before/after context
- Do NOT include markdown code fences
- Do NOT explain — just return the code
- Preserve indentation style
- If the instruction is unclear, make a reasonable assumption`
}
```

---

## Шаг 4: Создать InlineEditController

**Файл:** `src/core/inline-edit/InlineEditController.ts`

```typescript
import * as vscode from "vscode"
import { buildInlineEditPrompt } from "./InlineEditPrompt"
import { showInlineEditInput } from "./InlineEditWidget"

// You'll need to import the API client that sends requests to the LLM
// This depends on how the existing system makes API calls.
// Look at how the main chat sends messages — find the ApiHandler or similar.

export class InlineEditController {
	constructor(
		// Dependencies — inject whatever is needed for LLM calls
		private readonly getApiHandler: () => any, // Replace with actual type
	) {}

	async execute(): Promise<void> {
		const editor = vscode.window.activeTextEditor
		if (!editor) return

		const selection = editor.selection
		if (selection.isEmpty) {
			vscode.window.showInformationMessage("Выделите код для редактирования")
			return
		}

		// Get instruction from user
		const instruction = await showInlineEditInput()
		if (!instruction) return

		// Get selected code and context
		const document = editor.document
		const selectedCode = document.getText(selection)
		const filePath = vscode.workspace.asRelativePath(document.uri)
		const language = document.languageId

		// Get surrounding context (10 lines before/after)
		const startLine = Math.max(0, selection.start.line - 10)
		const endLine = Math.min(document.lineCount - 1, selection.end.line + 10)

		const beforeRange = new vscode.Range(startLine, 0, selection.start.line, 0)
		const afterRange = new vscode.Range(
			selection.end.line + 1, 0,
			endLine + 1, 0,
		)

		const beforeContext = document.getText(beforeRange)
		const afterContext = document.getText(afterRange)

		// Build prompt
		const prompt = buildInlineEditPrompt(
			instruction,
			selectedCode,
			filePath,
			language,
			beforeContext,
			afterContext,
		)

		// Show progress
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "Shuncode: Inline Edit...",
				cancellable: true,
			},
			async (progress, token) => {
				try {
					// Call LLM
					// TODO: Use the actual API handler from the project.
					// Look at how ApiHandler.createMessage() works in the main chat flow.
					// You need a simple completion (not a multi-turn chat).
					//
					// Example pseudo-code:
					// const response = await this.getApiHandler().complete(prompt)
					// const newCode = response.text

					const newCode = "TODO: implement LLM call"

					if (token.isCancellationRequested || !newCode) return

					// Apply the edit
					await editor.edit((editBuilder) => {
						editBuilder.replace(selection, newCode)
					})

					// Optionally: show as diff instead of direct replacement
					// Use DiffStore.addHunks() to show inline diff that user can accept/reject
				} catch (error) {
					vscode.window.showErrorMessage(
						`Inline Edit failed: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			},
		)
	}
}
```

**ВАЖНО:** Самая сложная часть — подключение к LLM API. Нужно найти как текущая система делает API-вызовы. Поищи:
```bash
rg "createMessage\|completePrompt\|sendMessage\|ApiHandler" --type ts
```

Найди класс который принимает промпт и возвращает текст. Используй его вместо `TODO: implement LLM call`.

---

## Шаг 5: Зарегистрировать команду в extension.ts

В `src/extension.ts` (или где регистрируются команды расширения):

```typescript
const inlineEditController = new InlineEditController(getApiHandler)
context.subscriptions.push(
	vscode.commands.registerCommand("shuncode.inlineEdit", () => {
		inlineEditController.execute()
	})
)
```

---

## Шаг 6 (опционально): Показать через DiffSystem вместо прямой замены

Вместо `editBuilder.replace()` можно показать результат через существующий DiffStore:
```typescript
// Вместо прямой замены:
const hunk = {
	filePath: document.uri.fsPath,
	startLine: selection.start.line,
	endLine: selection.end.line,
	originalContent: selectedCode,
	newContent: newCode,
}
// Добавить в DiffStore → показать inline diff → пользователь Accept/Reject
```

Это более безопасный подход (пользователь видит что изменилось). Но требует интеграции с DiffStore.

---

## Проверка

1. Открыть TypeScript файл
2. Выделить функцию
3. Нажать Ctrl+Shift+K
4. Ввести "добавь обработку ошибок try/catch"
5. ИИ должен сгенерировать новую версию кода
6. Код должен заменить выделение (или показать diff)
7. Проверить: пустое выделение → сообщение "Выделите код"
8. Проверить: отмена ввода (Escape) → ничего не происходит
