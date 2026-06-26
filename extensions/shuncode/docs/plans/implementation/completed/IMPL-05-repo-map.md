# IMPL-05: Repo Map (Карта репозитория)

> Приоритет: ВЫСОКИЙ
> Оценка: 4-6 часов
> Зависимости: нет

---

## Цель

Создать "оглавление" проекта — список всех файлов с их экспортируемыми символами (функции, классы, интерфейсы). Это даёт ИИ обзор всего проекта без чтения каждого файла. Аналог Aider's repo-map.

## Результат

- При каждой задаче ИИ получает компактную карту проекта в `environment_details`
- Карта содержит файлы + экспортируемые символы (function, class, interface, export)
- Обновляется при изменении файлов (debounced)
- Не больше 3000-5000 токенов

---

## Архитектура

```
FileWatcher (уже есть) → RepoMapGenerator → кэш в памяти
                                                   ↓
                              environment_details → "Project structure:" section
```

---

## Файлы

1. **СОЗДАТЬ:** `src/core/indexing/RepoMapGenerator.ts` — генератор карты
2. **ИЗМЕНИТЬ:** `src/core/prompts/system-prompt/components/system_info.ts` — добавить карту в environment_details

---

## Шаг 1: Создать RepoMapGenerator

**Файл:** `src/core/indexing/RepoMapGenerator.ts`

```typescript
import * as fs from "node:fs/promises"
import * as path from "node:path"

/**
 * RepoMapGenerator — creates a compact "table of contents" of the project.
 * Extracts exported symbols (functions, classes, interfaces) from source files
 * using simple regex (no tree-sitter dependency for speed).
 */

interface FileSignature {
	relativePath: string
	symbols: string[]
}

// Patterns to extract exported symbols
const EXPORT_PATTERNS: RegExp[] = [
	/^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/gm,
	/^export\s+(?:default\s+)?class\s+(\w+)/gm,
	/^export\s+(?:default\s+)?interface\s+(\w+)/gm,
	/^export\s+(?:default\s+)?type\s+(\w+)/gm,
	/^export\s+(?:default\s+)?enum\s+(\w+)/gm,
	/^export\s+(?:default\s+)?const\s+(\w+)/gm,
	// Python
	/^def\s+(\w+)\s*\(/gm,
	/^class\s+(\w+)/gm,
	// Rust
	/^pub\s+(?:async\s+)?fn\s+(\w+)/gm,
	/^pub\s+struct\s+(\w+)/gm,
	/^pub\s+enum\s+(\w+)/gm,
	/^pub\s+trait\s+(\w+)/gm,
	// Go
	/^func\s+(\w+)/gm,
	/^type\s+(\w+)\s+struct/gm,
	/^type\s+(\w+)\s+interface/gm,
]

const SOURCE_EXTENSIONS = new Set([
	".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go",
	".java", ".kt", ".cs", ".cpp", ".c", ".h", ".hpp",
	".rb", ".php", ".swift", ".scala",
])

const IGNORE_DIRS = new Set([
	"node_modules", ".git", "dist", "build", "out", ".next",
	"__pycache__", ".venv", "venv", "coverage", ".cache",
	"vendor", "target",
])

const MAX_FILE_SIZE = 100 * 1024 // 100KB
const MAX_FILES = 500
const MAX_SYMBOLS_PER_FILE = 20

export class RepoMapGenerator {
	private cache: string | null = null
	private cacheTimestamp: number = 0
	private readonly CACHE_TTL = 30_000 // 30 seconds

	constructor(private readonly rootDir: string) {}

	/**
	 * Generate (or return cached) repo map.
	 * @param maxChars Max characters in the output (default 8000 ≈ 3000 tokens)
	 */
	async generate(maxChars: number = 8000): Promise<string> {
		const now = Date.now()
		if (this.cache && now - this.cacheTimestamp < this.CACHE_TTL) {
			return this.cache
		}

		const signatures = await this.collectSignatures()
		const map = this.formatMap(signatures, maxChars)
		this.cache = map
		this.cacheTimestamp = now
		return map
	}

	/** Invalidate cache (call on file changes) */
	invalidate(): void {
		this.cache = null
	}

	private async collectSignatures(): Promise<FileSignature[]> {
		const results: FileSignature[] = []
		await this.walkDir(this.rootDir, "", results)
		// Sort: files with more symbols first (more important)
		results.sort((a, b) => b.symbols.length - a.symbols.length)
		return results.slice(0, MAX_FILES)
	}

	private async walkDir(
		dir: string,
		relativeTo: string,
		results: FileSignature[],
	): Promise<void> {
		let entries
		try {
			entries = await fs.readdir(dir, { withFileTypes: true })
		} catch {
			return
		}

		for (const entry of entries) {
			if (results.length >= MAX_FILES) break

			const fullPath = path.join(dir, entry.name)
			const relPath = relativeTo ? `${relativeTo}/${entry.name}` : entry.name

			if (entry.isDirectory()) {
				if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
					await this.walkDir(fullPath, relPath, results)
				}
			} else if (entry.isFile()) {
				const ext = path.extname(entry.name).toLowerCase()
				if (!SOURCE_EXTENSIONS.has(ext)) continue

				try {
					const stat = await fs.stat(fullPath)
					if (stat.size > MAX_FILE_SIZE) continue

					const content = await fs.readFile(fullPath, "utf-8")
					const symbols = this.extractSymbols(content)

					if (symbols.length > 0) {
						results.push({
							relativePath: relPath,
							symbols: symbols.slice(0, MAX_SYMBOLS_PER_FILE),
						})
					} else {
						// Include file even without symbols (shows project structure)
						results.push({ relativePath: relPath, symbols: [] })
					}
				} catch {
					// Skip files that can't be read
				}
			}
		}
	}

	private extractSymbols(content: string): string[] {
		const symbols = new Set<string>()

		for (const pattern of EXPORT_PATTERNS) {
			// Reset regex state
			pattern.lastIndex = 0
			let match
			while ((match = pattern.exec(content)) !== null) {
				if (match[1] && match[1].length > 1) {
					symbols.add(match[1])
				}
			}
		}

		return Array.from(symbols)
	}

	private formatMap(signatures: FileSignature[], maxChars: number): string {
		if (signatures.length === 0) return ""

		const lines: string[] = []
		let totalChars = 0

		for (const sig of signatures) {
			let line: string
			if (sig.symbols.length > 0) {
				line = `${sig.relativePath}: ${sig.symbols.join(", ")}`
			} else {
				line = sig.relativePath
			}

			if (totalChars + line.length + 1 > maxChars) break
			lines.push(line)
			totalChars += line.length + 1
		}

		return lines.join("\n")
	}
}
```

