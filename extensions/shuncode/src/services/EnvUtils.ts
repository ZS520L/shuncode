import { isMultiRootWorkspace } from "@/core/workspace/utils/workspace-detection"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { EmptyRequest } from "@/shared/proto/shuncode/common"
import { Logger } from "@/shared/services/Logger"

// Canonical header names for extra client/host context
export const ShuncodeHeaders = {
	PLATFORM: "X-PLATFORM",
	PLATFORM_VERSION: "X-PLATFORM-VERSION",
	CLIENT_VERSION: "X-CLIENT-VERSION",
	CLIENT_TYPE: "X-CLIENT-TYPE",
	CORE_VERSION: "X-CORE-VERSION",
	IS_MULTIROOT: "X-IS-MULTIROOT",
} as const
export type ShuncodeHeaderName = (typeof ShuncodeHeaders)[keyof typeof ShuncodeHeaders]

export async function buildBasicShuncodeHeaders(): Promise<Record<string, string>> {
	const headers: Record<string, string> = {}
	try {
		const host = await HostProvider.env.getHostVersion(EmptyRequest.create({}))
		headers[ShuncodeHeaders.PLATFORM] = host.platform || "unknown"
		headers[ShuncodeHeaders.PLATFORM_VERSION] = host.version || "unknown"
		headers[ShuncodeHeaders.CLIENT_TYPE] = host.shuncodeType || "unknown"
		headers[ShuncodeHeaders.CLIENT_VERSION] = host.shuncodeVersion || "unknown"
	} catch (error) {
		Logger.log("Failed to get IDE/platform info via HostBridge EnvService.getHostVersion", error)
		headers[ShuncodeHeaders.PLATFORM] = "unknown"
		headers[ShuncodeHeaders.PLATFORM_VERSION] = "unknown"
		headers[ShuncodeHeaders.CLIENT_TYPE] = "unknown"
		headers[ShuncodeHeaders.CLIENT_VERSION] = "unknown"
	}
	headers[ShuncodeHeaders.CORE_VERSION] = ExtensionRegistryInfo.version

	return headers
}

export async function buildShuncodeExtraHeaders(): Promise<Record<string, string>> {
	const headers = await buildBasicShuncodeHeaders()

	try {
		const isMultiRoot = await isMultiRootWorkspace()
		headers[ShuncodeHeaders.IS_MULTIROOT] = isMultiRoot ? "true" : "false"
	} catch (error) {
		Logger.log("Failed to detect multi-root workspace", error)
		headers[ShuncodeHeaders.IS_MULTIROOT] = "false"
	}

	return headers
}
