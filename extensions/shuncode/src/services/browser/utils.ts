import { fileExistsAtPath } from "@utils/fs"
import AdmZip from "adm-zip"
import axios from "axios"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
// @ts-ignore
import PCR from "puppeteer-chromium-resolver"
import { launch } from "puppeteer-core"
import { HostProvider } from "@/hosts/host-provider"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"

interface PCRStats {
	puppeteer: { launch: typeof launch }
	executablePath: string
}

const SHUNCODE_CHROMIUM_URLS: Record<string, string> = {
	win64: "https://storage.yandexcloud.net/shuncode-releases/chrome-headless-shell-win64.zip",
	linux64: "https://storage.yandexcloud.net/shuncode-releases/chrome-headless-shell-linux64.zip",
	"mac-arm64": "https://storage.yandexcloud.net/shuncode-releases/chrome-headless-shell-mac-arm64.zip",
}

function getShuncodeChromiumUrl(): string | undefined {
	const platform = os.platform()
	const arch = os.arch()

	if (platform === "win32") return SHUNCODE_CHROMIUM_URLS["win64"]
	if (platform === "linux") return SHUNCODE_CHROMIUM_URLS["linux64"]
	if (platform === "darwin" && arch === "arm64") return SHUNCODE_CHROMIUM_URLS["mac-arm64"]

	return undefined
}

async function findExecutableInDir(dir: string): Promise<string | undefined> {
	const platform = os.platform()
	const exeName = platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell"

	async function search(currentDir: string): Promise<string | undefined> {
		try {
			const entries = await fs.readdir(currentDir, { withFileTypes: true })
			for (const entry of entries) {
				const fullPath = path.join(currentDir, entry.name)
				if (entry.isFile() && entry.name === exeName) {
					return fullPath
				}
				if (entry.isDirectory()) {
					const found = await search(fullPath)
					if (found) return found
				}
			}
		} catch {
			// ignore
		}
		return undefined
	}

	return search(dir)
}

export type DownloadProgressCallback = (percent: number) => void

async function downloadShuncodeChromium(
	puppeteerDir: string,
	onProgress?: DownloadProgressCallback,
): Promise<string | undefined> {
	const url = getShuncodeChromiumUrl()
	if (!url) {
		Logger.info("Shuncode Chromium: no URL for this platform")
		return undefined
	}

	const extractDir = path.join(puppeteerDir, "shuncode-chromium")

	const existingExe = await findExecutableInDir(extractDir)
	if (existingExe) {
		Logger.info(`Shuncode Chromium already exists: ${existingExe}`)
		return existingExe
	}

	Logger.info(`[Shuncode Chromium] Downloading from: ${url}`)

	try {
		const response = await axios.get(url, {
			responseType: "arraybuffer",
			timeout: 120_000,
			onDownloadProgress: (progressEvent) => {
				if (onProgress && progressEvent.total) {
					const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100)
					onProgress(percent)
				}
			},
			...getAxiosSettings(),
		})

		Logger.info(`[Shuncode Chromium] Downloaded ${response.data.byteLength} bytes`)

		onProgress?.(100)
		await fs.mkdir(extractDir, { recursive: true })

		const zip = new AdmZip(Buffer.from(response.data))
		zip.extractAllTo(extractDir, true)

		if (os.platform() !== "win32") {
			const exe = await findExecutableInDir(extractDir)
			if (exe) {
				await fs.chmod(exe, 0o755)
			}
		}

		const exePath = await findExecutableInDir(extractDir)
		if (exePath) {
			Logger.info(`Shuncode Chromium extracted: ${exePath}`)
			return exePath
		}

		Logger.warn("[Shuncode Chromium] Extracted but executable not found in: " + extractDir)
		return undefined
	} catch (error) {
		Logger.warn(`[Shuncode Chromium] Failed: ${(error as Error).message}`)
		return undefined
	}
}

export async function ensureChromiumExists(onProgress?: DownloadProgressCallback): Promise<PCRStats> {
	const puppeteerDir = path.join(HostProvider.get().globalStorageFsPath, "puppeteer")
	const dirExists = await fileExistsAtPath(puppeteerDir)
	if (!dirExists) {
		await fs.mkdir(puppeteerDir, { recursive: true })
	}

	Logger.info("[Shuncode Chromium] ensureChromiumExists called, trying Yandex Cloud first...")
	const shuncodeExe = await downloadShuncodeChromium(puppeteerDir, onProgress)
	if (shuncodeExe) {
		Logger.info(`[Shuncode Chromium] Using Shuncode binary: ${shuncodeExe}`)
		const puppeteer = await import("puppeteer-core")
		return {
			puppeteer: { launch: puppeteer.launch },
			executablePath: shuncodeExe,
		}
	}

	Logger.info("[Shuncode Chromium] Falling back to PCR (Google CDN)")
	const stats: PCRStats = await PCR({
		downloadPath: puppeteerDir,
	})
	return stats
}
