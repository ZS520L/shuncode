# IMPL-11: Интернационализация (i18n) — русский + английский

> Приоритет: КРИТИЧЕСКИЙ — делать ПЕРВЫМ, блокирует все UI-задачи
> Оценка: 8-12 часов
> Зависимости: нет (но все UI-планы зависят от этого)

---

## Цель

Все строки UI сейчас захардкожены на русском. Нужна система i18n с двумя языками: RU (по умолчанию) и EN. Чтобы в будущем добавить новый язык = создать один файл перевода без правки компонентов.

## Текущее состояние

~280 русских строк в webview (React, ~21 файл):
- Settings: табы, labels, tooltips, описания (~160 строк)
- Chat: сообщения, кнопки, подсказки (~80 строк)
- Welcome, History, PendingChanges (~40 строк)

~170 русских строк в backend (TS, ~16 файлов):
- Status bar, notifications, logging messages
- DiffSystem messages, IndexingService

**Итого:** ~450 строк для выноса в ключи.

## Результат

- Переключатель языка в Settings → Общие
- По умолчанию: RU
- Все строки UI загружаются из JSON-файлов переводов
- Добавление нового языка = 1 JSON файл + 0 правок кода

---

## Архитектура

```
webview-ui/src/i18n/
├── index.ts          — хук useTranslation() + провайдер
├── locales/
│   ├── ru.json       — русские строки
│   └── en.json       — английские строки
└── types.ts          — типы ключей (автокомплит)

src/i18n/
├── index.ts          — функция t() для backend
├── locales/
│   ├── ru.json       — русские строки (backend: notifications, status bar)
│   └── en.json       — английские строки
└── types.ts
```

**Подход:** Без внешних библиотек (react-i18next — лишний overhead для 2 языков). Простой свой хук. Это ~100 строк кода.

---

## Шаг 1: Создать систему i18n для webview

### 1.1. Типы

**Создать файл:** `webview-ui/src/i18n/types.ts`

```typescript
/**
 * All translation keys. Adding a key here enforces it in all locale files.
 * Keys are organized by component/area using dot-notation.
 */
export interface TranslationKeys {
	// Settings tabs
	"settings.tabs.apiConfig": string
	"settings.tabs.features": string
	"settings.tabs.browser": string
	"settings.tabs.terminal": string
	"settings.tabs.indexing": string
	"settings.tabs.general": string
	"settings.tabs.about": string
	"settings.tabs.debug": string

	// Settings headers & tooltips
	"settings.apiConfig.header": string
	"settings.apiConfig.tooltip": string
	"settings.features.header": string
	"settings.features.tooltip": string
	"settings.browser.header": string
	"settings.browser.tooltip": string
	"settings.terminal.header": string
	"settings.terminal.tooltip": string
	"settings.indexing.header": string
	"settings.indexing.tooltip": string
	"settings.general.header": string
	"settings.general.tooltip": string
	"settings.about.header": string
	"settings.about.tooltip": string
	"settings.debug.header": string
	"settings.debug.tooltip": string

	// Common actions
	"common.save": string
	"common.cancel": string
	"common.delete": string
	"common.accept": string
	"common.reject": string
	"common.expand": string
	"common.collapse": string
	"common.search": string
	"common.close": string
	"common.enable": string
	"common.disable": string
	"common.on": string
	"common.off": string

	// Chat
	"chat.placeholder": string
	"chat.contextHint": string
	"chat.stopAI": string
	"chat.addContext": string
	"chat.addFiles": string
	"chat.selectModel": string
	"chat.modeAct": string
	"chat.modePlan": string
	"chat.modeActDescription": string
	"chat.modePlanDescription": string
	"chat.modeToggle": string
	"chat.error": string
	"chat.askQuestion": string
	"chat.wantsToExecute": string
	"chat.wantsToEdit": string
	"chat.wantsToCreate": string
	"chat.wantsToDelete": string
	"chat.wantsToRead": string
	"chat.outsideWorkspace": string
	"chat.imageTooBig": string
	"chat.nonImageDisabled": string
	"chat.appliedRules": string

	// Pending changes
	"pendingChanges.files": string
	"pendingChanges.file": string
	"pendingChanges.accept": string
	"pendingChanges.reject": string

	// Indexing
	"indexing.title": string
	"indexing.reindex": string
	"indexing.status.idle": string
	"indexing.status.indexing": string
	"indexing.status.complete": string
	"indexing.status.error": string
	"indexing.mode.local": string
	"indexing.mode.remote": string
	"indexing.mode.off": string

	// General settings
	"general.language": string
	"general.theme": string
	"general.telemetry": string

	// Allow arbitrary keys for extensibility
	[key: string]: string
}

/** Supported locales */
export type Locale = "ru" | "en"
```

