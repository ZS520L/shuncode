import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo, useRef } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface ExperimentsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const ExperimentsSection = ({ renderSectionHeader }: ExperimentsSectionProps) => {
	const { t } = useI18n()
	const {
		worktreesEnabled,
		multiRootSetting,
		skillsEnabled,
		nativeToolCallSetting,
		enableParallelToolCalling,
		imageGenerationBaseUrl,
		imageGenerationApiKey,
		imageGenerationModelId,
	} = useExtensionState()

	const imageBaseUrlRef = useRef<string>(imageGenerationBaseUrl || "")
	const imageApiKeyRef = useRef<string>(imageGenerationApiKey || "")
	const imageModelIdRef = useRef<string>(imageGenerationModelId || "")

	return (
		<div>
			{renderSectionHeader("experiments")}
			<Section>
				<div style={{ marginBottom: 20 }}>
					{/* Skills */}
					<div className="mt-2.5">
						<VSCodeCheckbox
							checked={skillsEnabled}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("skillsEnabled", checked)
							}}>
							{t("features.skills")}
						</VSCodeCheckbox>
						<p className="text-xs">
							<span className="text-(--vscode-errorForeground)">{t("features.experimental")}: </span>{" "}
							<span className="text-description">{t("features.skillsDescription")}</span>
						</p>
					</div>

					{/* Native Tool Call */}
					<div className="mt-2.5">
						<VSCodeCheckbox
							checked={nativeToolCallSetting}
							onChange={(e) => {
								const enabled = (e?.target as HTMLInputElement).checked
								updateSetting("nativeToolCallEnabled", enabled)
							}}>
							{t("features.nativeToolCall")}
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">{t("features.nativeToolCallDescription")}</p>
					</div>

					{/* Parallel Tool Calling */}
					<div className="mt-2.5">
						<VSCodeCheckbox
							checked={enableParallelToolCalling}
							onChange={(e) => {
								const enabled = (e?.target as HTMLInputElement).checked
								updateSetting("enableParallelToolCalling", enabled)
							}}>
							{t("features.parallelToolCalling")}
						</VSCodeCheckbox>
						<p className="text-xs">
							<span className="text-(--vscode-errorForeground)">{t("features.experimental")}: </span>{" "}
							<span className="text-description">{t("features.parallelToolCallingDescription")}</span>
						</p>
					</div>

					{/* Worktrees */}
					{worktreesEnabled?.featureFlag && (
						<div style={{ marginTop: 10 }}>
							<VSCodeCheckbox
								checked={worktreesEnabled?.user}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("worktreesEnabled", checked)
								}}>
								{t("features.worktrees")}
							</VSCodeCheckbox>
							<p className="text-xs text-(--vscode-descriptionForeground)">{t("features.worktreesDescription")}</p>
						</div>
					)}

					{/* Multi-Root */}
					{multiRootSetting.featureFlag && (
						<div className="mt-2.5">
							<VSCodeCheckbox
								checked={multiRootSetting.user}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("multiRootEnabled", checked)
								}}>
								{t("features.multiRoot")}
							</VSCodeCheckbox>
							<p className="text-xs">
								<span className="text-error">{t("features.experimental")}: </span>{" "}
								<span className="text-description">{t("features.multiRootDescription")}</span>
							</p>
						</div>
					)}
				</div>

				{/* Image Generation Endpoint */}
				<div style={{ marginTop: 10, borderTop: "1px solid var(--vscode-widget-border)", paddingTop: 15 }}>
					<div className="text-sm font-medium mb-2">Image Generation</div>
					<p className="text-xs text-(--vscode-descriptionForeground) mb-3">
						Configure an OpenAI-compatible image generation endpoint. Once configured, the model can use the generate_image tool.
					</p>

					<div className="mb-2">
						<label className="block text-xs mb-1">Base URL</label>
						<VSCodeTextField
							className="w-full"
							placeholder="https://api.openai.com"
							value={imageBaseUrlRef.current || imageGenerationBaseUrl || ""}
							onChange={(e: any) => { imageBaseUrlRef.current = e.target.value }}
							onBlur={(e: any) => {
								updateSetting("imageGenerationBaseUrl" as any, e.target.value)
							}}
						/>
					</div>

					<div className="mb-2">
						<label className="block text-xs mb-1">API Key</label>
						<VSCodeTextField
							className="w-full"
							type="password"
							placeholder="sk-..."
							value={imageApiKeyRef.current || imageGenerationApiKey || ""}
							onChange={(e: any) => { imageApiKeyRef.current = e.target.value }}
							onBlur={(e: any) => {
								updateSetting("imageGenerationApiKey" as any, e.target.value)
							}}
						/>
					</div>

					<div className="mb-2">
						<label className="block text-xs mb-1">Model ID</label>
						<VSCodeTextField
							className="w-full"
							placeholder="gpt-image-1"
							value={imageModelIdRef.current || imageGenerationModelId || ""}
							onChange={(e: any) => { imageModelIdRef.current = e.target.value }}
							onBlur={(e: any) => {
								updateSetting("imageGenerationModelId" as any, e.target.value)
							}}
						/>
						<p className="text-xs text-(--vscode-descriptionForeground) mt-1">
							Supported: gpt-image-1, gpt-image-2, dall-e-3
						</p>
					</div>
				</div>
			</Section>
		</div>
	)
}

export default memo(ExperimentsSection)
