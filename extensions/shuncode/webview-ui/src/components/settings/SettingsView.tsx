import type { ExtensionMessage } from "@shared/ExtensionMessage"
import { ResetStateRequest } from "@shared/proto/shuncode/state"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import {
	Brain,
	FlaskConical,
	Hammer,
	Layers,
	type LucideIcon,
	Mic,
	Pencil,
	Puzzle,
	Search,
	ShieldCheck,
	SlidersHorizontal,
	ScrollText,
	SquareMousePointer,
	SquareTerminal,
	Wrench,
} from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useEvent } from "react-use"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { StateServiceClient } from "@/services/grpc-client"
import { getEnvironmentColor } from "@/utils/environmentColors"
import { Tab, TabContent, TabHeader, TabList, TabTrigger } from "../common/Tab"
import SectionHeader from "./SectionHeader"
import BrowserSettingsSection from "./sections/BrowserSettingsSection"
import ContextSection from "./sections/ContextSection"
import DebugSection from "./sections/DebugSection"
import EditingSection from "./sections/EditingSection"
import ExperimentsSection from "./sections/ExperimentsSection"
import GeneralSettingsSection from "./sections/GeneralSettingsSection"
import FastContextSection from "./sections/FastContextSection"
import McpSection from "./sections/McpSection"
import MemorySettingsSection from "./sections/MemorySettingsSection"
import MultiProviderSection from "./sections/MultiProviderSection"
import PermissionsSection from "./sections/PermissionsSection"
import SkillsSettingsSection from "./sections/SkillsSettingsSection"
import SystemPromptSettingsSection from "./sections/SystemPromptSettingsSection"
import TerminalSettingsSection from "./sections/TerminalSettingsSection"
import ToolsSettingsSection from "./sections/ToolsSettingsSection"
import VoiceSection from "./sections/VoiceSection"

const _IS_DEV = process.env.IS_DEV

// Tab definitions
interface SettingsTab {
	id: string
	nameKey: string
	tooltipKey: string
	headerKey: string
	icon: LucideIcon
	hidden?: boolean | (() => boolean)
}

export const SETTINGS_TABS: SettingsTab[] = [
	{
		id: "providers",
		nameKey: "settings.tabs.providers.name",
		tooltipKey: "settings.tabs.providers.tooltip",
		headerKey: "settings.tabs.providers.header",
		icon: SlidersHorizontal,
	},
	{
		id: "multiProvider",
		nameKey: "settings.tabs.multiProvider.name",
		tooltipKey: "settings.tabs.multiProvider.tooltip",
		headerKey: "settings.tabs.multiProvider.header",
		icon: SlidersHorizontal,
		hidden: true,
	},
	{
		id: "general",
		nameKey: "settings.tabs.general.name",
		tooltipKey: "settings.tabs.general.tooltip",
		headerKey: "settings.tabs.general.header",
		icon: Wrench,
	},
	{
		id: "permissions",
		nameKey: "settings.tabs.permissions.name",
		tooltipKey: "settings.tabs.permissions.tooltip",
		headerKey: "settings.tabs.permissions.header",
		icon: ShieldCheck,
	},
	{
		id: "editing",
		nameKey: "settings.tabs.editing.name",
		tooltipKey: "settings.tabs.editing.tooltip",
		headerKey: "settings.tabs.editing.header",
		icon: Pencil,
	},
	{
		id: "context",
		nameKey: "settings.tabs.context.name",
		tooltipKey: "settings.tabs.context.tooltip",
		headerKey: "settings.tabs.context.header",
		icon: Layers,
	},
	{
		id: "terminal",
		nameKey: "settings.tabs.terminal.name",
		tooltipKey: "settings.tabs.terminal.tooltip",
		headerKey: "settings.tabs.terminal.header",
		icon: SquareTerminal,
	},
	{
		id: "browser",
		nameKey: "settings.tabs.browser.name",
		tooltipKey: "settings.tabs.browser.tooltip",
		headerKey: "settings.tabs.browser.header",
		icon: SquareMousePointer,
	},
	{
		id: "voice",
		nameKey: "settings.tabs.voice.name",
		tooltipKey: "settings.tabs.voice.tooltip",
		headerKey: "settings.tabs.voice.header",
		icon: Mic,
	},
	{
		id: "fastContext",
		nameKey: "settings.tabs.fastContext.name",
		tooltipKey: "settings.tabs.fastContext.tooltip",
		headerKey: "settings.tabs.fastContext.header",
		icon: Search,
	},
	{
		id: "mcp",
		nameKey: "settings.tabs.mcp.name",
		tooltipKey: "settings.tabs.mcp.tooltip",
		headerKey: "settings.tabs.mcp.header",
		icon: Puzzle,
	},
	{
		id: "tools",
		nameKey: "settings.tabs.tools.name",
		tooltipKey: "settings.tabs.tools.tooltip",
		headerKey: "settings.tabs.tools.header",
		icon: Hammer,
	},
	{
		id: "memory",
		nameKey: "settings.tabs.memory.name",
		tooltipKey: "settings.tabs.memory.tooltip",
		headerKey: "settings.tabs.memory.header",
		icon: Brain,
	},
	{
		id: "skills",
		nameKey: "settings.tabs.skills.name",
		tooltipKey: "settings.tabs.skills.tooltip",
		headerKey: "settings.tabs.skills.header",
		icon: Puzzle,
	},
	{
		id: "systemPrompt",
		nameKey: "settings.tabs.systemPrompt.name",
		tooltipKey: "settings.tabs.systemPrompt.tooltip",
		headerKey: "settings.tabs.systemPrompt.header",
		icon: ScrollText,
	},
	{
		id: "experiments",
		nameKey: "settings.tabs.experiments.name",
		tooltipKey: "settings.tabs.experiments.tooltip",
		headerKey: "settings.tabs.experiments.header",
		icon: FlaskConical,
	},
	// Debug tab — only visible in debug mode
	{
		id: "debug",
		nameKey: "settings.tabs.debug.name",
		tooltipKey: "settings.tabs.debug.tooltip",
		headerKey: "settings.tabs.debug.header",
		icon: FlaskConical,
		hidden: true, // Controlled dynamically based on mode
	},
]