### 1.2. Файлы переводов

**Создать файл:** `webview-ui/src/i18n/locales/ru.json`

```json
{
	"settings.tabs.apiConfig": "API Конфигурация",
	"settings.tabs.features": "Функции",
	"settings.tabs.browser": "Браузер",
	"settings.tabs.terminal": "Терминал",
	"settings.tabs.indexing": "Индексация",
	"settings.tabs.general": "Общие",
	"settings.tabs.about": "О программе",
	"settings.tabs.debug": "Отладка",

	"settings.apiConfig.header": "API Конфигурация",
	"settings.apiConfig.tooltip": "Настройка API провайдеров",
	"settings.features.header": "Настройки функций",
	"settings.features.tooltip": "Настройки функций",
	"settings.browser.header": "Настройки браузера",
	"settings.browser.tooltip": "Настройки браузера",
	"settings.terminal.header": "Настройки терминала",
	"settings.terminal.tooltip": "Настройки терминала",
	"settings.indexing.header": "Индексация кодовой базы",
	"settings.indexing.tooltip": "Настройки индексации кодовой базы",
	"settings.general.header": "Общие настройки",
	"settings.general.tooltip": "Общие настройки",
	"settings.about.header": "О программе",
	"settings.about.tooltip": "О Shuncode AI",
	"settings.debug.header": "Отладка",
	"settings.debug.tooltip": "Инструменты отладки",

	"common.save": "Сохранить",
	"common.cancel": "Отмена",
	"common.delete": "Удалить",
	"common.accept": "Принять",
	"common.reject": "Отменить",
	"common.expand": "Развернуть",
	"common.collapse": "Свернуть",
	"common.search": "Поиск",
	"common.close": "Закрыть",
	"common.enable": "Включить",
	"common.disable": "Выключить",
	"common.on": "Вкл",
	"common.off": "Выкл",

	"chat.placeholder": "Введите задачу или вопрос...",
	"chat.contextHint": "Используйте @ для контекста, / для команд, Shift + drag для файлов/изображений",
	"chat.stopAI": "Остановить AI",
	"chat.addContext": "Добавить контекст",
	"chat.addFiles": "Добавить файлы и изображения",
	"chat.selectModel": "Выбрать модель / API провайдера",
	"chat.modeAct": "Act",
	"chat.modePlan": "Plan",
	"chat.modeActDescription": "выполнять задачу сразу",
	"chat.modePlanDescription": "собирать информацию для составления плана",
	"chat.error": "Shuncode AI столкнулся с проблемой...",
	"chat.askQuestion": "У Shuncode AI есть вопрос:",
	"chat.wantsToExecute": "Shuncode AI предлагает выполнить команду:",
	"chat.wantsToEdit": "Shuncode AI хочет отредактировать файл:",
	"chat.wantsToCreate": "Shuncode AI хочет создать новый файл:",
	"chat.wantsToDelete": "Shuncode AI хочет удалить этот файл:",
	"chat.wantsToRead": "Shuncode AI хочет прочитать этот файл:",
	"chat.outsideWorkspace": "Этот файл находится вне рабочей области",
	"chat.imageTooBig": "Размер изображения превышает 7500px",
	"chat.nonImageDisabled": "Загрузка файлов, отличных от изображений, отключена",
	"chat.appliedRules": "Применены условные правила:",

	"pendingChanges.files": "файлов",
	"pendingChanges.file": "файл",
	"pendingChanges.accept": "Принять",
	"pendingChanges.reject": "Отменить",

	"indexing.title": "Индексация кодовой базы",
	"indexing.reindex": "Переиндексировать",
	"indexing.status.idle": "Не запущена",
	"indexing.status.indexing": "Индексация...",
	"indexing.status.complete": "Завершена",
	"indexing.status.error": "Ошибка",
	"indexing.mode.local": "Локальная (transformers.js)",
	"indexing.mode.remote": "Удалённая (API)",
	"indexing.mode.off": "Выключена",

	"general.language": "Язык интерфейса",
	"general.theme": "Тема",
	"general.telemetry": "Телеметрия"
}
```

**Создать файл:** `webview-ui/src/i18n/locales/en.json`

