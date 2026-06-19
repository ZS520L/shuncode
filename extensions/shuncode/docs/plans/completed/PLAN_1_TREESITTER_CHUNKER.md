# План 1: Tree-sitter Chunker [ВЫПОЛНЕНО]

## Статус: ВЫПОЛНЕНО (2026-02-06)

## Цель

Заменить текущий упрощённый `CodeChunker.ts` (разбивка по пустым строкам) на чанкер, основанный на tree-sitter. Tree-sitter понимает синтаксис языка и разбивает файл по функциям, классам, методам и другим структурным единицам. Результат: меньше чанков (44K → ~18K), каждый чанк — осмысленный блок кода, выше точность поиска.

## Важно

- WASM-файлы tree-sitter уже есть в проекте: `vscode/extensions/shuncode/dist/tree-sitter-*.wasm`
- Пакет `web-tree-sitter` уже установлен (используется в другом месте проекта)
- Текущий `CodeChunker.ts` НЕ УДАЛЯТЬ — он станет fallback для языков без tree-sitter парсера
- Интерфейс `CodeChunk` из `src/shared/IndexingTypes.ts` НЕ МЕНЯТЬ
- Функция `chunkFile(filePath, contents): CodeChunk[]` должна сохранить ту же сигнатуру

## Файлы

### Файл 1: `src/core/indexing/TreeSitterChunker.ts` (НОВЫЙ)

Создать новый файл. Это основной модуль.

Содержание:

```typescript
import * as path from "node:path"
import type { CodeChunk } from "@shared/IndexingTypes"
import { v4 as uuidv4 } from "uuid"

// --- Константы ---

// Максимальный размер чанка в строках. Если AST-узел больше — разбить с overlap.
const MAX_CHUNK_LINES = 80

// Минимальный размер чанка. Мелкие узлы объединяются с соседями.
const MIN_CHUNK_LINES = 3

// Overlap при разбивке слишком больших узлов.
const OVERLAP_LINES = 5

// Маппинг расширений на имена tree-sitter WASM-файлов.
// Ключ — расширение файла, значение — имя WASM без "tree-sitter-" и ".wasm".
// Пример: ".ts" → "typescript" → загрузится tree-sitter-typescript.wasm
const EXTENSION_TO_TREESITTER: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".cs": "c_sharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
}

// Типы AST-узлов, которые являются "чанкоразделителями" — каждый такой узел
// становится отдельным чанком (если не слишком мал).
// Эти имена стандартны для tree-sitter грамматик.
const CHUNK_NODE_TYPES = new Set([
  // Функции / методы
  "function_declaration",
  "function_definition",
  "method_definition",
  "method_declaration",
  "arrow_function",        // только top-level
  "function_item",         // Rust
  // Классы / структуры
  "class_declaration",
  "class_definition",
  "struct_item",           // Rust
  "impl_item",             // Rust
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "enum_item",             // Rust
  // Модули
  "module",
  "module_item",
  // Export statements (TypeScript/JS)
  "export_statement",
  // Python
  "decorated_definition",
])
```

Далее в этом же файле:

```typescript
// --- Singleton для tree-sitter ---

let Parser: any = null  // web-tree-sitter Parser class
const languageCache = new Map<string, any>()  // загруженные языки

/**
 * Инициализировать tree-sitter Parser.
 * Вызывается один раз при первом использовании.
 * @param wasmDir — абсолютный путь к папке с WASM-файлами (обычно extensionPath + "/dist")
 */
async function initParser(wasmDir: string): Promise<void> {
  if (Parser) return
  const TreeSitter = require("web-tree-sitter")
  await TreeSitter.init()
  Parser = new TreeSitter()
}

/**
 * Загрузить язык tree-sitter по имени.
 * @param langName — например "typescript", "python"
 * @param wasmDir — путь к WASM-файлам
 */
async function loadLanguage(langName: string, wasmDir: string): Promise<any | null> {
  if (languageCache.has(langName)) {
    return languageCache.get(langName)
  }
  const wasmPath = path.join(wasmDir, `tree-sitter-${langName}.wasm`)
  try {
    const TreeSitter = require("web-tree-sitter")
    const lang = await TreeSitter.Language.load(wasmPath)
    languageCache.set(langName, lang)
    return lang
  } catch {
    // WASM файл не найден — язык не поддерживается tree-sitter
    languageCache.set(langName, null)
    return null
  }
}
```

