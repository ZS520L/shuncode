import { Plus, Trash2, Copy, ChevronDown, ChevronUp, Check, X, RefreshCw, Zap, Edit3 } from "lucide-react"
import { useState, useCallback, useMemo } from "react"
import styled from "styled-components"
import { VSCodeButton, VSCodeTextArea, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useI18n } from "@/i18n"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ApiProviderConfig, ApiProtocol, API_PROTOCOL_LABELS, ModelEntry, getConfigModelIds, splitModelIds } from "./utils/multiProviderConfig"
import { ModelsServiceClient } from "@/services/grpc-client"
import { OpenAiModelsRequest } from "@shared/proto/shuncode/models"

/**
 * 多接口管理器的Props
 */
interface MultiProviderManagerProps {
	configs: ApiProviderConfig[]
	onConfigsChange: (configs: ApiProviderConfig[]) => void
	onActiveConfigChange: (configId: string) => void
	activeConfigId?: string
}

/**
 * 样式定义
 */
const Container = styled.div`
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 0;
`

const ConfigListContainer = styled.div`
	display: flex;
	flex-direction: column;
	gap: 8px;
	max-height: 500px;
	overflow-y: auto;
	border: 1px solid var(--vscode-panel-border);
	border-radius: 4px;
	padding: 8px;
	background-color: var(--vscode-editor-background);

	&::-webkit-scrollbar {
		width: 8px;
	}

	&::-webkit-scrollbar-track {
		background: transparent;
	}

	&::-webkit-scrollbar-thumb {
		background: var(--vscode-scrollbarSlider-background);
		border-radius: 4px;

		&:hover {
			background: var(--vscode-scrollbarSlider-hoverBackground);
		}
	}
`

const ConfigCard = styled.div<{ isActive: boolean }>`
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 12px;
	border: 2px solid ${(props) => (props.isActive ? "var(--vscode-focusBorder)" : "var(--vscode-panel-border)")};
	border-radius: 4px;
	background-color: ${(props) =>
		props.isActive ? "var(--vscode-editor-lineHighlightBackground)" : "var(--vscode-editor-background)"};
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		border-color: var(--vscode-focusBorder);
		box-shadow: 0 0 0 1px var(--vscode-focusBorder);
	}
`

const ConfigHeader = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
`

const ConfigInfo = styled.div`
	display: flex;
	align-items: center;
	gap: 8px;
	flex: 1;
	min-width: 0;
`

const ConfigTitle = styled.div`
	display: flex;
	flex-direction: column;
	gap: 2px;
	flex: 1;
	min-width: 0;
`

const ConfigName = styled.span`
	font-weight: 500;
	color: var(--vscode-foreground);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
`

const ConfigProvider = styled.span`
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
`

const ConfigActions = styled.div`
	display: flex;
	align-items: center;
	gap: 4px;
`

const ActionButton = styled.button`
	display: flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	padding: 0;
	border: 1px solid var(--vscode-button-border);
	border-radius: 3px;
	background-color: var(--vscode-button-secondaryBackground);
	color: var(--vscode-button-secondaryForeground);
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		background-color: var(--vscode-button-secondaryHoverBackground);
	}

	&:active {
		transform: scale(0.95);
	}

	svg {
		width: 16px;
		height: 16px;
	}
`

const ExpandButton = styled(ActionButton)`
	width: auto;
	padding: 0 8px;
	gap: 4px;
	font-size: 12px;
`

const ConfigDetails = styled.div`
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding-top: 8px;
	border-top: 1px solid var(--vscode-panel-border);
`

const DetailRow = styled.div`
	display: flex;
	flex-direction: column;
	gap: 4px;
`

const DetailLabel = styled.label`
	font-size: 12px;
	font-weight: 500;
	color: var(--vscode-descriptionForeground);
	text-transform: uppercase;
	letter-spacing: 0.5px;
`

const DetailValue = styled.div`
	font-size: 12px;
	color: var(--vscode-foreground);
	word-break: break-all;
	font-family: monospace;
	background-color: var(--vscode-editor-background);
	padding: 4px 6px;
	border-radius: 2px;
	border: 1px solid var(--vscode-panel-border);
`

const ButtonGroup = styled.div`
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
`

const AddConfigButton = styled.button`
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	height: 32px;
	padding: 0 16px;
	border: 1px solid var(--vscode-button-border, transparent);
	border-radius: 4px;
	background-color: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
	font-size: 13px;
	font-weight: 500;
	line-height: 1;
	cursor: pointer;
	box-shadow: none;
	outline: none;
	transition: background-color 0.15s ease, border-color 0.15s ease;

	&:hover {
		background-color: var(--vscode-button-hoverBackground);
	}

	&:focus-visible {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: 2px;
	}

	svg {
		width: 15px;
		height: 15px;
		flex-shrink: 0;
	}