```json
{
	"settings.tabs.apiConfig": "API Configuration",
	"settings.tabs.features": "Features",
	"settings.tabs.browser": "Browser",
	"settings.tabs.terminal": "Terminal",
	"settings.tabs.indexing": "Indexing",
	"settings.tabs.general": "General",
	"settings.tabs.about": "About",
	"settings.tabs.debug": "Debug",

	"settings.apiConfig.header": "API Configuration",
	"settings.apiConfig.tooltip": "API provider settings",
	"settings.features.header": "Feature Settings",
	"settings.features.tooltip": "Feature settings",
	"settings.browser.header": "Browser Settings",
	"settings.browser.tooltip": "Browser settings",
	"settings.terminal.header": "Terminal Settings",
	"settings.terminal.tooltip": "Terminal settings",
	"settings.indexing.header": "Codebase Indexing",
	"settings.indexing.tooltip": "Codebase indexing settings",
	"settings.general.header": "General Settings",
	"settings.general.tooltip": "General settings",
	"settings.about.header": "About",
	"settings.about.tooltip": "About Shuncode AI",
	"settings.debug.header": "Debug",
	"settings.debug.tooltip": "Debug tools",

	"common.save": "Save",
	"common.cancel": "Cancel",
	"common.delete": "Delete",
	"common.accept": "Accept",
	"common.reject": "Reject",
	"common.expand": "Expand",
	"common.collapse": "Collapse",
	"common.search": "Search",
	"common.close": "Close",
	"common.enable": "Enable",
	"common.disable": "Disable",
	"common.on": "On",
	"common.off": "Off",

	"chat.placeholder": "Type a task or question...",
	"chat.contextHint": "Use @ for context, / for commands, Shift + drag for files/images",
	"chat.stopAI": "Stop AI",
	"chat.addContext": "Add context",
	"chat.addFiles": "Add files and images",
	"chat.selectModel": "Select model / API provider",
	"chat.modeAct": "Act",
	"chat.modePlan": "Plan",
	"chat.modeActDescription": "execute the task immediately",
	"chat.modePlanDescription": "gather information to create a plan",
	"chat.error": "Shuncode AI encountered a problem...",
	"chat.askQuestion": "Shuncode AI has a question:",
	"chat.wantsToExecute": "Shuncode AI wants to execute a command:",
	"chat.wantsToEdit": "Shuncode AI wants to edit a file:",
	"chat.wantsToCreate": "Shuncode AI wants to create a new file:",
	"chat.wantsToDelete": "Shuncode AI wants to delete this file:",
	"chat.wantsToRead": "Shuncode AI wants to read this file:",
	"chat.outsideWorkspace": "This file is outside the workspace",
	"chat.imageTooBig": "Image size exceeds 7500px",
	"chat.nonImageDisabled": "Uploading non-image files is disabled",
	"chat.appliedRules": "Applied conditional rules:",

	"pendingChanges.files": "files",
	"pendingChanges.file": "file",
	"pendingChanges.accept": "Accept",
	"pendingChanges.reject": "Reject",

	"indexing.title": "Codebase Indexing",
	"indexing.reindex": "Reindex",
	"indexing.status.idle": "Not running",
	"indexing.status.indexing": "Indexing...",
	"indexing.status.complete": "Complete",
	"indexing.status.error": "Error",
	"indexing.mode.local": "Local (transformers.js)",
	"indexing.mode.remote": "Remote (API)",
	"indexing.mode.off": "Disabled",

	"general.language": "Interface language",
	"general.theme": "Theme",
	"general.telemetry": "Telemetry"
}
```

**ВАЖНО:** Это НЕ полный набор — тут ~70 ключей для старта. По мере миграции компонентов (шаг 4) нужно добавлять новые ключи в оба файла. Все строки которые ты видишь кириллицей в TSX — нужно вынести в ключи.

### 1.3. Хук useTranslation

**Создать файл:** `webview-ui/src/i18n/index.ts`

