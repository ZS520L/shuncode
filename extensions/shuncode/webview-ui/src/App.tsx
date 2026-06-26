import type { Boolean, EmptyRequest } from "@shared/proto/shuncode/common"
import { useEffect } from "react"
import AccountView from "./components/account/AccountView"
import ChatView from "./components/chat/ChatView"
import { ChatErrorBoundary } from "./components/chat/ChatErrorBoundary"
import HistoryView from "./components/history/HistoryView"
import McpView from "./components/mcp/configuration/McpConfigurationView"
import SettingsView from "./components/settings/SettingsView"
import WorktreesView from "./components/worktrees/WorktreesView"
import { useExtensionState } from "./context/ExtensionStateContext"
import { useShuncodeAuth } from "./context/ShuncodeAuthContext"
import { Providers } from "./Providers"
import { SessionServiceClient, UiServiceClient } from "./services/grpc-client"

const AppContent = () => {
	const {
		didHydrateState,
		shouldShowAnnouncement,
		showMcp,
		mcpTab,
		showSettings,
		settingsTargetSection,
		showHistory,
		showAccount,
		showWorktrees,
		showAnnouncement,
		setShowAnnouncement,
		setShouldShowAnnouncement,
		closeMcpView,
		navigateToHistory,
		hideSettings,
		hideHistory,
		hideAccount,
		hideWorktrees,
		hideAnnouncement,
	} = useExtensionState()

	const { shuncodeUser, organizations, activeOrganization } = useShuncodeAuth()

	useEffect(() => {
		if (shouldShowAnnouncement) {
			setShowAnnouncement(true)

			// Use the gRPC client instead of direct WebviewMessage
			UiServiceClient.onDidShowAnnouncement({} as EmptyRequest)
				.then((response: Boolean) => {
					setShouldShowAnnouncement(response.value)
				})
				.catch((error) => {
					console.error("Failed to acknowledge announcement:", error)
				})
		}
	}, [shouldShowAnnouncement, setShouldShowAnnouncement, setShowAnnouncement])

	// Handle native title bar session tab actions from workbench WebviewViewPane
	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const msg = event.data
			if (!msg || !msg.type) return
			switch (msg.type) {
				case "sessionTabClicked":
					if (msg.sessionId) {
						SessionServiceClient.switchSession({ value: msg.sessionId }).catch(console.error)
					}
					break
				case "sessionTabClosed":
					if (msg.sessionId) {
						SessionServiceClient.closeSession({ value: msg.sessionId }).catch(console.error)
					}
					break
				case "sessionTabNew":
					SessionServiceClient.createSession({ metadata: {} }).catch(console.error)
					break
			}
		}
		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [])

	if (!didHydrateState) {
		return null
	}

	return (
		<ChatErrorBoundary errorTitle="ShunCode crashed" height="100vh">
			<div className="flex h-screen w-full flex-col">
				{showSettings && <SettingsView onDone={hideSettings} targetSection={settingsTargetSection} />}
				{showHistory && <HistoryView onDone={hideHistory} />}
				{showMcp && <McpView initialTab={mcpTab} onDone={closeMcpView} />}
				{showAccount && (
					<AccountView
						activeOrganization={activeOrganization}
						onDone={hideAccount}
						organizations={organizations}
						shuncodeUser={shuncodeUser}
					/>
				)}
				{showWorktrees && <WorktreesView onDone={hideWorktrees} />}
				{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
				<ChatView
					hideAnnouncement={hideAnnouncement}
					isHidden={showSettings || showHistory || showMcp || showAccount || showWorktrees}
					showAnnouncement={showAnnouncement}
					showHistoryView={navigateToHistory}
				/>
			</div>
		</ChatErrorBoundary>
	)
}

const App = () => {
	return (
		<Providers>
			<AppContent />
		</Providers>
	)
}

export default App
