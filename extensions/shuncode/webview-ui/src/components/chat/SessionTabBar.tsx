import { PlusIcon, XIcon } from "lucide-react"
import { useCallback, useEffect, useRef } from "react"
import { SessionTabInfo } from "@/../../src/shared/ExtensionMessage"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { SessionServiceClient } from "@/services/grpc-client"

/**
 * SessionTabBar - Multi-tab conversation bar.
 * Shows all active sessions as tabs. Supports switching, closing, and creating new sessions.
 * Only renders when there are 2+ sessions (single session = no tab bar needed).
 */
export const SessionTabBar = () => {
	const { sessionTabs, currentSessionId } = useExtensionState()
	const scrollRef = useRef<HTMLDivElement>(null)

	// Auto-scroll to show the active tab (usually the rightmost/newest one)
	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
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
		// Create a new session tab — backend suspends current task, creates + switches to new empty session
		SessionServiceClient.createSession({ metadata: {} }).catch(console.error)
	}, [])

	if (!sessionTabs || sessionTabs.length === 0) {
		return null
	}

	return (
		<div ref={scrollRef} className="flex items-center gap-0.5 px-1 py-0.5 border-b border-(--vscode-panel-border) bg-(--vscode-sideBar-background) overflow-x-auto min-h-[32px]">
			{sessionTabs.map((tab: SessionTabInfo) => {
				const isActive = tab.id === currentSessionId
				return (
					<div
						key={tab.id}
						onClick={() => handleSwitchTab(tab.id)}
						className={`
							flex items-center gap-1 px-2.5 py-1 rounded-sm cursor-pointer
							text-xs max-w-[160px] min-w-[80px] group relative
							transition-colors duration-100
							${isActive
								? "bg-(--vscode-tab-activeBackground) text-(--vscode-tab-activeForeground) border border-(--vscode-tab-activeBorder)"
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

			{/* New tab button */}
			<button
				onClick={handleNewTab}
				className="shrink-0 p-1 rounded-sm text-(--vscode-tab-inactiveForeground) hover:bg-(--vscode-tab-hoverBackground) hover:text-(--vscode-tab-activeForeground) transition-colors"
				aria-label="New conversation"
				title="New conversation"
			>
				<PlusIcon size={14} />
			</button>
		</div>
	)
}