```typescript
import { createContext, useContext, useCallback, useMemo } from "react"
import type { Locale } from "./types"

import ruLocale from "./locales/ru.json"
import enLocale from "./locales/en.json"

const locales: Record<Locale, Record<string, string>> = {
	ru: ruLocale,
	en: enLocale,
}

/** Default locale */
const DEFAULT_LOCALE: Locale = "ru"

/** i18n Context */
interface I18nContextValue {
	locale: Locale
	setLocale: (locale: Locale) => void
}

export const I18nContext = createContext<I18nContextValue>({
	locale: DEFAULT_LOCALE,
	setLocale: () => {},
})

/**
 * Translation hook.
 *
 * Usage:
 *   const { t } = useTranslation()
 *   return <span>{t("settings.tabs.apiConfig")}</span>
 *
 * Interpolation:
 *   t("pendingChanges.count", { count: 5 })
 *   where key value = "{{count}} файлов"
 */
export function useTranslation() {
	const { locale } = useContext(I18nContext)

	const t = useCallback(
		(key: string, params?: Record<string, string | number>): string => {
			let value = locales[locale]?.[key] ?? locales[DEFAULT_LOCALE]?.[key] ?? key

			// Simple interpolation: {{param}}
			if (params) {
				for (const [paramKey, paramValue] of Object.entries(params)) {
					value = value.replace(new RegExp(`\\{\\{${paramKey}\\}\\}`, "g"), String(paramValue))
				}
			}

			return value
		},
		[locale],
	)

	return { t, locale }
}

/** Available locales for settings UI */
export const AVAILABLE_LOCALES: Array<{ value: Locale; label: string }> = [
	{ value: "ru", label: "Русский" },
	{ value: "en", label: "English" },
]

export type { Locale }
```

---

## Шаг 2: Создать I18nProvider

**Создать файл:** `webview-ui/src/i18n/I18nProvider.tsx`

```tsx
import React, { useState, useCallback, useEffect } from "react"
import { I18nContext } from "./index"
import type { Locale } from "./types"
import { useExtensionState } from "../context/ExtensionStateContext"

/**
 * Wraps the app to provide i18n context.
 * Reads initial locale from extension settings.
 */
export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	// Read locale from extension state (settings)
	// TODO: Find the exact key where locale is stored in globalState/settings.
	// For now, use "preferredLanguage" or "interfaceLanguage" from ExtensionState.
	// If it doesn't exist yet — add it to the shared settings types.
	const { interfaceLanguage } = useExtensionState()

	const [locale, setLocaleState] = useState<Locale>(
		(interfaceLanguage as Locale) || "ru"
	)

	// Sync with extension state when it changes
	useEffect(() => {
		if (interfaceLanguage && interfaceLanguage !== locale) {
			setLocaleState(interfaceLanguage as Locale)
		}
	}, [interfaceLanguage])

	const setLocale = useCallback((newLocale: Locale) => {
		setLocaleState(newLocale)
		// Persist: send to extension backend via postMessage
		// vscode.postMessage({ type: "updateSetting", key: "interfaceLanguage", value: newLocale })
	}, [])

	return (
		<I18nContext.Provider value={{ locale, setLocale }}>
			{children}
		</I18nContext.Provider>
	)
}
```

**ВАЖНО:**
- Нужно найти где в `ExtensionStateContext` хранятся настройки и добавить `interfaceLanguage` если его нет
- Нужно найти корневой App/Provider компонент и обернуть его в `<I18nProvider>`
- Если `ExtensionState` не имеет `interfaceLanguage` — добавить его в `@shared/ExtensionMessage.ts` (или где определён тип state)

---

## Шаг 3: Обернуть приложение в I18nProvider

Найти корневой компонент webview (обычно `App.tsx` или `main.tsx` или `index.tsx`):

```bash
rg "createRoot\|ReactDOM.render" --type tsx --type ts
```

Обернуть:

```tsx
// Было:
<ExtensionStateProvider>
  <App />
</ExtensionStateProvider>

// Стало:
<ExtensionStateProvider>
  <I18nProvider>
    <App />
  </I18nProvider>
</ExtensionStateProvider>
```

`I18nProvider` должен быть ВНУТРИ `ExtensionStateProvider` (потому что читает `useExtensionState`).

---

## Шаг 4: Миграция компонентов

Это самый большой шаг — заменить хардкод строки на `t("key")`. Делать ПОЭТАПНО — по одному файлу за раз.

### Порядок миграции (от простого к сложному):

**Фаза 4A: Settings tabs (SettingsView.tsx) — 30 мин**

```typescript
// Было:
{ id: "api-config", name: "API Конфигурация", tooltipText: "Настройка API провайдеров", ... }

// Стало:
// В SettingsView.tsx убрать name/tooltipText/headerText из SETTINGS_TABS,
// или сделать их ключами:
{ id: "api-config", nameKey: "settings.tabs.apiConfig", tooltipKey: "settings.apiConfig.tooltip", headerKey: "settings.apiConfig.header", ... }

// В renderTabItem:
const { t } = useTranslation()
<span>{t(tab.nameKey)}</span>
```

**Фаза 4B: PendingChangesBar.tsx — 15 мин**

