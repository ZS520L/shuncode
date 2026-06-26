import { EmptyRequest, StringRequest } from "@shared/proto/shuncode/common"
import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Brain, Download, RefreshCw, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useI18n } from "@/i18n"
import { StateServiceClient } from "@/services/grpc-client"
import Section from "../Section"

interface SkillsSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}
interface SkillInfo {
	name: string
	description: string
	path: string
	source: string
	enabled: boolean
}
interface MarketplaceSource {
	id: string
	name: string
	url: string
	rawBase?: string
	builtIn?: boolean
}
interface MarketplaceItem {
	name: string
	description: string
	installed: boolean
}
interface SkillMutationResult {
	success?: boolean
	name?: string
	error?: string
}

const CUSTOM_SOURCES_STORAGE_KEY = "shuncode.skillMarketplace.customSources"
const MARKETPLACE_CACHE_KEY = "shuncode.skillMarketplace.cache"

interface MarketplaceCache {
	[sourceId: string]: { items: MarketplaceItem[]; ts: number }
}

const readMarketplaceCache = (): MarketplaceCache => {
	try {
		const raw = localStorage.getItem(MARKETPLACE_CACHE_KEY)
		return JSON.parse(raw || "{}")
	} catch {
		return {}
	}
}

const writeMarketplaceCache = (cache: MarketplaceCache) => {
	localStorage.setItem(MARKETPLACE_CACHE_KEY, JSON.stringify(cache))
}

const readCustomSources = (): MarketplaceSource[] => {
	try {
		const raw = localStorage.getItem(CUSTOM_SOURCES_STORAGE_KEY)
		const parsed = JSON.parse(raw || "[]")
		return Array.isArray(parsed) ? parsed.filter(isValidCustomSource) : []
	} catch {
		return []
	}
}

const writeCustomSources = (sources: MarketplaceSource[]) => {
	localStorage.setItem(CUSTOM_SOURCES_STORAGE_KEY, JSON.stringify(sources.filter(isValidCustomSource)))
}

const isValidCustomSource = (source: unknown): source is MarketplaceSource => {
	if (!source || typeof source !== "object") return false
	const value = source as Partial<MarketplaceSource>
	return typeof value.id === "string" && typeof value.name === "string" && typeof value.url === "string" && value.url.length > 0
}

