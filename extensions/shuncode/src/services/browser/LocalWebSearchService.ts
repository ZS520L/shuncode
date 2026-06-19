import axios from "axios"
import * as cheerio from "cheerio"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"

export interface WebSearchResult {
	title: string
	url: string
	snippet: string
}

export interface WebSearchOptions {
	region?: string
	safeSearch?: "strict" | "moderate" | "off"
	maxResults?: number
}

const DEFAULT_REGION = "cn-zh"
const DEFAULT_SAFE_SEARCH: NonNullable<WebSearchOptions["safeSearch"]> = "moderate"
const DEFAULT_MAX_RESULTS = 10

const safeSearchParam: Record<NonNullable<WebSearchOptions["safeSearch"]>, string> = {
	strict: "1",
	moderate: "-1",
	off: "-2",
}

export class LocalWebSearchService {
	async search(
		query: string,
		allowedDomains?: string[],
		blockedDomains?: string[],
		options: WebSearchOptions = {},
	): Promise<WebSearchResult[]> {
		const region = normalizeRegion(options.region) || DEFAULT_REGION
		const safeSearch = options.safeSearch || DEFAULT_SAFE_SEARCH
		const maxResults = normalizeMaxResults(options.maxResults)
		const searchParams = new URLSearchParams({
			q: query,
			kl: region,
			kp: safeSearchParam[safeSearch],
		})
		const url = `https://html.duckduckgo.com/html/?${searchParams.toString()}`

		const response = await axios.get(url, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Accept-Language": getAcceptLanguage(region),
			},
			timeout: 10_000,
			...getAxiosSettings(),
		})

		const $ = cheerio.load(response.data)
		const results: WebSearchResult[] = []
		const seenUrls = new Set<string>()

		$(".result").each((_i, el) => {
			const titleEl = $(el).find(".result__title a")
			const snippetEl = $(el).find(".result__snippet")
			const title = titleEl.text().trim()
			const rawHref = titleEl.attr("href") || ""
			const realUrl = normalizeResultUrl(extractRealUrl(rawHref))
			const snippet = snippetEl.text().trim()

			if (title && realUrl && realUrl.startsWith("http") && !seenUrls.has(realUrl)) {
				seenUrls.add(realUrl)
				results.push({ title, url: realUrl, snippet })
			}
		})

		let filtered = results
		const normalizedAllowedDomains = normalizeDomainFilters(allowedDomains)
		const normalizedBlockedDomains = normalizeDomainFilters(blockedDomains)

		if (normalizedAllowedDomains.length > 0) {
			filtered = filtered.filter((r) => {
				try {
					const host = normalizeHostname(new URL(r.url).hostname)
					return normalizedAllowedDomains.some((domain) => domainMatches(host, domain))
				} catch {
					return false
				}
			})
		}

		if (normalizedBlockedDomains.length > 0) {
			filtered = filtered.filter((r) => {
				try {
					const host = normalizeHostname(new URL(r.url).hostname)
					return !normalizedBlockedDomains.some((domain) => domainMatches(host, domain))
				} catch {
					return true
				}
			})
		}

		filtered = filtered.slice(0, maxResults)

		Logger.info(
			`LocalWebSearchService: query="${query.slice(0, 120)}", region=${region}, results=${filtered.length}`,
		)
		return filtered
	}
}

function extractRealUrl(duckUrl: string): string {
	try {
		if (duckUrl.includes("uddg=")) {
			const urlObj = new URL(duckUrl, "https://duckduckgo.com")
			const realUrl = urlObj.searchParams.get("uddg")
			if (realUrl) return realUrl
		}
		if (duckUrl.startsWith("http")) return duckUrl
	} catch {
		// ignore
	}
	return duckUrl
}

function normalizeRegion(region?: string): string | undefined {
	const value = region?.trim().toLowerCase()
	if (!value) return undefined
	return /^[a-z]{2}-[a-z]{2}$|^wt-wt$/.test(value) ? value : undefined
}

function getAcceptLanguage(region: string): string {
	if (region.endsWith("-zh")) return "zh-CN,zh;q=0.9,en;q=0.6"
	if (region.endsWith("-ja")) return "ja-JP,ja;q=0.9,en;q=0.6"
	if (region.endsWith("-ko")) return "ko-KR,ko;q=0.9,en;q=0.6"
	return "en-US,en;q=0.8"
}

function normalizeMaxResults(maxResults?: number): number {
	if (!Number.isFinite(maxResults)) return DEFAULT_MAX_RESULTS
	return Math.min(Math.max(Math.floor(maxResults || DEFAULT_MAX_RESULTS), 1), 10)
}

function normalizeDomainFilters(domains?: string[]): string[] {
	if (!domains) return []
	return Array.from(new Set(domains.map(normalizeDomainFilter).filter((domain): domain is string => !!domain)))
}

function normalizeDomainFilter(domain: string): string | undefined {
	const trimmed = domain.trim().toLowerCase()
	if (!trimmed) return undefined

	try {
		const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`)
		return normalizeHostname(url.hostname)
	} catch {
		return normalizeHostname(trimmed.split("/")[0])
	}
}

function normalizeHostname(hostname: string): string {
	return hostname.toLowerCase().replace(/^www\./, "")
}

function domainMatches(host: string, domain: string): boolean {
	return host === domain || host.endsWith(`.${domain}`)
}

function normalizeResultUrl(rawUrl: string): string {
	try {
		const url = new URL(rawUrl)
		url.hash = ""
		url.protocol = url.protocol.toLowerCase()
		url.hostname = url.hostname.toLowerCase()

		for (const key of Array.from(url.searchParams.keys())) {
			const lowerKey = key.toLowerCase()
			if (
				lowerKey.startsWith("utm_") ||
				["fbclid", "gclid", "msclkid", "yclid", "spm", "from", "source"].includes(lowerKey)
			) {
				url.searchParams.delete(key)
			}
		}

		return url.toString()
	} catch {
		return rawUrl
	}
}
