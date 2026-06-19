import { ShuncodeMessage, ShuncodeSayTool } from "@shared/ExtensionMessage"
import { Mode } from "@shared/storage/types"
import { LucideIcon } from "lucide-react"
import type React from "react"
import { useMemo } from "react"
import { useI18n } from "@/i18n"
import { cleanPathPrefix } from "../common/CodeAccordian"
import { getIconByToolName } from "./chat-view"
import ErrorRow from "./ErrorRow"
import { ThinkingRow } from "./ThinkingRow"
import { TypewriterText } from "./TypewriterText"

interface RequestStartRowProps {
	message: ShuncodeMessage
	apiRequestFailedMessage?: string
	apiReqStreamingFailedMessage?: string
	cost?: number
	reasoningContent?: string
	responseStarted?: boolean
	shuncodeMessages: ShuncodeMessage[]
	mode?: Mode
	classNames?: string
	isExpanded: boolean
	handleToggle: () => void
}

// State type for api_req_started rendering
type ApiReqState = "pre" | "thinking" | "error" | "final"

// Helper to format search regex for display - show all terms separated by |
const formatSearchRegex = (regex: string, path: string, filePattern?: string): string => {
	const cleanedPath = cleanPathPrefix(path)
	const terms = regex
		.split("|")
		.map((t) => t.trim().replace(/\\b/g, "").replace(/\\s\?/g, " "))
		.filter(Boolean)
		.join(" | ")
	return filePattern && filePattern !== "*" ? `"${terms}" in ${cleanedPath}/ (${filePattern})` : `"${terms}" in ${cleanedPath}/`
}
// Format activity text based on tool type
const getActivityText = (tool: ShuncodeSayTool, t: (key: string) => string): string | null => {
	const cleanedPath = cleanPathPrefix(tool.path || "")
	switch (tool.tool) {
		case "readFile":
			return tool.path ? `${t("activity.reading")} ${cleanedPath}...` : null
		case "listFilesTopLevel":
		case "listFilesRecursive":
			return tool.path ? `${t("activity.exploring")} ${cleanedPath}/...` : null
		case "searchFiles":
			return tool.regex && tool.path ? `${t("activity.searching")} ${formatSearchRegex(tool.regex, tool.path, tool.filePattern)}...` : null
		case "listCodeDefinitionNames":
			return tool.path ? `${t("activity.analyzing")} ${cleanedPath}/...` : null
		default:
			return null
	}
}

// Collect tools in a given range, with optional stop condition
const collectToolsInRange = (
	messages: ShuncodeMessage[],
	startIdx: number,
	endIdx: number,
	t: (key: string) => string,
	stopCondition?: (msg: ShuncodeMessage) => boolean,
): { icon: LucideIcon; text: string }[] => {
	const activities: { icon: LucideIcon; text: string }[] = []
	for (let i = startIdx; i < endIdx; i++) {
		const msg = messages[i]
		if (stopCondition?.(msg)) {
			break
		}
		if (msg.say !== "tool" && msg.ask !== "tool") {
			continue
		}

		try {
			const tool = JSON.parse(msg.text || "{}") as ShuncodeSayTool
			const activityText = getActivityText(tool, t)
			if (activityText) {
				const toolIcon = getIconByToolName(tool.tool)
				activities.push({ icon: toolIcon, text: activityText })
			}
		} catch {
			// ignore parse errors
		}
	}
	return activities
}

// Find current api_req and determine if it has cost
const findCurrentApiReq = (messages: ShuncodeMessage[]): { index: number; hasCost: boolean } | null => {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.say === "api_req_started" && msg.text) {
			try {
				const info = JSON.parse(msg.text)
				return { index: i, hasCost: info.cost != null }
			} catch {
				return null
			}
		}
	}
	return null
}

// Find the most recent completed api_req before the given index
const findPrevCompletedApiReq = (messages: ShuncodeMessage[], beforeIdx: number): number => {
	for (let i = beforeIdx - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.say === "api_req_started" && msg.text) {
			try {
				const info = JSON.parse(msg.text)
				if (info.cost != null) {
					return i
				}
			} catch {
				// ignore parse errors
			}
		}
	}
	return -1
}

/**
 * Displays the current state of an active tool operation,
 */
export const RequestStartRow: React.FC<RequestStartRowProps> = ({
	apiRequestFailedMessage,
	apiReqStreamingFailedMessage,
	cost,
	reasoningContent,
	responseStarted,
	shuncodeMessages,
	mode,
	handleToggle,
	isExpanded,
	message,
}) => {
	const { t } = useI18n()
	// Derive explicit state
	const hasError = !!(apiRequestFailedMessage || apiReqStreamingFailedMessage)
	const hasCost = cost != null
	const hasReasoning = !!reasoningContent
	const hasResponseStarted = !!responseStarted

	const apiReqState: ApiReqState = hasError ? "error" : hasCost ? "final" : hasReasoning ? "thinking" : "pre"

	// While reasoning is streaming, keep the Brain ThinkingBlock exactly as-is.
	// Once response content starts (any text/tool/command), collapse into a compact
	// "🧠 Thinking" row that can be expanded to show the reasoning only.
	const showStreamingThinking = hasReasoning && !hasResponseStarted && !hasError && !hasCost

	// Find all exploratory tool activities that are currently in flight.
	// Only show tools between the previous completed API request and the current incomplete one.
	// Once an API request completes (has cost), tool messages that follow belong to the next cycle.
	const currentActivities = useMemo(() => {
		const currentApiReq = findCurrentApiReq(shuncodeMessages)
		if (!currentApiReq) {
			return []
		}

		if (!currentApiReq.hasCost) {
			// CASE A: Current api_req is INCOMPLETE
			const prevIdx = findPrevCompletedApiReq(shuncodeMessages, currentApiReq.index)
			if (prevIdx === -1) {
				return []
			}
			return collectToolsInRange(shuncodeMessages, prevIdx + 1, currentApiReq.index, t)
		}
		// CASE B: Current api_req is COMPLETE - no activities to show
		return []
	}, [shuncodeMessages, t])

	return (
		<div>
			{apiReqState === "pre" && (
				<div className="flex items-center text-description w-full text-sm">
					<div className="ml-1 flex-1 w-full h-full">
						{currentActivities.length > 0 ? (
							<div className="flex flex-col gap-0.5 w-full min-h-1">
								{currentActivities.map((activity, _) => (
									<div className="flex items-center gap-2 h-auto w-full overflow-hidden" key={activity.text}>
										<activity.icon className="size-2 text-foreground shrink-0" />
										<TypewriterText speed={15} text={activity.text} />
									</div>
								))}
							</div>
						) : (
							<TypewriterText
								text={message.partial !== false ? (mode === "plan" ? t("request.planning") : t("request.thinking")) : ""}
							/>
						)}
					</div>
				</div>
			)}
			{reasoningContent && (
				<ThinkingRow
					isExpanded={isExpanded || showStreamingThinking}
					isThinking={showStreamingThinking}
					isVisible={true}
					onToggle={handleToggle}
					reasoningContent={reasoningContent}
					showTitle={false}
					startTime={message.ts}
				/>
			)}

			{apiReqState === "error" && (
				<ErrorRow
					apiReqStreamingFailedMessage={apiReqStreamingFailedMessage}
					apiRequestFailedMessage={apiRequestFailedMessage}
					errorType="error"
					message={message}
				/>
			)}
		</div>
	)
}
