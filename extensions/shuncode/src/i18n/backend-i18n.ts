/**
 * Backend i18n module for translating strings in Extension Host.
 *
 * Detects locale via vscode.env.language, defaults to "ru".
 *
 * Used for:
 * - showMessage notifications (native VS Code popups)
 * - checkpointManagerErrorMessage (checkpoint error banner)
 * - Inline diff buttons (Accept/Reject)
 *
 * Supports interpolation: t("key", { error: "text" })
 * Substitution syntax: {{param_name}}
 */

import * as vscode from "vscode"

type Locale = "ru" | "en"
const RUSSIAN_PREFERRED_LANGUAGE_PREFIX = "russian"

// --- English translations ---
const en: Record<string, string> = {
	"checkpoint.error.slowInit":
		"Checkpoints are taking longer than expected to initialize. Working in a large repository? Consider re-opening ShunCode in a project that uses git, or disabling checkpoints.",
	"checkpoint.error.timeout":
		"Checkpoints initialization timed out. Consider re-opening ShunCode in a project that uses git, or disabling checkpoints.",
	"checkpoint.error.gitRequired": "Git must be installed to use checkpoints.",
	"checkpoint.error.disabled": "Checkpoints are disabled in settings.",
	"checkpoint.error.disabledNoDiff": "Checkpoints are disabled in settings. Cannot show diff.",
	"checkpoint.error.restoreFailed": "Failed to restore checkpoint: {{error}}",
	"checkpoint.error.restoreOffsetFailed": "Failed to restore offset checkpoint: {{error}}",
	"checkpoint.error.noValidHash": "Failed to restore checkpoint: No valid checkpoint hash found",
	"checkpoint.error.trackerNotAvailable": "Checkpoint tracker not available",
	"checkpoint.error.unexpectedNoHash": "Unexpected error: No checkpoint hash found",
	"checkpoint.error.diffFailed": "Failed to retrieve diff set: {{error}}",
	"checkpoint.error.presentDiffFailed": "Failed to present diff: {{error}}",
	"checkpoint.error.notInitialized": "Checkpoint manager is not initialized.",
	"checkpoint.error.noPrimaryRoot": "No primary workspace root configured.",
	"checkpoint.error.noTrackerForPrimary": "No checkpoint tracker available for the primary workspace.",
	"checkpoint.info.noChanges": "No changes found",
	"checkpoint.info.taskRestored": "Task messages have been restored to the checkpoint",
	"checkpoint.info.workspaceRestored": "Workspace files have been restored to the checkpoint",
	"checkpoint.info.taskAndWorkspaceRestored": "Task and workspace have been restored to the checkpoint",
	"diff.accept": "Accept",
	"diff.reject": "Reject",
	"voice.preparing": "Preparing voice input... Downloading required components (~170 MB). This only happens on first launch. Please try again in a couple of minutes.",
	"voice.ready": "Voice input is ready! Click the microphone again.",
	"voice.downloadFailed": "Failed to download voice input components: {{error}}",
	"voice.downloadTimeout": "Download timed out. Please check your internet connection and try again.",
	"auth.loginRequired": "Please sign in to continue. It's free!",
	"auth.loginFailed": "Failed to log in to ShunCode",
	"auth.logoutSuccess": "Successfully logged out of ShunCode",
	"auth.logoutFailed": "Logout failed",
	"auth.freeLimit": "You've used all {{limit}} free messages. Sign in to continue — it's free and takes 30 seconds!",
	"auth.success.title": "ShunCode - Authorization",
	"auth.success.heading": "Done!",
	"auth.success.body": "You are authorized. Return to ShunCode.",
	"auth.success.redirectPrefix": "Redirecting in ",
	"auth.success.redirectSuffix": " sec...",

	"auth.oca.logoutSuccess": "Successfully logged out of OCA",
	"auth.oca.logoutFailed": "OCA Logout failed",
	"auth.oca.loginFailed": "Failed to log in to OCA",
	"auth.oca.notAuthenticated": "Not authenticated with OCA. Please sign in first.",
	"auth.oca.noModels": "No models found. Did you set up your OCA access (possibly through entitlements)?",
	"auth.oca.refreshed": "Refreshed OCA models from {{url}}",
	"auth.oca.fetchFailed": "Failed to fetch OCA models. Please check your configuration from {{url}}",
	"auth.oca.refreshError": "Error refreshing OCA models. {{details}}",
	"auth.codex.signInSuccess": "Successfully signed in to OpenAI Codex",
	"auth.codex.signInFailed": "OpenAI Codex sign in failed: {{error}}",

	"mcp.authSuccess": "Successfully authenticated MCP server",
	"mcp.authFailed": "Failed to authenticate MCP server",
	"mcp.installSuccess": "MCP server \"{{name}}\" installed successfully.",
	"mcp.downloadFailed": "Failed to download MCP",
	"mcp.errorTimeout": "Request timed out. Please try again.",
	"mcp.errorNotFound": "MCP server not found in marketplace.",
	"mcp.errorServer": "Internal server error. Please try again later.",
	"mcp.errorNetwork": "Network error. Please check your internet connection.",

	"diff.allCleared": "All pending diffs cleared.",

	"inlineEdit.selectCode": "Select code to edit",
	"inlineEdit.emptyResponse": "ShunCode: empty response from model",
	"inlineEdit.noChanges": "ShunCode: model found nothing to change",
	"inlineEdit.inputPrompt": "What to do with selected code?",
	"inlineEdit.inputPlaceholder": "Add error handling, rename, refactor...",
	"inlineEdit.progress": "ShunCode: Inline Edit...",
	"inlineEdit.error": "ShunCode Inline Edit: {{error}}",

	"commands.selectCodeToImprove": "Please select some code to improve.",
	"commands.selectCodeToExplain": "Please select some code to explain.",

	"history.deletePrompt": "What would you like to delete?",
	"history.deleteAll": "Delete Everything",
	"history.deleteExceptFavorites": "Delete All Except Favorites",
	"history.noFavorites": "No favorited tasks found. Would you like to delete all tasks anyway?",
	"history.deleteAllTasks": "Delete All Tasks",
	"history.deleteError": "Encountered error while deleting task history, there may be some files left behind. Error: {{error}}",

	"state.resettingGlobal": "Resetting global state...",
	"state.resettingWorkspace": "Resetting workspace state...",
	"state.resetDone": "State reset",
	"state.resetFailed": "Failed to reset state: {{error}}",

	"cli.installFailed": "Failed to start CLI installation: {{error}}",


	"gigachat.error.authRequired": "GigaChat Authorization Key is required",
	"gigachat.error.oauthInvalidResponse": "GigaChat OAuth: invalid server response: {{details}}",
	"gigachat.error.oauthFailed": "GigaChat OAuth error ({{status}}): {{details}}",
	"gigachat.error.oauthRequest": "GigaChat OAuth request error: {{error}}",
	"gigachat.error.apiFailed": "GigaChat API error ({{status}}): {{details}}",
	"gigachat.error.noResponseBody": "GigaChat API returned no response body",
	"gigachat.log.oauthStarting": "Starting OAuth token request...",
	"gigachat.log.oauthStatus": "OAuth response status: {{status}}",
	"gigachat.log.oauthTokenReceived": "OAuth token received, expires_at: {{expiresAt}}",
	"gigachat.log.chatRequest": "Chat request: model={{model}}, messages={{count}}, stream=true",

	"yandexgpt.error.apiKeyRequired": "YandexGPT API key is required",
	"yandexgpt.error.folderIdRequired": "Yandex Cloud folder ID is required",
	"yandexgpt.error.apiFailed": "YandexGPT API error ({{status}}): {{details}}",
	"yandexgpt.error.noResponseBody": "YandexGPT API returned no response body",
}

