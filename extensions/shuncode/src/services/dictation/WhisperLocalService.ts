import { execFile } from "node:child_process"
import * as fs from "node:fs"
import * as https from "node:https"
import * as http from "node:http"
import * as os from "node:os"
import * as path from "node:path"
import { promisify } from "node:util"
import { Logger } from "@/shared/services/Logger"

const execFileAsync = promisify(execFile)

// Shuncode CDN — platform-specific voice archives
const SHUNCODE_VOICE_CDN = "https://shuncode-ai.ru/downloads"

// Model options: bundled=true means archive is shipped with the extension for the current platform
const WHISPER_MODELS: Record<string, { file: string; sizeMB: number; archive: string; bundled: boolean }> = {
	tiny: { file: "ggml-tiny.bin", sizeMB: 75, archive: "shuncode-voice-tiny.zip", bundled: true },
	base: { file: "ggml-base.bin", sizeMB: 142, archive: "shuncode-voice-base.zip", bundled: false },
	small: { file: "ggml-small.bin", sizeMB: 466, archive: "shuncode-voice-small.zip", bundled: false },
}

// Platform binary names (inside the archive)
const PLATFORM_BINARIES: Record<string, { binaryName: string; ffmpegName: string }> = {
	win32: { binaryName: "whisper-cli.exe", ffmpegName: "ffmpeg.exe" },
	darwin: { binaryName: "whisper-cli", ffmpegName: "ffmpeg" },
	linux: { binaryName: "whisper-cli", ffmpegName: "ffmpeg" },
}

/**
 * WhisperLocalService — manages local whisper.cpp binary and model for offline transcription.
 *
 * Files stored in: globalStoragePath/whisper/
 *   ├── whisper-cli[.exe]  — whisper.cpp binary
 *   └── ggml-base.bin      — model file
 */
export class WhisperLocalService {
	private whisperDir: string
	private _extensionPath: string | null
	readonly modelName: string

	constructor(globalStoragePath: string, modelName: string = "base", extensionPath?: string) {
		this.whisperDir = path.join(globalStoragePath, "whisper")
		this.modelName = modelName
		this._extensionPath = extensionPath || null
	}

	/** Path to bundled archive for the current platform (if available) */
	private get bundledArchivePath(): string | null {
		if (!this._extensionPath) return null
		const model = WHISPER_MODELS[this.modelName]
		if (!model?.bundled) return null
		const platform = os.platform()
		const archivePath = path.join(this._extensionPath, "assets", "voice", platform, model.archive)
		return fs.existsSync(archivePath) ? archivePath : null
	}

	/**
	 * Delete the model file so ensureReady() will re-download it.
	 * Keeps whisper-cli and ffmpeg binaries (shared across models).
	 */
	resetModel(): void {
		try {
			if (fs.existsSync(this.modelPath)) {
				fs.unlinkSync(this.modelPath)
				Logger.info(`[WhisperLocal] Deleted model: ${this.modelPath}`)
			}
		} catch (err) {
			Logger.error(`[WhisperLocal] Failed to delete model:`, err)
		}
	}

	/** Path to whisper-cli binary */
	get binaryPath(): string {
		const platform = os.platform()
		const info = PLATFORM_BINARIES[platform]
		if (!info) throw new Error(`Unsupported platform: ${platform}`)
		return path.join(this.whisperDir, info.binaryName)
	}

	/** Path to our bundled ffmpeg binary */
	get ffmpegPath(): string {
		const platform = os.platform()
		const info = PLATFORM_BINARIES[platform]
		if (!info) throw new Error(`Unsupported platform: ${platform}`)
		return path.join(this.whisperDir, info.ffmpegName)
	}

	/** Path to model file */
	get modelPath(): string {
		const model = WHISPER_MODELS[this.modelName]
		if (!model) throw new Error(`Unknown model: ${this.modelName}`)
		return path.join(this.whisperDir, model.file)
	}

	/** Check if whisper.cpp binary is available */
	get isBinaryReady(): boolean {
		return fs.existsSync(this.binaryPath)
	}

	/** Check if our ffmpeg is available */
	get isFfmpegReady(): boolean {
		return fs.existsSync(this.ffmpegPath)
	}

	/** Check if model is downloaded */
	get isModelReady(): boolean {
		return fs.existsSync(this.modelPath)
	}

	/** Check if everything is ready for transcription */
	get isReady(): boolean {
		return this.isBinaryReady && this.isModelReady && this.isFfmpegReady
	}

