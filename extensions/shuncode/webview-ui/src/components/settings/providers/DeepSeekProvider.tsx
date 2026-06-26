import { deepSeekModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { DROPDOWN_Z_INDEX } from "../ApiOptions"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer, ModelSelector } from "../common/ModelSelector"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the DeepSeekProvider component
 */
interface DeepSeekProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The DeepSeek provider configuration component
 */
export const DeepSeekProvider = ({ showModelOptions, isPopup, currentMode }: DeepSeekProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// Local state for reasoning effort toggle
	const isV4 = selectedModelId?.startsWith("deepseek-v4-")
	const [reasoningEffortSelected, setReasoningEffortSelected] = useState(!!modeFields.reasoningEffort)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.deepSeekApiKey || ""}
				onChange={(value) => handleFieldChange("deepSeekApiKey", value)}
				providerName="DeepSeek"
				signupUrl="https://www.deepseek.com/"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={deepSeekModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					{isV4 && (
						<>
							<VSCodeCheckbox
								checked={reasoningEffortSelected}
								onChange={(e: any) => {
									const isChecked = e.target.checked === true
									setReasoningEffortSelected(isChecked)
									if (!isChecked) {
										handleModeFieldChange(
											{ plan: "planModeReasoningEffort", act: "actModeReasoningEffort" },
											"",
											currentMode,
										)
									}
								}}
								style={{ marginTop: 0 }}>
								Enable Reasoning Effort
							</VSCodeCheckbox>

							{reasoningEffortSelected && (
								<div>
									<label htmlFor="deepseek-reasoning-effort">
										<span style={{ fontWeight: 500, fontSize: 12 }}>Reasoning Effort</span>
									</label>
									<DropdownContainer className="dropdown-container" zIndex={DROPDOWN_Z_INDEX - 100}>
										<VSCodeDropdown
											id="deepseek-reasoning-effort"
											onChange={(e: any) => {
												handleModeFieldChange(
													{ plan: "planModeReasoningEffort", act: "actModeReasoningEffort" },
													e.target.value,
													currentMode,
												)
											}}
											style={{ width: "100%", marginTop: 3 }}
											value={modeFields.reasoningEffort || "high"}>
											<VSCodeOption value="high">High</VSCodeOption>
											<VSCodeOption value="max">Max</VSCodeOption>
										</VSCodeDropdown>
									</DropdownContainer>
								</div>
							)}
						</>
					)}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