// --- Russian translations ---
const ru: Record<string, string> = {
	// allow-any-unicode-next-line
	"checkpoint.error.slowInit": "Инициализация контрольных точек занимает больше времени, чем ожидалось. Работаете с большим репозиторием? Попробуйте открыть ShunCode в проекте с git или отключите контрольные точки.",
	// allow-any-unicode-next-line
	"checkpoint.error.timeout": "Инициализация контрольных точек превысила время ожидания. Попробуйте открыть ShunCode в проекте с git или отключите контрольные точки.",
	// allow-any-unicode-next-line
	"checkpoint.error.gitRequired": "Для работы контрольных точек необходимо установить Git.",
	// allow-any-unicode-next-line
	"checkpoint.error.disabled": "Контрольные точки отключены в настройках.",
	// allow-any-unicode-next-line
	"checkpoint.error.disabledNoDiff": "Контрольные точки отключены в настройках. Невозможно показать различия.",
	// allow-any-unicode-next-line
	"checkpoint.error.restoreFailed": "Не удалось восстановить контрольную точку: {{error}}",
	// allow-any-unicode-next-line
	"checkpoint.error.restoreOffsetFailed": "Не удалось восстановить смещённую контрольную точку: {{error}}",
	// allow-any-unicode-next-line
	"checkpoint.error.noValidHash": "Не удалось восстановить контрольную точку: не найден действительный хеш",
	// allow-any-unicode-next-line
	"checkpoint.error.trackerNotAvailable": "Трекер контрольных точек недоступен",
	// allow-any-unicode-next-line
	"checkpoint.error.unexpectedNoHash": "Непредвиденная ошибка: хеш контрольной точки не найден",
	// allow-any-unicode-next-line
	"checkpoint.error.diffFailed": "Не удалось получить набор различий: {{error}}",
	// allow-any-unicode-next-line
	"checkpoint.error.presentDiffFailed": "Не удалось показать различия: {{error}}",
	// allow-any-unicode-next-line
	"checkpoint.error.notInitialized": "Менеджер контрольных точек не инициализирован.",
	// allow-any-unicode-next-line
	"checkpoint.error.noPrimaryRoot": "Основной корень рабочей области не настроен.",
	// allow-any-unicode-next-line
	"checkpoint.error.noTrackerForPrimary": "Трекер контрольных точек для основной рабочей области недоступен.",
	// allow-any-unicode-next-line
	"checkpoint.info.noChanges": "Изменений не найдено",
	// allow-any-unicode-next-line
	"checkpoint.info.taskRestored": "Сообщения задачи восстановлены до контрольной точки",
	// allow-any-unicode-next-line
	"checkpoint.info.workspaceRestored": "Файлы рабочей области восстановлены до контрольной точки",
	// allow-any-unicode-next-line
	"checkpoint.info.taskAndWorkspaceRestored": "Задача и рабочая область восстановлены до контрольной точки",
	// allow-any-unicode-next-line
	"diff.accept": "Принять",
	// allow-any-unicode-next-line
	"diff.reject": "Отклонить",
	// allow-any-unicode-next-line
	"voice.preparing": "Подготовка голосового ввода... Загружаются необходимые компоненты (~170 МБ). Это происходит только при первом запуске. Попробуйте через пару минут.",
	// allow-any-unicode-next-line
	"voice.ready": "Голосовой ввод готов к работе! Нажмите на микрофон ещё раз.",
	// allow-any-unicode-next-line
	"voice.downloadFailed": "Не удалось загрузить компоненты голосового ввода: {{error}}",
	// allow-any-unicode-next-line
	"voice.downloadTimeout": "Загрузка прервана по таймауту. Проверьте подключение к интернету и попробуйте снова.",
	// allow-any-unicode-next-line
	"auth.loginRequired": "Авторизуйтесь чтобы продолжить. Это бесплатно!",
	// allow-any-unicode-next-line
	"auth.loginFailed": "Не удалось войти в ShunCode",
	// allow-any-unicode-next-line
	"auth.logoutSuccess": "Вы вышли из ShunCode",
	// allow-any-unicode-next-line
	"auth.logoutFailed": "Не удалось выйти",
	// allow-any-unicode-next-line
	"auth.freeLimit": "Вы использовали все {{limit}} бесплатных сообщений. Авторизуйтесь чтобы продолжить — это бесплатно и займёт 30 секунд!",
	// allow-any-unicode-next-line
	"auth.success.title": "ShunCode — Авторизация",
	// allow-any-unicode-next-line
	"auth.success.heading": "Готово!",
	// allow-any-unicode-next-line
	"auth.success.body": "Вы авторизованы. Вернитесь в ShunCode.",
	// allow-any-unicode-next-line
	"auth.success.redirectPrefix": "Перенаправление через ",
	// allow-any-unicode-next-line
	"auth.success.redirectSuffix": " сек...",

	// allow-any-unicode-next-line
	"auth.oca.logoutSuccess": "Вы вышли из OCA",
	// allow-any-unicode-next-line
	"auth.oca.logoutFailed": "Не удалось выйти из OCA",
	// allow-any-unicode-next-line
	"auth.oca.loginFailed": "Не удалось войти в OCA",
	// allow-any-unicode-next-line
	"auth.oca.notAuthenticated": "Вы не авторизованы в OCA. Войдите в аккаунт.",
	// allow-any-unicode-next-line
	"auth.oca.noModels": "Модели не найдены. Настроен ли доступ к OCA (возможно, через entitlements)?",
	// allow-any-unicode-next-line
	"auth.oca.refreshed": "Модели OCA обновлены из {{url}}",
	// allow-any-unicode-next-line
	"auth.oca.fetchFailed": "Не удалось загрузить модели OCA. Проверьте конфигурацию: {{url}}",
	// allow-any-unicode-next-line
	"auth.oca.refreshError": "Ошибка обновления моделей OCA. {{details}}",
	// allow-any-unicode-next-line
	"auth.codex.signInSuccess": "Вход в OpenAI Codex выполнен",
	// allow-any-unicode-next-line
	"auth.codex.signInFailed": "Не удалось войти в OpenAI Codex: {{error}}",

	// allow-any-unicode-next-line
	"mcp.authSuccess": "MCP-сервер успешно авторизован",
	// allow-any-unicode-next-line
	"mcp.authFailed": "Не удалось авторизовать MCP-сервер",
	// allow-any-unicode-next-line
	"mcp.installSuccess": "MCP-сервер «{{name}}» установлен.",
	// allow-any-unicode-next-line
	"mcp.downloadFailed": "Не удалось загрузить MCP",
	// allow-any-unicode-next-line
	"mcp.errorTimeout": "Превышено время ожидания. Попробуйте ещё раз.",
	// allow-any-unicode-next-line
	"mcp.errorNotFound": "MCP-сервер не найден в маркетплейсе.",
	// allow-any-unicode-next-line
	"mcp.errorServer": "Внутренняя ошибка сервера. Попробуйте позже.",
	// allow-any-unicode-next-line
	"mcp.errorNetwork": "Ошибка сети. Проверьте подключение к интернету.",

	// allow-any-unicode-next-line
	"diff.allCleared": "Все ожидающие изменения очищены.",

	// allow-any-unicode-next-line
	"inlineEdit.selectCode": "Выделите код для редактирования",
	// allow-any-unicode-next-line
	"inlineEdit.emptyResponse": "ShunCode: пустой ответ от модели",
	// allow-any-unicode-next-line
	"inlineEdit.noChanges": "ShunCode: модель не нашла что менять",
	// allow-any-unicode-next-line
	"inlineEdit.inputPrompt": "Что сделать с выделенным кодом?",
	// allow-any-unicode-next-line
	"inlineEdit.inputPlaceholder": "Добавь обработку ошибок, переименуй, рефакторинг...",
	// allow-any-unicode-next-line
	"inlineEdit.progress": "ShunCode: Инлайн-редактирование...",
	// allow-any-unicode-next-line
	"inlineEdit.error": "ShunCode Inline Edit: {{error}}",

	// allow-any-unicode-next-line
	"commands.selectCodeToImprove": "Выделите код для улучшения.",
	// allow-any-unicode-next-line
	"commands.selectCodeToExplain": "Выделите код для объяснения.",

	// allow-any-unicode-next-line
	"history.deletePrompt": "Что вы хотите удалить?",
	// allow-any-unicode-next-line
	"history.deleteAll": "Удалить всё",
	// allow-any-unicode-next-line
	"history.deleteExceptFavorites": "Удалить всё кроме избранного",
	// allow-any-unicode-next-line
	"history.noFavorites": "Избранных задач не найдено. Удалить все задачи?",
	// allow-any-unicode-next-line
	"history.deleteAllTasks": "Удалить все задачи",
	// allow-any-unicode-next-line
	"history.deleteError": "Ошибка при удалении истории задач, некоторые файлы могли остаться. Ошибка: {{error}}",

	// allow-any-unicode-next-line
	"state.resettingGlobal": "Сброс глобального состояния...",
	// allow-any-unicode-next-line
	"state.resettingWorkspace": "Сброс состояния рабочей области...",
	// allow-any-unicode-next-line
	"state.resetDone": "Состояние сброшено",
	// allow-any-unicode-next-line
	"state.resetFailed": "Не удалось сбросить состояние: {{error}}",

	// allow-any-unicode-next-line
	"cli.installFailed": "Не удалось запустить установку CLI: {{error}}",


	// allow-any-unicode-next-line
	"gigachat.error.authRequired": "Требуется ключ авторизации GigaChat",
	// allow-any-unicode-next-line
	"gigachat.error.oauthInvalidResponse": "Ошибка авторизации GigaChat: некорректный ответ сервера: {{details}}",
	// allow-any-unicode-next-line
	"gigachat.error.oauthFailed": "Ошибка авторизации GigaChat ({{status}}): {{details}}",
	// allow-any-unicode-next-line
	"gigachat.error.oauthRequest": "Ошибка запроса авторизации GigaChat: {{error}}",
	// allow-any-unicode-next-line
	"gigachat.error.apiFailed": "Ошибка API GigaChat ({{status}}): {{details}}",
	// allow-any-unicode-next-line
	"gigachat.error.noResponseBody": "API GigaChat не вернул тело ответа",
	// allow-any-unicode-next-line
	"gigachat.log.oauthStarting": "Запрос OAuth токена...",
	// allow-any-unicode-next-line
	"gigachat.log.oauthStatus": "OAuth статус ответа: {{status}}",
	// allow-any-unicode-next-line
	"gigachat.log.oauthTokenReceived": "OAuth токен получен, expires_at: {{expiresAt}}",
	// allow-any-unicode-next-line
	"gigachat.log.chatRequest": "Запрос к чату: модель={{model}}, сообщений={{count}}, stream=true",

	// allow-any-unicode-next-line
	"yandexgpt.error.apiKeyRequired": "Требуется API-ключ YandexGPT",
	// allow-any-unicode-next-line
	"yandexgpt.error.folderIdRequired": "Требуется идентификатор каталога Yandex Cloud (Folder ID)",
	// allow-any-unicode-next-line
	"yandexgpt.error.apiFailed": "Ошибка API YandexGPT ({{status}}): {{details}}",
	// allow-any-unicode-next-line
	"yandexgpt.error.noResponseBody": "API YandexGPT не вернул тело ответа",
}

