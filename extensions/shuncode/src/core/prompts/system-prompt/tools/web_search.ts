import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const GENERIC: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ShuncodeDefaultTool.WEB_SEARCH,
	name: "web_search",
	description: `Performs a local web search via DuckDuckGo and returns relevant results
- Takes a search query as input and returns search results with titles, URLs, and snippets
- Optionally filter results by allowed or blocked domains
- Use this tool when you need to search the web for information
- You may provide either allowed_domains OR blocked_domains, but NOT both
- Domains should be provided as a JSON array of strings
- This tool is read-only and does not modify any files`,
	parameters: [
		{
			name: "query",
			required: true,
			instruction: "The search query to use",
			usage: "latest developments in AI",
		},
		{
			name: "allowed_domains",
			required: false,
			instruction: "JSON array of domains to restrict results to",
			usage: '["example.com", "github.com"]',
		},
		{
			name: "blocked_domains",
			required: false,
			instruction: "JSON array of domains to exclude from results",
			usage: '["ads.com", "spam.com"]',
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ShuncodeToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id: ShuncodeDefaultTool.WEB_SEARCH,
	name: "web_search",
	description:
		"Performs a local web search via DuckDuckGo and returns relevant results with titles, URLs, and snippets. Use this tool when you need to find current information from the internet.",
	parameters: [
		{
			name: "query",
			required: true,
			instruction: "The search query to use",
		},
		{
			name: "allowed_domains",
			required: false,
			instruction: "JSON array of domains to restrict results to",
		},
		{
			name: "blocked_domains",
			required: false,
			instruction: "JSON array of domains to exclude from results",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ShuncodeToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const web_search_variants = [GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN]
