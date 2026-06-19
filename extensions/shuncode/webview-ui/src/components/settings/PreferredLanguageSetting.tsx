import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { updateSetting } from "./utils/settingsHandlers"

const PreferredLanguageSetting: React.FC = () => {
	const { t } = useI18n()
	const { preferredLanguage, alwaysThinkInPreferredLanguage } = useExtensionState()

	const handleLanguageChange = (newLanguage: string) => {
		updateSetting("preferredLanguage", newLanguage)
	}

	const handleThinkInLanguageChange = (e: any) => {
		const checked = e.target.checked === true
		updateSetting("alwaysThinkInPreferredLanguage", checked)
	}

	return (
		<div style={{}}>
			<label className="block mb-1 text-base font-medium" htmlFor="preferred-language-dropdown">
				{t("preferredLanguage.label")}
			</label>
			{/* allow-any-unicode-next-line */}
			<VSCodeDropdown
				// allow-any-unicode-next-line
				currentValue={preferredLanguage || "Simplified Chinese - 简体中文"}
				id="preferred-language-dropdown"
				onChange={(e: any) => {
					handleLanguageChange(e.target.value)
				}}
				style={{ width: "100%" }}>
				{/* allow-any-unicode-next-line */}
				<VSCodeOption value="Simplified Chinese - 简体中文">Simplified Chinese - 简体中文</VSCodeOption>
				<VSCodeOption value="English">English</VSCodeOption>
			</VSCodeDropdown>
			<p className="text-sm text-description mt-1">{t("preferredLanguage.description")}</p>

			<div className="mt-3">
				<VSCodeCheckbox checked={alwaysThinkInPreferredLanguage || false} onChange={handleThinkInLanguageChange}>
					{t("preferredLanguage.alwaysThink")}
				</VSCodeCheckbox>
				<p className="text-sm text-description mt-1">{t("preferredLanguage.alwaysThinkDescription")}</p>
			</div>
		</div>
	)
}

export default React.memo(PreferredLanguageSetting)
