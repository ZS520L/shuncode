import * as fs from "node:fs"
import { AudioDeviceList } from "@shared/proto/shuncode/dictation"
import {
	listAudioDevices as listDevices,
	detectWindowsAudioDevice,
	setCachedWinAudioDevice,
} from "@/shared/audioProgramConstants"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Lists available audio input devices.
 * Uses ffmpeg to enumerate devices on all platforms.
 * On Windows, also detects the working default device and marks it with isDefault.
 * Always re-detects the default device (cache is reset on each call so Refresh works).
 */
export const listAudioDevices = async (controller: Controller): Promise<AudioDeviceList> => {
	try {
		// Get ffmpeg path — try bundled first, then system
		let ffmpegPath = "ffmpeg"

		try {
			const { getWhisperLocalService } = await import("@/services/dictation/WhisperLocalService")
			const { HostProvider: HP } = await import("@/hosts/host-provider")
			const dictSettings = controller.stateManager.getGlobalSettingsKey("dictationSettings") as any
			const whisperModel = dictSettings?.whisperModel ?? "tiny"
			const whisper = getWhisperLocalService(HP.get().globalStorageFsPath, whisperModel, HP.get().extensionFsPath)
			if (whisper?.ffmpegPath && fs.existsSync(whisper.ffmpegPath)) {
				ffmpegPath = whisper.ffmpegPath
			}
		} catch {
			// Use system ffmpeg
		}

		Logger.info(`[listAudioDevices] Using ffmpeg: ${ffmpegPath}`)
		const devices = await listDevices(ffmpegPath)

		// Reset cached device so detectWindowsAudioDevice re-probes fresh
		const platform = process.platform
		if (platform === "win32") {
			setCachedWinAudioDevice(null)
		}

		// Detect the system default device (always fresh)
		let defaultDeviceId: string | null = null
		if (platform === "win32") {
			defaultDeviceId = await detectWindowsAudioDevice(ffmpegPath)
		} else if (devices.length > 0) {
			// On macOS/Linux, the first device in the list is typically the default
			defaultDeviceId = devices[0].id
		}

		Logger.info(`[listAudioDevices] Default device: "${defaultDeviceId ?? "none"}"`)

		return AudioDeviceList.create({
			devices: devices.map((d) => ({
				id: d.id,
				name: d.name,
				isDefault: d.id === defaultDeviceId,
			})),
			error: "",
		})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		Logger.error("[listAudioDevices] Failed:", errorMessage)
		return AudioDeviceList.create({
			devices: [],
			error: errorMessage,
		})
	}
}
