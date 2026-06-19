import { OpenaiReasoningEffort } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface ContextSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const ContextSection = ({ renderSectionHeader }: ContextSectionProps) => {
	const { t } = useI18n()
	const { openaiReasoningEffort, strictPlanModeEnabled, useAutoCondense, focusChainSettings } = useExtensionState()

	return (
		<div>
			{renderSectionHeader("context")}
			<Section>
				<div style={{ marginBottom: 20 }}>
					{/* Auto-Condense */}
					<div>
						<VSCodeCheckbox
							checked={useAutoCondense}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("useAutoCondense", checked)
							}}>
							{t("features.autoCondense")}
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							{t("features.autoCondenseDescription")}{" "}
							<a
								className="text-(--vscode-textLink-foreground) hover:text-(--vscode-textLink-activeForeground)"
								href="https://shuncode-ai.ru/ru/docs/auto-condense"
								rel="noopener noreferrer"
								target="_blank">
								{t("features.learnMore")}
							</a>
						</p>
					</div>

					{/* Strict Plan Mode */}
					<div style={{ marginTop: 10 }}>
						<VSCodeCheckbox
							checked={strictPlanModeEnabled}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("strictPlanModeEnabled", checked)
							}}>
							{t("features.strictPlanMode")}
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">{t("features.strictPlanModeDescription")}</p>
					</div>

					{/* Reasoning Effort */}
					<div style={{ marginTop: 10 }}>
						<label
							className="block text-sm font-medium text-(--vscode-foreground) mb-1"
							htmlFor="openai-reasoning-effort-dropdown">
							{t("features.openaiReasoningEffort")}
						</label>
						<VSCodeDropdown
							className="w-full"
							currentValue={openaiReasoningEffort || "xhigh"}
							id="openai-reasoning-effort-dropdown"
							onChange={(e: any) => {
								const newValue = e.target.currentValue as OpenaiReasoningEffort
								updateSetting("openaiReasoningEffort", newValue)
							}}>
							<VSCodeOption value="low">{t("features.reasoning.low")}</VSCodeOption>
							<VSCodeOption value="medium">{t("features.reasoning.medium")}</VSCodeOption>
							<VSCodeOption value="high">{t("features.reasoning.high")}</VSCodeOption>
							<VSCodeOption value="xhigh">xhigh</VSCodeOption>
						</VSCodeDropdown>
						<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
							{t("features.openaiReasoningEffortDescription")}
						</p>
					</div>

					{/* Focus Chain */}
					<div style={{ marginTop: 10 }}>
						<VSCodeCheckbox
							checked={focusChainSettings?.enabled || false}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("focusChainSettings", { ...focusChainSettings, enabled: checked })
							}}>
							{t("features.focusChain")}
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">{t("features.focusChainDescription")}</p>
					</div>
					{focusChainSettings?.enabled && (
						<div style={{ marginTop: 10, marginLeft: 20 }}>
							<label
								className="block text-sm font-medium text-(--vscode-foreground) mb-1"
								htmlFor="focus-chain-remind-interval">
								{t("features.focusChainInterval")}
							</label>
							<VSCodeTextField
								className="w-20"
								id="focus-chain-remind-interval"
								onChange={(e: any) => {
									const value = parseInt(e.target.value, 10)
									if (!Number.isNaN(value) && value >= 1 && value <= 100) {
										updateSetting("focusChainSettings", {
											...focusChainSettings,
											remindShuncodeInterval: value,
										})
									}
								}}
								value={String(focusChainSettings?.remindShuncodeInterval || 6)}
							/>
							<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
								{t("features.focusChainIntervalDescription")}
							</p>
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}

export default memo(ContextSection)
