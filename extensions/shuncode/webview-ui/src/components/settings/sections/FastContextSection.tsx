import type { FastContextConfig } from "@shared/FastContextTypes"
import { DEFAULT_FAST_CONTEXT_CONFIG } from "@shared/FastContextTypes"
import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState } from "react"
import { PLATFORM_CONFIG } from "@/config/platform.config"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import Section from "../Section"

interface FastContextSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

/** Send a single Fast Context config key update to extension backend */
function postFastContextConfigKey(key: string, value: any) {
	PLATFORM_CONFIG.postMessage({
		type: "updateFastContextConfig",
		fastContextConfigUpdate: { key, value },
	})
}

const FastContextSection = ({ renderSectionHeader }: FastContextSectionProps) => {
	const { t } = useI18n()
	const { fastContextConfig: stateConfig } = useExtensionState()

	const config: FastContextConfig = stateConfig ?? DEFAULT_FAST_CONTEXT_CONFIG

	// Local state for text inputs (debounced on blur)
	const [localEnabled, setLocalEnabled] = useState(config.enabled)
	const [apiUrl, setApiUrl] = useState(config.apiUrl)
	const [apiKey, setApiKey] = useState(config.apiKey)
	const [modelId, setModelId] = useState(config.modelId)
	const [maxTurns, setMaxTurns] = useState(String(config.maxTurns))
	const [maxParallelCalls, setMaxParallelCalls] = useState(String(config.maxParallelCalls))
	const [timeoutSeconds, setTimeoutSeconds] = useState(String(config.timeoutSeconds))
	const [excludePatternsText, setExcludePatternsText] = useState(config.excludePatterns.join(", "))
	const [systemPrompt, setSystemPrompt] = useState(config.systemPrompt || "")
	const [localShowProgress, setLocalShowProgress] = useState(config.showProgress)

	// Sync local state when config from backend changes
	useEffect(() => {
		setLocalEnabled(config.enabled)
		setApiUrl(config.apiUrl)
		setApiKey(config.apiKey)
		setModelId(config.modelId)
		setMaxTurns(String(config.maxTurns))
		setMaxParallelCalls(String(config.maxParallelCalls))
		setTimeoutSeconds(String(config.timeoutSeconds))
		setExcludePatternsText(config.excludePatterns.join(", "))
		setSystemPrompt(config.systemPrompt || "")
		setLocalShowProgress(config.showProgress)
	}, [config.enabled, config.apiUrl, config.apiKey, config.modelId, config.maxTurns, config.maxParallelCalls, config.timeoutSeconds, config.excludePatterns, config.systemPrompt, config.showProgress])

	const handleEnabledChange = useCallback((e: any) => {
		const checked = e.target.checked
		setLocalEnabled(checked)
		postFastContextConfigKey("enabled", checked)
	}, [])

	const handleApiUrlBlur = useCallback(() => {
		postFastContextConfigKey("apiUrl", apiUrl.trim())
	}, [apiUrl])

	const handleApiKeyBlur = useCallback(() => {
		postFastContextConfigKey("apiKey", apiKey.trim())
	}, [apiKey])

	const handleModelIdBlur = useCallback(() => {
		postFastContextConfigKey("modelId", modelId.trim())
	}, [modelId])

	const handleMaxTurnsBlur = useCallback(() => {
		const parsed = Number.parseInt(maxTurns, 10)
		if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 8) {
			postFastContextConfigKey("maxTurns", parsed)
		}
	}, [maxTurns])

	const handleMaxParallelCallsBlur = useCallback(() => {
		const parsed = Number.parseInt(maxParallelCalls, 10)
		if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 16) {
			postFastContextConfigKey("maxParallelCalls", parsed)
		}
	}, [maxParallelCalls])

	const handleTimeoutBlur = useCallback(() => {
		const parsed = Number.parseInt(timeoutSeconds, 10)
		if (!Number.isNaN(parsed) && parsed >= 5 && parsed <= 120) {
			postFastContextConfigKey("timeoutSeconds", parsed)
		}
	}, [timeoutSeconds])

	const handleExcludePatternsBlur = useCallback(() => {
		const patterns = excludePatternsText
			.split(",")
			.map((p) => p.trim())
			.filter((p) => p.length > 0)
		postFastContextConfigKey("excludePatterns", patterns)
	}, [excludePatternsText])

	const handleSystemPromptBlur = useCallback(() => {
		postFastContextConfigKey("systemPrompt", systemPrompt.trim() || undefined)
	}, [systemPrompt])

	const handleShowProgressChange = useCallback((e: any) => {
		const checked = e.target.checked
		setLocalShowProgress(checked)
		postFastContextConfigKey("showProgress", checked)
	}, [])

	return (
		<div>
			{renderSectionHeader("fastContext")}

			<Section>
				{/* Enable/Disable toggle */}
				<div className="mb-4">
					<label className="flex items-center gap-2 cursor-pointer">
						<input
							type="checkbox"
							checked={localEnabled}
							onChange={handleEnabledChange}
							className="accent-[var(--vscode-focusBorder)]"
						/>
						<span className="text-sm font-medium">{t("fastContext.enabled")}</span>
					</label>
					<p className="text-xs text-description mt-1">{t("fastContext.enabled.description")}</p>
				</div>

				{localEnabled && (
					<>
						{/* LLM Endpoint Configuration */}
						<div className="mb-4 p-3 rounded" style={{ background: "var(--vscode-editor-background)" }}>
							<h4 className="text-sm font-medium mb-3">{t("fastContext.llmConfig")}</h4>

							{/* API URL */}
							<div className="mb-3">
								<label className="block text-xs font-medium mb-1">{t("fastContext.apiUrl")}</label>
								<VSCodeTextField
									style={{ width: "100%" }}
									value={apiUrl}
									placeholder="https://api.openai.com/v1"
									onInput={(e: any) => setApiUrl(e.target.value)}
									onBlur={handleApiUrlBlur}
								/>
								<p className="text-xs text-description mt-1">{t("fastContext.apiUrl.description")}</p>
							</div>

							{/* API Key */}
							<div className="mb-3">
								<label className="block text-xs font-medium mb-1">{t("fastContext.apiKey")}</label>
								<VSCodeTextField
									style={{ width: "100%" }}
									value={apiKey}
									type="password"
									placeholder="sk-..."
									onInput={(e: any) => setApiKey(e.target.value)}
									onBlur={handleApiKeyBlur}
								/>
							</div>

							{/* Model ID */}
							<div className="mb-3">
								<label className="block text-xs font-medium mb-1">{t("fastContext.modelId")}</label>
								<VSCodeTextField
									style={{ width: "100%" }}
									value={modelId}
									placeholder="gpt-4o-mini / gemini-2.0-flash / qwen-turbo"
									onInput={(e: any) => setModelId(e.target.value)}
									onBlur={handleModelIdBlur}
								/>
								<p className="text-xs text-description mt-1">{t("fastContext.modelId.description")}</p>
							</div>
						</div>

						{/* Search Behavior */}
						<div className="mb-4 p-3 rounded" style={{ background: "var(--vscode-editor-background)" }}>
							<h4 className="text-sm font-medium mb-3">{t("fastContext.searchBehavior")}</h4>

							<div className="grid grid-cols-2 gap-3">
								{/* Max Turns */}
								<div>
									<label className="block text-xs font-medium mb-1">{t("fastContext.maxTurns")}</label>
									<VSCodeTextField
										style={{ width: "100%" }}
										value={maxTurns}
										placeholder="4"
										onInput={(e: any) => setMaxTurns(e.target.value)}
										onBlur={handleMaxTurnsBlur}
									/>
									<p className="text-xs text-description mt-1">1-8</p>
								</div>

								{/* Max Parallel Calls */}
								<div>
									<label className="block text-xs font-medium mb-1">{t("fastContext.maxParallelCalls")}</label>
									<VSCodeTextField
										style={{ width: "100%" }}
										value={maxParallelCalls}
										placeholder="8"
										onInput={(e: any) => setMaxParallelCalls(e.target.value)}
										onBlur={handleMaxParallelCallsBlur}
									/>
									<p className="text-xs text-description mt-1">1-16</p>
								</div>
							</div>

							{/* Timeout */}
							<div className="mt-3">
								<label className="block text-xs font-medium mb-1">{t("fastContext.timeout")}</label>
								<VSCodeTextField
									style={{ width: "100%" }}
									value={timeoutSeconds}
									placeholder="30"
									onInput={(e: any) => setTimeoutSeconds(e.target.value)}
									onBlur={handleTimeoutBlur}
								/>
								<p className="text-xs text-description mt-1">{t("fastContext.timeout.description")}</p>
							</div>
						</div>

						{/* Exclude Patterns */}
						<div className="mb-4">
							<label className="block text-xs font-medium mb-1">{t("fastContext.excludePatterns")}</label>
							<VSCodeTextField
								style={{ width: "100%" }}
								value={excludePatternsText}
								placeholder="node_modules, .git, dist, build"
								onInput={(e: any) => setExcludePatternsText(e.target.value)}
								onBlur={handleExcludePatternsBlur}
							/>
							<p className="text-xs text-description mt-1">{t("fastContext.excludePatterns.description")}</p>
						</div>

						{/* Show Progress */}
						<div className="mb-4">
							<label className="flex items-center gap-2 cursor-pointer">
								<input
									type="checkbox"
									checked={localShowProgress}
									onChange={handleShowProgressChange}
									className="accent-[var(--vscode-focusBorder)]"
								/>
								<span className="text-xs font-medium">{t("fastContext.showProgress")}</span>
							</label>
						</div>

						{/* Custom System Prompt (advanced) */}
						<details className="mb-4">
							<summary className="text-xs font-medium cursor-pointer">{t("fastContext.advanced")}</summary>
							<div className="mt-2">
								<label className="block text-xs font-medium mb-1">{t("fastContext.systemPrompt")}</label>
								<textarea
									className="w-full h-32 p-2 rounded text-xs resize-y"
									style={{
										background: "var(--vscode-input-background)",
										color: "var(--vscode-input-foreground)",
										border: "1px solid var(--vscode-input-border)",
									}}
									value={systemPrompt}
									placeholder={t("fastContext.systemPrompt.placeholder")}
									onChange={(e) => setSystemPrompt(e.target.value)}
									onBlur={handleSystemPromptBlur}
								/>
								<p className="text-xs text-description mt-1">{t("fastContext.systemPrompt.description")}</p>
							</div>
						</details>

						{/* Status / Info */}
						<div className="p-2 rounded text-xs" style={{ background: "var(--vscode-textBlockQuote-background)" }}>
							<p className="font-medium mb-1">{t("fastContext.howItWorks.title")}</p>
							<p className="text-description">{t("fastContext.howItWorks.description")}</p>
						</div>
					</>
				)}
			</Section>
		</div>
	)
}

export default FastContextSection
