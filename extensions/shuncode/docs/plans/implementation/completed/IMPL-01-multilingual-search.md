# IMPL-01: Мультиязычная embedding модель + адаптивные веса поиска

> Приоритет: КРИТИЧЕСКИЙ (баг-фикс)
> Оценка: 3-4 часа
> Зависимости: нет

---

## Цель

Текущая модель `all-MiniLM-L6-v2` — англоязычная. Запросы на русском ("найди авторизацию") не находят код с `auth`, `login`, `authenticate`. Нужно заменить модель на мультиязычную (50+ языков) и адаптировать веса hybrid search для не-латинских запросов.

## Почему НЕ словарь терминов

Ранее планировался RU→EN словарь (`DevTermsDictionary.ts`). Это не масштабируется:
- Для каждого нового языка (ZH, JA, KO, DE...) нужен свой словарь
- Ручное поддержание = всегда неполно
- Мультиязычная модель уже решает эту задачу — она маппит "авторизация" и "authentication" в близкие точки в одном векторном пространстве

**Решение:** мультиязычная модель + адаптивные веса (больше семантики для не-латинских запросов, т.к. keyword search по буквальному совпадению строк бесполезен для кириллицы в англоязычном коде).

## Результат

- Поиск на любом из 50+ языков находит релевантный код
- Для не-латинских запросов: семантический поиск доминирует (0.90 vs 0.10)
- Для латинских запросов: баланс как раньше (0.65 / 0.35)
- Индекс автоматически пересоздаётся при смене модели
- Никаких hardcoded словарей — расширение на новые языки = 0 работы

---

## Шаг 1: Скачать новую модель

Нужно скачать ONNX-модель `paraphrase-multilingual-MiniLM-L12-v2` от Xenova (формат для transformers.js).

**Модель:** https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2

**Что скачать:** весь репозиторий, но нужны только эти файлы:
```
onnx/model_quantized.onnx   (или model.onnx если quantized нет)
config.json
tokenizer.json
tokenizer_config.json
special_tokens_map.json
vocab.txt (если есть) или sentencepiece.bpe.model
```

**Куда положить:**
```
vscode/extensions/shuncode/models/paraphrase-multilingual-MiniLM-L12-v2/
├── onnx/
│   └── model_quantized.onnx
├── config.json
├── tokenizer.json
├── tokenizer_config.json
├── special_tokens_map.json
└── (vocab.txt или sentencepiece.bpe.model)
```

**ВАЖНО:** Проверь `config.json` — поле `hidden_size` должно быть `384`. Это размерность эмбеддингов. Если отличается — запомни число, оно понадобится в Шаге 2.

**Команда для скачивания (если установлен git lfs):**
```bash
cd vscode/extensions/shuncode/models/
git clone https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2
```

Или скачай вручную с HuggingFace. Файлы ONNX могут быть 50-100MB.

---

## Шаг 2: Обновить LocalEmbeddingProvider

**Файл:** `vscode/extensions/shuncode/src/core/indexing/providers/LocalEmbeddingProvider.ts`

Заменить ВСЮ строку с названием модели:

**Найти:**
```typescript
const extractor = await pipeline("feature-extraction", "all-MiniLM-L6-v2")
```

**Заменить на:**
```typescript
const extractor = await pipeline("feature-extraction", "paraphrase-multilingual-MiniLM-L12-v2")
```

**Также проверить размерность.** В этом же файле:

**Найти:**
```typescript
readonly dimensions = 384
```

Если `hidden_size` в `config.json` новой модели НЕ 384, заменить на правильное значение. Для `paraphrase-multilingual-MiniLM-L12-v2` размерность = 384, так что скорее всего менять не нужно.

---

## Шаг 3: Адаптивные веса в SearchEngine

Вместо словаря — определяем, содержит ли запрос не-латинские символы. Если да — увеличиваем вес семантического поиска, т.к. keyword search бесполезен (кириллица/иероглифы не совпадут с латинскими идентификаторами в коде).

**Файл:** `vscode/extensions/shuncode/src/core/indexing/SearchEngine.ts`

**3.1. Добавить функцию определения скрипта.** В начало файла (после импортов, перед классом) добавить:

