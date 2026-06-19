import type { AudioDevice } from "./DictationSettings"

/**
 * Cached Windows audio device name.
 * Detected once via `ffmpeg -list_devices` and reused.
 */
let _cachedWinAudioDevice: string | null = null

/** Get the cached Windows audio device name */
export function getCachedWinAudioDevice(): string | null {
	return _cachedWinAudioDevice
}

/** Set the cached Windows audio device (e.g. from user settings) */
export function setCachedWinAudioDevice(device: string | null): void {
	_cachedWinAudioDevice = device
}

export const AUDIO_PROGRAM_CONFIG = {
	darwin: {
		command: "ffmpeg",
		fallbackPaths: ["/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"],
		getArgs: (outputFile: string, deviceId?: string) => [
			"-f",
			"avfoundation",
			"-i",
			deviceId ? `:${deviceId}` : ":default",
			"-c:a",
			"libopus",
			"-b:a",
			"32k",
			"-application",
			"voip",
			"-ar",
			"16000",
			"-ac",
			"1",
			outputFile,
		],
		dependencyName: "FFmpeg",
		installCommand: "brew install ffmpeg",
		error: "FFmpeg is required for voice recording but is not installed on your system.",
		installDescription: "FFmpeg is a multimedia framework that Shuncode uses to record audio from your microphone.",
	},
	linux: {
		command: "ffmpeg",
		fallbackPaths: ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/snap/bin/ffmpeg"],
		getArgs: (outputFile: string, deviceId?: string) => [
			"-f",
			"alsa",
			"-i",
			deviceId || "default",
			"-c:a",
			"libopus",
			"-b:a",
			"32k",
			"-application",
			"voip",
			"-ar",
			"16000",
			"-ac",
			"1",
			outputFile,
		],
		dependencyName: "FFmpeg",
		installCommand: "sudo apt-get update && sudo apt-get install -y ffmpeg",
		error: "FFmpeg is required for voice recording but is not installed on your system.",
		installDescription: "FFmpeg is a multimedia framework that Shuncode uses to record audio from your microphone.",
	},
	win32: {
		command: "ffmpeg",
		fallbackPaths: [
			"C:\\ffmpeg\\bin\\ffmpeg.exe",
			"C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
			"C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe",
		],
		getArgs: (outputFile: string, deviceId?: string) => [
			"-f",
			"dshow",
			"-i",
			`audio=${deviceId || _cachedWinAudioDevice || "default"}`,
			"-c:a",
			"libopus",
			"-b:a",
			"32k",
			"-application",
			"voip",
			"-ar",
			"16000",
			"-ac",
			"1",
			outputFile,
		],
		dependencyName: "FFmpeg",
		installCommand: "winget install Gyan.FFmpeg",
		error: "FFmpeg is required for voice recording but is not installed on your system.",
		installDescription: "FFmpeg is a multimedia framework that Shuncode uses to record audio from your microphone.",
	},
}

/**
 * Detect the working default audio input device on Windows.
 *
 * Strategy:
 * 1. List all audio devices via ffmpeg -list_devices (dshow)
 * 2. Try a 1-second test recording with each device
 * 3. Pick the first device that produces non-empty audio
 * 4. Cache the result for the session
 *
 * This works reliably regardless of system language, device order, or configuration.
 */
export async function detectWindowsAudioDevice(ffmpegPath: string): Promise<string | null> {
	if (_cachedWinAudioDevice) return _cachedWinAudioDevice

	const { execFile } = await import("node:child_process")
	const { promisify } = await import("node:util")
	const fs = await import("node:fs")
	const os = await import("node:os")
	const path = await import("node:path")
	const execFileAsync = promisify(execFile)

	try {
		// 1. List all audio devices
		const { stderr } = await execFileAsync(ffmpegPath, [
			"-list_devices", "true", "-f", "dshow", "-i", "dummy",
		], { timeout: 5000 }).catch((err: any) => ({ stderr: err.stderr || "", stdout: "" }))

		const lines = stderr.split("\n")
		const audioDevices: string[] = []
		for (const line of lines) {
			const match = line.match(/"([^"]+)"\s*\(audio\)/)
			if (match) {
				audioDevices.push(match[1])
			}
		}

		if (audioDevices.length === 0) {
			console.warn("[AudioDevice] No audio devices found")
			return null
		}

		console.log(`[AudioDevice] Found ${audioDevices.length} audio devices: ${audioDevices.map(d => `"${d}"`).join(", ")}`)

		// 2. Test each device with a 1-second recording
		for (const device of audioDevices) {
			const testFile = path.join(os.tmpdir(), `shuncode_mic_test_${Date.now()}.wav`)

			try {
				console.log(`[AudioDevice] Testing: "${device}"...`)
				await execFileAsync(ffmpegPath, [
					"-f", "dshow",
					"-i", `audio=${device}`,
					"-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
					"-t", "1",
					testFile, "-y",
				], { timeout: 5000 })

				// Check if file has actual audio data (> 1KB = real audio, not just WAV header)
				if (fs.existsSync(testFile)) {
					const size = fs.statSync(testFile).size
					fs.unlinkSync(testFile)

					if (size > 1000) {
						_cachedWinAudioDevice = device
						console.log(`[AudioDevice] ✓ Working device: "${device}" (${size} bytes)`)
						return _cachedWinAudioDevice
				} else {
						// allow-any-unicode-next-line
						console.log(`[AudioDevice] ✗ Empty audio: "${device}" (${size} bytes)`)
				}
				}
			} catch (testErr) {
				// allow-any-unicode-next-line
				console.log(`[AudioDevice] ✗ Failed: "${device}" — ${testErr instanceof Error ? testErr.message.substring(0, 80) : testErr}`)
				// Cleanup
				try { if (fs.existsSync(testFile)) fs.unlinkSync(testFile) } catch {}
			}
		}

		console.warn("[AudioDevice] No working audio device found")
		return null
	} catch (err) {
		console.error("[AudioDevice] Detection failed:", err)
		return null
	}
}