Далее основная функция чанкинга:

```typescript
/**
 * Разбить содержимое файла на чанки с помощью tree-sitter.
 *
 * Алгоритм:
 * 1. Парсим файл tree-sitter
 * 2. Обходим AST первого уровня
 * 3. Узлы из CHUNK_NODE_TYPES → отдельный чанк
 * 4. Остальные узлы подряд → объединяем в один чанк пока не превысим MAX_CHUNK_LINES
 * 5. Слишком большие узлы → разбиваем с overlap (как в текущем CodeChunker)
 *
 * @param filePath — относительный путь к файлу
 * @param contents — содержимое файла
 * @param wasmDir — путь к папке с tree-sitter WASM файлами
 * @returns массив CodeChunk
 */
export async function chunkFileTreeSitter(
  filePath: string,
  contents: string,
  wasmDir: string,
): Promise<CodeChunk[] | null> {
  // 1. Определить язык по расширению
  const ext = path.extname(filePath).toLowerCase()
  const langName = EXTENSION_TO_TREESITTER[ext]
  if (!langName) return null  // нет tree-sitter парсера — вернуть null, вызывающий код использует fallback

  // 2. Инициализировать парсер и загрузить язык
  await initParser(wasmDir)
  const language = await loadLanguage(langName, wasmDir)
  if (!language) return null  // WASM не найден

  // 3. Парсить
  Parser.setLanguage(language)
  const tree = Parser.parse(contents)
  const rootNode = tree.rootNode

  // 4. Обойти дочерние узлы корня
  const allLines = contents.split("\n")
  const chunks: CodeChunk[] = []
  let pendingLines: string[] = []
  let pendingStart = 0

  function flushPending(): void {
    if (pendingLines.length < MIN_CHUNK_LINES) return
    if (pendingLines.length <= MAX_CHUNK_LINES) {
      chunks.push({
        id: uuidv4(),
        filePath,
        content: pendingLines.join("\n"),
        startLine: pendingStart,
        endLine: pendingStart + pendingLines.length - 1,
        language: langName,
      })
    } else {
      // Разбить большой pending-блок
      chunks.push(...splitLargeBlock(pendingLines, pendingStart, filePath, langName))
    }
    pendingLines = []
  }

  for (let i = 0; i < rootNode.childCount; i++) {
    const node = rootNode.child(i)
    if (!node) continue

    const nodeStartLine = node.startPosition.row
    const nodeEndLine = node.endPosition.row
    const nodeLines = allLines.slice(nodeStartLine, nodeEndLine + 1)

    if (CHUNK_NODE_TYPES.has(node.type) && nodeLines.length >= MIN_CHUNK_LINES) {
      // Структурный узел — сначала сбросить pending
      flushPending()

      if (nodeLines.length <= MAX_CHUNK_LINES) {
        chunks.push({
          id: uuidv4(),
          filePath,
          content: nodeLines.join("\n"),
          startLine: nodeStartLine,
          endLine: nodeEndLine,
          language: langName,
        })
      } else {
        // Очень большая функция/класс — разбить
        chunks.push(...splitLargeBlock(nodeLines, nodeStartLine, filePath, langName))
      }
    } else {
      // Не структурный узел — накапливать в pending
      if (pendingLines.length === 0) {
        pendingStart = nodeStartLine
      }
      pendingLines.push(...nodeLines)

      // Если pending стал большим — сбросить
      if (pendingLines.length >= MAX_CHUNK_LINES) {
        flushPending()
      }
    }
  }

  // Сбросить остаток
  flushPending()

  // Если ничего не получилось — вернуть null (fallback)
  if (chunks.length === 0) return null

  return chunks
}
```

Вспомогательная функция `splitLargeBlock` — скопировать из текущего `CodeChunker.ts` (строки 109-134), она одинаковая.

```typescript
function splitLargeBlock(
  lines: string[],
  startLine: number,
  filePath: string,
  language: string,
): CodeChunk[] {
  const chunks: CodeChunk[] = []
  let i = 0
  while (i < lines.length) {
    const end = Math.min(i + MAX_CHUNK_LINES, lines.length)
    const chunkLines = lines.slice(i, end)
    if (chunkLines.length >= MIN_CHUNK_LINES) {
      chunks.push({
        id: uuidv4(),
        filePath,
        content: chunkLines.join("\n"),
        startLine: startLine + i,
        endLine: startLine + end - 1,
        language,
      })
    }
    i += MAX_CHUNK_LINES - OVERLAP_LINES
    if (i >= lines.length) break
  }
  return chunks
}
```

