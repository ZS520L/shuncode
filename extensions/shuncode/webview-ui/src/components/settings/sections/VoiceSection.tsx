import { VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { memo, useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useShuncodeAuth } from "@/context/ShuncodeAuthContext"
import { useI18n } from "@/i18n"
import { DictationServiceClient } from "@/services/grpc-client"
import { SUPPORTED_DICTATION_LANGUAGES } from "@shared/DictationSettings"
import type { AudioDevice } from "@shared/DictationSettings"
import { EmptyRequest } from "@shared/proto/index.shuncode"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface VoiceSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const WHISPER_MODELS = [
	{ id: "tiny", labelKey: "voice.modelTiny", requiresAuth: false, locked: false },
	{ id: "base", labelKey: "voice.modelBase", requiresAuth: false, locked: false },
	{ id: "small", labelKey: "voice.modelSmall", requiresAuth: false, locked: false },
]

const VoiceSection = ({ renderSectionHeader }: VoiceSectionProps) => {
	const { t } = useI18n()
	const { dictationSettings, navigateToAccount } = useExtensionState()
	const { shuncodeUser } = useShuncodeAuth()
	const isAuthenticated = !!shuncodeUser?.uid

	const isReady = dictationSettings?.voiceReady === true
	const isDownloading = dictationSettings?.voiceDownloading === true

	const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([])
	const [devicesLoading, setDevicesLoading] = useState(false)

	const savedDeviceId = dictationSettings?.audioDeviceId || ""

	const updateDictation = useCallback((updates: Record<string, any>) => {
		updateSetting("dictationSettings", { ...dictationSettings, ...updates })
	}, [dictationSettings])

	const handleDownload = useCallback(() => {
		updateDictation({ voiceDownloading: true })
	}, [updateDictation])

	const handleReinstall = useCallback(() => {
		updateDictation({ voiceReinstall: true, voiceDownloading: true })
	}, [updateDictation])

	const loadAudioDevices = useCallback(async () => {
		setDevicesLoading(true)
		try {
			const result = await DictationServiceClient.listAudioDevices(EmptyRequest.create({}))
			if (result.devices && result.devices.length > 0) {
				setAudioDevices(result.devices.map((d) => ({ id: d.id, name: d.name, isDefault: d.isDefault })))
			} else {
				setAudioDevices([])
			}
		} catch {
			setAudioDevices([])
		} finally {
			setDevicesLoading(false)
		}
	}, [])

	// Load devices when dictation is enabled and voice components are ready
	useEffect(() => {
		if (dictationSettings?.dictationEnabled && isReady) {
			loadAudioDevices()
		}
	}, [dictationSettings?.dictationEnabled, isReady, loadAudioDevices])

	return (
		<div>
			{renderSectionHeader("voice")}
			<Section>
				<div style={{ marginBottom: 20 }}>
					{/* Enable voice input */}
					<div>
						<VSCodeCheckbox
							checked={dictationSettings?.dictationEnabled}
							onChange={(e: any) => {
								updateDictation({ dictationEnabled: e.target.checked === true })
							}}>
							{t("voice.enable")}
						</VSCodeCheckbox>
						<p className="text-xs text-description mt-1">{t("voice.enableDescription")}</p>
					</div>

					{dictationSettings?.dictationEnabled && (
						<>
							{/* Language */}
							<div className="mt-4">
								<label className="text-sm font-medium">{t("voice.language")}</label>
								<VSCodeDropdown
									className="w-full mt-1"
									value={dictationSettings?.dictationLanguage || "ru"}
									onChange={(e: any) => {
										updateDictation({ dictationLanguage: e.target.value })
									}}>
									{SUPPORTED_DICTATION_LANGUAGES.map((lang) => (
										<VSCodeOption key={lang.code} value={lang.code}>
											{lang.name}
										</VSCodeOption>
									))}
								</VSCodeDropdown>
								<p className="text-xs text-description mt-1">{t("voice.languageDescription")}</p>
							</div>

							{/* Microphone */}
							<div className="mt-4">
								<div className="flex items-center gap-2">
									<label className="text-sm font-medium">{t("voice.microphone")}</label>
									{isReady && (
										<span
											className={`codicon codicon-refresh cursor-pointer text-description hover:text-foreground ${devicesLoading ? "animate-spin" : ""}`}
											title={t("voice.microphoneRefresh")}
											onClick={() => !devicesLoading && loadAudioDevices()}
										/>
									)}
								</div>
							<select
								className="w-full mt-1"
								value={savedDeviceId}
								disabled={!isReady || devicesLoading}
								onChange={(e) => {
									updateDictation({ audioDeviceId: e.target.value })
								}}
								style={{
									padding: "4px 8px",
									background: "var(--vscode-dropdown-background)",
									color: "var(--vscode-dropdown-foreground)",
									border: "1px solid var(--vscode-dropdown-border)",
									borderRadius: "2px",
									fontSize: "var(--vscode-font-size)",
									fontFamily: "var(--vscode-font-family)",
									outline: "none",
									cursor: isReady && !devicesLoading ? "pointer" : "not-allowed",
									opacity: !isReady || devicesLoading ? 0.5 : 1,
								}}>
								<option value="">
									{devicesLoading ? t("voice.microphoneLoading") : t("voice.microphoneAuto")}
								</option>
							{audioDevices.map((device) => (
								<option key={device.id} value={device.id}>
									{device.name}{device.isDefault ? ` ${t("voice.microphoneSystemDefault")}` : ""}
								</option>
							))}
							{/* If saved device not in loaded list yet — show it so select doesn't reset */}
							{savedDeviceId && audioDevices.length > 0 && !audioDevices.some((d) => d.id === savedDeviceId) ? (
								<option key={savedDeviceId} value={savedDeviceId}>
									{savedDeviceId}
								</option>
							) : null}
							</select>
								<p className="text-xs text-description mt-1">{t("voice.microphoneDescription")}</p>
								{isReady && audioDevices.length === 0 && !devicesLoading && (
									<p className="text-xs text-warning mt-1">{t("voice.microphoneNone")}</p>
								)}
							</div>

							{/* Whisper Model */}
							<div className="mt-4">
								<label className="text-sm font-medium">{t("voice.model")}</label>
								<VSCodeDropdown
									className="w-full mt-1"
									value={dictationSettings?.whisperModel || "tiny"}
									onChange={(e: any) => {
										const newModel = e.target.value
										const modelConfig = WHISPER_MODELS.find((m) => m.id === newModel)
										if (!modelConfig || modelConfig.locked) return
										if (modelConfig.requiresAuth && !isAuthenticated) return
										if (newModel !== dictationSettings?.whisperModel) {
											updateDictation({ whisperModel: newModel, voiceReady: false, voiceDownloading: false })
										}
									}}>
									{WHISPER_MODELS.map((model) => {
										const disabled = model.locked || (model.requiresAuth && !isAuthenticated)
										return (
											<VSCodeOption key={model.id} value={model.id} disabled={disabled}>
												{t(model.labelKey)}
											</VSCodeOption>
										)
									})}
								</VSCodeDropdown>
								<p className="text-xs text-description mt-1">{t("voice.modelDescription")}</p>
							</div>

							{/* Download / Reinstall button */}
							<div className="mt-4">
								{!isAuthenticated ? (
									<VSCodeButton className="w-full" onClick={() => navigateToAccount()}>
										{t("voice.signIn")}
									</VSCodeButton>
								) : (
									<VSCodeButton
										className="w-full"
										disabled={isDownloading}
										onClick={isReady ? handleReinstall : handleDownload}>
										{isDownloading ? (
											<>
												<span className="codicon codicon-loading animate-spin mr-1.5" />
												{t("voice.downloading")}
											</>
										) : isReady ? (
											t("voice.reinstallButton")
										) : (
											t("voice.downloadButton")
										)}
									</VSCodeButton>
								)}
							</div>

							{/* Note */}
							<p className="text-xs text-description mt-3 opacity-60">{t("voice.downloadNote")}</p>
						</>
					)}
				</div>
			</Section>
		</div>
	)
}

export default memo(VoiceSection)
