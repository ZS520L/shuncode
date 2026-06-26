import { HistoryIcon, PlusIcon, SettingsIcon, XIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SessionServiceClient } from "@/services/grpc-client"
import { SessionTabInfo } from "@/../../src/shared/ExtensionMessage"
import { useExtensionState } from "../../context/ExtensionStateContext"

// Custom MCP Server Icon component using VSCode codicon
const McpServerIcon = ({ className, size }: { className?: string; size?: number }) => (
	<span
		className={`codicon codicon-server flex items-center ${className || ""}`}
		style={{ fontSize: size ? `${size}px` : "12.5px", marginBottom: "1px" }}
	/>
)

export const Navbar = () => {
	const { navigateToHistory, navigateToSettings, navigateToMcp, sessionTabs, currentSessionId } = useExtensionState()
	const tabsRef = useRef<HTMLDivElement>(null)

	// Auto-scroll tabs to show newest (rightmost) tab
	useEffect(() => {
		if (tabsRef.current) {
			tabsRef.current.scrollLeft = tabsRef.current.scrollWidth
		}
	}, [sessionTabs?.length])

	const handleSwitchTab = useCallback((sessionId: string) => {
		if (sessionId === currentSessionId) return
		SessionServiceClient.switchSession({ value: sessionId }).catch(console.error)
	}, [currentSessionId])

	const handleCloseTab = useCallback((e: React.MouseEvent, sessionId: string) => {
		e.stopPropagation()
		SessionServiceClient.closeSession({ value: sessionId }).catch(console.error)
	}, [])

	const handleNewTab = useCallback(() => {
		SessionServiceClient.createSession({ metadata: {} }).catch(console.error)
	}, [])

	const ACTION_BUTTONS = useMemo(
		() => [
			{
				id: "mcp",
				tooltip: "MCP Servers",
				icon: McpServerIcon,
				navigate: navigateToMcp,
			},
			{
				id: "history",
				tooltip: "History",
				icon: HistoryIcon,
				navigate: navigateToHistory,
			},
			{
				id: "settings",
				tooltip: "Settings",
				icon: SettingsIcon,
				navigate: navigateToSettings,
			},
		],
		[navigateToHistory, navigateToMcp, navigateToSettings],
	)

	const hasTabs = sessionTabs && sessionTabs.length > 0

	return (
		<nav
			className="flex-none flex items-center bg-transparent z-10 border-b border-(--vscode-panel-border) min-h-[36px]"
			id="shuncode-navbar-container">

			{/* Session tabs (left side, scrollable) */}
			{hasTabs && (
				<div ref={tabsRef} className="flex items-center gap-0.5 overflow-x-auto flex-1 min-w-0 px-1">
					{sessionTabs.map((tab: SessionTabInfo) => {
						const isActive = tab.id === currentSessionId
						return (
							<div
								key={tab.id}
								onClick={() => handleSwitchTab(tab.id)}
								className={`
									flex items-center gap-1 px-2.5 py-1 rounded-sm cursor-pointer
									text-xs max-w-[160px] min-w-[70px] group relative shrink-0
									transition-colors duration-100
									${isActive
										? "bg-(--vscode-tab-activeBackground) text-(--vscode-tab-activeForeground)"
										: "text-(--vscode-tab-inactiveForeground) hover:bg-(--vscode-tab-hoverBackground)"
									}
								`}
								title={tab.title}
							>
								{/* State indicator dot */}
								{tab.state === "running" && (
									<span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0 animate-pulse" />
								)}
								{tab.state === "paused" && (
									<span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />
								)}

								{/* Title */}
								<span className="truncate flex-1 select-none">
									{tab.title}
								</span>

								{/* Close button */}
								<button
									onClick={(e) => handleCloseTab(e, tab.id)}
									className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded-sm hover:bg-(--vscode-toolbar-hoverBackground) transition-opacity"
									aria-label="Close tab"
								>
									<XIcon size={12} />
								</button>
							</div>
						)
					})}

					{/* New tab + button */}
					<button
						onClick={handleNewTab}
						className="shrink-0 p-1 rounded-sm text-(--vscode-tab-inactiveForeground) hover:bg-(--vscode-tab-hoverBackground) hover:text-(--vscode-tab-activeForeground) transition-colors"
						aria-label="New conversation"
						title="New conversation"
					>
						<PlusIcon size={14} />
					</button>
				</div>
			)}

			{/* Spacer when no tabs */}
			{!hasTabs && <div className="flex-1" />}

			{/* Right side action icons */}
			<div className="flex items-center gap-1 shrink-0 px-2">
				{ACTION_BUTTONS.map((btn) => (
					<Tooltip key={`navbar-tooltip-${btn.id}`}>
						<TooltipContent side="bottom">{btn.tooltip}</TooltipContent>
						<TooltipTrigger asChild>
							<Button
								aria-label={btn.tooltip}
								className="p-0 h-7"
								data-testid={`tab-${btn.id}`}
								onClick={() => btn.navigate()}
								size="icon"
								variant="icon">
								<btn.icon className="stroke-1 [svg]:size-4" size={16} />
							</Button>
						</TooltipTrigger>
					</Tooltip>
				))}
			</div>
		</nav>
	)
}
