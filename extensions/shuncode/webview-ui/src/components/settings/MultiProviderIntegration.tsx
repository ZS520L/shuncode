/**
 * 多接口配置管理系统集成示例
 * 
 * 这个文件展示了如何在实际应用中集成多接口管理系统
 */

import { useState, useCallback, useEffect } from "react"
import styled from "styled-components"
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Download, Upload, RotateCcw } from "lucide-react"
import MultiProviderManager from "./MultiProviderManager"
import AdvancedProviderConfig, { AdvancedConfig } from "./AdvancedProviderConfig"
import { ApiProviderConfig, readMultiProviderConfigs, writeMultiProviderConfigs } from "./utils/multiProviderConfig"

const Container = styled.div`
	display: flex;
	flex-direction: column;
	gap: 16px;
	padding: 16px;
`

const TabContainer = styled.div`
	display: flex;
	gap: 8px;
	border-bottom: 1px solid var(--vscode-panel-border);
	margin-bottom: 16px;
`

const Tab = styled.button<{ isActive: boolean }>`
	padding: 8px 16px;
	border: none;
	background: none;
	color: ${(props) =>
		props.isActive ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)"};
	cursor: pointer;
	border-bottom: 2px solid
		${(props) => (props.isActive ? "var(--vscode-focusBorder)" : "transparent")};
	font-weight: ${(props) => (props.isActive ? "500" : "400")};
	transition: all 0.2s ease;

	&:hover {
		color: var(--vscode-foreground);
	}
`

const ToolBar = styled.div`
	display: flex;
	gap: 8px;
	padding: 12px;
	border: 1px solid var(--vscode-panel-border);
	border-radius: 4px;
	background-color: var(--vscode-editor-background);
	flex-wrap: wrap;
`

const ToolBarButton = styled(VSCodeButton)`
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 6px 12px;
	font-size: 12px;

	svg {
		width: 14px;
		height: 14px;
	}
`

const InfoPanel = styled.div`
	padding: 12px;
	border-radius: 4px;
	background-color: var(--vscode-textBlockQuote-background);
	border: 1px solid var(--vscode-textBlockQuote-border);
	color: var(--vscode-descriptionForeground);
	font-size: 12px;
`

/**
 * 多接口配置管理系统集成组件
 * 
 * 功能：
 * - 管理多个 API 配置
 * - 支持导出/导入配置
 * - 支持高级配置选项
 * - 实时预览当前活跃配置
 */
