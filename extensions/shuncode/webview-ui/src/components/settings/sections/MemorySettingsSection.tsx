import { EmptyRequest, StringRequest } from "@shared/proto/shuncode/common"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Brain, ExternalLink, Plus, RefreshCw, Trash2 } from "lucide-react"
import React, { useCallback, useEffect, useState } from "react"
import { useI18n } from "@/i18n"
import { FileServiceClient, StateServiceClient } from "@/services/grpc-client"
import Section from "../Section"

interface MemorySettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

interface MemoryItem {
	id: string
	name: string
	path: string
	scope: "global" | "project"
	content: string
	createdAt?: string
}

const MemorySettingsSection = ({ renderSectionHeader }: MemorySettingsSectionProps) => {
	const { t } = useI18n()
	const [items, setItems] = useState<MemoryItem[]>([])
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | undefined>()
	const [expandedId, setExpandedId] = useState<string | undefined>()
	const [deletingId, setDeletingId] = useState<string | undefined>()
	const [newName, setNewName] = useState("")
	const [newContent, setNewContent] = useState("")
	const [isAdding, setIsAdding] = useState(false)

	const refresh = useCallback(async () => {
		setIsLoading(true)
		setError(undefined)
		try {
			const result = await StateServiceClient.listMemoryItems(EmptyRequest.create({}))
			setItems(JSON.parse(result.value || "[]"))
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setIsLoading(false)
		}
	}, [])

	useEffect(() => {
		refresh()
	}, [refresh])

	const handleAdd = useCallback(async () => {
		const content = newContent.trim()
		if (!content) return

		setIsAdding(true)
		setError(undefined)
		try {
			const result = await StateServiceClient.addMemoryItem(
				StringRequest.create({ value: JSON.stringify({ name: newName.trim(), content }) }),
			)
			const parsed = JSON.parse(result.value || "{}")
			if (parsed.success) {
				setNewName("")
				setNewContent("")
				if (parsed.item) {
					setItems((prev) => [parsed.item, ...prev])
					setExpandedId(parsed.item.id)
				} else {
					await refresh()
				}
			} else {
				setError(parsed.error || t("memory.addFailed"))
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setIsAdding(false)
		}
	}, [newContent, newName, refresh, t])

	const handleOpen = useCallback(async (item: MemoryItem) => {
		try {
			await FileServiceClient.openFile(StringRequest.create({ value: item.path }))
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		}
	}, [])

	const handleDelete = useCallback(async (item: MemoryItem) => {
		setDeletingId(item.id)
		setError(undefined)
		try {
			const result = await StateServiceClient.deleteMemoryItem(StringRequest.create({ value: item.path }))
			const parsed = JSON.parse(result.value || "{}")
			if (!parsed.success) {
				setError(parsed.error || t("memory.deleteFailed"))
				return
			}
			setItems((prev) => prev.filter((i) => i.id !== item.id))
			if (expandedId === item.id) setExpandedId(undefined)
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
			console.error("Failed to delete memory item:", err)
		} finally {
			setDeletingId(undefined)
		}
	}, [expandedId, t])

	const renderItem = (item: MemoryItem) => {
		const isExpanded = expandedId === item.id
		const isDeleting = deletingId === item.id
		const preview = item.content.slice(0, 120).replace(/\n/g, " ")

		return (
			<div
				key={item.id}
				className="rounded mb-2"
				style={{ border: "1px solid var(--vscode-widget-border)" }}>
				<div
					className="flex items-center gap-2 px-3 py-2 cursor-pointer"
					onClick={() => setExpandedId(isExpanded ? undefined : item.id)}
					style={{ background: "var(--vscode-sideBar-background)" }}>
					<Brain className="w-4 h-4 shrink-0 text-(--vscode-descriptionForeground)" />
					<div className="flex-1 min-w-0">
						<div className="text-sm font-medium truncate">{item.name}</div>
						{!isExpanded && (
							<div className="text-xs text-(--vscode-descriptionForeground) truncate">
								{preview}{item.content.length > 120 ? "..." : ""}
							</div>
						)}
					</div>
					<div className="flex items-center gap-1 shrink-0">
						{item.createdAt && (
							<span className="text-xs text-(--vscode-descriptionForeground)">
								{new Date(item.createdAt).toLocaleDateString()}
							</span>
						)}
						<VSCodeButton
							appearance="icon"
							onClick={(e: React.MouseEvent) => {
								e.stopPropagation()
								handleOpen(item)
							}}
							title={t("memory.open") || "Open memory file"}>
							<ExternalLink className="w-3.5 h-3.5" />
						</VSCodeButton>
						<VSCodeButton
							appearance="icon"
							disabled={isDeleting}
							onClick={(e: React.MouseEvent) => {
								e.stopPropagation()
								handleDelete(item)
							}}
							title={t("memory.delete")}>
							<Trash2 className="w-3.5 h-3.5" />
						</VSCodeButton>
					</div>
				</div>
				{isExpanded && (
					<div className="px-3 py-2" style={{ background: "var(--vscode-editor-background)" }}>
						<div className="flex items-center gap-2 mb-2 text-xs text-(--vscode-descriptionForeground)">
							<span className="truncate" title={item.path}>{item.path}</span>
						</div>
						<pre
							className="text-xs whitespace-pre-wrap break-words p-2 rounded overflow-auto"
							style={{
								background: "var(--vscode-input-background)",
								border: "1px solid var(--vscode-input-border, var(--vscode-widget-border))",
								maxHeight: "300px",
								overscrollBehavior: "contain",
							}}>
							{item.content}
						</pre>
					</div>
				)}
			</div>
		)
	}

	return (
		<div>
			{renderSectionHeader("memory")}
			<Section>
				<div
					className="p-3 rounded-md mb-4"
					style={{ border: "1px solid var(--vscode-widget-border)", background: "var(--vscode-editor-background)" }}>
					<div className="text-sm font-semibold flex items-center gap-2 mb-2">
						<Plus className="w-4 h-4" />
						{t("memory.addTitle")}
					</div>
					<VSCodeTextField
						className="w-full mb-2"
						disabled={isAdding}
						onChange={(e: any) => setNewName(e.target.value)}
						placeholder={t("memory.namePlaceholder")}
						value={newName}
					/>
					<textarea
						className="w-full box-border rounded p-2 text-sm"
						disabled={isAdding}
						onChange={(e) => setNewContent(e.target.value)}
						placeholder={t("memory.contentPlaceholder")}
						rows={4}
						style={{
							background: "var(--vscode-input-background)",
							border: "1px solid var(--vscode-input-border, var(--vscode-widget-border))",
							color: "var(--vscode-input-foreground)",
							resize: "vertical",
						}}
						value={newContent}
					/>
					<div className="flex items-center justify-end gap-2 mt-2">
						<VSCodeButton disabled={isAdding || !newContent.trim()} onClick={handleAdd}>
							<Plus className="w-4 h-4 mr-1" />
							{isAdding ? t("memory.adding") : t("memory.add")}
						</VSCodeButton>
					</div>
				</div>

				<div className="flex items-center justify-between gap-2 mb-3">
					<div>
						<p className="text-xs mt-0 mb-0 text-(--vscode-descriptionForeground)">
							{t("memory.description")}
						</p>
					</div>
					<VSCodeButton appearance="secondary" disabled={isLoading} onClick={refresh}>
						<span className="inline-flex items-center" slot="start">
							<RefreshCw className="w-4 h-4" />
						</span>
						{isLoading ? t("memory.loading") : t("memory.refresh")}
					</VSCodeButton>
				</div>

				{error && (
					<div className="mb-3 p-2 rounded text-xs" style={{ background: "var(--vscode-inputValidation-errorBackground)" }}>
						{error}
					</div>
				)}

				{items.length === 0 && !isLoading && !error && (
					<div className="text-xs text-(--vscode-descriptionForeground) py-4 text-center">
						{t("memory.empty")}
					</div>
				)}

				{items.length > 0 && (
					<div className="mb-3">
						{items.map(renderItem)}
					</div>
				)}
			</Section>
		</div>
	)
}

export default MemorySettingsSection
