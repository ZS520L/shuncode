export type LanguageKey = "en" | "zh-CN"

export type LanguageDisplay = "English" | "Simplified Chinese - 简体中文"

export const DEFAULT_LANGUAGE_SETTINGS: LanguageKey = "zh-CN"

export const languageOptions: { key: LanguageKey; display: LanguageDisplay }[] = [
	{ key: "zh-CN", display: "Simplified Chinese - 简体中文" },
	{ key: "en", display: "English" },
]

export function getLanguageKey(display: LanguageDisplay | undefined): LanguageKey {
	if (!display) {
		return DEFAULT_LANGUAGE_SETTINGS
	}
	const languageOption = languageOptions.find((option) => option.display === display)
	if (languageOption) {
		return languageOption.key
	}
	return DEFAULT_LANGUAGE_SETTINGS
}