	/**
	 * Check if system has ffmpeg in PATH already.
	 * If yes, we don't need to download our own.
	 */
	get hasSystemFfmpeg(): boolean {
		const name = os.platform() === "win32" ? "ffmpeg.exe" : "ffmpeg"
		const pathDirs = (process.env.PATH || "").split(path.delimiter)
		for (const dir of pathDirs) {
			const fullPath = path.join(dir, name)
			if (fs.existsSync(fullPath)) return true
		}
		return false
	}

	/**
	 * Get the best available ffmpeg path — ours or system.
	 */
	get effectiveFfmpegPath(): string {
		if (this.isFfmpegReady) return this.ffmpegPath
		if (this.hasSystemFfmpeg) return "ffmpeg" // system PATH
		return this.ffmpegPath // will fail if not downloaded yet
	}

	/** Get model size in MB */
	get modelSizeMB(): number {
		return WHISPER_MODELS[this.modelName]?.sizeMB || 0
	}

	/**
	 * Ensure whisper directory exists
	 */
	private async ensureDir(): Promise<void> {
		if (!fs.existsSync(this.whisperDir)) {
			fs.mkdirSync(this.whisperDir, { recursive: true })
		}
	}

	/**
	 * Download a file from URL with redirect support.
	 * Reports progress via callback.
	 */
	/** Auth token for CDN downloads — set before calling ensureReady() */
	public authToken: string | null = null

