import { RecordingResult } from "@shared/proto/shuncode/dictation"
import * as os from "os"
import { HostProvider } from "@/hosts/host-provider"
import { t } from "@/i18n/backend-i18n"
import { audioRecordingService } from "@/services/dictation/AudioRecordingService"
import { telemetryService } from "@/services/telemetry"
import { AUDIO_PROGRAM_CONFIG } from "@/shared/audioProgramConstants"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Handles the installation of missing dependencies with Shuncode
 */
async function handleInstallWithShuncode(
	controller: Controller,
	dependencyName: string,
	installCommand: string,
	platform: string,
): Promise<void> {
	const platformName = platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : "Linux"
	const installTask = `Please install ${dependencyName} for voice recording on ${platformName}.\n\nRun this command:\n\`\`\`bash\n${installCommand}\n\`\`\`\n\nThis will enable voice recording functionality in Shuncode.`

	// Clear any existing task and start the installation task
	await controller.clearTask()
	await controller.postStateToWebview()
	await controller.initTask(installTask)

	HostProvider.get().logToChannel(`Started task to install ${dependencyName}`)
}

/**
 * Handles copying the installation command to clipboard
 */
async function handleCopyCommand(installCommand: string): Promise<void> {
	await HostProvider.env.clipboardWriteText({ value: installCommand })
	await HostProvider.window.showMessage({
		type: ShowMessageType.INFORMATION,
		message: t("dictation.installCopied", { command: installCommand }),
		options: { items: [] },
	})
}

/**
 * Handles missing dependency notification and user action
 */
async function handleMissingDependency(
	controller: Controller,
	platform: string,
	config: (typeof AUDIO_PROGRAM_CONFIG)[keyof typeof AUDIO_PROGRAM_CONFIG],
): Promise<void> {
	const installWithShuncode = t("dictation.installWithShuncode")
	const installManually = t("dictation.copyCommand")
	const dismiss = t("dictation.dismiss")

	const action = await HostProvider.window.showMessage({
		type: ShowMessageType.INFORMATION,
		message: t("dictation.missingDep", { name: config.dependencyName, description: config.installDescription }),
		options: { items: [installWithShuncode, installManually, dismiss] },
	})

	if (action.selectedOption === installWithShuncode) {
		await handleInstallWithShuncode(controller, config.dependencyName, config.installCommand, platform)
	} else if (action.selectedOption === installManually) {
		await handleCopyCommand(config.installCommand)
	}
	// If dismiss, do nothing
}

/**
 * Handles sign-in errors for dictation
 */
async function handleSignInError(controller: Controller, errorMessage: string): Promise<void> {
	const signInAction = t("dictation.signIn")
	const action = await HostProvider.window.showMessage({
		type: ShowMessageType.ERROR,
		message: t("dictation.error", { error: errorMessage }),
		options: { items: [signInAction] },
	})

	if (action.selectedOption === signInAction) {
		await controller.authService.createAuthRequest()
	}
}

/**
 * Shows a generic error message
 */
async function showGenericError(errorMessage: string): Promise<void> {
	await HostProvider.window.showMessage({
		type: ShowMessageType.ERROR,
		message: t("dictation.error", { error: errorMessage }),
		options: { items: [] },
	})
}

/**
 * Checks if the recording error is due to missing dependencies
 */
function isMissingDependencyError(
	error: string | undefined,
	config: (typeof AUDIO_PROGRAM_CONFIG)[keyof typeof AUDIO_PROGRAM_CONFIG] | undefined,
): boolean {
	return !!(error && config && error.includes(config.error))
}

/**
 * Starts audio recording using the Extension Host
 * @param controller The controller instance
 * @returns RecordingResult with success status
 */
export const startRecording = async (controller: Controller): Promise<RecordingResult> => {
	const taskId = controller.task?.taskId

	try {
		// Check if local Whisper.cpp is available (use model from user settings)
		let whisper: any = null
		try {
			const dictSettings = controller.stateManager.getGlobalSettingsKey("dictationSettings") as any
			const whisperModel = dictSettings?.whisperModel ?? "tiny"
			const { getWhisperLocalService } = await import("@/services/dictation/WhisperLocalService")
			const { HostProvider: HP } = await import("@/hosts/host-provider")
			whisper = getWhisperLocalService(HP.get().globalStorageFsPath, whisperModel, HP.get().extensionFsPath)
		} catch {
			// WhisperLocalService not initialized — will use cloud fallback
		}

		// If Whisper not ready — download everything first, then start recording
		if (whisper && !whisper.isReady) {
			Logger.info("[startRecording] Whisper.cpp not ready, starting download...")

			try {
				const token = await controller.authService.getAuthToken()
				whisper.authToken = token
			} catch {}

			// Return immediately with "preparing" status — don't block UI
			// Start download in background and tell user to try again
			whisper
				.ensureReady((msg: string) => Logger.info(`[WhisperDownload] ${msg}`))
				.then(() => {
					Logger.info("[WhisperDownload] All components ready! Voice input is now available.")
					HostProvider.window.showMessage({
						type: ShowMessageType.INFORMATION,
						message: t("voice.ready"),
						options: { items: [] },
					})
				})
				.catch((err: any) => {
					Logger.warn("[WhisperDownload] Download failed:", err)
					HostProvider.window.showMessage({
						type: ShowMessageType.ERROR,
						message: t("voice.downloadFailed", { error: err instanceof Error ? err.message : String(err) }),
						options: { items: [] },
					})
				})

			return RecordingResult.create({
				success: false,
				error: t("voice.preparing"),
			})
		}

		// Get user-selected audio device from settings
		const dictSettings = controller.stateManager.getGlobalSettingsKey("dictationSettings") as any
		const userDeviceId: string | undefined = dictSettings?.audioDeviceId || undefined

		// Detect audio device on Windows before recording (only if no user-selected device)
		if (process.platform === "win32" && !userDeviceId) {
			const { detectWindowsAudioDevice } = await import("@/shared/audioProgramConstants")
			const ffmpegPath = whisper?.effectiveFfmpegPath || "ffmpeg"
			await detectWindowsAudioDevice(ffmpegPath)
		} else if (process.platform === "win32" && userDeviceId) {
			// User explicitly selected a device — set it as cached so getArgs uses it
			const { setCachedWinAudioDevice } = await import("@/shared/audioProgramConstants")
			setCachedWinAudioDevice(userDeviceId)
		}

		// Start recording (pass user-selected device)
		const result = await audioRecordingService.startRecording(userDeviceId)

		// Handle successful recording start
		if (result.success) {
			telemetryService.captureVoiceRecordingStarted(taskId, process.platform)
			return RecordingResult.create({
				success: true,
				error: "",
			})
		}

		// Check if the error is due to missing dependencies
		const platform = os.platform() as keyof typeof AUDIO_PROGRAM_CONFIG
		const config = AUDIO_PROGRAM_CONFIG[platform]

		if (isMissingDependencyError(result.error, config)) {
			// Don't await - show dialog asynchronously so frontend gets immediate response
			handleMissingDependency(controller, platform, config)
		}

		return RecordingResult.create({
			success: false,
			error: result.error || "",
		})
	} catch (error) {
		Logger.error("Error starting recording:", error)
		const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"

		// Handle different error types
		if (errorMessage.includes("sign in")) {
			// Don't await - show dialog asynchronously so frontend gets immediate response
			handleSignInError(controller, errorMessage)
		} else {
			// Don't await - show dialog asynchronously so frontend gets immediate response
			showGenericError(errorMessage)
		}

		return RecordingResult.create({
			success: false,
			error: errorMessage,
		})
	}
}
