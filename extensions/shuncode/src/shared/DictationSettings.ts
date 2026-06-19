export interface AudioDevice {
	id: string // Device name/identifier (e.g. "Microphone (Realtek Audio)")
	name: string // Human-readable display name
	isDefault?: boolean // true if this device is detected as the system default
}

export interface DictationSettings {
	featureEnabled: boolean // Feature flag - whether dictation feature is available
	dictationEnabled: boolean // User preference - whether user has enabled dictation
	dictationLanguage: string
	// allow-any-unicode-next-line
	whisperModel?: string // "tiny" | "base" | "small" — local whisper model quality
	voiceReady?: boolean // true when all voice components are downloaded and ready
	voiceDownloading?: boolean // true while components are being downloaded (transient, not persisted across restarts)
	voiceDownloadProgress?: number // 0-100, download percentage (transient)
	voiceReinstall?: boolean // transient flag: delete model and re-download
	audioDeviceId?: string // User-selected microphone device ID (empty = auto-detect)
	audioDevices?: AudioDevice[] // Available audio devices list (transient, populated on request)
}

export const DEFAULT_DICTATION_SETTINGS: DictationSettings = {
	featureEnabled: false, // Feature flag, will be set by the extension based on platform
	dictationEnabled: false, // Default is false while this service is in Experimental status
	dictationLanguage: "ru",
	whisperModel: "tiny", // Default quality level (only tiny is bundled and free)
}

export interface LanguageItem {
	name: string
	code: string
}

export const SUPPORTED_DICTATION_LANGUAGES: LanguageItem[] = [
	{ name: "English", code: "en" },
	// allow-any-unicode-next-line
	{ name: "Spanish (Español)", code: "es" },
	// allow-any-unicode-next-line
	{ name: "Chinese (中文)", code: "zh" },
	// allow-any-unicode-next-line
	{ name: "Japanese (日本語)", code: "ja" },
	{ name: "Afrikaans", code: "af" },
	// allow-any-unicode-next-line
	{ name: "Arabic (العربية)", code: "ar" },
	// allow-any-unicode-next-line
	{ name: "Armenian (Հայերեն)", code: "hy" },
	// allow-any-unicode-next-line
	{ name: "Azerbaijani (Azərbaycan)", code: "az" },
	// allow-any-unicode-next-line
	{ name: "Belarusian (Беларуская)", code: "be" },
	{ name: "Bosnian (Bosanski)", code: "bs" },
	// allow-any-unicode-next-line
	{ name: "Bulgarian (Български)", code: "bg" },
	// allow-any-unicode-next-line
	{ name: "Catalan (Català)", code: "ca" },
	{ name: "Croatian (Hrvatski)", code: "hr" },
	// allow-any-unicode-next-line
	{ name: "Czech (Čeština)", code: "cs" },
	{ name: "Danish (Dansk)", code: "da" },
	{ name: "Dutch (Nederlands)", code: "nl" },
	{ name: "Estonian (Eesti)", code: "et" },
	{ name: "Finnish (Suomi)", code: "fi" },
	// allow-any-unicode-next-line
	{ name: "French (Français)", code: "fr" },
	{ name: "Galician (Galego)", code: "gl" },
	{ name: "German (Deutsch)", code: "de" },
	// allow-any-unicode-next-line
	{ name: "Greek (Ελληνικά)", code: "el" },
	// allow-any-unicode-next-line
	{ name: "Hebrew (עברית)", code: "he" },
	// allow-any-unicode-next-line
	{ name: "Hindi (हिन्दी)", code: "hi" },
	{ name: "Hungarian (Magyar)", code: "hu" },
	// allow-any-unicode-next-line
	{ name: "Icelandic (Íslenska)", code: "is" },
	{ name: "Indonesian (Bahasa Indonesia)", code: "id" },
	{ name: "Italian (Italiano)", code: "it" },
	// allow-any-unicode-next-line
	{ name: "Kannada (ಕನ್ನಡ)", code: "kn" },
	// allow-any-unicode-next-line
	{ name: "Kazakh (Қазақша)", code: "kk" },
	// allow-any-unicode-next-line
	{ name: "Korean (한국어)", code: "ko" },
	// allow-any-unicode-next-line
	{ name: "Latvian (Latviešu)", code: "lv" },
	// allow-any-unicode-next-line
	{ name: "Lithuanian (Lietuvių)", code: "lt" },
	// allow-any-unicode-next-line
	{ name: "Macedonian (Македонски)", code: "mk" },
	{ name: "Malay (Bahasa Melayu)", code: "ms" },
	// allow-any-unicode-next-line
	{ name: "Marathi (मराठी)", code: "mr" },
	// allow-any-unicode-next-line
	{ name: "Maori (Te Reo Māori)", code: "mi" },
	// allow-any-unicode-next-line
	{ name: "Nepali (नेपाली)", code: "ne" },
	{ name: "Norwegian (Norsk)", code: "no" },
	// allow-any-unicode-next-line
	{ name: "Persian (فارسی)", code: "fa" },
	{ name: "Polish (Polski)", code: "pl" },
	// allow-any-unicode-next-line
	{ name: "Portuguese (Português)", code: "pt" },
	// allow-any-unicode-next-line
	{ name: "Romanian (Română)", code: "ro" },
	// allow-any-unicode-next-line
	{ name: "Russian (Русский)", code: "ru" },
	// allow-any-unicode-next-line
	{ name: "Serbian (Српски)", code: "sr" },
	// allow-any-unicode-next-line
	{ name: "Slovak (Slovenčina)", code: "sk" },
	// allow-any-unicode-next-line
	{ name: "Slovenian (Slovenščina)", code: "sl" },
	{ name: "Swahili (Kiswahili)", code: "sw" },
	{ name: "Swedish (Svenska)", code: "sv" },
	{ name: "Tagalog", code: "tl" },
	// allow-any-unicode-next-line
	{ name: "Tamil (தமிழ்)", code: "ta" },
	// allow-any-unicode-next-line
	{ name: "Thai (ไทย)", code: "th" },
	// allow-any-unicode-next-line
	{ name: "Turkish (Türkçe)", code: "tr" },
	// allow-any-unicode-next-line
	{ name: "Ukrainian (Українська)", code: "uk" },
	// allow-any-unicode-next-line
	{ name: "Urdu (اردو)", code: "ur" },
	// allow-any-unicode-next-line
	{ name: "Vietnamese (Tiếng Việt)", code: "vi" },
	{ name: "Welsh (Cymraeg)", code: "cy" },
]
