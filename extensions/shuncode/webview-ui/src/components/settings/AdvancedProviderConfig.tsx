import { useState, useCallback } from "react"
import styled from "styled-components"
import { VSCodeButton, VSCodeTextField, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react"
import { useI18n } from "@/i18n"

/**
 * 高级配置项
 */
export interface AdvancedConfig {
	customHeaders?: Record<string, string>
	timeout?: number
	retryCount?: number
	rateLimit?: {
		requestsPerMinute?: number
		tokensPerMinute?: number
	}
	proxy?: {
		enabled?: boolean
		url?: string
		auth?: {
			username?: string
			password?: string
		}
	}
	ssl?: {
		verify?: boolean
		caPath?: string
	}
	logging?: {
		enabled?: boolean
		level?: "debug" | "info" | "warn" | "error"
	}
}

interface AdvancedProviderConfigProps {
	config: AdvancedConfig
	onChange: (config: AdvancedConfig) => void
}

const Container = styled.div`
	display: flex;
	flex-direction: column;
	gap: 12px;
`

const Section = styled.div`
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 12px;
	border: 1px solid var(--vscode-panel-border);
	border-radius: 4px;
	background-color: var(--vscode-editor-background);
`

const SectionHeader = styled.button`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 8px;
	border: none;
	background: none;
	color: var(--vscode-foreground);
	cursor: pointer;
	font-weight: 500;
	font-size: 13px;

	&:hover {
		background-color: var(--vscode-list-hoverBackground);
		border-radius: 3px;
	}

	svg {
		width: 16px;
		height: 16px;
	}
`

const SectionContent = styled.div`
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding-left: 8px;
	border-left: 2px solid var(--vscode-panel-border);
	padding-top: 8px;
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

const FormSelect = styled.select`
	padding: 6px 8px;
	border-radius: 3px;
	border: 1px solid var(--vscode-input-border);
	background-color: var(--vscode-input-background);
	color: var(--vscode-input-foreground);
	font-size: 12px;
	width: 100%;
`

const HeaderList = styled.div`
	display: flex;
	flex-direction: column;
	gap: 8px;
`

const HeaderItem = styled.div`
	display: flex;
	gap: 8px;
	align-items: flex-start;
`

const HeaderInputGroup = styled.div`
	display: flex;
	gap: 4px;
	flex: 1;
`

const HeaderInput = styled(VSCodeTextField)`
	flex: 1;
`

const RemoveButton = styled.button`
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
		background-color: var(--vscode-errorForeground);
		color: white;
	}

	svg {
		width: 14px;
		height: 14px;
	}
`

const AddButton = styled(VSCodeButton)`
	width: 100%;
	margin-top: 8px;
