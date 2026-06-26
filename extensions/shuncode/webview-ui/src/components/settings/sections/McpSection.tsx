import type { McpViewTab } from "@shared/mcp"
import { EmptyRequest } from "@shared/proto/shuncode/common"
import { McpServers } from "@shared/proto/shuncode/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { useEffect, useState } from "react"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { McpServiceClient } from "@/services/grpc-client"
import AddRemoteServerForm from "../../mcp/configuration/tabs/add-server/AddRemoteServerForm"
import ConfigureServersView from "../../mcp/configuration/tabs/installed/ConfigureServersView"
import McpMarketplaceView from "../../mcp/configuration/tabs/marketplace/McpMarketplaceView"

interface McpSectionProps {
	renderSectionHeader: (tabId: string) => React.ReactNode
}

const McpSection = ({ renderSectionHeader }: McpSectionProps) => {
	const { t } = useI18n()
	const { remoteConfigSettings, setMcpServers, setMcpMarketplaceCatalog } = useExtensionState()

	const showMarketplace = remoteConfigSettings?.mcpMarketplaceEnabled !== false
	const showRemoteServers = remoteConfigSettings?.blockPersonalRemoteMCPServers !== true

	const [activeTab, setActiveTab] = useState<McpViewTab>(showMarketplace ? "marketplace" : "configure")

	// Refresh data when section mounts
	useEffect(() => {
		if (showMarketplace) {
			McpServiceClient.refreshMcpMarketplace(EmptyRequest.create({}))
				.then((response) => {
					setMcpMarketplaceCatalog(response)
				})
				.catch((error) => {
					console.error("Error refreshing MCP marketplace:", error)
				})
		}

		McpServiceClient.getLatestMcpServers(EmptyRequest.create({}))
			.then((response: McpServers) => {
				if (response.mcpServers) {
					const mcpServers = convertProtoMcpServersToMcpServers(response.mcpServers)
					setMcpServers(mcpServers)
				}
			})
			.catch((error) => {
				console.error("Failed to fetch MCP servers:", error)
			})
	}, [showMarketplace])

	useEffect(() => {
		if (!showMarketplace && activeTab === "marketplace") {
			setActiveTab("configure")
		}
		if (!showRemoteServers && activeTab === "addRemote") {
			setActiveTab("configure")
		}
	}, [showMarketplace, showRemoteServers, activeTab])

	return (
		<div className="flex flex-col">
			{renderSectionHeader("mcp")}

			{/* Sub-tabs */}
			<TabBar>
				{showMarketplace && (
					<SubTab $active={activeTab === "marketplace"} onClick={() => setActiveTab("marketplace")}>
						{t("mcp.marketplace")}
					</SubTab>
				)}
				{showRemoteServers && (
					<SubTab $active={activeTab === "addRemote"} onClick={() => setActiveTab("addRemote")}>
						{t("mcp.remoteServers")}
					</SubTab>
				)}
				<SubTab $active={activeTab === "configure"} onClick={() => setActiveTab("configure")}>
					{t("mcp.configure")}
				</SubTab>
			</TabBar>

			{/* Content */}
			<div>
				{showMarketplace && activeTab === "marketplace" && <McpMarketplaceView />}
				{showRemoteServers && activeTab === "addRemote" && (
					<AddRemoteServerForm onServerAdded={() => setActiveTab("configure")} />
				)}
				{activeTab === "configure" && <ConfigureServersView />}
			</div>
		</div>
	)
}

const TabBar = styled.div`
	display: flex;
	gap: 1px;
	padding: 0 20px;
	border-bottom: 1px solid var(--vscode-panel-border);
`

const SubTab = styled.button<{ $active: boolean }>`
	background: none;
	border: none;
	border-bottom: 2px solid ${(props) => (props.$active ? "var(--vscode-foreground)" : "transparent")};
	color: ${(props) => (props.$active ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)")};
	padding: 8px 16px;
	cursor: pointer;
	font-size: 13px;
	margin-bottom: -1px;
	font-family: inherit;

	&:hover {
		color: var(--vscode-foreground);
	}
`

export default McpSection
