import { TelemetrySettingEnum, TelemetrySettingRequest } from "@shared/proto/shuncode/state"
import { useCallback } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { StateServiceClient } from "@/services/grpc-client"

const telemetryRequest = TelemetrySettingRequest.create({
	setting: TelemetrySettingEnum.ENABLED,
})

export const TelemetryBanner: React.FC = () => {
	const { t } = useI18n()
	const { navigateToSettings } = useExtensionState()

	const handleClose = useCallback(() => {
		StateServiceClient.updateTelemetrySetting(telemetryRequest).catch(console.error)
	}, [])

	const handleOpenSettings = useCallback(() => {
		handleClose()
		navigateToSettings()
	}, [handleClose, navigateToSettings])

	return (
		<div className="bg-banner-background text-banner-foreground px-3 py-2 flex flex-col gap-1 shrink-0 mb-1 relative text-sm m-4">
			<h3 className="m-0">{t("telemetry.helpImproveShuncode")}</h3>
			<i>{t("telemetry.accessExperimentalFeatures")}</i>
			<p className="m-0">{t("telemetry.collectsUsageData")}</p>
			<p className="m-0">
				<span>{t("telemetry.turnOffIn")} </span>
				<span className="text-link cursor-pointer" onClick={handleOpenSettings}>
					{t("telemetry.settings")}
				</span>
				.
			</p>

			{/* Close button */}
			<button
				aria-label={t("telemetry.closeBannerEnable")}
				className="absolute top-3 right-3 opacity-70 hover:opacity-100 cursor-pointer border-0 bg-transparent p-0 text-inherit"
				onClick={handleClose}
				type="button">
				{/* allow-any-unicode-next-line */}✕
			</button>
		</div>
	)
}

export default TelemetryBanner
