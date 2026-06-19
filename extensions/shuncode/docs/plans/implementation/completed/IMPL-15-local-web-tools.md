# IMPL-15: Локальные web_search и web_fetch (без серверного бэкенда)

> Статус: ✅ ЗАВЕРШЕНО (2026-03-07)
> Приоритет: ВЫСОКИЙ (инструменты сломаны — 404)
> Оценка: 4-8 часов
> Зависимости: нет

---

## Проблема

Инструменты `web_search` и `web_fetch` **не работают**. Оба обработчика отправляют HTTP-запросы на бэкенд Shuncode:

```
POST https://shuncode-ai.ru/api/v1/search/websearch
POST https://shuncode-ai.ru/api/v1/search/webfetch
```

Эти эндпоинты **не существуют** в `shuncode-web`. Результат — **404 Not Found**.

### Почему так получилось

Код унаследован от Roo Code (бывший Cline). У них web-инструменты работали через их облачный бэкенд. При форке `apiBaseUrl` был переключён на `shuncode-ai.ru`, но серверные роуты не были реализованы.

### Текущее поведение

1. Модель вызывает `web_search` или `web_fetch`
2. Обработчик проверяет `shuncodeWebToolsEnabled` (включён по умолчанию) и авторизацию
3. Делает `axios.post()` на `${apiBaseUrl}/api/v1/search/websearch`
4. Получает 404
5. Модель получает ошибку: `Error performing web search: Request failed with status code 404`

---

## Цель

Переделать `web_search` и `web_fetch` на **полностью локальную** работу внутри расширения. Никакого серверного бэкенда. Никакой авторизации.

---

## Архитектура (было → стало)

### Было (сломано)

```
AI модель → WebSearchToolHandler → axios.post(shuncode-ai.ru) → 404
AI модель → WebFetchToolHandler  → axios.post(shuncode-ai.ru) → 404
```

### Стало

```
AI модель → WebSearchToolHandler → LocalWebSearchService → DuckDuckGo (HTTP scraping) → результаты
AI модель → WebFetchToolHandler  → UrlContentFetcher (уже есть!) → Puppeteer → markdown
```

---

## Шаг 1: Создать `LocalWebSearchService`

**Файл:** `src/services/browser/LocalWebSearchService.ts`

Сервис для локального поиска через DuckDuckGo. Не требует API-ключей.

### Алгоритм

1. Отправить GET-запрос на `https://html.duckduckgo.com/html/?q=<query>`
2. Распарсить HTML через `cheerio` (уже есть в зависимостях — используется в `UrlContentFetcher.ts`)
3. Извлечь результаты: заголовок, URL, сниппет
4. Вернуть массив результатов

### Структура результата

```typescript
interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

interface WebSearchResponse {
  results: WebSearchResult[]
  query: string
}
```

### Реализация

```typescript
import axios from "axios"
import * as cheerio from "cheerio"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"

export class LocalWebSearchService {
  /**
   * Поиск через DuckDuckGo HTML-версию.
   * Не требует API-ключей.
   */
  async search(query: string): Promise<WebSearchResult[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`

    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      },
      timeout: 10000,
      ...getAxiosSettings(),
    })

    const $ = cheerio.load(response.data)
    const results: WebSearchResult[] = []

    $(".result").each((_i, el) => {
      const titleEl = $(el).find(".result__title a")
      const snippetEl = $(el).find(".result__snippet")
      const title = titleEl.text().trim()
      // DuckDuckGo проксирует URL через редирект — нужно извлечь реальный URL
      const rawHref = titleEl.attr("href") || ""
      const realUrl = extractRealUrl(rawHref)
      const snippet = snippetEl.text().trim()

      if (title && realUrl) {
        results.push({ title, url: realUrl, snippet })
      }
    })

    return results.slice(0, 10) // Максимум 10 результатов
  }
}

/**
 * DuckDuckGo оборачивает URL в редирект вида:
 * //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&rut=...
 * Нужно извлечь реальный URL из параметра uddg.
 */
