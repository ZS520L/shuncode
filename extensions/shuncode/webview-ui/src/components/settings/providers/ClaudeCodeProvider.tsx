import { claudeCodeModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { SUPPORTED_ANTHROPIC_THINKING_MODELS } from "./AnthropicProvider"

/**
 * Props for the ClaudeCodeProvider component
 */
interface ClaudeCodeProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Claude Code provider configuration component
 */
export const ClaudeCodeProvider = ({ showModelOptions, isPopup, currentMode }: ClaudeCodeProviderProps) => {
	const { t } = useI18n()
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<DebouncedTextField
				initialValue={apiConfiguration?.claudeCodePath || ""}
				onChange={(value) => handleFieldChange("claudeCodePath", value)}
				placeholder={t("provider.defaultClaudeCodePath")}
				style={{ width: "100%", marginTop: 3 }}
				type="text">
				<span style={{ fontWeight: 500 }}>{t("provider.claudeCodeCliPath")}</span>
			</DebouncedTextField>

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				{t("provider.pathToClaudeCodeCli")}
			</p>

			{showModelOptions && (
				<>
					<ModelSelector
						label={t("provider.model")}
						models={claudeCodeModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					{(selectedModelId === "sonnet" || selectedModelId === "opus") && (
						<p
							style={{
								fontSize: "12px",
								marginBottom: 2,
								marginTop: 2,
								color: "var(--vscode-descriptionForeground)",
							}}>
							{t("provider.useLatestVersionDefault")} {selectedModelId} {t("provider.byDefault")}
						</p>
					)}

					{SUPPORTED_ANTHROPIC_THINKING_MODELS.includes(selectedModelId) && (
						<ThinkingBudgetSlider currentMode={currentMode} maxBudget={selectedModelInfo.thinkingConfig?.maxBudget} />
					)}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