export const MultiProviderIntegration = () => {
	const [activeTab, setActiveTab] = useState<"basic" | "advanced" | "tools">("basic")
	const [configs, setConfigs] = useState<ApiProviderConfig[]>([])
	const [activeConfigId, setActiveConfigId] = useState<string | null>(null)
	const [advancedConfigs, setAdvancedConfigs] = useState<Record<string, AdvancedConfig>>({})
	const [showAdvancedForAll, setShowAdvancedForAll] = useState(false)

	// 从 localStorage 加载配置
	useEffect(() => {
		const loadConfigs = () => {
			try {
				const parsed = readMultiProviderConfigs()
				setConfigs(parsed)
				const active = parsed.find((c: ApiProviderConfig) => c.isActive)
				if (active) {
					setActiveConfigId(active.id)
				}

				const advStored = localStorage.getItem("shuncode_advanced_configs")
				if (advStored) {
					setAdvancedConfigs(JSON.parse(advStored))
				}
			} catch (error) {
				console.error("Failed to load configs:", error)
			}
		}

		loadConfigs()
	}, [])

	// 保存配置到 localStorage
	const saveConfigs = useCallback((newConfigs: ApiProviderConfig[]) => {
		setConfigs(newConfigs)
		writeMultiProviderConfigs(newConfigs)
	}, [])

	// 保存高级配置
	const saveAdvancedConfigs = useCallback((configId: string, advConfig: AdvancedConfig) => {
		const updated = { ...advancedConfigs, [configId]: advConfig }
		setAdvancedConfigs(updated)
		localStorage.setItem("shuncode_advanced_configs", JSON.stringify(updated))
	}, [advancedConfigs])

	// 获取当前活跃配置
	const activeConfig = configs.find((c) => c.isActive)

	// 导出配置
	const handleExportConfigs = useCallback(() => {
		const exportData = {
			version: "1.0.0",
			exportedAt: new Date().toISOString(),
			configs,
			advancedConfigs,
		}

		const dataStr = JSON.stringify(exportData, null, 2)
		const dataBlob = new Blob([dataStr], { type: "application/json" })
		const url = URL.createObjectURL(dataBlob)
		const link = document.createElement("a")
		link.href = url
		link.download = `shuncode-api-configs-${Date.now()}.json`
		link.click()
		URL.revokeObjectURL(url)
	}, [configs, advancedConfigs])

	// 导入配置
	const handleImportConfigs = useCallback(() => {
		const input = document.createElement("input")
		input.type = "file"
		input.accept = ".json"
		input.onchange = (e: any) => {
			const file = e.target.files?.[0]
			if (!file) return

			const reader = new FileReader()
			reader.onload = (event: any) => {
				try {
					const data = JSON.parse(event.target.result)
					if (data.configs && Array.isArray(data.configs)) {
						setConfigs(data.configs)
						localStorage.setItem("shuncode_api_configs", JSON.stringify(data.configs))

						if (data.advancedConfigs) {
							setAdvancedConfigs(data.advancedConfigs)
							localStorage.setItem(
								"shuncode_advanced_configs",
								JSON.stringify(data.advancedConfigs),
							)
						}

						alert("配置导入成功！")
					}
				} catch (error) {
					alert("导入失败：文件格式不正确")
					console.error("Import error:", error)
				}
			}
			reader.readAsText(file)
		}
		input.click()
	}, [])

	// 重置所有配置
	const handleResetConfigs = useCallback(() => {
		if (window.confirm("确定要重置所有配置吗？此操作无法撤销。")) {
			setConfigs([])
			setAdvancedConfigs({})
			setActiveConfigId(null)
			localStorage.removeItem("shuncode_api_configs")
			localStorage.removeItem("shuncode_advanced_configs")
		}
	}, [])

	return (
		<Container>
			{/* 标签页 */}
			<TabContainer>
				<Tab isActive={activeTab === "basic"} onClick={() => setActiveTab("basic")}>
					基础配置
				</Tab>
				<Tab isActive={activeTab === "advanced"} onClick={() => setActiveTab("advanced")}>
					高级设置
				</Tab>
				<Tab isActive={activeTab === "tools"} onClick={() => setActiveTab("tools")}>
					工具
				</Tab>
			</TabContainer>

			{/* 基础配置标签页 */}
			{activeTab === "basic" && (
				<div>
					<MultiProviderManager
						configs={configs}
						onConfigsChange={saveConfigs}
						onActiveConfigChange={setActiveConfigId}
						activeConfigId={activeConfigId || undefined}
					/>

					{/* 当前活跃配置信息 */}
					{activeConfig && (
						<InfoPanel>
							<div style={{ fontWeight: 500, marginBottom: "8px" }}>
								当前活跃配置：{activeConfig.name}
							</div>
							<div>提供商：{activeConfig.provider}</div>
							{activeConfig.baseUrl && <div>基础 URL：{activeConfig.baseUrl}</div>}
							<div>模型：{activeConfig.modelId}</div>
						</InfoPanel>
					)}
				</div>
			)}

			{/* 高级设置标签页 */}
			{activeTab === "advanced" && (
				<div>
					<div style={{ marginBottom: "16px" }}>
						<VSCodeCheckbox
							checked={showAdvancedForAll}
							onChange={(e: any) => setShowAdvancedForAll(e.target.checked)}>
							为所有配置显示高级选项
						</VSCodeCheckbox>
					</div>

					{showAdvancedForAll ? (
						<div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
							{configs.map((config) => (
								<div key={config.id}>
									<div
										style={{
											fontWeight: 500,
											marginBottom: "12px",
											paddingBottom: "8px",
											borderBottom: "1px solid var(--vscode-panel-border)",
										}}>
										{config.name}
									</div>
									<AdvancedProviderConfig
										config={advancedConfigs[config.id] || {}}
										onChange={(advConfig) =>
											saveAdvancedConfigs(config.id, advConfig)
										}
									/>
								</div>
							))}
						</div>
					) : activeConfig ? (
						<div>
							<div
								style={{
									fontWeight: 500,
									marginBottom: "12px",
									paddingBottom: "8px",
									borderBottom: "1px solid var(--vscode-panel-border)",
								}}>
								{activeConfig.name} - 高级设置
							</div>
							<AdvancedProviderConfig
								config={advancedConfigs[activeConfig.id] || {}}
								onChange={(advConfig) =>
									saveAdvancedConfigs(activeConfig.id, advConfig)
								}
							/>
						</div>
					) : (
						<InfoPanel>请先创建或激活一个配置</InfoPanel>
					)}
				</div>
			)}

			{/* 工具标签页 */}
			{activeTab === "tools" && (
				<div>
					<ToolBar>
						<ToolBarButton onClick={handleExportConfigs}>
							<Download />
							导出配置
						</ToolBarButton>
						<ToolBarButton onClick={handleImportConfigs}>
							<Upload />
							导入配置
						</ToolBarButton>
						<ToolBarButton
							onClick={handleResetConfigs}
							style={{
								backgroundColor: "var(--vscode-errorForeground)",
								color: "white",
							}}>
							<RotateCcw />
							重置所有
						</ToolBarButton>
					</ToolBar>

					<InfoPanel>
						<div style={{ fontWeight: 500, marginBottom: "8px" }}>导出/导入说明</div>
						<ul style={{ margin: "8px 0", paddingLeft: "20px" }}>
							<li>导出：将所有配置保存为 JSON 文件，用于备份或迁移</li>
							<li>导入：从 JSON 文件恢复配置（会覆盖现有配置）</li>
							<li>重置：清除所有配置和高级设置（无法撤销）</li>
						</ul>
					</InfoPanel>

					<InfoPanel style={{ marginTop: "16px" }}>
						<div style={{ fontWeight: 500, marginBottom: "8px" }}>统计信息</div>
						<div>总配置数：{configs.length}</div>
						<div>活跃配置：{activeConfig?.name || "无"}</div>
						<div>高级配置数：{Object.keys(advancedConfigs).length}</div>
					</InfoPanel>
				</div>
			)}
		</Container>
	)
}

export default MultiProviderIntegration
