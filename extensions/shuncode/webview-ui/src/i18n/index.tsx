import { createContext, type FC, type ReactNode, useCallback, useContext, useMemo, useState } from "react"
import { updateSetting } from "@/components/settings/utils/settingsHandlers"
import en from "./locales/en.json"
import zhCN from "./locales/zh-CN.json"
import type { Locale, TranslationDictionary } from "./types"

const STORAGE_KEY = "shuncode.interfaceLanguage"
const DEFAULT_LOCALE: Locale = "zh-CN"

// Maps interface locale to preferredLanguage display value (used in system prompt)
const LOCALE_TO_PREFERRED_LANGUAGE: Record<Locale, string> = {
	"zh-CN": "Simplified Chinese - 简体中文",
	en: "English",
}

const dictionaries: Record<Locale, TranslationDictionary> = {
	"zh-CN": zhCN,
	en,
}

interface I18nContextValue {
	locale: Locale
	setLocale: (locale: Locale) => void
	t: (key: string, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined)

function resolveInitialLocale(): Locale {
	const stored = localStorage.getItem(STORAGE_KEY)
	if (stored === "zh-CN" || stored === "en") {
		return stored
	}
	return DEFAULT_LOCALE
}

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

export const I18nProvider: FC<{ children: ReactNode }> = ({ children }) => {
	const [locale, setLocaleState] = useState<Locale>(() => resolveInitialLocale())

	const setLocale = useCallback((next: Locale) => {
		setLocaleState(next)
		localStorage.setItem(STORAGE_KEY, next)
		// Sync model language: use same language for AI communication and thinking
		updateSetting("preferredLanguage", LOCALE_TO_PREFERRED_LANGUAGE[next])
		updateSetting("alwaysThinkInPreferredLanguage", true)
	}, [])

	const t = useCallback(
		(key: string, params?: Record<string, string | number>) => {
			const current = dictionaries[locale]?.[key]
			const fallback = dictionaries[DEFAULT_LOCALE]?.[key]
			return interpolate(current ?? fallback ?? key, params)
		},
		[locale],
	)

	const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])
	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
	const context = useContext(I18nContext)
	if (!context) {
		throw new Error("useI18n must be used within I18nProvider")
	}
	return context
}

export const AVAILABLE_LOCALES: Array<{ value: Locale; labelKey: string }> = [
	{ value: "zh-CN", labelKey: "language.chinese" },
	{ value: "en", labelKey: "language.english" },
]

export type { Locale }