`

const StatusBadge = styled.span<{ status: "active" | "inactive" }>`
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px 8px;
	border-radius: 12px;
	font-size: 11px;
	font-weight: 500;
	background-color: ${(props) =>
		props.status === "active" ? "var(--vscode-testing-iconPassed)" : "var(--vscode-descriptionForeground)"};
	color: ${(props) => (props.status === "active" ? "white" : "var(--vscode-editor-background)")};

	svg {
		width: 10px;
		height: 10px;
	}
`

const EmptyState = styled.div`
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 8px;
	padding: 24px;
	color: var(--vscode-descriptionForeground);
	text-align: center;
	border: 1px dashed var(--vscode-panel-border);
	border-radius: 4px;
	background-color: var(--vscode-editor-background);
`

const FormSection = styled.div`
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 12px;
	border: 1px solid var(--vscode-panel-border);
	border-radius: 4px;
	background-color: var(--vscode-editor-background);
`

const FormField = styled.div`
	display: flex;
	flex-direction: column;
	gap: 4px;
`

const FormLabel = styled.label`
	font-size: 12px;
	font-weight: 500;
	color: var(--vscode-foreground);
`

const FormInput = styled(VSCodeTextField)`
	width: 100%;
`

const FormTextArea = styled(VSCodeTextArea)`
	width: 100%;
`

const ModelListContainer = styled.div`
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin-top: 4px;
`

const ModelRow = styled.div`
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 8px;
	border: 1px solid var(--vscode-panel-border);
	border-radius: 4px;
	background-color: var(--vscode-editor-background);
	font-size: 12px;
`

const ModelName = styled.span`
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-family: monospace;
`

const ModelContextBadge = styled.span`
	display: inline-flex;
	align-items: center;
	gap: 3px;
	padding: 2px 6px;
	border-radius: 10px;
	font-size: 11px;
	background-color: var(--vscode-badge-background);
	color: var(--vscode-badge-foreground);
`

const ModelActionBtn = styled.button`
	display: flex;
	align-items: center;
	justify-content: center;
	width: 22px;
	height: 22px;
	padding: 0;
	border: none;
	border-radius: 3px;
	background: transparent;
	color: var(--vscode-descriptionForeground);
	cursor: pointer;
	transition: all 0.15s ease;

	&:hover {
		background-color: var(--vscode-toolbar-hoverBackground);
		color: var(--vscode-foreground);
	}

	svg {
		width: 14px;
		height: 14px;
	}
`

const FetchModelsOverlay = styled.div`
	position: fixed;
	inset: 0;
	z-index: 999;
	display: flex;
	align-items: center;
	justify-content: center;
	background-color: rgba(0, 0, 0, 0.4);
`

const FetchModelsDialog = styled.div`
	width: 400px;
	max-height: 500px;
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 16px;
	border-radius: 6px;
	background-color: var(--vscode-editor-background);
	border: 1px solid var(--vscode-panel-border);
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
`

const FetchModelsList = styled.div`
	display: flex;
	flex-direction: column;
	gap: 4px;
	max-height: 300px;
	overflow-y: auto;
	border: 1px solid var(--vscode-panel-border);
	border-radius: 4px;
	padding: 6px;
`

const FetchModelItem = styled.label`
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 4px 6px;
	border-radius: 3px;
	font-size: 12px;
	cursor: pointer;

	&:hover {
		background-color: var(--vscode-list-hoverBackground);
	}

	input[type="checkbox"] {
		accent-color: var(--vscode-focusBorder);
	}
`

const TestResultBadge = styled.span<{ success: boolean }>`
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px 8px;
	border-radius: 10px;
	font-size: 11px;
	font-weight: 500;
	background-color: ${(props) => (props.success ? "var(--vscode-testing-iconPassed)" : "var(--vscode-errorForeground)")};
	color: white;
