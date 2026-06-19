import type React from "react"
import { memo, useCallback, useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { usePlatform } from "@/context/PlatformContext"
import { useI18n } from "@/i18n"
import { useMetaKeyDetection } from "@/utils/hooks"
import type { Mode } from "@shared/storage/types"
import { MODE_COLORS, MODE_KEYS, SwitchContainer } from "./ChatTextArea.styles"

interface ModeSwitcherProps {
	mode: Mode
	onSwitchMode: (mode: Mode) => void
}

const ModeSwitcher: React.FC<ModeSwitcherProps> = ({ mode, onSwitchMode }) => {
	const { t } = useI18n()
	const { platform } = useExtensionState()
	const [, metaKeyChar] = useMetaKeyDetection(platform)
	const [shownTooltipMode, setShownTooltipMode] = useState<Mode | null>(null)

	const togglePlanActKeys = usePlatform()
		.togglePlanActKeys.replace("Meta", metaKeyChar)
		.replace(/.$/, (match) => match.toUpperCase())

	const handleClick = useCallback(
		(key: string) => {
			onSwitchMode(key as Mode)
		},
		[onSwitchMode],
	)

	return (
		<Tooltip>
			<TooltipContent
				className="text-xs px-2 flex flex-col gap-1"
				hidden={shownTooltipMode === null}
				side="top">
				{shownTooltipMode &&
					`${t("chat.modePrefix")} ${t(`mode.${shownTooltipMode}`)} ${t("chat.modeShuncodeWill")} ${t(`chat.mode${shownTooltipMode.charAt(0).toUpperCase() + shownTooltipMode.slice(1)}Description` as any)}`}
				<p className="text-description/80 text-xs mb-0">
					{t("chat.modeToggle")}: <kbd className="text-muted-foreground mx-1">{togglePlanActKeys}</kbd>
				</p>
			</TooltipContent>
			<TooltipTrigger>
				<SwitchContainer data-testid="mode-switch" disabled={false}>
					{MODE_KEYS.map((key) => {
						const isActive = mode === key
						return (
							<div
								key={key}
								aria-checked={isActive}
								style={{
									padding: "3px 8px",
									fontSize: "10px",
									textAlign: "center" as const,
									cursor: "pointer",
									lineHeight: 1,
									whiteSpace: "nowrap" as const,
									backgroundColor: isActive ? MODE_COLORS[key] : "transparent",
									color: isActive ? "#fff" : "var(--vscode-input-foreground)",
									fontWeight: isActive ? 500 : 400,
									transition: "background-color 0.15s ease, color 0.15s ease",
								}}
								onClick={() => handleClick(key)}
								onMouseLeave={() => setShownTooltipMode(null)}
								onMouseOver={() => setShownTooltipMode(key as Mode)}
								role="switch">
								{t(`mode.${key}`)}
							</div>
						)
					})}
				</SwitchContainer>
			</TooltipTrigger>
		</Tooltip>
	)
}

export default memo(ModeSwitcher)