```typescript
/**
 * Check if a query contains mostly non-Latin characters.
 * Used to adjust search weights: for non-Latin queries, semantic search
 * should dominate because keyword matching against Latin code identifiers
 * won't work for Cyrillic/CJK/Arabic/etc.
 *
 * This approach scales to any language without per-language dictionaries.
 */
function isNonLatinQuery(query: string): boolean {
	// Remove whitespace, digits, and common punctuation
	const cleaned = query.replace(/[\s\d\-_.,;:!?()[\]{}<>"/\\|@#$%^&*+=~`']+/g, "")
	if (cleaned.length === 0) return false

	// Count Latin characters (a-z, A-Z)
	let latinCount = 0
	for (const char of cleaned) {
		if (/[a-zA-Z]/.test(char)) {
			latinCount++
		}
	}

	// If less than 40% of meaningful characters are Latin → non-Latin query
	return latinCount / cleaned.length < 0.4
}
```

**3.2. Обновить метод `mergeResults`.** Найти в классе `SearchEngine`:

```typescript
private mergeResults(
	semanticResults: IndexSearchResult[],
	keywordResults: IndexSearchResult[],
	topK: number,
): IndexSearchResult[] {
```

Внутри этого метода найти строки с весами:

```typescript
const SEMANTIC_WEIGHT = 0.65
const KEYWORD_WEIGHT = 0.35
```

**Заменить сигнатуру метода и веса:**

```typescript
private mergeResults(
	semanticResults: IndexSearchResult[],
	keywordResults: IndexSearchResult[],
	topK: number,
	nonLatinQuery: boolean = false,
): IndexSearchResult[] {
```

```typescript
// Adaptive weights: for non-Latin queries, semantic search dominates
// because keyword matching against Latin code identifiers is mostly useless
const SEMANTIC_WEIGHT = nonLatinQuery ? 0.90 : 0.65
const KEYWORD_WEIGHT = nonLatinQuery ? 0.10 : 0.35
```

**3.3. Обновить метод `search` чтобы передавать флаг.** Найти:

```typescript
async search(query: string, topK: number = 10): Promise<IndexSearchResult[]> {
	const candidateCount = Math.max(topK * 2, topK)
	const semanticResults = await this.indexingService.search(query, candidateCount)
	const chunks = this.indexingService.getStorage().getChunks()
	const keywordResults = keywordSearch(chunks, query, candidateCount)
	const merged = this.mergeResults(semanticResults, keywordResults, candidateCount)
	return rerankResults(merged, query).slice(0, topK)
}
```

**Заменить на:**

```typescript
async search(query: string, topK: number = 10): Promise<IndexSearchResult[]> {
	const candidateCount = Math.max(topK * 2, topK)
	const nonLatin = isNonLatinQuery(query)

	// Semantic search uses the multilingual model — handles any language natively
	const semanticResults = await this.indexingService.search(query, candidateCount)

	// Keyword search still runs (may catch exact matches in comments, strings, etc.)
	const chunks = this.indexingService.getStorage().getChunks()
	const keywordResults = keywordSearch(chunks, query, candidateCount)

	const merged = this.mergeResults(semanticResults, keywordResults, candidateCount, nonLatin)
	return rerankResults(merged, query).slice(0, topK)
}
```

**НЕ создавать файл `DevTermsDictionary.ts` — он не нужен.**

---

## Шаг 4: Принудительная переиндексация при смене модели

При замене модели старые эмбеддинги несовместимы (другая модель = другое векторное пространство). Нужно инвалидировать индекс.

**Файл:** `vscode/extensions/shuncode/src/core/indexing/IndexingService.ts`

Найти место где сервис инициализируется (конструктор или `init`/`start` метод). Добавить проверку версии модели.

**Вариант реализации:** добавить в metadata хранилища поле `modelName`. При запуске сравнивать с текущим. Если отличается — очистить индекс.

**Найти в IndexingService.ts** метод который запускает индексацию или инициализирует storage. Перед первым использованием storage добавить:

```typescript
// Check if model changed — if so, clear index (embeddings are incompatible)
const currentModel = "paraphrase-multilingual-MiniLM-L12-v2"
const storedModel = storage.getMetadata("embeddingModel")
if (storedModel && storedModel !== currentModel) {
	Logger.log(`[Indexing] Embedding model changed (${storedModel} → ${currentModel}). Clearing index.`)
	storage.clear()
}
storage.setMetadata("embeddingModel", currentModel)
```

**ВАЖНО:** Если в `IndexStorage.ts` нет методов `getMetadata`/`setMetadata` — нужно их добавить. Простейший вариант: отдельная таблица `metadata` в SQLite с полями `key TEXT PRIMARY KEY, value TEXT`. Или JSON файл рядом с индексом.

Если добавлять metadata сложно — допустимо просто удалить файл индекса (`index.db` или `index.json`) руками и задокументировать это. Пользователь нажмёт "Переиндексировать" в настройках.

---

## Шаг 5: Обновить .gitignore

Файлы ONNX модели большие (50-100MB). Убедиться что они НЕ в .gitignore (они должны быть в репозитории, т.к. это bundled модель для офлайн работы).

Если модели хранятся через git-lfs — убедиться что `*.onnx` трекается:
```bash
git lfs track "*.onnx"
```

---

## Проверка

1. **Пересобрать расширение:**
   ```bash
   cd vscode/extensions/shuncode
   node esbuild.mjs
   ```
   Ошибок компиляции быть не должно.

2. **Запустить Shuncode AI, открыть проект.**

3. **Перейти в Settings → Индексация → нажать "Переиндексировать".**
   - Фаза "Загрузка модели" должна показать что грузится новая модель
   - Индексация должна завершиться без ошибок

4. **Проверить поиск на русском:**
   - В чате написать: "найди где происходит авторизация"
   - Должен найти файлы с `auth`, `login`, `authenticate`

5. **Проверить поиск на английском:**
   - В чате написать: "find authentication logic"
   - Должен найти те же файлы

6. **Проверить поиск на другом языке (если есть возможность):**
   - "Authentifizierung finden" (DE), "認証ロジック" (JA)
   - Должен найти те же файлы — без каких-либо словарей

7. **Проверить что старая модель не используется:**
   - Папку `models/all-MiniLM-L6-v2/` можно удалить (но не обязательно)
   - Убедиться что в `LocalEmbeddingProvider.ts` нет ссылок на `all-MiniLM-L6-v2`