	private async downloadFile(
		url: string,
		destPath: string,
		onProgress?: (downloaded: number, total: number) => void,
		timeoutMs: number = 300000,
	): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error("Download timed out. Check your internet connection and try again."))
			}, timeoutMs)

			const doRequest = (requestUrl: string, redirectCount = 0) => {
				if (redirectCount > 5) {
					clearTimeout(timer)
					reject(new Error("Too many redirects"))
					return
				}

				const headers: Record<string, string> = { "User-Agent": "Shuncode" }
				if (this.authToken) {
					headers["Authorization"] = `Bearer ${this.authToken}`
				}

				const protocol = requestUrl.startsWith("https") ? https : http
				Logger.info(`[WhisperDownload] GET ${requestUrl}`)
				protocol
					.get(requestUrl, { headers, timeout: 30000 }, (response) => {
						Logger.info(`[WhisperDownload] Response: ${response.statusCode}`)
						// Handle redirects
						if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
							const location = response.headers.location
							// If redirected to login page — auth required, don't follow
							if (location.includes("/auth/login") || location.includes("/login")) {
								clearTimeout(timer)
								reject(new Error("Authorization required. Please sign in to your Shuncode account."))
								return
							}
							doRequest(location, redirectCount + 1)
							return
						}

						if (response.statusCode === 401 || response.statusCode === 403) {
							clearTimeout(timer)
							reject(new Error("Authorization required. Please sign in to your Shuncode account."))
							return
						}

						if (response.statusCode !== 200) {
							clearTimeout(timer)
							reject(new Error(`HTTP ${response.statusCode} downloading ${requestUrl}`))
							return
						}

						const totalBytes = parseInt(response.headers["content-length"] || "0", 10)
						let downloadedBytes = 0

						const fileStream = fs.createWriteStream(destPath)
						response.on("data", (chunk: Buffer) => {
							downloadedBytes += chunk.length
							onProgress?.(downloadedBytes, totalBytes)
						})
						response.pipe(fileStream)
						fileStream.on("finish", () => {
							fileStream.close()
							clearTimeout(timer)
							resolve()
						})
						fileStream.on("error", (err) => {
							clearTimeout(timer)
							fs.unlinkSync(destPath)
							reject(err)
						})
					})
					.on("error", reject)
			}

			doRequest(url)
		})
	}

	/**
	 * Ensure everything is ready.
	 * Uses bundled archive if available, otherwise downloads from CDN.
	 */
	async ensureReady(onProgress?: (message: string, pct?: number) => void): Promise<void> {
		if (this.isReady) return

		await this.ensureDir()

		const model = WHISPER_MODELS[this.modelName]
		if (!model) throw new Error(`Unknown model: ${this.modelName}`)

		const archivePath = path.join(this.whisperDir, model.archive)
		const bundled = this.bundledArchivePath

		try {
			if (bundled) {
				onProgress?.("Installing voice components...")
				Logger.info(`[WhisperLocal] Using bundled archive: ${bundled}`)
				fs.copyFileSync(bundled, archivePath)
			} else {
				const archiveUrl = `${SHUNCODE_VOICE_CDN}/${model.archive}`
				onProgress?.("Downloading voice components...")
				Logger.info(`[WhisperLocal] Downloading: ${archiveUrl}`)
				await this.downloadFile(archiveUrl, archivePath)
			}

			onProgress?.("Extracting...")
			const platform = os.platform()
			if (platform === "win32") {
				await execFileAsync("powershell", [
					"-NoProfile", "-Command",
					`Expand-Archive -Path '${archivePath}' -DestinationPath '${this.whisperDir}' -Force`,
				], { timeout: 120000 })
			} else if (archivePath.endsWith(".tar.xz")) {
				await execFileAsync("tar", ["-xf", archivePath, "-C", this.whisperDir], { timeout: 120000 })
			} else {
				await execFileAsync("unzip", ["-o", archivePath, "-d", this.whisperDir], { timeout: 120000 })
			}

			if (platform !== "win32") {
				if (fs.existsSync(this.binaryPath)) fs.chmodSync(this.binaryPath, 0o755)
				if (fs.existsSync(this.ffmpegPath)) fs.chmodSync(this.ffmpegPath, 0o755)
			}

			if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath)

			if (!this.isReady) {
				throw new Error("Archive extracted but required files not found")
			}

			Logger.info("[WhisperLocal] All components ready")
			onProgress?.("Voice components ready")
		} catch (error) {
			// Cleanup on failure
			if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath)
			throw error
		}
	}

	/**
	 * Transcribe an audio file using local whisper.cpp.
	 *
	 * @param audioFilePath Path to audio file (WAV 16kHz mono recommended)
	 * @param language BCP-47 language code (e.g. "ru", "en")
	 * @returns Transcribed text
	 */
	async transcribe(audioFilePath: string, language: string = "en"): Promise<string> {
		if (!this.isReady) {
			throw new Error("Whisper.cpp not ready. Call ensureReady() first.")
		}

		if (!fs.existsSync(audioFilePath)) {
			throw new Error(`Audio file not found: ${audioFilePath}`)
		}

		Logger.info(`[WhisperLocal] Transcribing: ${audioFilePath}, lang=${language}`)

		const args = [
			"--model", this.modelPath,
			"--language", language,
			"--no-timestamps",
			"--output-txt",
			"--file", audioFilePath,
		]

		try {
			const { stdout, stderr } = await execFileAsync(this.binaryPath, args, {
				timeout: 60000, // 60 sec timeout
				maxBuffer: 10 * 1024 * 1024, // 10 MB
			})

			// whisper.cpp outputs text to stdout
			const text = stdout.trim()

			if (!text && stderr) {
				Logger.warn(`[WhisperLocal] No text output. stderr: ${stderr.substring(0, 500)}`)
			}

			// Also check for .txt output file (--output-txt writes alongside the audio file)
			const txtPath = audioFilePath + ".txt"
			if (!text && fs.existsSync(txtPath)) {
				const fileText = fs.readFileSync(txtPath, "utf-8").trim()
				fs.unlinkSync(txtPath)
				return fileText
			}

			// Cleanup txt file if it was created
			if (fs.existsSync(txtPath)) {
				fs.unlinkSync(txtPath)
			}

			Logger.info(`[WhisperLocal] Transcribed: "${text.substring(0, 100)}..."`)
			return text
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error)
			Logger.error(`[WhisperLocal] Transcription error: ${msg}`)
			throw new Error(`Whisper transcription failed: ${msg}`)
		}
	}

	/**
	 * Convert audio file to WAV 16kHz mono using our ffmpeg (required by whisper.cpp).
	 */
	async convertToWav(inputPath: string, outputPath: string): Promise<void> {
		const ffmpeg = this.effectiveFfmpegPath
		Logger.info(`[WhisperLocal] Converting to WAV using: ${ffmpeg}`)

		try {
			await execFileAsync(ffmpeg, [
				"-i", inputPath,
				"-ar", "16000",
				"-ac", "1",
				"-c:a", "pcm_s16le",
				"-y",
				outputPath,
			], { timeout: 30000 })
		} catch (error) {
			throw new Error(`Failed to convert audio to WAV: ${error instanceof Error ? error.message : error}`)
		}
	}
}

// Singleton instance — initialized when globalStoragePath is available
let _whisperService: WhisperLocalService | null = null

export function getWhisperLocalService(globalStoragePath?: string, modelName?: string, extensionPath?: string): WhisperLocalService | null {
	if (globalStoragePath) {
		const requestedModel = modelName || "base"
		if (!_whisperService || _whisperService.modelName !== requestedModel) {
			_whisperService = new WhisperLocalService(globalStoragePath, requestedModel, extensionPath)
		}
	}
	return _whisperService
}