type SettingsViewProps = {
	onDone: () => void
	targetSection?: string
}

const SettingsView = ({ onDone, targetSection }: SettingsViewProps) => {
	const { t } = useI18n()
	// Memoize to avoid recreation
	const TAB_CONTENT_MAP = useMemo(
		() => ({
			providers: MultiProviderSection,
			multiProvider: MultiProviderSection,
			permissions: PermissionsSection,
			editing: EditingSection,
			context: ContextSection,
			general: GeneralSettingsSection,
			browser: BrowserSettingsSection,
			terminal: TerminalSettingsSection,
			voice: VoiceSection,
			fastContext: FastContextSection,
			mcp: McpSection,
			tools: ToolsSettingsSection,
			memory: MemorySettingsSection,
			skills: SkillsSettingsSection,
			systemPrompt: SystemPromptSettingsSection,
			experiments: ExperimentsSection,
			debug: DebugSection,
		}),
		[],
	) // Empty deps - these imports never change

	const { version, environment, mode } = useExtensionState()

	// Determine visible tabs based on mode
	const visibleTabs = useMemo(() => {
		return SETTINGS_TABS.filter((tab) => {
			if (tab.id === "debug") {
				return mode === "debug"
			}
			if (typeof tab.hidden === "function") {
				return !tab.hidden()
			}
			return !tab.hidden
		})
	}, [mode])

	const renderSectionHeader = useCallback(
		(tabId: string) => {
			const tab = SETTINGS_TABS.find((item) => item.id === tabId)
			if (!tab) {
				return null
			}

			return (
				<SectionHeader>
					<div className="flex items-center gap-2">
						<tab.icon className="w-4" />
						<div>{t(tab.headerKey)}</div>
					</div>
				</SectionHeader>
			)
		},
		[t],
	)

	const [activeTab, setActiveTab] = useState<string>(() => {
		// Map old tab IDs to new ones for backward compatibility
		if (targetSection === "api-config") return "providers"
		if (targetSection === "multiProvider") return "providers"
		if (targetSection === "features") return "permissions"
		if (targetSection === "about") return "general"
		return targetSection || SETTINGS_TABS[0].id
	})

	// Compact mode
	const containerRef = useRef<HTMLDivElement>(null)
	const [isCompact, setIsCompact] = useState(false)

	useLayoutEffect(() => {
		const el = containerRef.current
		if (!el) return
		const ro = new ResizeObserver(([entry]) => {
			setIsCompact(entry.contentRect.width < 500)
		})
		ro.observe(el)
		return () => ro.disconnect()
	}, [])

	// Scroll position preservation
	const scrollPositions = useRef<Record<string, number>>({})
	const contentRef = useRef<HTMLDivElement>(null)

	const handleTabChange = useCallback(
		(newTab: string) => {
			// Save current scroll position
			if (contentRef.current) {
				scrollPositions.current[activeTab] = contentRef.current.scrollTop
			}
			setActiveTab(newTab)
			// Restore scroll position for new tab
			requestAnimationFrame(() => {
				if (contentRef.current) {
					contentRef.current.scrollTop = scrollPositions.current[newTab] || 0
				}
			})
		},
		[activeTab],
	)

	// Optimized message handler with early returns
	const handleMessage = useCallback(
		(event: MessageEvent) => {
			const message: ExtensionMessage = event.data
			if (message.type !== "grpc_response") {
				return
			}

			const grpcMessage = message.grpc_response?.message
			if (grpcMessage?.key !== "scrollToSettings") {
				return
			}

			const tabId = grpcMessage.value
			if (!tabId) {
				return
			}

			// Map old IDs
			let mappedTabId = tabId
			if (tabId === "api-config" || tabId === "multiProvider") mappedTabId = "providers"
			if (tabId === "features") mappedTabId = "permissions"
			if (tabId === "about") mappedTabId = "general"

			// Check if valid tab ID
			if (SETTINGS_TABS.some((tab) => tab.id === mappedTabId)) {
				handleTabChange(mappedTabId)
				return
			}

			// Fallback to element scrolling
			requestAnimationFrame(() => {
				const element = document.getElementById(tabId)
				if (!element) {
					return
				}

				element.scrollIntoView({ behavior: "smooth" })
				element.style.transition = "background-color 0.5s ease"
				element.style.backgroundColor = "var(--vscode-textPreformat-background)"

				setTimeout(() => {
					element.style.backgroundColor = "transparent"
				}, 1200)
			})
		},
		[handleTabChange],
	)

	useEvent("message", handleMessage)

	// Memoized reset state handler
	const handleResetState = useCallback(async (resetGlobalState?: boolean) => {
		try {
			await StateServiceClient.resetState(ResetStateRequest.create({ global: resetGlobalState }))
		} catch (error) {
			console.error("Failed to reset state:", error)
		}
	}, [])

	// Update active tab when targetSection changes
	useEffect(() => {
		if (targetSection) {
			let mapped = targetSection
			if (targetSection === "api-config" || targetSection === "multiProvider") mapped = "providers"
			if (targetSection === "features") mapped = "permissions"
			if (targetSection === "about") mapped = "general"
			setActiveTab(mapped)
		}
	}, [targetSection])

	// Memoized tab item renderer
	const renderTabItem = useCallback(
		(tab: (typeof SETTINGS_TABS)[0]) => {
			return (
				<TabTrigger className="flex justify-baseline" data-testid={`tab-${tab.id}`} key={tab.id} value={tab.id}>
					<Tooltip key={tab.id}>
						<TooltipTrigger>
							<div
								className={cn(
									"whitespace-nowrap overflow-hidden h-12 sm:py-3 box-border flex items-center border-l-2 border-transparent text-foreground opacity-70 bg-transparent hover:bg-list-hover p-4 cursor-pointer gap-2",
									{
										"opacity-100 border-l-2 border-l-focus-border border-t-0 border-r-0 border-b-0 bg-list-activeSelection-background hover:bg-list-activeSelection-background cursor-default":
											activeTab === tab.id,
									},
								)}>
								<tab.icon className="w-4 h-4" />
								{!isCompact && <span className="hidden sm:block">{t(tab.nameKey)}</span>}
							</div>
						</TooltipTrigger>
						<TooltipContent side="right">{t(tab.tooltipKey)}</TooltipContent>
					</Tooltip>
				</TabTrigger>
			)
		},
		[activeTab, t, isCompact],
	)

	// Memoized active content component
	const ActiveContent = useMemo(() => {
		const Component = TAB_CONTENT_MAP[activeTab as keyof typeof TAB_CONTENT_MAP]
		if (!Component) {
			return null
		}

		// Special props for specific components
		const props: any = { renderSectionHeader }
		if (activeTab === "debug") {
			props.onResetState = handleResetState
		}

		return <Component {...props} />
	}, [activeTab, handleResetState, renderSectionHeader, TAB_CONTENT_MAP])

	const titleColor = getEnvironmentColor(environment)

	return (
		<Tab ref={containerRef}>
			<TabHeader className="flex justify-between items-center gap-2">
				<div className="flex items-center gap-1">
					<h3 className="text-md m-0" style={{ color: titleColor }}>
						{t("settings.title")}
					</h3>
				</div>
				<div className="flex gap-2">
					<VSCodeButton onClick={onDone}>{t("settings.done")}</VSCodeButton>
				</div>
			</TabHeader>

			<div className="flex flex-1 overflow-hidden">
				<TabList
					className="shrink-0 flex flex-col overflow-y-auto border-r border-sidebar-background"
					onValueChange={handleTabChange}
					value={activeTab}>
					{visibleTabs.map(renderTabItem)}
				</TabList>

				<TabContent className="flex-1 overflow-auto" ref={contentRef}>
					{ActiveContent}
				</TabContent>
			</div>
		</Tab>
	)
}

export default SettingsView
