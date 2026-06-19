import { McpDisplayMode } from "@shared/McpDisplayMode"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeLink, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import McpDisplayModeDropdown from "@/components/mcp/chat-display/McpDisplayModeDropdown"
import { useCallback } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AVAILABLE_LOCALES, type Locale, useI18n } from "@/i18n"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface GeneralSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const GeneralSettingsSection = ({ renderSectionHeader }: GeneralSettingsSectionProps) => {
	const { telemetrySetting, remoteConfigSettings, mcpDisplayMode, version, alwaysThinkInPreferredLanguage, preferredLanguage } =
		useExtensionState()
	const { locale, setLocale, t } = useI18n()

	const handlePreferredLanguageChange = useCallback((value: string) => {
		updateSetting("preferredLanguage", value)
	}, [])

	return (
		<div>
			{renderSectionHeader("general")}
			<Section>
				{/* Model output language */}
			<div className="mb-[10px]">
				<div className="mb-[5px] text-sm">{t("general.modelLanguage")}</div>
				<VSCodeDropdown
					currentValue={preferredLanguage || "中文 (Chinese)"}
					onChange={(e: any) => handlePreferredLanguageChange(e.target.currentValue)}>
					<VSCodeOption value="English">English</VSCodeOption>
					<VSCodeOption value="中文 (Chinese)">中文 (Chinese)</VSCodeOption>
					<VSCodeOption value="Russian - Русский">Russian - Русский</VSCodeOption>
				</VSCodeDropdown>
				<p className="text-xs mt-[3px] text-(--vscode-descriptionForeground)">
					{t("general.modelLanguageDescription")}
				</p>
			</div>

			{/* UI Language */}
				<div className="mb-[10px]">
					<div className="mb-[5px] text-sm">{t("general.uiLanguage")}</div>
					<VSCodeDropdown
						currentValue={locale}
						onChange={(e: any) => setLocale(e.target.currentValue as Locale)}>
						{AVAILABLE_LOCALES.map((item) => (
							<VSCodeOption key={item.value} value={item.value}>
								{t(item.labelKey)}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
				</div>

				{/* Think in selected language */}
				<div className="mt-[6px]">
					<VSCodeCheckbox
						checked={alwaysThinkInPreferredLanguage || false}
						onChange={(e: any) => {
							updateSetting("alwaysThinkInPreferredLanguage", e.target.checked === true)
						}}>
						{t("preferredLanguage.alwaysThink")}
					</VSCodeCheckbox>
					<p className="text-xs mt-[3px] text-(--vscode-descriptionForeground)">
						{t("preferredLanguage.alwaysThinkDescription")}
					</p>
				</div>

				{/* MCP Display Mode */}
				<div style={{ marginTop: 10 }}>
					<label
						className="block text-sm font-medium text-(--vscode-foreground) mb-1"
						htmlFor="mcp-display-mode-dropdown">
						{t("features.mcpDisplayMode")}
					</label>
					<McpDisplayModeDropdown
						className="w-full"
						id="mcp-display-mode-dropdown"
						onChange={(newMode: McpDisplayMode) => updateSetting("mcpDisplayMode", newMode)}
						value={mcpDisplayMode}
					/>
					<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
						{t("features.mcpDisplayModeDescription")}
					</p>
				</div>

				{/* Telemetry */}
				<div className="mb-[5px] mt-[10px]">
					<Tooltip>
						<TooltipContent hidden={remoteConfigSettings?.telemetrySetting === undefined}>
							{t("general.telemetry.lockedByOrg")}
						</TooltipContent>
						<TooltipTrigger asChild>
							<div className="flex items-center gap-2 mb-[5px]">
								<VSCodeCheckbox
									checked={telemetrySetting === "enabled"}
									disabled={remoteConfigSettings?.telemetrySetting === "disabled"}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										updateSetting("telemetrySetting", checked ? "enabled" : "disabled")
									}}>
									{t("general.telemetry.allow")}
								</VSCodeCheckbox>
								{!!remoteConfigSettings?.telemetrySetting && (
									<i className="codicon codicon-lock text-description text-sm" />
								)}
							</div>
						</TooltipTrigger>
					</Tooltip>

					<p className="text-sm mt-[5px] text-description">
						{t("general.telemetry.description.pre")}{" "}
					<VSCodeLink
						className="text-inherit"
						href="https://shuncode-ai.ru/ru/privacy"
						style={{ fontSize: "inherit", textDecoration: "underline" }}>
						{t("general.telemetry.overview")}
					</VSCodeLink>{" "}
					{t("general.telemetry.description.mid")}{" "}
					<VSCodeLink
						className="text-inherit"
						href="https://shuncode-ai.ru/ru/privacy"
						style={{ fontSize: "inherit", textDecoration: "underline" }}>
						{t("general.telemetry.privacy")}
					</VSCodeLink>{" "}
						{t("general.telemetry.description.post")}
					</p>
				</div>

				{/* About */}
				<div
					className="mt-4 p-3 rounded-md"
					style={{
						border: "1px solid var(--vscode-widget-border)",
					}}>
					<h4 className="text-sm font-semibold mb-1">ShunCode AI v{version}</h4>
					<p className="text-xs text-description">{t("about.description")}</p>
				</div>
			</Section>
		</div>
	)
}

export default GeneralSettingsSection