---

## Шаг 2: Интегрировать в environment_details

Нужно найти где формируется `environment_details` в системном промпте.

**Найти файл:** `src/core/prompts/system-prompt/components/system_info.ts` (файл где формируется `SYSTEM_INFO` секция).

Найти место где генерируется строка с информацией об окружении (working directory, open files, etc.).

**Добавить после секции о файлах проекта:**

```typescript
// Repo map — project structure with symbols
const repoMapGenerator = new RepoMapGenerator(context.cwd)
const repoMap = await repoMapGenerator.generate(6000)
if (repoMap) {
	result += `\n\nProject Structure (exported symbols):\n${repoMap}`
}
```

**ВАЖНО:** `RepoMapGenerator` должен быть создан один раз и переиспользоваться (синглтон или хранение в Controller). Создание нового на каждый запрос — допустимо для первой версии (кэш 30 секунд спасёт), но в будущем стоит оптимизировать.

---

## Шаг 3: Инвалидация кэша при изменении файлов

Если в проекте есть `FileWatcher` (в `IndexingService`) — добавить вызов `repoMapGenerator.invalidate()` при изменении файлов.

Если FileWatcher недоступен — кэш с TTL 30 секунд достаточен для начала.

---

## Проверка

1. Собрать расширение, открыть проект
2. Отправить любое сообщение в чат
3. В ответе ИИ должен быть виден контекст проекта (может ссылаться на файлы которые не читал)
4. Проверить что карта не слишком большая (< 8000 символов)
5. Проверить что `node_modules`, `.git`, `dist` не попадают в карту