const createCustomSourceId = () => `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const getSourceRequestValue = (source: MarketplaceSource | undefined) => {
	if (!source) return ""
	return source.builtIn ? source.id : JSON.stringify({ sourceId: source.id, source })
}

const getInstallRequestValue = (skillName: string, source: MarketplaceSource | undefined) => {
	if (!source) return skillName
	return JSON.stringify({ skillName, sourceId: source.id, source })
}

const isGitHubTreeUrl = (value: string) => {
	try {
		const url = new URL(value)
		const parts = url.pathname.split("/").filter(Boolean)
		return url.hostname === "github.com" && parts.length >= 5 && parts[2] === "tree"
	} catch {
		return false
	}
}

const SkillsSettingsSection = ({ renderSectionHeader }: SkillsSettingsSectionProps) => {
	const { t } = useI18n()
	const [skills, setSkills] = useState<SkillInfo[]>([])
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | undefined>()
	const [sources, setSources] = useState<MarketplaceSource[]>([])
	const [activeSource, setActiveSource] = useState("")
	const [marketplace, setMarketplace] = useState<MarketplaceItem[]>([])
	const [marketError, setMarketError] = useState<string | undefined>()
	const [isMarketLoading, setIsMarketLoading] = useState(false)
	const [isInstalling, setIsInstalling] = useState<string | undefined>()
	const [newSourceName, setNewSourceName] = useState("")
	const [newSourceUrl, setNewSourceUrl] = useState("")
	const [isAddingSource, setIsAddingSource] = useState(false)

	const refresh = useCallback(async () => {
		setIsLoading(true)
		try {
			const result = await StateServiceClient.listInstalledSkills(EmptyRequest.create({}))
			setSkills(JSON.parse(result.value || "[]"))
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setIsLoading(false)
		}
	}, [])

	const loadSources = useCallback(async () => {
		try {
			const result = await StateServiceClient.listMarketplaceSources(EmptyRequest.create({}))
			const builtIns = (JSON.parse(result.value || "[]") as MarketplaceSource[]).map((source) => ({ ...source, builtIn: true }))
			const customSources = readCustomSources()
			const nextSources = [...builtIns, ...customSources]
			setSources(nextSources)
			if (nextSources.length > 0 && !nextSources.some((source) => source.id === activeSource)) {
				setActiveSource(nextSources[0].id)
			}
		} catch {
			/* */
		}
	}, [activeSource])

	const activeSourceInfo = sources.find((source) => source.id === activeSource)

	const loadMarketplace = useCallback(async (forceRefresh = false) => {
		if (!activeSourceInfo) {
			return
		}

		// Use cache for instant display, refresh in background
		if (!forceRefresh) {
			const cache = readMarketplaceCache()
			const cached = cache[activeSourceInfo.id]
			if (cached?.items?.length) {
				setMarketplace(cached.items)
				// Still refresh in background if cache is older than 5 minutes
				if (Date.now() - cached.ts < 5 * 60 * 1000) {
					return
				}
			}
		}

		setIsMarketLoading(true)
		setMarketError(undefined)
		try {
			const result = await StateServiceClient.listMarketplaceSkills(
				StringRequest.create({ value: getSourceRequestValue(activeSourceInfo) }),
			)
			const parsed = JSON.parse(result.value || "[]")
			let items: MarketplaceItem[]
			if (Array.isArray(parsed)) {
				items = parsed
			} else {
				items = Array.isArray(parsed.items) ? parsed.items : []
				setMarketError(typeof parsed.error === "string" ? parsed.error : undefined)
			}
			setMarketplace(items)
			// Update cache
			const cache = readMarketplaceCache()
			cache[activeSourceInfo.id] = { items, ts: Date.now() }
			writeMarketplaceCache(cache)
		} catch (err) {
			setMarketError(err instanceof Error ? err.message : String(err))
		} finally {
			setIsMarketLoading(false)
		}
	}, [activeSourceInfo])

	useEffect(() => {
		refresh()
		loadSources()
	}, [])
	useEffect(() => {
		loadMarketplace()
	}, [activeSource, loadMarketplace])

	const handleInstall = useCallback(
		async (item: MarketplaceItem) => {
			setIsInstalling(item.name)
			setMarketError(undefined)
			try {
				const result = await StateServiceClient.installSkill(
					StringRequest.create({ value: getInstallRequestValue(item.name, activeSourceInfo) }),
				)
				const parsed = JSON.parse(result.value || "{}")
				if (parsed.success) {
					setMarketplace((prev) =>
						prev.map((m) => (m.name === item.name ? { ...m, installed: true } : m)),
					)
					setMarketError(undefined)
					refresh()
					loadMarketplace(true)
				} else {
					setMarketError(parsed.error || `Failed to install ${item.name}`)
				}
			} catch (err) {
				setMarketError(err instanceof Error ? err.message : String(err))
			} finally {
				setIsInstalling(undefined)
			}
		},
		[refresh, loadMarketplace, activeSourceInfo],
	)

	const handleDelete = useCallback(
		async (skill: SkillInfo) => {
			setError(undefined)
			try {
				const result = await StateServiceClient.deleteSkill(
					StringRequest.create({ value: JSON.stringify({ skillName: skill.name, path: skill.path }) }),
				)
				const parsed = JSON.parse(result.value || "{}") as SkillMutationResult
				if (!parsed.success) {
					setError(parsed.error || `Failed to delete ${skill.name}`)
					return
				}

				const deletedName = parsed.name || skill.name
				setSkills((prev) => prev.filter((s) => s.path !== skill.path))
				setMarketplace((prev) =>
					prev.map((m) => (m.name === deletedName || m.name === skill.name ? { ...m, installed: false } : m)),
				)
				await loadMarketplace(true)
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err))
				console.error("Delete skill failed:", err)
			}
		},
		[loadMarketplace],
	)

	const handleDeleteSource = useCallback(() => {
		const source = activeSourceInfo
		if (!source || source.builtIn) return
		if (!confirm(`Delete source "${source.name}"?`)) return
		const customSources = readCustomSources().filter((item) => item.id !== source.id)
		writeCustomSources(customSources)
		const builtIns = sources.filter((item) => item.builtIn)
		const nextSources = [...builtIns, ...customSources]
		setSources(nextSources)
		setActiveSource(nextSources[0]?.id || "")
		setMarketplace([])
		setMarketError(undefined)
	}, [activeSourceInfo, sources])

	const handleAddSource = useCallback(() => {
		const name = newSourceName.trim()
		const url = newSourceUrl.trim()
		if (!name || !url) {
			setMarketError("Source name and URL are required")
			return
		}
		if (!isGitHubTreeUrl(url)) {
			setMarketError("Source URL must be a GitHub tree URL, e.g. https://github.com/owner/repo/tree/main/skills")
			return
		}

		const customSources = readCustomSources()
		const source: MarketplaceSource = { id: createCustomSourceId(), name, url }
		const nextCustomSources = [...customSources, source]
		writeCustomSources(nextCustomSources)
		const builtIns = sources.filter((item) => item.builtIn)
		setSources([...builtIns, ...nextCustomSources])
		setActiveSource(source.id)
		setNewSourceName("")
		setNewSourceUrl("")
		setIsAddingSource(false)
		setMarketError(undefined)
	}, [newSourceName, newSourceUrl, sources])

	return (
		<div>
			{renderSectionHeader("skills")}
			<Section>
				{/* Marketplace */}
				<div
					className="mb-4 p-3 rounded"
					style={{ border: "1px solid var(--vscode-widget-border)", background: "var(--vscode-sideBar-background)" }}>
					<div className="text-sm font-semibold mb-2 flex items-center gap-2">
						<Download className="w-4 h-4" />
						{t("skills.marketplace")}
					</div>
					<div className="flex items-center gap-2 mb-2">
						<label className="text-xs shrink-0">{t("skills.source")}:</label>
						<VSCodeDropdown
							className="flex-1"
							currentValue={activeSource}
							onChange={(e: any) => setActiveSource(e.target.currentValue)}>
							{sources.map((s) => (
								<VSCodeOption key={s.id} value={s.id}>
									{s.name}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
						<VSCodeButton appearance="secondary" disabled={isMarketLoading} onClick={() => loadMarketplace(true)}>
							<RefreshCw className="w-3.5 h-3.5" />
						</VSCodeButton>
						<VSCodeButton appearance="secondary" onClick={() => setIsAddingSource((value) => !value)}>
							{isAddingSource ? "Cancel" : "Add"}
						</VSCodeButton>
						{activeSourceInfo && !activeSourceInfo.builtIn && (
							<VSCodeButton appearance="icon" onClick={handleDeleteSource} title="Delete source">
								<Trash2 className="w-3.5 h-3.5" />
							</VSCodeButton>
						)}
					</div>
					{isAddingSource && (
						<div className="mb-3 p-2 rounded" style={{ border: "1px solid var(--vscode-widget-border)" }}>
							<div className="flex flex-col gap-2">
								<VSCodeTextField
									className="w-full"
									placeholder="Source name"
									value={newSourceName}
									onInput={(e: any) => setNewSourceName(e.target.value)}
								/>
								<VSCodeTextField
									className="w-full"
									placeholder="https://github.com/owner/repo/tree/main/skills"
									value={newSourceUrl}
									onInput={(e: any) => setNewSourceUrl(e.target.value)}
								/>
								<div>
									<VSCodeButton appearance="secondary" onClick={handleAddSource}>Add source</VSCodeButton>
								</div>
							</div>
						</div>
					)}
					<div className="max-h-64 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
						{marketError && (
							<div className="text-xs py-1" style={{ color: "var(--vscode-errorForeground)" }}>
								{marketError}
							</div>
						)}
						{isMarketLoading && (
							<div className="text-xs text-(--vscode-descriptionForeground) py-2">{t("skills.loading")}</div>
						)}
						{!isMarketLoading && marketplace.length === 0 && (
							<div className="text-xs text-(--vscode-descriptionForeground) py-2">
								{t("skills.marketplaceEmpty")}
							</div>
						)}
						{marketplace.map((item) => (
							<div
								className="flex items-center gap-2 py-1.5 px-2 rounded"
								key={item.name}
								style={{ borderBottom: "1px solid var(--vscode-widget-border)" }}>
								<div className="flex-1 min-w-0">
									<div className="text-xs font-medium">{item.name}</div>
									<div className="text-xs text-(--vscode-descriptionForeground) truncate">
										{item.description}
									</div>
								</div>
								{item.installed ? (
									<span className="text-xs text-(--vscode-descriptionForeground) px-1">
										{t("skills.installed")}
									</span>
								) : (
									<VSCodeButton
										appearance="secondary"
										disabled={isInstalling === item.name}
										onClick={() => handleInstall(item)}>
										{isInstalling === item.name ? "..." : t("skills.install")}
									</VSCodeButton>
								)}
							</div>
						))}
					</div>
				</div>

				{/* Installed skills */}
				<div className="flex items-center justify-between gap-2 mb-3">
					<div className="text-sm font-semibold">{t("skills.installedSkills")}</div>
					<VSCodeButton appearance="secondary" disabled={isLoading} onClick={refresh}>
						<RefreshCw className="w-4 h-4 mr-1" />
					</VSCodeButton>
				</div>

				{error && (
					<div className="text-xs py-1 mb-2" style={{ color: "var(--vscode-errorForeground)" }}>
						{error}
					</div>
				)}

				{skills.length === 0 && !isLoading && (
					<div className="text-xs text-(--vscode-descriptionForeground) py-4 text-center">{t("skills.empty")}</div>
				)}

				{skills.map((skill) => (
					<div
						className="flex items-center gap-3 px-3 py-2 rounded mb-2"
						key={skill.path}
						style={{ border: "1px solid var(--vscode-widget-border)" }}>
						<Brain className="w-4 h-4 shrink-0 text-(--vscode-descriptionForeground)" />
						<div className="flex-1 min-w-0">
							<div className="text-sm font-medium">{skill.name}</div>
							<div className="text-xs text-(--vscode-descriptionForeground) truncate">{skill.description}</div>
						</div>
						<VSCodeButton appearance="icon" onClick={() => handleDelete(skill)} title={`${t("skills.delete")}: ${skill.path}`}>
							<Trash2 className="w-3.5 h-3.5" />
						</VSCodeButton>
					</div>
				))}
			</Section>
		</div>
	)
}

export default SkillsSettingsSection