const dictionaries: Record<Locale, Record<string, string>> = { en, ru }

/** Module-level override — set by updateSettings when user changes interface language */
let _overrideLocale: Locale | null = null

/**
 * Sets the backend locale explicitly.
 * Called from updateSettings handler when preferredLanguage changes,
 * and from controller init to restore the setting on startup.
 */
export function setBackendLocale(locale: Locale): void {
	_overrideLocale = locale
}

/**
 * Maps preferred language display value to backend locale.
 * Preferred language values are formatted as "English" or "Russian - Русский".
 * We resolve by stable English prefix to avoid locale-dependent string matching.
 */
export function getBackendLocaleForPreferredLanguage(preferredLanguage: string): Locale {
	const normalized = preferredLanguage.trim().toLowerCase()
	return normalized.startsWith(RUSSIAN_PREFERRED_LANGUAGE_PREFIX) ? "ru" : "en"
}

/**
 * Detects current locale.
 * Priority: explicit override → vscode.env.language → default "ru"
 */
function getLocale(): Locale {
	if (_overrideLocale) return _overrideLocale
	try {
		if (vscode.env.language.startsWith("ru")) {
			return "ru"
		}
	} catch {
		// ignore
	}
	return "ru"
}

/**
 * Substitutes params into string: {{key}} -> value
 */
function interpolate(value: string, params?: Record<string, string | number>): string {
	if (!params) {
		return value
	}
	let result = value
	for (const [key, paramValue] of Object.entries(params)) {
		result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), String(paramValue))
	}
	return result
}

/**
 * Translates key to current language with parameter substitution.
 * If key not found returns the key itself (fallback).
 */
export function t(key: string, params?: Record<string, string | number>): string {
	const locale = getLocale()
	const current = dictionaries[locale]?.[key]
	const fallback = dictionaries["en"]?.[key]
	return interpolate(current ?? fallback ?? key, params)
}
