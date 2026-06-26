import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { FileServiceClient, UiServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_TITLEBAR_INACTIVE_FOREGROUND } from "@/utils/vscStyles"
import * as PopoverPrimitive from "@radix-ui/react-popover"

interface PendingChangesBarProps {
	style?: React.CSSProperties
}

const PendingChangesBar = ({ style }: PendingChangesBarProps) => {
	const { pendingChanges } = useExtensionState()
	const { t } = useI18n()
	const [isExpanded, setIsExpanded] = useState(false)
	const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false)

	// Don't render if no pending changes
	if (!pendingChanges || pendingChanges.length === 0) {
		return null
	}

	const totalAdded = pendingChanges.reduce((sum, c) => sum + c.addedCount, 0)
	const totalRemoved = pendingChanges.reduce((sum, c) => sum + c.removedCount, 0)

	const borderColor = `color-mix(in srgb, ${getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND)} 20%, transparent)`
	const borderGradient = `linear-gradient(to bottom, ${borderColor} 0%, transparent 50%)`
	const bgGradient = `linear-gradient(to bottom, color-mix(in srgb, var(--vscode-sideBar-background) 96%, white) 0%, transparent 80%)`

	const handleOpenFile = async (fsPath: string) => {
		try {
			await FileServiceClient.openFile({ value: fsPath })
		} catch (error) {
			console.error("Failed to open file:", error)
		}
	}

	const handleAcceptAll = async () => {
		try {
			await UiServiceClient.acceptAllPendingChanges({})
		} catch (error) {
			console.error("Failed to accept all:", error)
		}
	}

	const handleRejectAll = async () => {
		try {
			await UiServiceClient.rejectAllPendingChanges({})
		} catch (error) {
			console.error("Failed to reject all:", error)
		}
	}

	return (
		<div
			className="mx-3.5 select-none break-words relative"
			style={{
				borderTop: `0.5px solid ${borderColor}`,
				borderRadius: "4px 4px 0 0",
				background: bgGradient,
				...style,
			}}>
			{/* Left border gradient */}
			<div
				className="absolute left-0 pointer-events-none"
				style={{
					width: 0.5,
					top: 3,
					height: "100%",
					background: borderGradient,
				}}
			/>
			{/* Right border gradient */}
			<div
				className="absolute right-0 top-0 pointer-events-none"
				style={{
					width: 0.5,
					top: 3,
					height: "100%",
					background: borderGradient,
				}}
			/>

			{/* Header - always visible */}
			<div className="pt-2 pb-2 px-3.5 flex items-center justify-between gap-2">
				{/* Left side - expandable info */}
				<div
					aria-label={isExpanded ? t("pending.collapse") : t("pending.expand")}
					className="flex flex-nowrap items-center gap-2 min-w-0 flex-1 cursor-pointer"
					onClick={() => setIsExpanded((prev) => !prev)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault()
							e.stopPropagation()
							setIsExpanded((prev) => !prev)
						}
					}}
					tabIndex={0}>
					{isExpanded ? (
						<span className="codicon codicon-chevron-down text-xs" />
					) : (
						<span className="codicon codicon-chevron-right text-xs" />
					)}
					<span className="text-muted-foreground text-sm">
						{pendingChanges.length} {pendingChanges.length === 1 ? t("pending.file.one") : t("pending.file.many")}
					</span>
					<span className="text-green-500 text-xs">+{totalAdded}</span>
					<span className="text-red-500 text-xs">-{totalRemoved}</span>
				</div>

				{/* Right side - nav + action buttons always visible */}
				<div className="flex items-center gap-1">
					<button
						className="p-0.5 rounded hover:bg-[var(--vscode-list-hoverBackground)] text-muted-foreground"
						onClick={(e) => {
							e.stopPropagation()
							UiServiceClient.navigatePrevHunk({}).catch(() => {})
						}}
						title={t("pending.previousHunk")}>
						<ChevronLeftIcon className="size-4" />
					</button>
					<button
						className="p-0.5 rounded hover:bg-[var(--vscode-list-hoverBackground)] text-muted-foreground"
						onClick={(e) => {
							e.stopPropagation()
							UiServiceClient.navigateNextHunk({}).catch(() => {})
						}}
						title={t("pending.nextHunk")}>
						<ChevronRightIcon className="size-4" />
					</button>
			<PopoverPrimitive.Root open={rejectConfirmOpen} onOpenChange={setRejectConfirmOpen}>
				<PopoverPrimitive.Trigger asChild>
					<button
						className="px-2 py-0.5 text-xs text-[var(--vscode-textLink-foreground)] hover:underline"
						onClick={(e) => e.stopPropagation()}>
						{t("pending.rejectAll")}
					</button>
				</PopoverPrimitive.Trigger>
				<PopoverPrimitive.Portal>
					<PopoverPrimitive.Content
						side="top"
						align="end"
						sideOffset={4}
						onClick={(e) => e.stopPropagation()}
						style={{
							padding: "10px",
							width: "fit-content",
							minWidth: 0,
							borderRadius: "4px",
							backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-menu-background, #1e1e1e))",
							color: "var(--vscode-editorWidget-foreground, var(--vscode-menu-foreground, #cccccc))",
							border: "1px solid var(--vscode-editorWidget-border, var(--vscode-menu-border, #454545))",
							boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
							zIndex: 9999,
						}}>
						<div className="text-xs mb-2 whitespace-nowrap">{t("pending.rejectAll.confirm")}</div>
						<div className="flex justify-end gap-1.5">
							<button
								className="px-2 py-0.5 text-xs rounded"
								style={{ color: "var(--vscode-descriptionForeground, #999)" }}
								onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--vscode-list-hoverBackground, rgba(255,255,255,0.1))")}
								onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
								onClick={() => setRejectConfirmOpen(false)}>
								{t("pending.rejectAll.no")}
							</button>
							<button
								className="px-2 py-0.5 text-xs rounded"
								style={{ backgroundColor: "var(--vscode-errorForeground, #f14c4c)", color: "#fff" }}
								onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
								onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
								onClick={() => {
									setRejectConfirmOpen(false)
									handleRejectAll()
								}}>
								{t("pending.rejectAll.yes")}
							</button>
						</div>
					</PopoverPrimitive.Content>
				</PopoverPrimitive.Portal>
			</PopoverPrimitive.Root>
					<button
						className="px-2 py-0.5 text-xs text-[var(--vscode-textLink-foreground)] hover:underline"
						onClick={(e) => {
							e.stopPropagation()
							handleAcceptAll()
						}}>
						{t("pending.acceptAll")}
					</button>
				</div>
			</div>

			{/* Expanded content - file list */}
			{isExpanded && (
				<div className="px-3.5 pb-2">
					<div className="space-y-0.5">
						{pendingChanges.map((change) => (
							<div
								className="flex items-center justify-between gap-2 py-1 px-2 rounded hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer"
								key={change.id}
								onClick={() => handleOpenFile(change.fsPath)}>
								<span className="truncate text-sm">{change.fileName}</span>
								<div className="flex items-center gap-1 text-xs">
									{change.addedCount > 0 && <span className="text-green-500">+{change.addedCount}</span>}
									{change.removedCount > 0 && <span className="text-red-500">-{change.removedCount}</span>}
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	)
}

export default PendingChangesBar
