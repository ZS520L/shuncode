import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import AutoApproveMenuItem from "@/components/chat/auto-approve-menu/AutoApproveMenuItem"
import { ACTION_METADATA } from "@/components/chat/auto-approve-menu/constants"
import { updateAutoApproveSettings } from "@/components/chat/auto-approve-menu/AutoApproveSettingsAPI"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAutoApproveActions } from "@/hooks/useAutoApproveActions"
import { useI18n } from "@/i18n"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface PermissionsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const PermissionsSection = ({ renderSectionHeader }: PermissionsSectionProps) => {
	const { t } = useI18n()
	const { autoApprovalSettings, yoloModeToggled, remoteConfigSettings } = useExtensionState()
	const { isChecked, updateAction } = useAutoApproveActions()

	return (
		<div>
			{renderSectionHeader("permissions")}
			<Section>
				<div style={{ marginBottom: 20 }}>
					{/* Auto-Approve Actions */}
					<div
						className="p-3 mb-3 rounded-md"
						style={{
							border: "1px solid var(--vscode-widget-border)",
						}}>
						<div className="font-semibold mb-2">{t("permissions.actionsSection")}</div>
						<p className="text-xs text-(--vscode-descriptionForeground) mb-3">
							{t("permissions.description")}
						</p>

						<div className="flex flex-col gap-0.5">
							{ACTION_METADATA.map((action) => (
								<AutoApproveMenuItem
									action={action}
									isChecked={isChecked}
									key={action.id}
									onToggle={updateAction}
								/>
							))}
						</div>

						{/* Separator */}
						<div
							className="my-2"
							style={{
								height: "0.5px",
								background: "var(--vscode-descriptionForeground)",
								opacity: 0.15,
							}}
						/>

						{/* Notifications */}
						<VSCodeCheckbox
							checked={autoApprovalSettings.enableNotifications}
							onChange={async (e: any) => {
								const checked = e.target.checked === true
								await updateAutoApproveSettings({
									...autoApprovalSettings,
									version: (autoApprovalSettings.version ?? 1) + 1,
									enableNotifications: checked,
								})
							}}>
							{t("permissions.enableNotifications")}
						</VSCodeCheckbox>
					</div>

					{/* YOLO Mode */}
					<div
						className="p-3 rounded-md"
						style={{
							border: "1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-widget-border))",
						}}>
						<div className="font-semibold mb-2">{t("permissions.yoloSection")}</div>
						<Tooltip>
							<TooltipTrigger asChild>
								<div className="flex items-center gap-2">
									<VSCodeCheckbox
										checked={yoloModeToggled}
										disabled={remoteConfigSettings?.yoloModeToggled !== undefined}
										onChange={(e: any) => {
											const checked = e.target.checked === true
											updateSetting("yoloModeToggled", checked)
										}}>
										{t("features.yoloMode")}
									</VSCodeCheckbox>
									{remoteConfigSettings?.yoloModeToggled !== undefined && (
										<i className="codicon codicon-lock text-description text-sm" />
									)}
								</div>
							</TooltipTrigger>
							<TooltipContent
								className="max-w-xs"
								hidden={remoteConfigSettings?.yoloModeToggled === undefined}
								side="top">
								{t("features.lockedByOrg")}
							</TooltipContent>
						</Tooltip>
						<p className="text-xs text-(--vscode-errorForeground) mt-1">{t("features.yoloDanger")}</p>
					</div>
				</div>
			</Section>
		</div>
	)
}

export default memo(PermissionsSection)