`

/**
 * 多接口管理器组件
 * 支持创建、编辑、删除、复制API配置
 */
export const MultiProviderManager = ({
	configs,
	onConfigsChange,
	onActiveConfigChange,
	activeConfigId,
}: MultiProviderManagerProps) => {
	const { t } = useI18n()
	const [expandedId, setExpandedId] = useState<string | null>(null)
	const [showForm, setShowForm] = useState(false)
	const [editingId, setEditingId] = useState<string | null>(null)
	const [formData, setFormData] = useState<Partial<ApiProviderConfig>>({
		name: "",
		provider: "openai",
		protocol: "openai-chat",
		baseUrl: "",
		apiKey: "",
		modelId: "",
		modelIds: [],
		models: [],
		description: "",
	})
	const [modelIdsText, setModelIdsText] = useState("")
	const [validationError, setValidationError] = useState<string | null>(null)

	// 测试接口状态
	const [testingConfigId, setTestingConfigId] = useState<string | null>(null)
	const [testResult, setTestResult] = useState<{ configId: string; success: boolean; message: string } | null>(null)

	// 读取模型状态
	const [fetchingConfigId, setFetchingConfigId] = useState<string | null>(null)
	const [fetchedModels, setFetchedModels] = useState<string[]>([])
	const [selectedFetchModels, setSelectedFetchModels] = useState<Set<string>>(new Set())
	const [showFetchDialog, setShowFetchDialog] = useState(false)
	const [fetchError, setFetchError] = useState<string | null>(null)

	// 编辑模型上下文长度
	const [editingModelCtx, setEditingModelCtx] = useState<{ configId: string; modelId: string } | null>(null)
	const [editCtxValue, setEditCtxValue] = useState("")

	// 生成唯一ID
	const generateId = useCallback(() => {
		return `config_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
	}, [])

	// 重置表单
	const resetForm = useCallback(() => {
		setFormData({
			name: "",
			provider: "openai",
			protocol: "openai-chat",
			baseUrl: "",
			apiKey: "",
			modelId: "",
			modelIds: [],
			models: [],
			description: "",
		})
		setModelIdsText("")
		setEditingId(null)
		setShowForm(false)
		setValidationError(null)
	}, [])

	// 获取模型的上下文长度
	const getModelCtx = useCallback((config: ApiProviderConfig, modelId: string): number => {
		const entry = config.models?.find((m) => m.id === modelId)
		if (entry) return entry.contextWindow
		return config.contextWindow || 128_000
	}, [])

	// 格式化上下文长度显示
	const formatCtx = (ctx: number): string => {
		if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(ctx % 1_000_000 === 0 ? 0 : 1)}M`
		if (ctx >= 1_000) return `${Math.round(ctx / 1_000)}K`
		return String(ctx)
	}

	// 测试接口连通性（通过后端 RPC 代理，避免 webview CORS 限制）
	const handleTestConnection = useCallback(
		async (configId: string) => {
			const config = configs.find((c) => c.id === configId)
			if (!config) return

			setTestingConfigId(configId)
			setTestResult(null)

			try {
				const defaultUrl = config.protocol === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"
				let baseUrl = (config.baseUrl || defaultUrl).replace(/\/+$/, "")
				// Anthropic API requires /v1 path prefix for its endpoints
				if (config.protocol === "anthropic" && !baseUrl.endsWith("/v1")) {
					baseUrl = `${baseUrl}/v1`
				}
				const result = await ModelsServiceClient.refreshOpenAiModels(
					OpenAiModelsRequest.create({
						baseUrl,
						apiKey: config.apiKey || "",
						protocol: config.protocol || "openai-chat",
					}),
				)

				const models = result.values || []
				if (models.length > 0) {
					setTestResult({ configId, success: true, message: `连接成功，共 ${models.length} 个模型` })
				} else {
					setTestResult({ configId, success: false, message: "连接成功但未返回模型，请检查 API Key 权限" })
				}
			} catch (err: any) {
				setTestResult({ configId, success: false, message: err?.message || "连接失败" })
			} finally {
				setTestingConfigId(null)
			}
		},
		[configs],
	)

	// 读取远程模型列表（通过后端 RPC 代理，避免 webview CORS 限制）
	const handleFetchModels = useCallback(
		async (configId: string) => {
			const config = configs.find((c) => c.id === configId)
			if (!config) return

			setFetchingConfigId(configId)
			setFetchError(null)
			setFetchedModels([])
			setSelectedFetchModels(new Set())

			try {
				const defaultUrl = config.protocol === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"
				let baseUrl = (config.baseUrl || defaultUrl).replace(/\/+$/, "")
				// Anthropic API requires /v1 path prefix for its endpoints
				if (config.protocol === "anthropic" && !baseUrl.endsWith("/v1")) {
					baseUrl = `${baseUrl}/v1`
				}
				const result = await ModelsServiceClient.refreshOpenAiModels(
					OpenAiModelsRequest.create({
						baseUrl,
						apiKey: config.apiKey || "",
						protocol: config.protocol || "openai-chat",
					}),
				)

				const models = (result.values || []).slice().sort((a: string, b: string) => a.localeCompare(b))
				if (models.length > 0) {
					setFetchedModels(models)
					setShowFetchDialog(true)
				} else {
					setFetchError("未获取到模型列表，请检查 URL 和 API Key")
				}
			} catch (err: any) {
				setFetchError(err?.message || "读取模型失败")
			} finally {
				setFetchingConfigId(null)
			}
		},
		[configs],
	)

	// 确认添加选中的模型
	const handleConfirmFetchModels = useCallback(
		(configId: string) => {
			if (selectedFetchModels.size === 0) {
				setShowFetchDialog(false)
				return
			}

			const updatedConfigs = configs.map((config) => {
				if (config.id !== configId) return config
				const existingIds = new Set(getConfigModelIds(config))
				const newModelIds = Array.from(selectedFetchModels).filter((id) => !existingIds.has(id))
				if (newModelIds.length === 0) return config

				const allModelIds = [...getConfigModelIds(config), ...newModelIds]
				const existingModels = config.models || []
				const newModels: ModelEntry[] = [
					...existingModels,
					...newModelIds.map((id) => ({ id, contextWindow: config.contextWindow || 128_000 })),
				]

				return {
					...config,
					modelId: allModelIds[0],
					modelIds: allModelIds,
					models: newModels,
					updatedAt: Date.now(),
				}
			})

			onConfigsChange(updatedConfigs)
			setShowFetchDialog(false)
			setSelectedFetchModels(new Set())
			setFetchedModels([])
		},
		[configs, selectedFetchModels, onConfigsChange],
	)

	// 更新单个模型的上下文长度
	const handleUpdateModelCtx = useCallback(
		(configId: string, modelId: string, newCtx: number) => {
			const updatedConfigs = configs.map((config) => {
				if (config.id !== configId) return config
				const models = config.models || getConfigModelIds(config).map((id) => ({ id, contextWindow: config.contextWindow || 128_000 }))
				const updatedModels = models.map((m) => (m.id === modelId ? { ...m, contextWindow: newCtx } : m))
				// 如果该 modelId 不在 models 中则追加
				if (!updatedModels.find((m) => m.id === modelId)) {
					updatedModels.push({ id: modelId, contextWindow: newCtx })
				}
				return { ...config, models: updatedModels, updatedAt: Date.now() }
			})
			onConfigsChange(updatedConfigs)
			setEditingModelCtx(null)
		},
		[configs, onConfigsChange],
	)

	// 删除单个模型
	const handleRemoveModel = useCallback(
		(configId: string, modelId: string) => {
			const updatedConfigs = configs.map((config) => {
				if (config.id !== configId) return config
				const currentIds = getConfigModelIds(config)
				const newIds = currentIds.filter((id) => id !== modelId)
				if (newIds.length === 0) return config // 至少保留一个
				const newModels = (config.models || []).filter((m) => m.id !== modelId)
				return {
					...config,
					modelId: newIds[0],
					modelIds: newIds,
					models: newModels,
					updatedAt: Date.now(),
				}
			})
			onConfigsChange(updatedConfigs)
		},
		[configs, onConfigsChange],
	)

	// 保存配置
	const handleSaveConfig = useCallback(() => {
		const modelIds = splitModelIds(modelIdsText)
		if (!formData.name || !formData.apiKey || modelIds.length === 0) {
			setValidationError("请填写必要字段：名称、API Key、模型ID")
			return
		}
		setValidationError(null)

		const now = Date.now()
		// 构建 models 数组：基于表单中的 models 或从旧配置继承
		const existingModels = formData.models || []
		const models: ModelEntry[] = modelIds.map((id) => {
			const existing = existingModels.find((m) => m.id === id)
			return existing || { id, contextWindow: formData.contextWindow || 128_000 }
		})

		if (editingId) {
			const updatedConfigs: ApiProviderConfig[] = configs.map((config) =>
				config.id === editingId
					? {
							...config,
							...formData,
							modelId: modelIds[0],
							modelIds,
							models,
							protocol: formData.protocol || "openai-chat",
							provider: formData.protocol === "anthropic" ? "anthropic" : "openai",
							updatedAt: now,
						}
					: config,
			)
			onConfigsChange(updatedConfigs)
		} else {
			const newConfig: ApiProviderConfig = {
				id: generateId(),
				name: formData.name || "",
				protocol: formData.protocol || "openai-chat",
				provider: formData.protocol === "anthropic" ? "anthropic" : "openai",
				baseUrl: formData.baseUrl,
				apiKey: formData.apiKey || "",
				modelId: modelIds[0],
				modelIds,
				models,
				description: formData.description,
				isActive: configs.length === 0,
				createdAt: now,
				updatedAt: now,
				tags: formData.tags,
				customHeaders: formData.customHeaders,
				timeout: formData.timeout,
				retryCount: formData.retryCount,
				contextWindow: formData.contextWindow || 128_000,
				rateLimit: formData.rateLimit,
			}
			onConfigsChange([...configs, newConfig])
		}

		resetForm()
	}, [formData, modelIdsText, editingId, configs, onConfigsChange, generateId, resetForm])

	// 删除配置
	const handleDeleteConfig = useCallback(
		(id: string) => {
			const updatedConfigs =
				activeConfigId === id && configs.length > 1
					? configs.filter((config) => config.id !== id).map((config, index) => ({ ...config, isActive: index === 0 }))
					: configs.filter((config) => config.id !== id)
			onConfigsChange(updatedConfigs)

			if (activeConfigId === id && updatedConfigs.length > 0) {
				onActiveConfigChange(updatedConfigs[0].id)
			}
		},
		[configs, activeConfigId, onConfigsChange, onActiveConfigChange],
	)

	// 复制配置
	const handleDuplicateConfig = useCallback(
		(id: string) => {
			const configToCopy = configs.find((config) => config.id === id)
			if (!configToCopy) return

			const newConfig: ApiProviderConfig = {
				...configToCopy,
				id: generateId(),
				name: `${configToCopy.name} (Copy)`,
				isActive: false,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}

			onConfigsChange([...configs, newConfig])
		},
		[configs, onConfigsChange, generateId],
	)

	// 编辑配置
	const handleEditConfig = useCallback(
		(id: string) => {
			const config = configs.find((c) => c.id === id)
			if (config) {
				setFormData({
					...config,
					protocol: config.protocol || "openai-chat",
					provider: config.protocol === "anthropic" ? "anthropic" : "openai",
					modelIds: getConfigModelIds(config),
					models: config.models || getConfigModelIds(config).map((mid) => ({ id: mid, contextWindow: config.contextWindow || 128_000 })),
				})
				setModelIdsText(getConfigModelIds(config).join("\n"))
				setEditingId(id)
				setShowForm(true)
			}
		},
		[configs],
	)

	// 激活配置
	const handleActivateConfig = useCallback(
		(id: string) => {
			const updatedConfigs = configs.map((config) => ({
				...config,
				isActive: config.id === id,
			}))
			onConfigsChange(updatedConfigs)
			onActiveConfigChange(id)
		},
		[configs, onConfigsChange, onActiveConfigChange],
	)

	// 切换展开状态
	const toggleExpanded = useCallback((id: string) => {
		setExpandedId((prev) => (prev === id ? null : id))
	}, [])

	// 计算统计信息
	const stats = useMemo(() => {
		return {
			total: configs.length,
			active: configs.filter((c) => c.isActive).length,
		}
	}, [configs])

	return (
		<Container>
			{/* 统计信息 */}
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					padding: "8px 12px",
					backgroundColor: "var(--vscode-editor-background)",
					borderRadius: "4px",
					border: "1px solid var(--vscode-panel-border)",
					fontSize: "12px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				<span>
					总配置: <strong>{stats.total}</strong> | 活跃: <strong>{stats.active}</strong>
				</span>
				<AddConfigButton onClick={() => setShowForm(true)} type="button">
					<Plus />
					新增配置
				</AddConfigButton>
			</div>

			{/* 配置列表 */}
			{configs.length === 0 ? (
				<EmptyState>
					<div>暂无API配置</div>
					<div style={{ fontSize: "12px" }}>点击"新增配置"按钮创建第一个配置</div>
				</EmptyState>
			) : (
				<ConfigListContainer>
					{configs.map((config) => (
						<ConfigCard key={config.id} isActive={config.isActive}>
							<ConfigHeader>
								<ConfigInfo onClick={() => handleActivateConfig(config.id)}>
									<div
										style={{
											width: "12px",
											height: "12px",
											borderRadius: "50%",
											border: "2px solid var(--vscode-focusBorder)",
											backgroundColor: config.isActive ? "var(--vscode-focusBorder)" : "transparent",
										}}
									/>
									<ConfigTitle>
										<ConfigName>{config.name}</ConfigName>
										<ConfigProvider>
											{API_PROTOCOL_LABELS[config.protocol || "openai-chat"]}
											{config.baseUrl && ` • ${config.baseUrl}`}
										</ConfigProvider>
									</ConfigTitle>
								</ConfigInfo>

								<ConfigActions>
									{config.isActive && (
										<StatusBadge status="active">
											<Check />
											活跃
										</StatusBadge>
									)}

									<Tooltip>
										<TooltipTrigger asChild>
											<ExpandButton onClick={() => toggleExpanded(config.id)}>
												{expandedId === config.id ? <ChevronUp /> : <ChevronDown />}
											</ExpandButton>
										</TooltipTrigger>
										<TooltipContent>展开详情</TooltipContent>
									</Tooltip>

									<Tooltip>
										<TooltipTrigger asChild>
											<ActionButton onClick={() => handleDuplicateConfig(config.id)} title="复制配置">
												<Copy />
											</ActionButton>
										</TooltipTrigger>
										<TooltipContent>复制配置</TooltipContent>
									</Tooltip>

									<Tooltip>
										<TooltipTrigger asChild>
											<ActionButton
												onClick={() => handleEditConfig(config.id)}
												title="编辑配置"
												style={{
													backgroundColor: "var(--vscode-button-background)",
													color: "var(--vscode-button-foreground)",
												}}>
												✎
											</ActionButton>
										</TooltipTrigger>
										<TooltipContent>编辑配置</TooltipContent>
									</Tooltip>

									<Tooltip>
										<TooltipTrigger asChild>
											<ActionButton
												onClick={() => handleDeleteConfig(config.id)}
												title="删除配置"
												style={{
													backgroundColor: "var(--vscode-errorForeground)",
													color: "white",
												}}>
												<Trash2 />
											</ActionButton>
										</TooltipTrigger>
										<TooltipContent>删除配置</TooltipContent>
									</Tooltip>
								</ConfigActions>
							</ConfigHeader>

							{/* 展开的详情 */}
							{expandedId === config.id && (
								<ConfigDetails>
									{/* 已添加的模型列表 */}
									<DetailRow>
										<DetailLabel>已添加的模型 {getConfigModelIds(config).length}</DetailLabel>
										<ModelListContainer>
											{getConfigModelIds(config).map((modelId) => (
												<ModelRow key={modelId}>
													<ModelName title={modelId}>{modelId}</ModelName>
													{editingModelCtx?.configId === config.id && editingModelCtx?.modelId === modelId ? (
														<>
															<input
																type="number"
																value={editCtxValue}
																onChange={(e) => setEditCtxValue(e.target.value)}
																onKeyDown={(e) => {
																	if (e.key === "Enter") { const val = parseInt(editCtxValue); if (val > 0) handleUpdateModelCtx(config.id, modelId, val) }
																	else if (e.key === "Escape") { setEditingModelCtx(null) }
																}}
																style={{ width: "80px", height: "20px", fontSize: "11px", padding: "0 4px", backgroundColor: "var(--vscode-input-background)", color: "var(--vscode-input-foreground)", border: "1px solid var(--vscode-focusBorder)", borderRadius: "2px" }}
																autoFocus
															/>
															<ModelActionBtn onClick={() => { const val = parseInt(editCtxValue); if (val > 0) handleUpdateModelCtx(config.id, modelId, val) }}>
																<Check />
															</ModelActionBtn>
														</>
													) : (
														<ModelContextBadge>⊘ {formatCtx(getModelCtx(config, modelId))}</ModelContextBadge>
													)}
													<ModelActionBtn onClick={() => { setEditingModelCtx({ configId: config.id, modelId }); setEditCtxValue(String(getModelCtx(config, modelId))) }}>
														<Edit3 />
													</ModelActionBtn>
													{getConfigModelIds(config).length > 1 && (
														<ModelActionBtn onClick={() => handleRemoveModel(config.id, modelId)}>
															<X />
														</ModelActionBtn>
													)}
												</ModelRow>
											))}
										</ModelListContainer>
									</DetailRow>

									{/* 读取模型 / 测试接口 按钮 */}
									<div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
										<button
											onClick={() => handleFetchModels(config.id)}
											disabled={fetchingConfigId === config.id}
											style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 10px", fontSize: "12px", border: "1px solid var(--vscode-panel-border)", borderRadius: "3px", backgroundColor: "var(--vscode-button-secondaryBackground)", color: "var(--vscode-button-secondaryForeground)", cursor: fetchingConfigId === config.id ? "wait" : "pointer" }}>
											<RefreshCw style={{ width: "12px", height: "12px" }} />
											{fetchingConfigId === config.id ? "读取中..." : "读取模型"}
										</button>
										<button
											onClick={() => handleTestConnection(config.id)}
											disabled={testingConfigId === config.id}
											style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 10px", fontSize: "12px", border: "1px solid var(--vscode-panel-border)", borderRadius: "3px", backgroundColor: "var(--vscode-button-secondaryBackground)", color: "var(--vscode-button-secondaryForeground)", cursor: testingConfigId === config.id ? "wait" : "pointer" }}>
											<Zap style={{ width: "12px", height: "12px" }} />
											{testingConfigId === config.id ? "测试中..." : "测试接口"}
										</button>
										{testResult?.configId === config.id && (
											<TestResultBadge success={testResult.success}>
												{testResult.success ? "✓" : "✗"} {testResult.message}
											</TestResultBadge>
										)}
									</div>

									{fetchError && fetchingConfigId === null && (
										<div style={{ fontSize: "11px", color: "var(--vscode-errorForeground)" }}>{fetchError}</div>
									)}

									{config.baseUrl && (
										<DetailRow>
											<DetailLabel>基础 URL</DetailLabel>
											<DetailValue>{config.baseUrl}</DetailValue>
										</DetailRow>
									)}

									<DetailRow>
										<DetailLabel>API Key</DetailLabel>
										<DetailValue>
											{config.apiKey.substring(0, 8)}
											{"•".repeat(Math.max(0, config.apiKey.length - 8))}
										</DetailValue>
									</DetailRow>

									<DetailRow>
										<DetailLabel>创建时间</DetailLabel>
										<DetailValue>{new Date(config.createdAt).toLocaleString()}</DetailValue>
									</DetailRow>
								</ConfigDetails>
							)}
						</ConfigCard>
					))}
				</ConfigListContainer>
			)}

			{/* 新增/编辑表单 */}
			{showForm && (
				<FormSection>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							marginBottom: "8px",
						}}>
						<span style={{ fontWeight: 500 }}>{editingId ? "编辑配置" : "新增配置"}</span>
						<button
							onClick={resetForm}
							style={{
								background: "none",
								border: "none",
								color: "var(--vscode-descriptionForeground)",
								cursor: "pointer",
								fontSize: "16px",
							}}>
							<X />
						</button>
					</div>

					<FormField>
						<FormLabel>配置名称 *</FormLabel>
						<FormInput
							value={formData.name || ""}
							onInput={(e: any) => setFormData({ ...formData, name: e.target.value })}
							placeholder="例如：生产环境 OpenAI"
						/>
					</FormField>

					<FormField>
						<FormLabel>API 协议</FormLabel>
						<select
							value={formData.protocol || "openai-chat"}
							onChange={(e: any) =>
								setFormData({
									...formData,
									protocol: e.target.value as ApiProtocol,
								})
							}
							style={{
								width: "100%",
								padding: "4px 8px",
								height: "28px",
								fontSize: "13px",
								backgroundColor: "var(--vscode-input-background)",
								color: "var(--vscode-input-foreground)",
								border: "1px solid var(--vscode-input-border, var(--vscode-panel-border))",
								borderRadius: "2px",
								outline: "none",
							}}>
							<option value="openai-chat">OpenAI Chat Completions (/v1/chat/completions)</option>
							<option value="openai-responses">OpenAI Responses API (/v1/responses)</option>
							<option value="anthropic">Anthropic Messages API (/v1/messages)</option>
						</select>
					</FormField>

					<FormField>
						<FormLabel>基础 URL</FormLabel>
						<FormInput
							value={formData.baseUrl || ""}
							onInput={(e: any) => setFormData({ ...formData, baseUrl: e.target.value })}
							placeholder={formData.protocol === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1"}
						/>
					</FormField>

					<FormField>
						<FormLabel>API Key *</FormLabel>
						<FormInput
							type="password"
							value={formData.apiKey || ""}
							onInput={(e: any) => setFormData({ ...formData, apiKey: e.target.value })}
							placeholder="输入你的 API Key"
						/>
					</FormField>

					{/* 读取模型按钮（表单内） */}
					<FormField>
						<div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
							<button
								onClick={async () => {
									if (!formData.apiKey) {
										setValidationError("请先填写 API Key")
										return
									}
									setValidationError(null)
									setFetchingConfigId("__form__")
									setFetchError(null)
									try {
										const defaultUrl = formData.protocol === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"
										let baseUrl = (formData.baseUrl || defaultUrl).replace(/\/+$/, "")
										if (formData.protocol === "anthropic" && !baseUrl.endsWith("/v1")) {
											baseUrl = `${baseUrl}/v1`
										}
										const result = await ModelsServiceClient.refreshOpenAiModels(
											OpenAiModelsRequest.create({
												baseUrl,
												apiKey: formData.apiKey || "",
												protocol: formData.protocol || "openai-chat",
											}),
										)
										const models = (result.values || []).slice().sort((a: string, b: string) => a.localeCompare(b))
										if (models.length > 0) {
											setFetchedModels(models)
											setSelectedFetchModels(new Set())
											setShowFetchDialog(true)
										} else {
											setFetchError("未获取到模型列表，请检查 URL 和 API Key")
										}
									} catch (err: any) {
										setFetchError(err?.message || "读取模型失败")
									} finally {
										setFetchingConfigId(null)
									}
								}}
								disabled={fetchingConfigId === "__form__"}
								type="button"
								style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 10px", fontSize: "12px", border: "1px solid var(--vscode-panel-border)", borderRadius: "3px", backgroundColor: "var(--vscode-button-secondaryBackground)", color: "var(--vscode-button-secondaryForeground)", cursor: fetchingConfigId === "__form__" ? "wait" : "pointer" }}>
								<RefreshCw style={{ width: "12px", height: "12px" }} />
								{fetchingConfigId === "__form__" ? "读取中..." : "读取模型"}
							</button>
							<span style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
								填写 URL 和 Key 后可自动获取模型列表
							</span>
						</div>
						{fetchError && fetchingConfigId === null && (
							<div style={{ fontSize: "11px", color: "var(--vscode-errorForeground)", marginTop: "4px" }}>{fetchError}</div>
						)}
					</FormField>

					<FormField>
						<FormLabel>模型 ID *（支持多个，每行或逗号分隔）</FormLabel>
						<FormTextArea
							resize="vertical"
							rows={4}
							value={modelIdsText}
							onInput={(e: any) => setModelIdsText(e.target.value)}
							placeholder={"例如：\ngpt-4.1\no3-mini\nclaude-sonnet-4-5"}
						/>
					</FormField>

					<FormField>
						<FormLabel>描述</FormLabel>
						<FormInput
							value={formData.description || ""}
							onInput={(e: any) => setFormData({ ...formData, description: e.target.value })}
							placeholder="可选：配置的描述信息"
						/>
					</FormField>

					<FormField>
						<FormLabel>超时时间 (毫秒)</FormLabel>
						<FormInput
							type="number"
							value={formData.timeout || ""}
							onInput={(e: any) =>
								setFormData({
									...formData,
									timeout: e.target.value ? parseInt(e.target.value) : undefined,
								})
							}
							placeholder="30000"
						/>
					</FormField>

				<FormField>
					<FormLabel>重试次数</FormLabel>
					<FormInput
						type="number"
						value={formData.retryCount ?? ""}
						onInput={(e: any) =>
							setFormData({
								...formData,
								retryCount: e.target.value ? parseInt(e.target.value) : undefined,
							})
						}
						placeholder="3"
					/>
				</FormField>

			<FormField>
				<FormLabel>默认上下文长度（新模型）</FormLabel>
				<select
					value={formData.contextWindow || 128_000}
					onChange={(e: any) =>
						setFormData({
							...formData,
							contextWindow: parseInt(e.target.value),
						})
					}
					style={{
						width: "100%",
						padding: "4px 8px",
						height: "28px",
						fontSize: "13px",
						backgroundColor: "var(--vscode-input-background)",
						color: "var(--vscode-input-foreground)",
						border: "1px solid var(--vscode-input-border, var(--vscode-panel-border))",
						borderRadius: "2px",
						outline: "none",
					}}>
						<option value={128_000}>128K</option>
						<option value={200_000}>200K</option>
						<option value={1_000_000}>1M</option>
					</select>
			</FormField>

				{validationError && (
					<div style={{
						padding: "6px 10px",
						borderRadius: "3px",
						backgroundColor: "var(--vscode-inputValidation-errorBackground, #5a1d1d)",
						border: "1px solid var(--vscode-inputValidation-errorBorder, #be1100)",
						color: "var(--vscode-errorForeground, #f48771)",
						fontSize: "12px",
						marginBottom: "8px",
					}}>
						{validationError}
					</div>
				)}

				<ButtonGroup>
						<VSCodeButton onClick={handleSaveConfig}>
							<Check style={{ width: "14px", height: "14px", marginRight: "4px" }} />
							保存
						</VSCodeButton>
						<VSCodeButton
							onClick={resetForm}
							style={{
								backgroundColor: "var(--vscode-button-secondaryBackground)",
								color: "var(--vscode-button-secondaryForeground)",
							}}>
							<X style={{ width: "14px", height: "14px", marginRight: "4px" }} />
							取消
						</VSCodeButton>
					</ButtonGroup>
				</FormSection>
			)}

			{/* 读取模型对话框 */}
			{showFetchDialog && (
				<FetchModelsOverlay onClick={() => setShowFetchDialog(false)}>
					<FetchModelsDialog onClick={(e) => e.stopPropagation()}>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
							<span style={{ fontWeight: 500, fontSize: "14px" }}>选择要添加的模型</span>
							<button onClick={() => setShowFetchDialog(false)} style={{ background: "none", border: "none", color: "var(--vscode-descriptionForeground)", cursor: "pointer" }}><X /></button>
						</div>
						<div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
							已获取 {fetchedModels.length} 个模型，已选 {selectedFetchModels.size} 个
						</div>
						<FetchModelsList>
							{fetchedModels.map((modelId) => (
								<FetchModelItem key={modelId}>
									<input
										type="checkbox"
										checked={selectedFetchModels.has(modelId)}
										onChange={(e) => {
											const next = new Set(selectedFetchModels)
											if (e.target.checked) next.add(modelId)
											else next.delete(modelId)
											setSelectedFetchModels(next)
										}}
									/>
									<span style={{ fontFamily: "monospace" }}>{modelId}</span>
								</FetchModelItem>
							))}
						</FetchModelsList>
						<div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
							<VSCodeButton
								onClick={() => setShowFetchDialog(false)}
								style={{ backgroundColor: "var(--vscode-button-secondaryBackground)", color: "var(--vscode-button-secondaryForeground)" }}>
								取消
							</VSCodeButton>
							<VSCodeButton
								onClick={() => {
									if (selectedFetchModels.size === 0) {
										setShowFetchDialog(false)
										return
									}
									if (showForm) {
										// Append selected models to the form's modelIdsText
										const currentIds = splitModelIds(modelIdsText)
										const existingSet = new Set(currentIds)
										const newIds = Array.from(selectedFetchModels).filter((id) => !existingSet.has(id))
										const allIds = [...currentIds, ...newIds]
										setModelIdsText(allIds.join("\n"))
										setShowFetchDialog(false)
										setSelectedFetchModels(new Set())
										setFetchedModels([])
									} else {
										const expanded = expandedId
										if (expanded) handleConfirmFetchModels(expanded)
									}
								}}
								disabled={selectedFetchModels.size === 0}>
								添加选中 ({selectedFetchModels.size})
							</VSCodeButton>
						</div>
					</FetchModelsDialog>
				</FetchModelsOverlay>
			)}
		</Container>
	)
}

export default MultiProviderManager