function extractRealUrl(duckUrl: string): string {
  try {
    if (duckUrl.includes("uddg=")) {
      const urlObj = new URL(duckUrl, "https://duckduckgo.com")
      const realUrl = urlObj.searchParams.get("uddg")
      if (realUrl) return realUrl
    }
    // Если это уже обычный URL
    if (duckUrl.startsWith("http")) return duckUrl
  } catch {
    // ignore
  }
  return duckUrl
}
```

### Фильтрация по доменам

Текущие обработчики поддерживают `allowed_domains` и `blocked_domains`. После получения результатов фильтровать:

```typescript
function filterByDomains(
  results: WebSearchResult[],
  allowedDomains?: string[],
  blockedDomains?: string[],
): WebSearchResult[] {
  return results.filter((r) => {
    try {
      const host = new URL(r.url).hostname
      if (allowedDomains && allowedDomains.length > 0) {
        return allowedDomains.some((d) => host.includes(d))
      }
      if (blockedDomains && blockedDomains.length > 0) {
        return !blockedDomains.some((d) => host.includes(d))
      }
    } catch {
      // ignore
    }
    return true
  })
}
```

---

## Шаг 2: Переписать `WebSearchToolHandler.ts`

**Файл:** `src/core/task/tools/handlers/WebSearchToolHandler.ts`

### Что убрать

- Импорты `ShuncodeEnv`, `AuthService`, `buildShuncodeExtraHeaders`
- Проверку `shuncodeWebToolsEnabled`
- Проверку `authToken`
- Вызов `axios.post(${baseUrl}/api/v1/search/websearch)`

### Что добавить

- Импорт `LocalWebSearchService`
- Прямой вызов `localWebSearchService.search(query)`

### Ключевые изменения в `execute()`

```typescript
// БЫЛО:
const shuncodeWebToolsEnabled = config.services.stateManager.getGlobalSettingsKey("shuncodeWebToolsEnabled")
if (!shuncodeWebToolsEnabled) {
  return formatResponse.toolError("Shuncode web tools are currently disabled in settings.")
}
const authToken = await AuthService.getInstance().getAuthToken()
if (!authToken) {
  return formatResponse.toolError("Web search requires authentication...")
}
// ...
const response = await axios.post(`${baseUrl}/api/v1/search/websearch`, requestBody, { ... })

// СТАЛО:
const searchService = new LocalWebSearchService()
let results = await searchService.search(query)

// Фильтрация по доменам (если указаны)
if (allowedDomains.length > 0) {
  results = results.filter(r => {
    const host = new URL(r.url).hostname
    return allowedDomains.some(d => host.includes(d))
  })
}
if (blockedDomains.length > 0) {
  results = results.filter(r => {
    const host = new URL(r.url).hostname
    return !blockedDomains.some(d => host.includes(d))
  })
}
```

### Формат возвращаемого результата (сохранить как было)

```typescript
let resultText = `Search completed (${results.length} results found)`
if (results.length > 0) {
  resultText += ":\n\n"
  results.forEach((result, index) => {
    resultText += `${index + 1}. ${result.title}\n   ${result.url}\n   ${result.snippet}\n\n`
  })
}
return formatResponse.toolResult(resultText)
```

---

## Шаг 3: Переписать `WebFetchToolHandler.ts`

**Файл:** `src/core/task/tools/handlers/WebFetchToolHandler.ts`

### Ключевая идея

В расширении **уже есть** `UrlContentFetcher` (`src/services/browser/UrlContentFetcher.ts`), который:
1. Запускает headless Chromium (через `puppeteer-chromium-resolver`)
2. Открывает URL
3. Парсит HTML через cheerio
4. Конвертирует в markdown через turndown

Нужно просто использовать его вместо серверного вызова.

### Что убрать

- Импорты `ShuncodeEnv`, `AuthService`, `buildShuncodeExtraHeaders`
- Проверку `shuncodeWebToolsEnabled`
- Проверку `authToken`
- Вызов `axios.post(${baseUrl}/api/v1/search/webfetch)`

### Что добавить

- Импорт `UrlContentFetcher`
- Вызов `urlContentFetcher.urlToMarkdown(url)`

### Проблема: доступ к `vscode.ExtensionContext`

`UrlContentFetcher` требует `vscode.ExtensionContext` в конструкторе (для пути к глобальному хранилищу, где лежит Chromium). В `TaskConfig` его нет напрямую.

**Решение:** Передать `UrlContentFetcher` как сервис через `TaskConfig.services`, аналогично `browserSession`.

В `ToolExecutor.ts` уже есть поле `urlContentFetcher`:

```typescript
// Строка ~8
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
```

Нужно убедиться, что `urlContentFetcher` доступен в `TaskConfig.services`. Если нет — добавить.

### Ключевые изменения в `execute()`

```typescript
// БЫЛО:
const baseUrl = ShuncodeEnv.config().apiBaseUrl
const response = await axios.post(`${baseUrl}/api/v1/search/webfetch`, {
  Url: url,
  Prompt: prompt,
}, { ... })
const result = response.data.data.result

