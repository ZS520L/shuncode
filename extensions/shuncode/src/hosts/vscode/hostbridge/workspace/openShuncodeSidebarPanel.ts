import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import { OpenShuncodeSidebarPanelRequest, OpenShuncodeSidebarPanelResponse } from "@/shared/proto/index.host"

export async function openShuncodeSidebarPanel(_: OpenShuncodeSidebarPanelRequest): Promise<OpenShuncodeSidebarPanelResponse> {
	await vscode.commands.executeCommand(`${ExtensionRegistryInfo.views.Sidebar}.focus`)
	return {}
}