`

/**
 * 高级提供商配置编辑器
 */
export const AdvancedProviderConfig = ({ config, onChange }: AdvancedProviderConfigProps) => {
	const { t } = useI18n()
	const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

	const toggleSection = useCallback((section: string) => {
		setExpandedSections((prev) => {
			const next = new Set(prev)
			if (next.has(section)) {
				next.delete(section)
			} else {
				next.add(section)
			}
			return next
		})
	}, [])

	const updateConfig = useCallback(
		(updates: Partial<AdvancedConfig>) => {
			onChange({ ...config, ...updates })
		},
		[config, onChange],
	)

	const addHeader = useCallback(() => {
		const headers = { ...config.customHeaders }
		headers[`Header-${Object.keys(headers).length + 1}`] = ""
		updateConfig({ customHeaders: headers })
	}, [config.customHeaders, updateConfig])

	const updateHeader = useCallback(
		(oldKey: string, newKey: string, value: string) => {
			const headers = { ...config.customHeaders }
			if (oldKey !== newKey) {
				delete headers[oldKey]
			}
			headers[newKey] = value
			updateConfig({ customHeaders: headers })
		},
		[config.customHeaders, updateConfig],
	)

	const removeHeader = useCallback(
		(key: string) => {
			const headers = { ...config.customHeaders }
			delete headers[key]
			updateConfig({ customHeaders: headers })
		},
		[config.customHeaders, updateConfig],
	)

	return (
		<Container>
			{/* 基础配置 */}
			<Section>
				<SectionHeader onClick={() => toggleSection("basic")}>
					<span>基础设置</span>
					{expandedSections.has("basic") ? <ChevronUp /> : <ChevronDown />}
				</SectionHeader>

				{expandedSections.has("basic") && (
					<SectionContent>
						<FormField>
							<FormLabel>请求超时 (毫秒)</FormLabel>
							<FormInput
								type="number"
								value={config.timeout || ""}
								onChange={(e: any) =>
									updateConfig({
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
								value={config.retryCount ?? ""}
								onChange={(e: any) =>
									updateConfig({
										retryCount: e.target.value ? parseInt(e.target.value) : undefined,
									})
								}
								placeholder="3"
								min="0"
								max="10"
							/>
						</FormField>
					</SectionContent>
				)}
			</Section>

			{/* 速率限制 */}
			<Section>
				<SectionHeader onClick={() => toggleSection("rateLimit")}>
					<span>速率限制</span>
					{expandedSections.has("rateLimit") ? <ChevronUp /> : <ChevronDown />}
				</SectionHeader>

				{expandedSections.has("rateLimit") && (
					<SectionContent>
						<FormField>
							<FormLabel>每分钟请求数</FormLabel>
							<FormInput
								type="number"
								value={config.rateLimit?.requestsPerMinute ?? ""}
								onChange={(e: any) =>
									updateConfig({
										rateLimit: {
											...config.rateLimit,
											requestsPerMinute: e.target.value
												? parseInt(e.target.value)
												: undefined,
										},
									})
								}
								placeholder="60"
							/>
						</FormField>

						<FormField>
							<FormLabel>每分钟 Token 数</FormLabel>
							<FormInput
								type="number"
								value={config.rateLimit?.tokensPerMinute ?? ""}
								onChange={(e: any) =>
									updateConfig({
										rateLimit: {
											...config.rateLimit,
											tokensPerMinute: e.target.value
												? parseInt(e.target.value)
												: undefined,
										},
									})
								}
								placeholder="90000"
							/>
						</FormField>
					</SectionContent>
				)}
			</Section>

			{/* 自定义请求头 */}
			<Section>
				<SectionHeader onClick={() => toggleSection("headers")}>
					<span>自定义请求头</span>
					{expandedSections.has("headers") ? <ChevronUp /> : <ChevronDown />}
				</SectionHeader>

				{expandedSections.has("headers") && (
					<SectionContent>
						<HeaderList>
							{config.customHeaders &&
								Object.entries(config.customHeaders).map(([key, value]) => (
									<HeaderItem key={key}>
										<HeaderInputGroup>
											<HeaderInput
												placeholder="Header 名称"
												value={key}
												onChange={(e: any) =>
													updateHeader(key, e.target.value, value)
												}
											/>
											<HeaderInput
												placeholder="Header 值"
												value={value}
												onChange={(e: any) =>
													updateHeader(key, key, e.target.value)
												}
											/>
										</HeaderInputGroup>
										<RemoveButton
											onClick={() => removeHeader(key)}
											title="删除">
											<Trash2 />
										</RemoveButton>
									</HeaderItem>
								))}
						</HeaderList>
						<AddButton onClick={addHeader}>
							<Plus style={{ width: "14px", height: "14px", marginRight: "4px" }} />
							添加请求头
						</AddButton>
					</SectionContent>
				)}
			</Section>

			{/* 代理设置 */}
			<Section>
				<SectionHeader onClick={() => toggleSection("proxy")}>
					<span>代理设置</span>
					{expandedSections.has("proxy") ? <ChevronUp /> : <ChevronDown />}
				</SectionHeader>

				{expandedSections.has("proxy") && (
					<SectionContent>
						<FormField>
							<VSCodeCheckbox
								checked={config.proxy?.enabled || false}
								onChange={(e: any) =>
									updateConfig({
										proxy: {
											...config.proxy,
											enabled: e.target.checked,
										},
									})
								}>
								启用代理
							</VSCodeCheckbox>
						</FormField>

						{config.proxy?.enabled && (
							<>
								<FormField>
									<FormLabel>代理 URL</FormLabel>
									<FormInput
										value={config.proxy?.url || ""}
										onChange={(e: any) =>
											updateConfig({
												proxy: {
													...config.proxy,
													url: e.target.value,
												},
											})
										}
										placeholder="http://proxy.example.com:8080"
									/>
								</FormField>

								<FormField>
									<FormLabel>用户名 (可选)</FormLabel>
									<FormInput
										value={config.proxy?.auth?.username || ""}
										onChange={(e: any) =>
											updateConfig({
												proxy: {
													...config.proxy,
													auth: {
														...config.proxy?.auth,
														username: e.target.value,
													},
												},
											})
										}
										placeholder="代理用户名"
									/>
								</FormField>

								<FormField>
									<FormLabel>密码 (可选)</FormLabel>
									<FormInput
										type="password"
										value={config.proxy?.auth?.password || ""}
										onChange={(e: any) =>
											updateConfig({
												proxy: {
													...config.proxy,
													auth: {
														...config.proxy?.auth,
														password: e.target.value,
													},
												},
											})
										}
										placeholder="代理密码"
									/>
								</FormField>
							</>
						)}
					</SectionContent>
				)}
			</Section>

			{/* SSL/TLS 设置 */}
			<Section>
				<SectionHeader onClick={() => toggleSection("ssl")}>
					<span>SSL/TLS 设置</span>
					{expandedSections.has("ssl") ? <ChevronUp /> : <ChevronDown />}
				</SectionHeader>

				{expandedSections.has("ssl") && (
					<SectionContent>
						<FormField>
							<VSCodeCheckbox
								checked={config.ssl?.verify !== false}
								onChange={(e: any) =>
									updateConfig({
										ssl: {
											...config.ssl,
											verify: e.target.checked,
										},
									})
								}>
								验证 SSL 证书
							</VSCodeCheckbox>
						</FormField>

						{!config.ssl?.verify && (
							<FormField>
								<FormLabel>CA 证书路径 (可选)</FormLabel>
								<FormInput
									value={config.ssl?.caPath || ""}
									onChange={(e: any) =>
										updateConfig({
											ssl: {
												...config.ssl,
												caPath: e.target.value,
											},
										})
									}
									placeholder="/path/to/ca-cert.pem"
								/>
							</FormField>
						)}
					</SectionContent>
				)}
			</Section>

			{/* 日志设置 */}
			<Section>
				<SectionHeader onClick={() => toggleSection("logging")}>
					<span>日志设置</span>
					{expandedSections.has("logging") ? <ChevronUp /> : <ChevronDown />}
				</SectionHeader>

				{expandedSections.has("logging") && (
					<SectionContent>
						<FormField>
							<VSCodeCheckbox
								checked={config.logging?.enabled || false}
								onChange={(e: any) =>
									updateConfig({
										logging: {
											...config.logging,
											enabled: e.target.checked,
										},
									})
								}>
								启用日志
							</VSCodeCheckbox>
						</FormField>

						{config.logging?.enabled && (
							<FormField>
								<FormLabel>日志级别</FormLabel>
								<FormSelect
									value={config.logging?.level || "info"}
									onChange={(e) =>
										updateConfig({
											logging: {
												...config.logging,
												level: e.target.value as any,
											},
										})
									}>
									<option value="debug">Debug</option>
									<option value="info">Info</option>
									<option value="warn">Warn</option>
									<option value="error">Error</option>
								</FormSelect>
							</FormField>
						)}
					</SectionContent>
				)}
			</Section>
		</Container>
	)
}

export default AdvancedProviderConfig