/**
 * List all available audio input devices using ffmpeg.
 * Works on all platforms: Windows (dshow), macOS (avfoundation), Linux (alsa/pulse).
 *
 * Returns an array of AudioDevice objects with id and name.
 */
export async function listAudioDevices(ffmpegPath: string): Promise<AudioDevice[]> {
	const { execFile } = await import("node:child_process")
	const { promisify } = await import("node:util")
	const execFileAsync = promisify(execFile)
	const platform = (await import("node:os")).platform()
	const devices: AudioDevice[] = []

	try {
		if (platform === "win32") {
			// Windows: use dshow
			const { stderr } = await execFileAsync(ffmpegPath, [
				"-list_devices", "true", "-f", "dshow", "-i", "dummy",
			], { timeout: 5000 }).catch((err: any) => ({ stderr: err.stderr || "", stdout: "" }))

			const lines = stderr.split("\n")
			for (const line of lines) {
				const match = line.match(/"([^"]+)"\s*\(audio\)/)
				if (match) {
					devices.push({ id: match[1], name: match[1] })
				}
			}
		} else if (platform === "darwin") {
			// macOS: use avfoundation
			const { stderr } = await execFileAsync(ffmpegPath, [
				"-f", "avfoundation", "-list_devices", "true", "-i", "",
			], { timeout: 5000 }).catch((err: any) => ({ stderr: err.stderr || "", stdout: "" }))

			const lines = stderr.split("\n")
			let isAudioSection = false
			for (const line of lines) {
				if (line.includes("AVFoundation audio devices:")) {
					isAudioSection = true
					continue
				}
				if (isAudioSection) {
					// Format: [AVFoundation indev @ 0x...] [0] Device Name
					const match = line.match(/\[(\d+)]\s+(.+)/)
					if (match) {
						devices.push({ id: match[1], name: match[2].trim() })
					}
				}
			}
		} else {
			// Linux: try to list ALSA capture devices
			try {
				const { stdout } = await execFileAsync("arecord", ["-l"], { timeout: 5000 })
				const lines = stdout.split("\n")
				for (const line of lines) {
					// Format: card 0: PCH [HDA Intel PCH], device 0: ALC897 Analog [ALC897 Analog]
					const match = line.match(/card\s+(\d+):\s+\S+\s+\[([^\]]+)\],\s+device\s+(\d+):\s+(.+)/)
					if (match) {
						const deviceId = `hw:${match[1]},${match[3]}`
						const deviceName = `${match[2]} - ${match[4].replace(/\s*\[.*\]/, "").trim()}`
						devices.push({ id: deviceId, name: deviceName })
					}
				}
			} catch {
				// arecord not available, try pulseaudio
				try {
					const { stdout } = await execFileAsync("pactl", ["list", "sources", "short"], { timeout: 5000 })
					const lines = stdout.split("\n")
					for (const line of lines) {
						const parts = line.trim().split("\t")
						if (parts.length >= 2 && !parts[1].includes("monitor")) {
							devices.push({ id: parts[1], name: parts[1] })
						}
					}
				} catch {
					// No audio listing available
				}
			}
		}

		console.log(`[listAudioDevices] Found ${devices.length} devices on ${platform}`)
		return devices
	} catch (err) {
		console.error("[listAudioDevices] Failed:", err)
		return []
	}
}
