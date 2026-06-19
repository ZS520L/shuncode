import { EmptyRequest } from "@shared/proto/index.shuncode"
import { TranscribeAudioRequest } from "@shared/proto/shuncode/dictation"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { DictationServiceClient } from "@/services/grpc-client"
import { formatSeconds } from "@/utils/format"

interface VoiceRecorderProps {
	onTranscription: (text: string) => void
	onProcessingStateChange?: (isProcessing: boolean, message?: string) => void
	onRecordingStateChange?: (isRecording: boolean) => void
	onAuthRequired?: () => void
	disabled?: boolean
	language?: string
	isAuthenticated?: boolean
}

const MAX_DURATION = 5 * 60 // 5 minutes

/**
 * VoiceRecorder — microphone button with 3 states:
 *
 * 1. IDLE:        🎤 mic icon — click to start recording
 * 2. RECORDING:   🔴 pulsing red dot + timer — click to stop & transcribe
 * 3. TRANSCRIBING: ⏳ spinner — waiting for whisper.cpp
 *
 * Replaces the Send button during recording (handled by parent ChatTextArea).
 */
const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
	onTranscription,
	onProcessingStateChange,
	onRecordingStateChange,
	onAuthRequired,
	disabled = false,
	language = "ru",
	isAuthenticated = false,
}) => {
	const { t } = useI18n()
	const [state, setState] = useState<"idle" | "starting" | "recording" | "transcribing">("idle")
	const [recordingDuration, setRecordingDuration] = useState(0)
	const [error, setError] = useState<string | null>(null)
	const pollingRef = useRef<NodeJS.Timeout | null>(null)

	// Detect "preparing/downloading" state (both EN and RU contain "170")
	const isPreparing = error
		? error.includes("170") || error.includes("preparing")
		: false

	// Notify parent of recording state
	useEffect(() => {
		onRecordingStateChange?.(state === "recording")
	}, [state, onRecordingStateChange])

	// Poll recording duration
	useEffect(() => {
		if (state === "recording") {
			pollingRef.current = setInterval(async () => {
				try {
					const status = await DictationServiceClient.getRecordingStatus(EmptyRequest.create({}))
					if (status.isRecording) {
						setRecordingDuration(Math.floor(status.durationSeconds))
						if (status.durationSeconds >= MAX_DURATION) {
							handleStop()
						}
					}
				} catch {}
			}, 1000)
		} else {
			if (pollingRef.current) {
				clearInterval(pollingRef.current)
				pollingRef.current = null
			}
		}
		return () => {
			if (pollingRef.current) {
				clearInterval(pollingRef.current)
				pollingRef.current = null
			}
		}
	}, [state])

	const handleMicClick = useCallback(async () => {
		if (disabled || state === "starting" || state === "transcribing") return

		if (!isAuthenticated) {
			onAuthRequired?.()
			return
		}

		// Clear error on click
		if (error) {
			setError(null)
			return
		}

		setState("starting")
		setRecordingDuration(0)

		try {
			const response = await DictationServiceClient.startRecording(EmptyRequest.create({}))
			if (!response.success) {
				setError(response.error || t("voice.failedToStart"))
				setState("idle")
				return
			}
			setState("recording")
		} catch (err) {
			setError(err instanceof Error ? err.message : t("voice.failedToStart"))
			setState("idle")
		}
	}, [disabled, state, error, isAuthenticated, onAuthRequired, t])

	const handleStop = useCallback(async () => {
		if (state !== "recording") return

		setState("transcribing")
		onProcessingStateChange?.(true, t("chat.transcribing"))

		try {
			// 1. Stop recording
			const response = await DictationServiceClient.stopRecording(EmptyRequest.create({}))

			if (!response.success) {
				setError(response.error || t("voice.failedToStop"))
				setState("idle")
				onProcessingStateChange?.(false)
				return
			}

			if (!response.audioBase64) {
				setError(t("voice.noAudioData"))
				setState("idle")
				onProcessingStateChange?.(false)
				return
			}

			// 2. Transcribe
			const result = await DictationServiceClient.transcribeAudio(
				TranscribeAudioRequest.create({
					audioBase64: response.audioBase64,
					language,
				}),
			)

			if (result.error) {
				setError(result.error)
				setTimeout(() => setError(null), 5000)
			} else if (result.text) {
				setError(null)
				onTranscription(result.text)
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "An error occurred")
		} finally {
			setState("idle")
			onProcessingStateChange?.(false)
		}
	}, [state, language, onTranscription, onProcessingStateChange, t])

	const handleCancel = useCallback(async () => {
		if (state !== "recording") return

		try {
			await DictationServiceClient.cancelRecording(EmptyRequest.create({}))
		} catch {}

		setState("idle")
		onProcessingStateChange?.(false)
	}, [state, onProcessingStateChange])

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (pollingRef.current) clearInterval(pollingRef.current)
		}
	}, [])

	// ─── RECORDING STATE: red pulsing dot + timer + cancel ───
	if (state === "recording") {
		return (
			<div className="flex items-center gap-1.5 mr-1.5">
				{/* Pulsing red recording indicator + timer */}
				<Tooltip>
					<TooltipTrigger asChild>
						<div
							className="flex items-center gap-1 cursor-pointer input-icon-button"
							data-testid="stop-recording-button"
							onClick={handleStop}>
							{/* Red pulsing dot */}
							<span className="relative flex h-4 w-4">
								<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
								<span className="relative inline-flex rounded-full h-4 w-4 bg-red-500" />
							</span>
							{/* Timer */}
							<span className="text-sm text-description tabular-nums">
								{formatSeconds(recordingDuration)}
							</span>
						</div>
					</TooltipTrigger>
					<TooltipContent side="top">
						{t("chat.stopRecording")} ({formatSeconds(recordingDuration)}/{formatSeconds(MAX_DURATION)})
					</TooltipContent>
				</Tooltip>

				{/* Cancel button — hidden for now */}
			</div>
		)
	}

	// ─── IDLE / STARTING / TRANSCRIBING: mic icon ───
	const isLoading = state === "starting" || state === "transcribing" || isPreparing
	const iconClass = isLoading ? "codicon-loading" : error ? "codicon-error" : "codicon-mic"
	const iconColor = error && !isPreparing ? "text-error" : ""

	let tooltipText: string
	if (state === "transcribing") {
		tooltipText = t("chat.transcribing")
	} else if (state === "starting") {
		tooltipText = t("chat.startingRecording")
	} else if (isPreparing && error) {
		tooltipText = error
	} else if (error) {
		tooltipText = `${t("chat.error")}: ${error}`
	} else {
		tooltipText = t("chat.voiceInput")
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div
					className={cn("pt-1 input-icon-button mr-1.5 text-base mt-0.5", {
						disabled: disabled || isLoading,
						"animate-spin": isLoading,
					})}
					data-testid="voice-recorder-start-button"
					onClick={handleMicClick}
					style={{ color: iconColor || undefined }}>
					<span className={`codicon ${iconClass}`} />
				</div>
			</TooltipTrigger>
			<TooltipContent side="top">{tooltipText}</TooltipContent>
		</Tooltip>
	)
}

export default VoiceRecorder
