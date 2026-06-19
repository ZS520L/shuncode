import { ShuncodeMessage, ShuncodeSayTool } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/shuncode/common"
import { ChevronRightIcon, SquareArrowOutUpRightIcon, TerminalSquareIcon } from "lucide-react"
import { memo, useCallback, useMemo, useState } from "react"
import { cleanPathPrefix } from "@/components/common/CodeAccordian"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"
import { getIconByToolName, getToolsNotInCurrentActivities, isLowStakesTool } from "../../utils/messageUtils"

interface ToolGroupRendererProps {
	messages: ShuncodeMessage[]
	allMessages: ShuncodeMessage[]
}

interface ToolWithReasoning {
	tool: ShuncodeMessage
	parsedTool: ShuncodeSayTool
	reasoning?: string
}

const EXPANDABLE_TOOLS = new Set([
	"listFilesTopLevel",
	"listFilesRecursive",
	"listCodeDefinitionNames",
	"searchFiles",
	"glob",
	"editedExistingFile",
	"newFileCreated",
	"webSearch",
	"webFetch",
	"readDiagnostics",
])

/**
 * Renders a collapsible group of low-stakes tool calls.
 * Only shows tools that are NOT in the "current activities" range (PAST tools only).
 */
export const ToolGroupRenderer = memo(({ messages, allMessages }: ToolGroupRendererProps) => {
	const { t } = useI18n()
	const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>({})

	// Filter out tools in the "current activities" range (being shown in loading state)
	const filteredMessages = useMemo(() => getToolsNotInCurrentActivities(messages, allMessages), [messages, allMessages])

	// Build tool items with associated reasoning (reasoning that comes BEFORE a tool)
	const toolsWithReasoning = useMemo(() => buildToolsWithReasoning(filteredMessages), [filteredMessages])

	const summary = getToolGroupSummary(filteredMessages, t)

	const handleOpenFile = useCallback((filePath: string) => {
		FileServiceClient.openFileRelativePath(StringRequest.create({ value: filePath })).catch((err) =>
			console.error("Failed to open file:", err),
		)
	}, [])

	const handleItemToggle = useCallback((ts: number) => {
		setExpandedItems((prev) => ({ ...prev, [ts]: !prev[ts] }))
	}, [])

	// Don't render if no PAST tools to show
	if (toolsWithReasoning.length === 0) {
		return null
	}

	return (
		<div className={cn("px-4 py-2 text-description")}>
			{/* Header */}
			<div className="text-[13px] opacity-90 mb-1">{summary}:</div>

			{/* Content - files/folders with reasoning in tooltip */}
			<div className="min-w-0 space-y-0.5">
				{toolsWithReasoning.map(({ tool, parsedTool, reasoning }) => {
					const info = getToolDisplayInfo(parsedTool, t)
					if (!info) {
						return null
					}

					const isExpandable = EXPANDABLE_TOOLS.has(parsedTool.tool)
					const isItemExpanded = expandedItems[tool.ts] ?? false
					const content = parsedTool.content || null
					const hasReasoning = !!reasoning?.length

					return (
						<div className="min-w-0" key={tool.ts}>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										aria-expanded={isExpandable ? isItemExpanded : undefined}
										className="group flex items-center gap-1.5 cursor-pointer text-[13px] text-description py-1 px-1.5 hover:bg-secondary/25 hover:text-foreground active:bg-secondary/45 active:scale-[0.997] min-w-0 max-w-full rounded-sm transition-all duration-150"
										onClick={() => (isExpandable ? handleItemToggle(tool.ts) : handleOpenFile(info.path))}
										size="icon"
										type="button"
										variant="text">
										{isExpandable && (
											<ChevronRightIcon
												className={cn("size-3 shrink-0 opacity-70 transition-transform duration-150", {
													"rotate-90": isItemExpanded,
												})}
											/>
										)}
										<info.icon className="opacity-70 shrink-0 size-[13px] transition-colors group-hover:opacity-100" />
										<span
											className={cn(
												"flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis text-left [direction:rtl] text-[13px] group-hover:underline",
												{
													"[direction:ltr]": !!info.displayText,
												},
											)}>
											{(info.displayText || cleanPathPrefix(info.path)) + "\u200E"}
										</span>
										{!isExpandable && <SquareArrowOutUpRightIcon className="size-3 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />}
									</Button>
								</TooltipTrigger>
								{hasReasoning && <TooltipContent side="bottom">{reasoning}</TooltipContent>}
							</Tooltip>
							{/* Expanded content for folders/search/definitions - raw text */}
							{isExpandable && isItemExpanded && content && (
								<pre className="m-1 ml-6 text-xs text-description whitespace-pre-wrap break-words p-2 max-h-40 overflow-auto rounded-sm border border-editor-group-border bg-code">
									{content}
								</pre>
							)}
						</div>
					)
				})}
			</div>
		</div>
	)
})

/**
 * Build tool items with associated reasoning (reasoning that comes BEFORE a tool).
 * Only processes low-stakes tools, accumulating reasoning messages along the way.
 */
function buildToolsWithReasoning(messages: ShuncodeMessage[]): ToolWithReasoning[] {
	const result: ToolWithReasoning[] = []
	const reasoningBuffer: string[] = []

	for (const msg of messages) {
		// Reasoning and intermediate text — both go into the buffer (hidden in tooltip)
		if (msg.say === "reasoning" && msg.text) {
			reasoningBuffer.push(msg.text)
		} else if (msg.say === "text" && msg.text) {
			// Intermediate AI text absorbed into tool group — treat as reasoning
			reasoningBuffer.push(msg.text)
		} else if (isLowStakesTool(msg)) {
			// Command messages don't have JSON tool payload
			const isCommand = msg.say === "command" || msg.ask === "command"
			const parsedTool = isCommand
				? ({ tool: "command", path: "", content: msg.text } as ShuncodeSayTool)
				: parseToolSafe(msg.text)
			result.push({
				tool: msg,
				parsedTool,
				reasoning: reasoningBuffer.length > 0 ? reasoningBuffer.join("\n\n") : undefined,
			})
			reasoningBuffer.length = 0
		}
	}

	return result
}

/**
 * Safely parse tool JSON, returning empty tool on failure.
 */
function parseToolSafe(text: string | undefined): ShuncodeSayTool {
	try {
		return JSON.parse(text || "{}") as ShuncodeSayTool
	} catch {
		return {} as ShuncodeSayTool
	}
}

/**
 * Get display info for a tool.
 */
function getToolDisplayInfo(tool: ShuncodeSayTool, t: (key: string) => string) {
	const icon = getIconByToolName(tool.tool)
	const filePath = tool.path || ""
	const folderPath = filePath + "/"

	switch (tool.tool) {
		case "readFile":
			return { icon, path: filePath, label: t("process.read") }
		case "readDiagnostics":
			return { icon, path: filePath || "workspace", label: t("toolDisplay.diagnostics") }
		case "listFilesTopLevel":
			return { icon, path: folderPath, label: t("toolGroup.listed") }
		case "listFilesRecursive":
			return { icon, path: folderPath, label: t("toolDisplay.listedRecursive") }
		case "listCodeDefinitionNames":
			return { icon, path: folderPath, label: t("toolGroup.definitions") }
		case "searchFiles":
			return {
				icon,
				path: folderPath,
				label: `${t("tool.search")}: ${tool.regex}`,
				displayText: formatSearchDisplay(tool.regex || "", filePath, tool.filePattern, t),
			}
		case "glob":
			return { icon, path: filePath || "", label: "glob", displayText: `glob: ${cleanPathPrefix(filePath || "")}` }
		case "editedExistingFile":
			// allow-any-unicode-next-line
			return { icon, path: filePath, label: t("tool.edited"), displayText: `✏️ ${cleanPathPrefix(filePath)}` }
		case "newFileCreated":
			// allow-any-unicode-next-line
			return { icon, path: filePath, label: t("tool.created"), displayText: `➕ ${cleanPathPrefix(filePath)}` }
		case "fileDeleted":
			// allow-any-unicode-next-line
			return { icon, path: filePath, label: t("tool.deleted"), displayText: `🗑️ ${cleanPathPrefix(filePath)}` }
		case "webSearch":
			// allow-any-unicode-next-line
			return { icon, path: "", label: t("toolDisplay.searched"), displayText: `🔍 ${tool.content?.substring(0, 80) || t("toolDisplay.webSearch")}` }
		case "webFetch":
			// allow-any-unicode-next-line
			return { icon, path: filePath || "", label: t("toolDisplay.fetched"), displayText: `🌐 ${cleanPathPrefix(filePath || "url")}` }
		case "summarizeTask":
			// allow-any-unicode-next-line
			return { icon, path: "", label: t("toolDisplay.summarized"), displayText: `📝 ${t("toolDisplay.summarizedConversation")}` }
		case "useSkill":
			// allow-any-unicode-next-line
			return { icon, path: filePath || "", label: t("toolDisplay.skill"), displayText: `⚡ ${cleanPathPrefix(filePath || "skill")}` }
		case "command":
			return {
				icon: TerminalSquareIcon,
				path: "",
				label: t("toolDisplay.ran"),
				// allow-any-unicode-next-line
				displayText: `⚡ ${(tool.content || t("toolDisplay.command")).substring(0, 80)}`,
			}
		case "fastContext":
			return {
				icon,
				path: "",
				label: "Fast Context",
				displayText: `🔍 ${tool.query || tool.content?.substring(0, 80) || "searching..."}`,
			}
		default:
			return { icon, path: filePath || "", label: tool.tool || "tool" }
	}
}

/**
 * Format search regex for display - simplify complex patterns
 */
function formatSearchDisplay(regex: string, path: string, filePattern?: string, t?: (key: string) => string): string {
	// Split by | and clean up regex syntax
	const terms = regex
		.split("|")
		.map((term) => term.trim().replace(/\\b/g, "").replace(/\\s\?/g, " "))
		.filter(Boolean)

	const patternsLabel = t ? t("toolDisplay.patterns") : "patterns"
	const termDisplay = terms.length > 3 ? `${terms.length} ${patternsLabel}` : `"${terms.join(" | ")}"`
	let result = `${termDisplay} in ${cleanPathPrefix(path)}/`

	if (filePattern && filePattern !== "*") {
		result += ` (${filePattern})`
	}

	return result
}

/**
 * Get summary label for a tool group - shows what's been added to context.
 */
function getToolGroupSummary(messages: ShuncodeMessage[], t: (key: string) => string): string {
	const counts = { read: 0, list: 0, search: 0, def: 0, edit: 0, create: 0, del: 0, cmd: 0, web: 0, other: 0 }

	for (const msg of messages) {
		if (!isLowStakesTool(msg)) {
			continue
		}

		// Command messages
		if (msg.say === "command" || msg.ask === "command") {
			counts.cmd++
			continue
		}

		const tool = parseToolSafe(msg.text)
		switch (tool.tool) {
			case "readFile":
			case "readDiagnostics":
				counts.read++
				break
			case "listFilesTopLevel":
			case "listFilesRecursive":
				counts.list++
				break
			case "searchFiles":
			case "glob":
				counts.search++
				break
			case "listCodeDefinitionNames":
				counts.def++
				break
			case "editedExistingFile":
				counts.edit++
				break
			case "newFileCreated":
				counts.create++
				break
			case "fileDeleted":
				counts.del++
				break
			case "webSearch":
			case "webFetch":
				counts.web++
				break
			default:
				counts.other++
				break
		}
	}

	const parts: string[] = []

	if (counts.read > 0) parts.push(`${t("process.read")} ${counts.read}`)
	if (counts.list > 0) parts.push(`${t("toolGroup.listed")} ${counts.list}`)
	if (counts.edit > 0) parts.push(`${t("process.edited")} ${counts.edit}`)
	if (counts.create > 0) parts.push(`${t("process.created")} ${counts.create}`)
	if (counts.del > 0) parts.push(`${t("process.deleted")} ${counts.del}`)
	if (counts.cmd > 0) parts.push(`${t("process.commands")} ${counts.cmd}`)
	if (counts.search > 0) parts.push(`${t("process.search")} ${counts.search}`)
	if (counts.web > 0) parts.push(`${t("process.web")} ${counts.web}`)
	if (counts.def > 0) parts.push(`${t("toolGroup.definitions")} ${counts.def}`)

	return parts.length === 0 ? t("toolGroup.shuncodeWorked") : `Shuncode ${parts.join(", ")}`
}