// СТАЛО:
const fetcher = new UrlContentFetcher(config.services.extensionContext)
try {
  await fetcher.launchBrowser()
  const markdown = await fetcher.urlToMarkdown(url)
  return formatResponse.toolResult(markdown)
} finally {
  await fetcher.closeBrowser()
}
```

> **Примечание:** Параметр `prompt` в текущей реализации отправлялся на сервер для LLM-обработки (сервер дополнительно анализировал контент). В локальной версии мы просто возвращаем markdown. Модель сама проанализирует его — это её работа.

---

## Шаг 4: Убрать серверные зависимости

### 4a. Убрать проверку `shuncodeWebToolsEnabled` из обработчиков

Раньше эта настройка контролировала доступ к облачным API. При локальной работе она не нужна.

**Файлы:**
- `WebSearchToolHandler.ts` — убрать блок `if (!shuncodeWebToolsEnabled)`
- `WebFetchToolHandler.ts` — убрать блок `if (!shuncodeWebToolsEnabled)`

### 4b. Убрать `contextRequirements` из спецификаций промптов

**Файлы:**
- `src/core/prompts/system-prompt/tools/web_search.ts` — убрать строку `contextRequirements: (context) => context.shuncodeWebToolsEnabled === true`
- `src/core/prompts/system-prompt/tools/web_fetch.ts` — убрать строку `contextRequirements: (context) => context.shuncodeWebToolsEnabled === true`

Без этого изменения инструменты **не появятся в системном промпте**, если `shuncodeWebToolsEnabled === false`. А настройка в UI станет бессмысленной.

### 4c. (Опционально) Убрать настройку из UI

**Файл:** `webview-ui/src/components/settings/sections/ExperimentsSection.tsx`

Можно убрать тогл «Web Tools Enabled» из настроек, так как инструменты теперь локальные и бесплатные. Или оставить как kill switch — на усмотрение.

---

## Шаг 5: Обработка ошибок

### web_search

DuckDuckGo может начать блокировать при частых запросах. Обработать:
- Timeout (10 секунд)
- HTTP 429 (rate limit) — вернуть понятную ошибку модели
- Пустые результаты — вернуть `"No results found for query: ..."`

### web_fetch

Puppeteer может упасть на:
- Невалидный URL — проверить формат до запуска
- Таймаут страницы — уже обработан в `urlToMarkdown` (timeout: 10_000)
- Страница без контента — вернуть `"Page returned empty content"`
- Chrome не найден — `ensureChromiumExists()` скачает Chromium автоматически (первый запуск ~100 МБ)

---

## Шаг 6: Обновить промпты (описания инструментов)

### web_search

**Файл:** `src/core/prompts/system-prompt/tools/web_search.ts`

Убрать из описания упоминания об ограничениях (авторизация, серверные лимиты). Добавить:

```
- Search is performed locally via DuckDuckGo (no API key needed)
- Results include title, URL, and a short snippet
- Returns up to 10 results
```

### web_fetch

**Файл:** `src/core/prompts/system-prompt/tools/web_fetch.ts`

Убрать параметр `prompt` (он больше не нужен — сервер не анализирует контент). Или оставить, но игнорировать в обработчике.

**Рекомендация:** Оставить `prompt` в спецификации — он не мешает, и модель может использовать его для self-guidance при анализе полученного markdown. Но в обработчике его не обрабатывать.

---

## Шаг 7: Обновить тесты

### Снапшоты промптов

После изменения описаний инструментов и удаления `contextRequirements`:

```bash
cd vscode/extensions/shuncode
UPDATE_SNAPSHOTS=true npm run test:unit
```

### Ручное тестирование

1. Открыть Shuncode
2. Попросить модель: "Найди в интернете, что такое Tree-sitter"
3. Убедиться, что `web_search` возвращает результаты (не 404)
4. Попросить модель: "Открой https://docs.python.org/3/tutorial/index.html и кратко перескажи"
5. Убедиться, что `web_fetch` возвращает markdown-контент страницы

---

## Шаг 8: Локализация (i18n)

В проекте обязательна локализация на русский и английский. Все пользовательские строки — через `t()`.

### Существующие ключи (уже есть, не трогать)

**`webview-ui/src/i18n/locales/ru.json`:**
```json
"chat.wantsToWebSearch": "Shuncode AI хочет найти в интернете:",
"chat.webSearched": "Shuncode AI искал в интернете:",
"account.webSearch": "Веб-поиск",
"account.webFetch": "Веб-запрос",
"account.webFetchLlm": "Веб-запрос (LLM)",
```

**`webview-ui/src/i18n/locales/en.json`:**
```json
"chat.wantsToWebSearch": "Shuncode AI wants to search the web:",
"chat.webSearched": "Shuncode AI searched the web:",
"account.webSearch": "Web Search",
"account.webFetch": "Web Fetch",
"account.webFetchLlm": "Web Fetch (LLM)",
```

### Ключи настроек (обновить если меняем логику тогла)

Сейчас в обоих файлах локализации есть строки для тогла в настройках:

**`ru.json`:**
```json
"features.shuncodeWebTools": "Включить веб-инструменты Shuncode",
"features.shuncodeWebToolsDescription": "Включает инструменты веб-поиска и веб-запросов для AI-ассистента.",
"features.shuncodeWebToolsAuthRequired": "Для использования веб-инструментов необходимо авторизоваться.",
"features.shuncodeWebToolsSignIn": "Войти в аккаунт",
```

**`en.json`:**
```json
"features.shuncodeWebTools": "Enable Shuncode web tools",
"features.shuncodeWebToolsDescription": "Enables web search and web fetch tools for the AI assistant.",
"features.shuncodeWebToolsAuthRequired": "Authentication required to use web tools.",
"features.shuncodeWebToolsSignIn": "Sign in",
```

### Что нужно изменить

1. **Если оставляем тогл**, но убираем требование авторизации:
   - Удалить ключи `features.shuncodeWebToolsAuthRequired` и `features.shuncodeWebToolsSignIn` из обоих файлов
   - Обновить `features.shuncodeWebToolsDescription`:
     - RU: `"Включает инструменты веб-поиска и загрузки страниц для AI-ассистента. Работает локально, без сервера."`
     - EN: `"Enables web search and web fetch tools for the AI assistant. Works locally, no server required."`

2. **Если убираем тогл полностью** — удалить все 4 ключа `features.shuncodeWebTools*` из обоих файлов.

3. **Если добавляете новые сообщения об ошибках** (например, "Поиск не дал результатов"):
   - Добавить ключи в оба файла (`ru.json` и `en.json`)
   - Использовать через `t("ваш.ключ")` в webview-компонентах
   - В backend-обработчиках (Extension Host) строки возвращаются напрямую на английском — модель их читает, пользователь не видит

### Правило

**Все строки, видимые пользователю в UI — через `t()`. Все строки в оба файла (`ru.json` + `en.json`). Без исключений.**

---

## Сводка файлов

| Файл | Действие |
|------|----------|
| `src/services/browser/LocalWebSearchService.ts` | **СОЗДАТЬ** — локальный поиск через DuckDuckGo |
| `src/core/task/tools/handlers/WebSearchToolHandler.ts` | **ПЕРЕПИСАТЬ** — убрать серверный вызов, использовать LocalWebSearchService |
| `src/core/task/tools/handlers/WebFetchToolHandler.ts` | **ПЕРЕПИСАТЬ** — убрать серверный вызов, использовать UrlContentFetcher |
| `src/core/prompts/system-prompt/tools/web_search.ts` | **ОБНОВИТЬ** — убрать contextRequirements, обновить описание |
| `src/core/prompts/system-prompt/tools/web_fetch.ts` | **ОБНОВИТЬ** — убрать contextRequirements, обновить описание |
| `webview-ui/src/components/settings/sections/ExperimentsSection.tsx` | **ОПЦИОНАЛЬНО** — убрать или оставить тогл |
| `webview-ui/src/i18n/locales/ru.json` | **ОБНОВИТЬ** — изменить/удалить ключи `features.shuncodeWebTools*`, добавить `browser.downloadingChromium` / `browser.chromiumReady` |
| `webview-ui/src/i18n/locales/en.json` | **ОБНОВИТЬ** — изменить/удалить ключи `features.shuncodeWebTools*`, добавить `browser.downloadingChromium` / `browser.chromiumReady` |
| `src/core/controller/state/updateSettings.ts` | **ОБНОВИТЬ** — добавить предзагрузку Chromium при включении тогла |

---

## Альтернативы для web_search (если DuckDuckGo нестабилен)

| Вариант | Плюсы | Минусы |
|---------|-------|--------|
| DuckDuckGo HTML scraping | Бесплатно, без ключей | Могут блокировать при частых запросах |
| npm `duck-duck-scrape` | Готовый пакет, проще парсинг | Ещё одна зависимость |
| Puppeteer → Google/DuckDuckGo | Надёжнее скрейпинга | Тяжеловесно, нужен Chrome |
| SearXNG (self-hosted) | Стабильно, приватно | Нужен отдельный сервер |
| Serper API / Tavily API | Надёжно, качественно | Платно, нужен API-ключ |

**Рекомендация для старта:** DuckDuckGo HTML scraping. Если начнут блокировать — перейти на `duck-duck-scrape` или Puppeteer-based scraping.

---

## Важные заметки для реализатора

1. **`getAxiosSettings()`** — всегда добавляй к axios-запросам (см. `docs/development/NETWORK.md`). Без этого не работает прокси.

2. **`cheerio`** — уже в зависимостях, используется в `UrlContentFetcher.ts`. Отдельно устанавливать не нужно.

3. **`UrlContentFetcher`** — использует `puppeteer-chromium-resolver` (PCR). При первом запуске PCR скачает Chromium (~100 МБ) в `globalStorage/puppeteer/`. Это уже реализовано — просто знай.

4. **Не трогай `browser_action`** — он работает отдельно, через `BrowserSession.ts`. Это другой инструмент с другой логикой (интерактивный браузер с скриншотами).

5. **`shuncodeWebToolsEnabled`** — после удаления серверной зависимости можно:
   - Убрать настройку полностью (инструменты всегда включены)
   - Или оставить как kill switch (если пользователь не хочет web-инструменты)
   - Если оставляешь — убери проверку `authToken`, оставь только проверку настройки

6. **Телеметрия** — в текущих обработчиках есть `telemetryService.captureToolUsage()`. Оставь как есть — это полезно.

7. **PreToolUse hooks** — в текущих обработчиках есть вызов `ToolHookUtils.runPreToolUseIfEnabled()`. Оставь как есть.

8. **Скачивание Chromium — предзагрузка при включении тогла.**

   Сейчас `ensureChromiumExists()` молча скачивает ~100 МБ при первом вызове инструмента. Пользователь ничего не видит — инструмент просто «висит».

   **Правильный UX:** Chromium скачивается **заранее**, в момент когда пользователь включает галочку «Веб-инструменты» в настройках. Не при первом запросе модели.

   ### Логика

   1. Пользователь включает тогл `shuncodeWebToolsEnabled` в `ExperimentsSection.tsx`
   2. Срабатывает `updateSetting("shuncodeWebToolsEnabled", true)`
   3. На стороне Extension Host (бэкенд) перехватываем это в `updateSettings.ts`
   4. Проверяем, есть ли уже Chromium (`fileExistsAtPath(puppeteerDir + "/.chromium-browser-snapshots")`)
   5. Если нет — запускаем фоновую загрузку с индикацией

   ### Индикация для пользователя

   **Вариант: `vscode.window.withProgress()` с уведомлением внизу IDE**

   ```typescript
   // В updateSettings.ts, после сохранения shuncodeWebToolsEnabled = true:
   import { ensureChromiumExists } from "@services/browser/utils"

   if (request.shuncodeWebToolsEnabled === true) {
     // Проверяем, нужно ли скачивать
     const puppeteerDir = path.join(HostProvider.get().globalStorageFsPath, "puppeteer")
     const snapshotsDir = path.join(puppeteerDir, ".chromium-browser-snapshots")
     const exists = await fileExistsAtPath(snapshotsDir)

     if (!exists) {
       vscode.window.withProgress(
         {
           location: vscode.ProgressLocation.Notification,
           title: t("browser.downloadingChromium"), // "Скачивание браузера для веб-инструментов..."
           cancellable: false,
         },
         async () => {
           await ensureChromiumExists()
         },
       )
     }
   }
   ```

   Пользователь увидит:
   - Внизу справа — уведомление с прогрессом: **«Скачивание браузера для веб-инструментов...»**
   - Спиннер крутится пока идёт загрузка (~1-3 минуты)
   - После завершения — уведомление исчезает
   - Если пользователь снова вызовет `web_fetch` — Chromium уже есть, задержки нет

   ### Локализация

   **`ru.json`:**
   ```json
   "browser.downloadingChromium": "Скачивание компонента браузера для веб-инструментов. Подождите несколько минут...",
   "browser.chromiumReady": "Браузер готов. Веб-инструменты доступны."
   ```

   **`en.json`:**
   ```json
   "browser.downloadingChromium": "Downloading browser component for web tools. Please wait a few minutes...",
   "browser.chromiumReady": "Browser ready. Web tools are now available."
   ```

   ### Файлы

   - `src/core/controller/state/updateSettings.ts` — добавить логику предзагрузки при включении тогла
   - `src/services/browser/utils.ts` — (без изменений, `ensureChromiumExists()` уже есть)
   - `webview-ui/src/i18n/locales/ru.json` — добавить ключи `browser.downloadingChromium`, `browser.chromiumReady`
   - `webview-ui/src/i18n/locales/en.json` — добавить ключи `browser.downloadingChromium`, `browser.chromiumReady`

   > **Примечание:** `vscode.window.withProgress` работает только на стороне Extension Host (не в webview). Вызов идёт в `updateSettings.ts`, а не в React-компоненте. Строки для `withProgress` берутся напрямую (не через `t()`), потому что Extension Host не имеет доступа к webview i18n. Можно захардкодить на английском или использовать `vscode.l10n.t()` (встроенная локализация VS Code).

   > **Примечание 2:** Та же проблема уже существует для `browser_action`. Этот фикс покроет и его — если пользователь включил тогл, Chromium уже будет готов для обоих инструментов.

   > **Примечание 3 (будущее улучшение):** Сейчас PCR скачивает Chromium с `storage.googleapis.com`. Эти серверы могут быть недоступны из России или за корпоративным прокси. Запланировано: выложить Chromium-бинарники в **Yandex Object Storage** (S3) и добавить fallback — если Google недоступен, качать из Yandex Cloud. Три архива: win64, linux64, mac-arm64 (~400 МБ суммарно). Это **отдельная задача**, не блокирует IMPL-15.

---

*Создано: 2026-03-07*