Всего 4 строки: "Свернуть", "Развернуть", "файл"/"файлов", "Принять", "Отменить".

```tsx
const { t } = useTranslation()

// Было:
aria-label={isExpanded ? "Свернуть" : "Развернуть"}
// Стало:
aria-label={isExpanded ? t("common.collapse") : t("common.expand")}

// Было:
{pendingChanges.length === 1 ? "файл" : "файлов"}
// Стало:
{pendingChanges.length === 1 ? t("pendingChanges.file") : t("pendingChanges.files")}
```

**Фаза 4C: ChatTextArea.tsx — 30 мин**

~13 строк. Заменить по аналогии.

**Фаза 4D: ChatRow.tsx — 1 час**

~56 строк — самый большой файл. Много контекстных сообщений ("Shuncode AI хочет отредактировать файл:", "Shuncode AI хочет создать новый файл:" и т.д.).

**Фаза 4E: Settings секции — 2-3 часа**

Все файлы в `settings/sections/`:
- FeatureSettingsSection.tsx (56 строк)
- IndexingSettingsSection.tsx (34 строки)
- BrowserSettingsSection.tsx (19 строк)
- TerminalSettingsSection.tsx (15 строк)
- DebugSection.tsx (14 строк)
- GeneralSettingsSection.tsx (6 строк)
- ApiConfigurationSection.tsx (4 строк)
- AboutSection.tsx (2 строки)

Для каждого: добавить `const { t } = useTranslation()` и заменить кириллицу на `t("key")`.

**По ходу:** каждый раз когда встречаешь новую строку которой нет в `ru.json` / `en.json` — добавить в оба файла.

**Фаза 4F: Остальное — 1-2 часа**

- `HomeHeader.tsx`
- `NewTaskButton.tsx`
- `MessageQueue.tsx`
- `ThinkingRow.tsx`
- `ChatView.tsx`
- Settings providers (`OpenAICompatible.tsx`, `LiteLlmProvider.tsx`)

---

## Шаг 5: Backend строки (опционально, низкий приоритет)

Backend строки (status bar, notifications) видит только разработчик или продвинутый пользователь. Их можно мигрировать позже.

Если решишь делать сейчас — создать аналогичную структуру в `src/i18n/` с простой функцией `t()` (без React context):

```typescript
import ruLocale from "./locales/ru.json"
import enLocale from "./locales/en.json"

let currentLocale: "ru" | "en" = "ru"

export function setLocale(locale: "ru" | "en") {
	currentLocale = locale
}

export function t(key: string, params?: Record<string, string | number>): string {
	const locales = { ru: ruLocale, en: enLocale }
	let value = locales[currentLocale]?.[key] ?? locales.ru?.[key] ?? key
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			value = value.replace(`{{${k}}}`, String(v))
		}
	}
	return value
}
```

---

## Шаг 6: Добавить переключатель языка в Settings

В `GeneralSettingsSection.tsx` добавить dropdown:

```tsx
import { useTranslation, AVAILABLE_LOCALES } from "@/i18n"
import { I18nContext } from "@/i18n"
import { useContext } from "react"

// Внутри компонента:
const { t } = useTranslation()
const { locale, setLocale } = useContext(I18nContext)

// JSX:
<div>
	<label>{t("general.language")}</label>
	<select
		value={locale}
		onChange={(e) => setLocale(e.target.value as Locale)}
	>
		{AVAILABLE_LOCALES.map((l) => (
			<option key={l.value} value={l.value}>{l.label}</option>
		))}
	</select>
</div>
```

---

## Проверка

1. **Собрать:** `node esbuild.mjs` — без ошибок
2. **Язык RU:** открыть настройки — все надписи на русском
3. **Переключить на EN:** Settings → General → Language → English
4. **Все надписи** должны переключиться на английский БЕЗ перезагрузки
5. **Переключить обратно на RU** — всё возвращается
6. **Проверить чат:** все сообщения ("Shuncode AI хочет...", кнопки) на выбранном языке
7. **Проверить PendingChangesBar:** "Принять/Отменить" → "Accept/Reject"
8. **Проверить fallback:** если ключ отсутствует в en.json — должен показать русский текст (а не ключ)
9. **Перезагрузить Shuncode AI** — язык должен сохраниться (не сбрасываться на RU)

### Edge cases:
- Строки с интерполяцией: "5 файлов" / "5 files" — проверить что число подставляется
- Длинные английские строки не ломают layout (EN текст обычно на ~20% длиннее RU)
