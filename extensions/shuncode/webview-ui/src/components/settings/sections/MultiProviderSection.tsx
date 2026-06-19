import { useState, useEffect, useCallback } from "react"
import Section from "../Section"
import SectionHeader from "../SectionHeader"
import MultiProviderManager from "../MultiProviderManager"
import styled from "styled-components"
import { AlertCircle } from "lucide-react"
import {
	ApiProviderConfig,
	getConfigModelIds,
	readMultiProviderConfigs,
	writeMultiProviderConfigs,
} from "../utils/multiProviderConfig"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface MultiProviderSectionProps {
	renderSectionHeader?: (tabId: string) => JSX.Element | null
}

const InfoBox = styled.div`
	display: flex;
	gap: 8px;
	padding: 12px;
	border-radius: 4px;
	background-color: var(--vscode-textBlockQuote-background);
	border: 1px solid var(--vscode-textBlockQuote-border);
	color: var(--vscode-descriptionForeground);
	font-size: 12px;
	margin-bottom: 12px;

	svg {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		margin-top: 2px;
	}
`

/**
 * 多接口配置管理部分
 * 允许用户管理多个API提供商配置
 */
const MultiProviderSection = ({ renderSectionHeader }: MultiProviderSectionProps) => {
	const { handleFieldsChange } = useApiConfigurationHandlers()
	const [configs, setConfigs] = useState<ApiProviderConfig[]>([])
	const [activeConfigId, setActiveConfigId] = useState<string | null>(null)
	const [isSaving, setIsSaving] = useState(false)
	const [saveError, setSaveError] = useState<string | null>(null)

	// 从存储加载配置
	useEffect(() => {
		const loadConfigs = async () => {
			try {
				const parsed = readMultiProviderConfigs()
				setConfigs(parsed)
				const active = parsed.find((c: ApiProviderConfig) => c.isActive)
				if (active) {
					setActiveConfigId(active.id)
				}
			} catch (error) {
				console.error("Failed to load configs:", error)
				setSaveError("加载配置失败")
			}
		}

		loadConfigs()
	}, [])

	const applyActiveConfig = useCallback(
		async (activeConfig: ApiProviderConfig, modelId = getConfigModelIds(activeConfig)[0] || activeConfig.modelId) => {
			await handleFieldsChange({
				planModeApiProvider: "openai",
				actModeApiProvider: "openai",
				openAiBaseUrl: activeConfig.baseUrl || "",
				openAiApiKey: activeConfig.apiKey,
				openAiHeaders: activeConfig.customHeaders || {},
				planModeOpenAiModelId: modelId,
				actModeOpenAiModelId: modelId,
				planModeOpenAiModelInfo: undefined,
				actModeOpenAiModelInfo: undefined,
			})
		},
		[handleFieldsChange],
	)

	// 处理配置变更
	const handleConfigsChange = useCallback(
		async (newConfigs: ApiProviderConfig[]) => {
			setConfigs(newConfigs)
			setIsSaving(true)
			setSaveError(null)

			try {
				writeMultiProviderConfigs(newConfigs)

				const activeConfig = newConfigs.find((c) => c.isActive)
				if (activeConfig) {
					await applyActiveConfig(activeConfig)
				}
			} catch (error) {
				console.error("Failed to save configs:", error)
				setSaveError("保存配置失败，请重试")
			} finally {
				setIsSaving(false)
			}
		},
		[applyActiveConfig],
	)

	// 处理活跃配置变更
	const handleActiveConfigChange = useCallback((configId: string) => {
		setActiveConfigId(configId)
	}, [])

	return (
		<div>
			{renderSectionHeader?.("providers")}
			<Section>
				<InfoBox>
					<AlertCircle />
					<div>
						<div style={{ fontWeight: 500, marginBottom: "4px" }}>多接口管理</div>
						<div>管理多个 OpenAI Chat 兼容接口配置，支持同名模型通过“接口 + 模型名”区分。</div>
					</div>
				</InfoBox>

				{saveError && (
					<div
						style={{
							padding: "8px 12px",
							borderRadius: "4px",
							backgroundColor: "var(--vscode-errorForeground)",
							color: "white",
							fontSize: "12px",
							marginBottom: "12px",
						}}>
						{saveError}
					</div>
				)}

				<MultiProviderManager
					configs={configs}
					onConfigsChange={handleConfigsChange}
					onActiveConfigChange={handleActiveConfigChange}
					activeConfigId={activeConfigId ?? undefined}
				/>

				{isSaving && (
					<div
						style={{
							marginTop: "12px",
							padding: "8px 12px",
							borderRadius: "4px",
							backgroundColor: "var(--vscode-editor-background)",
							color: "var(--vscode-descriptionForeground)",
							fontSize: "12px",
							textAlign: "center",
						}}>
						保存中...
					</div>
				)}
			</Section>
		</div>
	)
}

export default MultiProviderSection