---

### Файл 2: `src/core/indexing/CodeChunker.ts` (ИЗМЕНИТЬ)

Добавить в начало файла импорт и обёртку. Текущий код `chunkFile` переименовать в `chunkFileSimple`. Новый `chunkFile` пробует tree-sitter, а если null — использует `chunkFileSimple`.

Конкретные правки:

1. Добавить импорт в начало файла (после существующих импортов):

```typescript
import { chunkFileTreeSitter } from "./TreeSitterChunker"
```

2. Переименовать текущую экспортируемую функцию `chunkFile` → `chunkFileSimple` (убрать export):

```typescript
// БЫЛО:
export function chunkFile(filePath: string, contents: string): CodeChunk[] {

// СТАЛО:
function chunkFileSimple(filePath: string, contents: string): CodeChunk[] {
```

3. Добавить новую экспортируемую функцию в конце файла:

```typescript
/** Путь к WASM-файлам tree-sitter. Устанавливается из extension.ts при инициализации. */
let _wasmDir: string = ""

export function setTreeSitterWasmDir(dir: string): void {
  _wasmDir = dir
}

/**
 * Основная функция чанкинга.
 * Пробует tree-sitter (синтаксический), при неудаче — fallback на текстовый.
 */
export async function chunkFile(filePath: string, contents: string): Promise<CodeChunk[]> {
  if (_wasmDir) {
    try {
      const result = await chunkFileTreeSitter(filePath, contents, _wasmDir)
      if (result && result.length > 0) {
        return result
      }
    } catch {
      // tree-sitter упал — используем fallback
    }
  }
  return chunkFileSimple(filePath, contents)
}
```

**ВНИМАНИЕ**: сигнатура `chunkFile` теперь `async` (возвращает `Promise<CodeChunk[]>` вместо `CodeChunk[]`).

---

### Файл 3: `src/core/indexing/IndexingService.ts` (ИЗМЕНИТЬ)

Все места, где вызывается `chunkFile`, нужно добавить `await` (функция стала async).

1. В импортах добавить `setTreeSitterWasmDir`:

```typescript
import { chunkFile, setTreeSitterWasmDir } from "./CodeChunker"
```

2. В методе `initialize()` — установить wasmDir в самом начале:

```typescript
async initialize(): Promise<void> {
  // Установить путь к tree-sitter WASM файлам
  const wasmDir = require("node:path").join(this.extensionPath, "dist")
  setTreeSitterWasmDir(wasmDir)

  // ... остальной код без изменений ...
}
```

3. В методе `startIndexing()`, Phase 3 (строка ~300), добавить `await`:

```typescript
// БЫЛО:
const chunks = chunkFile(file.relPath, content)

// СТАЛО:
const chunks = await chunkFile(file.relPath, content)
```

4. В методе `onFileChanged()` (строка ~189), добавить `await`:

```typescript
// БЫЛО:
const chunks = chunkFile(relPath, content)

// СТАЛО:
const chunks = await chunkFile(relPath, content)
```

---

### Файл 4: `src/core/indexing/index.ts` (ИЗМЕНИТЬ)

Добавить экспорт нового модуля:

```typescript
export { chunkFileTreeSitter } from "./TreeSitterChunker"
export { setTreeSitterWasmDir } from "./CodeChunker"
```

---

## Проверка после реализации

1. Собрать расширение: `node esbuild.mjs` в `vscode/extensions/shuncode/`
2. Запустить форк: `scripts\code.bat` из `vscode/`
3. Открыть проект, нажать "Переиндексировать" в табе "Индексация"
4. Сравнить количество чанков ДО и ПОСЛЕ (должно уменьшиться примерно вдвое)
5. Проверить в чате: `codebase_search` — спросить "где реализована авторизация"
6. Убедиться что для `.md`, `.yaml` и других файлов без tree-sitter парсера чанкинг работает (fallback)

## Риски

- WASM-файлы tree-sitter должны быть в `dist/` после сборки (плагин `copyWasmFiles` в `esbuild.mjs` уже копирует их)
- `web-tree-sitter` использует WASM, не нативные модули — кроссплатформенно (Windows + macOS + Linux)
- При первом вызове парсер инициализируется (~200ms), потом кэшируется
