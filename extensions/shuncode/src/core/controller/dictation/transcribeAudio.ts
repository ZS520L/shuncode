import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { TranscribeAudioRequest, Transcription } from "@shared/proto/shuncode/dictation"
import { HostProvider } from "@/hosts/host-provider"
import { getWhisperLocalService } from "@/services/dictation/WhisperLocalService"
import { getVoiceTranscriptionService } from "@/services/dictation/VoiceTranscriptionService"
import { telemetryService } from "@/services/telemetry"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Transcribes audio using local Whisper.cpp (preferred) or cloud fallback.
 *
 * Local mode: audioBase64 → temp .webm file → ffmpeg convert to .wav → whisper.cpp → text
 * Cloud mode: audioBase64 → Shuncode transcription API → text
 */
export const transcribeAudio = async (controller: Controller, request: TranscribeAudioRequest): Promise<Transcription> => {
	const taskId = controller.task?.taskId
	const startTime = Date.now()
	const language = request.language || "ru"

	telemetryService.captureVoiceTranscriptionStarted(taskId, language)

	try {
		// Try local Whisper.cpp first
		const whisper = getWhisperLocalService()
		if (whisper?.isReady) {
			Logger.info("[transcribeAudio] Using local Whisper.cpp")
			const text = await transcribeWithLocalWhisper(whisper, request.audioBase64, language)
			const durationMs = Date.now() - startTime
			Logger.info(`[transcribeAudio] Result: "${text?.substring(0, 80)}", ${durationMs}ms`)

			if (text) {
				telemetryService.captureVoiceTranscriptionCompleted(taskId, text.length, durationMs, language)
			}

			return Transcription.create({ text: text ?? "", error: "" })
		}

		// Fallback to cloud transcription
		Logger.info("[transcribeAudio] Local Whisper not ready, using cloud API")
		const result = await getVoiceTranscriptionService().transcribeAudio(request.audioBase64, language)
		const durationMs = Date.now() - startTime

		if (result.error) {
			let errorType = "api_error"
			if (result.error.includes("Authentication failed")) {
				errorType = "invalid_jwt_token"
			} else if (result.error.includes("Insufficient credits")) {
				errorType = "insufficient_credits"
			} else if (result.error.includes("Invalid audio format")) {
				errorType = "invalid_audio_format"
			} else if (result.error.includes("No internet connection")) {
				errorType = "no_internet"
			} else if (result.error.includes("Cannot connect")) {
				errorType = "connection_error"
			} else if (result.error.includes("Connection timed out")) {
				errorType = "timeout_error"
			} else if (result.error.includes("Network error")) {
				errorType = "network_error"
			}

			telemetryService.captureVoiceTranscriptionError(taskId, errorType, result.error, durationMs)

			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: result.error,
			})
		} else if (result.text) {
			telemetryService.captureVoiceTranscriptionCompleted(taskId, result.text.length, durationMs, language)
		}

		return Transcription.create({
			text: result.text ?? "",
			error: result.error ?? "",
		})
	} catch (error) {
		Logger.error("[transcribeAudio] Error:", error)
		const durationMs = Date.now() - startTime
		const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"

		telemetryService.captureVoiceTranscriptionError(taskId, "unexpected_error", errorMessage, durationMs)

		return Transcription.create({
			text: "",
			error: errorMessage,
		})
	}
}

/**
 * Transcribe audio using local Whisper.cpp.
 * Converts base64 webm → WAV → runs whisper.cpp → returns text.
 */
async function transcribeWithLocalWhisper(
	whisper: NonNullable<ReturnType<typeof getWhisperLocalService>>,
	audioBase64: string,
	language: string,
): Promise<string> {
	const tempDir = os.tmpdir()
	const timestamp = Date.now()
	const webmPath = path.join(tempDir, `shuncode_whisper_${timestamp}.webm`)
	const wavPath = path.join(tempDir, `shuncode_whisper_${timestamp}.wav`)

	try {
		// 1. Write base64 audio to temp file
		const audioBuffer = Buffer.from(audioBase64, "base64")
		fs.writeFileSync(webmPath, audioBuffer)

		// 2. Convert to WAV 16kHz mono (whisper.cpp requirement)
		await whisper.convertToWav(webmPath, wavPath)

		// 3. Transcribe with whisper.cpp
		const text = await whisper.transcribe(wavPath, language)

		return text
	} catch (err) {
		Logger.error("[transcribeLocal] Error:", err)
		throw err
	} finally {
		// Cleanup temp files
		if (fs.existsSync(webmPath)) fs.unlinkSync(webmPath)
		if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath)
	}
}
