import { BannerService } from "@/services/banner/BannerService"
import type { EmptyRequest } from "@/shared/proto/shuncode/common"
import { Empty } from "@/shared/proto/shuncode/common"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

/**
 * Clears the banner cache and pushes fresh banners to the webview.
 * Called when the user exits Settings so new server-side banners
 * appear without waiting for the 1-hour cache expiry.
 */
export async function refreshBanners(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		if (BannerService.isInitialized()) {
			BannerService.get().clearCache()
		}
		await controller.postStateToWebview()
	} catch (error) {
		Logger.error("Failed to refresh banners:", error)
	}
	return {}
}
