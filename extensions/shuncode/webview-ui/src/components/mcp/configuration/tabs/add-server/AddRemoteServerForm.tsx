import { EmptyRequest } from "@shared/proto/shuncode/common"
import { AddRemoteMcpServerRequest, McpServers } from "@shared/proto/shuncode/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { VSCodeButton, VSCodeLink, VSCodeRadio, VSCodeRadioGroup, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { LINKS } from "@/constants"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { McpServiceClient } from "@/services/grpc-client"

type TransportType = "streamableHttp" | "sse"

const AddRemoteServerForm = ({ onServerAdded }: { onServerAdded: () => void }) => {
	const { t } = useI18n()
	const [serverName, setServerName] = useState("")
	const [serverUrl, setServerUrl] = useState("")
	const [transportType, setTransportType] = useState<TransportType>("streamableHttp")
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [error, setError] = useState("")
	const { setMcpServers } = useExtensionState()

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		if (!serverName.trim()) {
			setError(t("mcp.serverNameRequired"))
			return
		}

		if (!serverUrl.trim()) {
			setError(t("mcp.serverUrlRequired"))
			return
		}

		try {
			new URL(serverUrl)
		} catch (_err) {
			setError(t("mcp.invalidUrlFormat"))
			return
		}

		setError("")
		setIsSubmitting(true)

		try {
			const servers: McpServers = await McpServiceClient.addRemoteMcpServer(
				AddRemoteMcpServerRequest.create({
					serverName: serverName.trim(),
					serverUrl: serverUrl.trim(),
					transportType: transportType,
				}),
			)

			setIsSubmitting(false)

			const mcpServers = convertProtoMcpServersToMcpServers(servers.mcpServers)
			setMcpServers(mcpServers)

			setServerName("")
			setServerUrl("")
			onServerAdded()
		} catch (error) {
			setIsSubmitting(false)
			setError(error instanceof Error ? error.message : t("mcp.failedToAddServer"))
		}
	}

	return (
		<div className="p-4 px-5">
			<div className="text-(--vscode-foreground) mb-2">
				{t("mcp.addRemoteServerDescription")}{" "}
				<VSCodeLink href={LINKS.DOCUMENTATION.REMOTE_MCP_SERVER_DOCS} style={{ display: "inline" }}>
					{t("mcp.here")}
				</VSCodeLink>
			</div>

			<form onSubmit={handleSubmit}>
				<div className="mb-2">
					<VSCodeTextField
						className="w-full"
						disabled={isSubmitting}
						onChange={(e) => {
							setServerName((e.target as HTMLInputElement).value)
							setError("")
						}}
						placeholder={t("mcp.serverNamePlaceholder")}
						value={serverName}>
						{t("mcp.serverName")}
					</VSCodeTextField>
				</div>

				<div className="mb-2">
					<VSCodeTextField
						className="w-full mr-4"
						disabled={isSubmitting}
						onChange={(e) => {
							setServerUrl((e.target as HTMLInputElement).value)
							setError("")
						}}
						placeholder={t("mcp.serverUrlPlaceholder")}
						value={serverUrl}>
						{t("mcp.serverUrl")}
					</VSCodeTextField>
				</div>

				<div className="mb-3">
					<label className={`block text-sm font-medium mb-2 ${isSubmitting ? "opacity-50" : ""}`}>
						{t("mcp.transportType")}
					</label>
					<VSCodeRadioGroup
						disabled={isSubmitting}
						onChange={(e) => {
							const value = (e.target as HTMLInputElement).value as TransportType
							setTransportType(value)
						}}
						value={transportType}>
						<VSCodeRadio checked={transportType === "streamableHttp"} value="streamableHttp">
							{t("mcp.streamableHttp")}
						</VSCodeRadio>
						<VSCodeRadio checked={transportType === "sse"} value="sse">
							{t("mcp.sseLegacy")}
						</VSCodeRadio>
					</VSCodeRadioGroup>
				</div>

				{error && <div className="mb-3 text-(--vscode-errorForeground)">{error}</div>}

				<VSCodeButton className="w-full" disabled={isSubmitting} type="submit">
					{isSubmitting ? t("mcp.connecting") : t("mcp.addServer")}
				</VSCodeButton>

				<VSCodeButton
					appearance="secondary"
					onClick={() => {
						McpServiceClient.openMcpSettings(EmptyRequest.create({})).catch((error) => {
							console.error("Error opening MCP settings:", error)
						})
					}}
					style={{ width: "100%", marginBottom: "5px", marginTop: 15 }}>
					{t("mcp.editConfiguration")}
				</VSCodeButton>
			</form>
		</div>
	)
}

export default AddRemoteServerForm
