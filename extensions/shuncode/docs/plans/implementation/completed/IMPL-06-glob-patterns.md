# IMPL-06: Glob patterns для list_files

> Приоритет: СРЕДНИЙ (P2-4 из ROADMAP)
> Оценка: 2-4 часа
> Зависимости: нет

---

## Цель

Расширить инструмент `list_files` (или создать отдельный `glob`) чтобы поддерживать glob-паттерны: `**/*.ts`, `**/test/**`, `src/**/*.{ts,tsx}`. Сейчас `list_files` умеет только рекурсивный листинг директории — нет фильтрации по паттерну.

## Результат

- ИИ может найти все `.ts` файлы в проекте: `**/*.ts`
- ИИ может найти тесты: `**/test/**/*.test.ts`
- Работает как отдельный tool `glob` (аналог Cursor)

---

## Файлы для изменения/создания

1. **СОЗДАТЬ:** `src/core/task/tools/handlers/GlobToolHandler.ts` — handler нового инструмента
2. **ИЗМЕНИТЬ:** `src/shared/tools.ts` — добавить `GLOB` в список инструментов
3. **ИЗМЕНИТЬ:** `src/core/prompts/system-prompt/tools/init.ts` — зарегистрировать tool spec
4. **СОЗДАТЬ:** `src/core/prompts/system-prompt/tools/glob.ts` — tool spec (описание для ИИ)
5. **ИЗМЕНИТЬ:** `src/core/task/ToolExecutor.ts` — добавить case для `glob`
6. **ИЗМЕНИТЬ:** `src/core/prompts/system-prompt/variants/generic/config.ts` — добавить `GLOB` в список tools

---

## Шаг 1: Установить glob library

В проекте уже может быть `fast-glob` или `glob`. Проверить:

```bash
cd vscode/extensions/shuncode
npm ls glob fast-glob globby
```

Если нет — установить:
```bash
npm install fast-glob
```

---

## Шаг 2: Создать tool spec

**Создать файл:** `src/core/prompts/system-prompt/tools/glob.ts`

```typescript
export const globToolSpec = `## glob
Description: Find files matching a glob pattern in the project directory. Returns matching file paths sorted by modification time.
Parameters:
- pattern: (required) The glob pattern to match files against. Patterns are automatically searched recursively. Examples: "*.ts" finds all .ts files, "**/test/**/*.test.ts" finds test files, "src/**/*.{ts,tsx}" finds TypeScript files in src.
- path: (optional) Directory to search in, relative to the project root. Defaults to project root.
Usage:
<glob>
<pattern>**/*.ts</pattern>
<path>src</path>
</glob>
`
```

---

## Шаг 3: Зарегистрировать инструмент

**Файл:** `src/shared/tools.ts`

Найти enum или объект `ShuncodeDefaultTool`. Добавить:

```typescript
GLOB = "glob",
```

---

## Шаг 4: Зарегистрировать tool spec в init.ts

**Файл:** `src/core/prompts/system-prompt/tools/init.ts`

Найти массив/маппинг tool specs. Добавить импорт и регистрацию `globToolSpec` по аналогии с другими tools.

---

## Шаг 5: Создать handler

**Создать файл:** `src/core/task/tools/handlers/GlobToolHandler.ts`

```typescript
import * as path from "node:path"
import fg from "fast-glob"

interface GlobToolParams {
	pattern: string
	path?: string
}

export async function handleGlobTool(
	params: GlobToolParams,
	cwd: string,
): Promise<string> {
	const { pattern, path: searchPath } = params

	if (!pattern) {
		return "Error: pattern parameter is required"
	}

	const baseDir = searchPath
		? path.resolve(cwd, searchPath)
		: cwd

	try {
		const files = await fg(pattern, {
			cwd: baseDir,
			dot: false,
			ignore: [
				"**/node_modules/**",
				"**/.git/**",
				"**/dist/**",
				"**/build/**",
				"**/.next/**",
				"**/coverage/**",
			],
			onlyFiles: true,
			stats: true,
			absolute: false,
		})

		// Sort by modification time (newest first)
		files.sort((a, b) => {
			const aTime = a.stats?.mtimeMs ?? 0
			const bTime = b.stats?.mtimeMs ?? 0
			return bTime - aTime
		})

		if (files.length === 0) {
			return `No files found matching pattern "${pattern}" in ${searchPath || "project root"}`
		}

		// Limit output
		const MAX_FILES = 200
		const truncated = files.length > MAX_FILES
		const displayFiles = files.slice(0, MAX_FILES)

		const result = displayFiles.map(f => {
			const relativePath = searchPath
				? path.join(searchPath, f.path)
				: f.path
			return relativePath
		}).join("\n")

		const header = `Found ${files.length} file(s) matching "${pattern}"${searchPath ? ` in ${searchPath}` : ""}:`
		const footer = truncated ? `\n... and ${files.length - MAX_FILES} more files (truncated)` : ""

		return `${header}\n${result}${footer}`
	} catch (error) {
		return `Error searching for files: ${error instanceof Error ? error.message : String(error)}`
	}
}
```

---

## Шаг 6: Подключить handler в ToolExecutor

**Файл:** `src/core/task/ToolExecutor.ts`

Найти switch/case или if-chain где обрабатываются разные tool names. Добавить case для `"glob"`:

```typescript
case "glob": {
	const pattern = toolParams.pattern || ""
	const searchPath = toolParams.path || ""
	const result = await handleGlobTool({ pattern, path: searchPath }, this.cwd)
	// ... отправить результат через say/ask по аналогии с другими tools
	break
}
```

**ВАЖНО:** Точный синтаксис зависит от структуры ToolExecutor. Посмотри как реализованы соседние handlers (например `search_files` или `list_files`) и сделай по аналогии.

---

## Шаг 7: Добавить в variant config

**Файл:** `src/core/prompts/system-prompt/variants/generic/config.ts`

В массив `.tools(...)` добавить `ShuncodeDefaultTool.GLOB`.

Также добавить в другие variant configs (next-gen, gpt-5, etc.) если хочешь чтобы glob был доступен для всех моделей.

---

## Проверка

1. Собрать расширение: `node esbuild.mjs` — без ошибок
2. Открыть проект, в чате написать: "найди все TypeScript файлы в проекте"
3. ИИ должен вызвать `glob` с паттерном `**/*.ts` (или аналогичным)
4. Результат должен показать список `.ts` файлов
5. Проверить: "найди все тестовые файлы" → `**/*.test.{ts,tsx,js}`
6. Проверить ограничение: паттерн не должен возвращать файлы из `node_modules`, `.git`
