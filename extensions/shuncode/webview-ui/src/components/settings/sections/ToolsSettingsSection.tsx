import { EmptyRequest } from "@shared/proto/shuncode/common"
import {
	normalizeToolCustomizationSettings,
	serializeToolCustomizationSettings,
	type CustomizableToolInfo,
	type ToolCustomizationData,
	type ToolCustomizationSettings,
} from "@shared/ToolCustomizationSettings"
import { VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ChevronDown, ChevronRight, Plug, RefreshCw, Search, Wrench } from "lucide-react"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { StateServiceClient } from "@/services/grpc-client"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface ToolsSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const commit = (settings: ToolCustomizationSettings) => {
	updateSetting("toolCustomizationSettings", serializeToolCustomizationSettings(settings))
}

const ToolsSettingsSection = ({ renderSectionHeader }: ToolsSettingsSectionProps) => {
	const { t } = useI18n()
	const { toolCustomizationSettings } = useExtensionState()
	const [data, setData] = useState<ToolCustomizationData | undefined>()
	const [dataError, setDataError] = useState<string | undefined>()
	const [isLoading, setIsLoading] = useState(false)
	const [search, setSearch] = useState("")
	const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
	const [paramEdits, setParamEdits] = useState<Record<string, Record<string, string>>>({})
	const descEditsRef = useRef<Record<string, string>>({})

	const settings = useMemo(
		() => normalizeToolCustomizationSettings(toolCustomizationSettings),
		[toolCustomizationSettings],
	)

	const refresh = async () => {
		setIsLoading(true)
		setDataError(undefined)
		try {
			const result = await StateServiceClient.getToolCustomizationData(EmptyRequest.create({}))
			setData(JSON.parse(result.value || "{}"))
		} catch (error) {
			setDataError(error instanceof Error ? error.message : String(error))
		} finally {
			setIsLoading(false)
		}
	}

	useEffect(() => {
		refresh()
	}, [])

	const getCustomization = (toolKey: string) => settings.tools[toolKey]
	const isEnabled = (toolKey: string) => getCustomization(toolKey)?.enabled !== false

	const toggleEnabled = (toolKey: string) => {
		const current = getCustomization(toolKey)
		commit({
			...settings,
			tools: {
				...settings.tools,
				[toolKey]: { ...current, enabled: !isEnabled(toolKey) },
			},
		})
	}

	const setDescription = (toolKey: string, description: string) => {
		const current = getCustomization(toolKey)
		commit({
			...settings,
			tools: {
				...settings.tools,
				[toolKey]: { ...current, description },
			},
		})
	}

	const setParamDesc = (toolKey: string, paramName: string, desc: string) => {
		const current = getCustomization(toolKey)
		commit({
			...settings,
			tools: {
				...settings.tools,
				[toolKey]: {
					...current,
					parameters: {
						...current?.parameters,
						[paramName]: { ...current?.parameters?.[paramName], description: desc },
					},
				},
			},
		})
	}

	const resetTool = (toolKey: string) => {
		const { [toolKey]: _removed, ...rest } = settings.tools
		commit({ tools: rest })
	}

	const toggleExpand = (key: string) => {
		setExpandedKeys((prev) => {
			const next = new Set(prev)
			if (next.has(key)) next.delete(key)
			else next.add(key)
			return next
		})
	}

	const filteredTools = useMemo(() => {
		if (!data) return []
		if (!search.trim()) return data.tools
		const q = search.toLowerCase()
		return data.tools.filter(
			(tool) =>
				tool.name.toLowerCase().includes(q) ||
				tool.description.toLowerCase().includes(q) ||
				tool.id.toLowerCase().includes(q),
		)
	}, [data, search])

	const builtinTools = filteredTools.filter((tool) => tool.type === "builtin")
	const mcpTools = filteredTools.filter((tool) => tool.type === "mcp")

	const renderToolCard = (tool: CustomizableToolInfo) => {
		const customization = getCustomization(tool.key)
		const enabled = isEnabled(tool.key)
		const expanded = expandedKeys.has(tool.key)
		const descValue =
			customization?.description !== undefined
				? customization.description
				: tool.description
		const isModified = !!customization

		return (
			<div
				key={tool.key}
				className="mb-2 rounded"
				style={{ border: "1px solid var(--vscode-widget-border)", opacity: enabled ? 1 : 0.55 }}>
				<div
					className="flex items-center gap-2 px-3 py-2 cursor-pointer"
					onClick={() => toggleExpand(tool.key)}
					style={{ background: "var(--vscode-sideBar-background)" }}>
					<VSCodeCheckbox
						checked={enabled}
						onChange={(e: any) => {
							e.stopPropagation()
							toggleEnabled(tool.key)
						}}
						onClick={(e: React.MouseEvent) => e.stopPropagation()}
					/>
					{expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
					<div className="flex-1 min-w-0">
						<div className="text-sm font-medium truncate">
							{tool.type === "mcp" ? (
								<span className="flex items-center gap-1">
									<Plug className="w-3 h-3" />
									{tool.serverName}:{tool.name}
								</span>
							) : (
								tool.name
							)}
						</div>
						<div className="text-xs text-(--vscode-descriptionForeground) truncate">
							{tool.description.slice(0, 120)}
							{tool.description.length > 120 ? "..." : ""}
						</div>
					</div>
					<div className="text-xs text-(--vscode-descriptionForeground) shrink-0">{tool.id}</div>
					{isModified && (
						<VSCodeButton
							appearance="secondary"
							onClick={(e: React.MouseEvent) => {
								e.stopPropagation()
								resetTool(tool.key)
							}}>
							{t("tools.reset")}
						</VSCodeButton>
					)}
				</div>

				{expanded && (
					<div className="px-3 py-2" style={{ background: "var(--vscode-editor-background)" }}>
						<div className="mb-2">
							<label className="block text-xs font-medium mb-1">{t("tools.description")}</label>
							<VSCodeTextField
								className="w-full"
								onBlur={(e: any) => setDescription(tool.key, e.target.value)}
								onChange={(e: any) => {
									descEditsRef.current[tool.key] = e.target.value
								}}
								placeholder={tool.description}
								value={
									customization?.description !== undefined
										? customization.description
										: (descEditsRef.current[tool.key] ?? tool.description)
								}
							/>
						</div>

						{tool.parameters.length > 0 && (
							<div className="mb-2">
								<div className="text-xs font-medium mb-1">{t("tools.parameters")}</div>
								{tool.parameters.map((parameter) => {
									const paramDesc =
										customization?.parameters?.[parameter.name]?.description ??
										parameter.description
									return (
										<div key={parameter.name} className="mb-1">
											<div className="text-xs text-(--vscode-descriptionForeground) mb-1">
												<code>{parameter.name}</code>
												{parameter.required && (
													<span className="ml-1">({t("tools.required")})</span>
												)}
											</div>
											<VSCodeTextField
												className="w-full"
												onBlur={(e: any) => {
													const value = e.target.value
													if (value !== parameter.description) {
														setParamDesc(tool.key, parameter.name, value)
													}
												}}
												onChange={(e: any) => {
													setParamEdits((prev) => ({
														...prev,
														[tool.key]: {
															...(prev[tool.key] || {}),
															[parameter.name]: e.target.value,
														},
													}))
												}}
												placeholder={parameter.description}
												size={Math.min(40, Math.max(20, parameter.description.length))}
												value={paramEdits?.[tool.key]?.[parameter.name] ?? paramDesc}
											/>
										</div>
									)
								})}
							</div>
						)}
					</div>
				)}
			</div>
		)
	}

	return (
		<div>
			{renderSectionHeader("tools")}
			<Section>
				<div className="flex items-center justify-between gap-2 mb-3">
					<div>
						<div className="text-sm">{t("tools.description")}</div>
						<p className="text-xs mt-[4px] text-(--vscode-descriptionForeground)">{t("tools.sectionDescription")}</p>
					</div>
					<VSCodeButton appearance="secondary" disabled={isLoading} onClick={refresh}>
						<span className="inline-flex items-center" slot="start">
							<RefreshCw className="w-4 h-4" />
						</span>
						{isLoading ? t("tools.loading") : t("tools.refresh")}
					</VSCodeButton>
				</div>

				{dataError && (
					<div className="mb-3 p-2 rounded text-xs" style={{ background: "var(--vscode-inputValidation-errorBackground)" }}>
						{dataError}
					</div>
				)}

				<div className="relative mb-3">
					<Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-(--vscode-descriptionForeground)" />
					<VSCodeTextField
						className="w-full pl-8"
						onChange={(e: any) => setSearch(e.target.value)}
						placeholder={t("tools.search")}
						value={search}
					/>
				</div>

				{!data && !dataError && (
					<div className="text-xs text-(--vscode-descriptionForeground)">{t("tools.clickRefresh")}</div>
				)}

				{data && (
					<>
						{builtinTools.length > 0 && (
							<div className="mb-3">
								<div className="text-sm font-semibold mb-2 flex items-center gap-2">
									<Wrench className="w-4 h-4" />
									{t("tools.builtinTools")}
								</div>
								{builtinTools.map(renderToolCard)}
							</div>
						)}

						{mcpTools.length > 0 && (
							<div className="mb-3">
								<div className="text-sm font-semibold mb-2 flex items-center gap-2">
									<Plug className="w-4 h-4" />
									{t("tools.mcpTools")}
								</div>
								{mcpTools.map(renderToolCard)}
							</div>
						)}

						{filteredTools.length === 0 && (
							<div className="text-xs text-(--vscode-descriptionForeground)">{t("tools.noTools")}</div>
						)}
					</>
				)}
			</Section>
		</div>
	)
}

export default ToolsSettingsSection
