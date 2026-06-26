import type { ShuncodeMessage, ShuncodeSayTool } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/shuncode/common"
import { ChevronRightIcon } from "lucide-react"
import { memo, useCallback, useState } from "react"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"

interface ReadFileGroupProps {
	messages: ShuncodeMessage[]
}

/**
 * Renders a collapsible group of consecutive readFile tool calls.
 * Header: "˅ Read  filename.tsx  and N other files"
 * Children: individual "Read  filename.tsx #L1-100" rows
 */
export const ReadFileGroup = memo(({ messages }: ReadFileGroupProps) => {
	const [isExpanded, setIsExpanded] = useState(false)

	// Parse all messages to determine display
	const tools = messages.map(parseTool).filter(Boolean) as ShuncodeSayTool[]
	const firstName = getFileName(tools[0]?.path || "")
	const uniqueFiles = new Set(tools.map((t) => getFileName(t.path ?? "")))
	const allSameFile = uniqueFiles.size === 1
	const otherCount = allSameFile ? 0 : messages.length - 1

	const handleOpenFile = useCallback((absolutePath: string | undefined) => {
		if (!absolutePath) return
		FileServiceClient.openFile(StringRequest.create({ value: absolutePath })).catch((err) =>
			console.error("Failed to open file:", err),
		)
	}, [])

	return (
		<div className="px-4 py-0.5">
			<button
				className={cn(
					"group flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-[12px] text-description transition-all duration-150",
					"hover:border-editor-group-border hover:bg-secondary/30 hover:text-foreground active:bg-secondary/50 active:scale-[0.997]",
					{ "bg-secondary/20 text-foreground": isExpanded },
				)}
				onClick={() => setIsExpanded(!isExpanded)}
				type="button">
				<ChevronRightIcon
					className={cn("size-3 shrink-0 transition-transform duration-150 group-hover:text-foreground", { "rotate-90": isExpanded })}
				/>
				<span className="truncate">
					<span className="font-medium">Read</span>
					<span className="ml-1.5 text-foreground/70">{firstName}</span>
					{otherCount > 0 && (
						<span className="text-description/70 ml-1">and {otherCount} other file{otherCount > 1 ? "s" : ""}</span>
					)}
				</span>
			</button>

			{/* Expanded children — indented individual read items */}
			{isExpanded && (
				<div className="mt-1 ml-3 overflow-y-auto text-[11px] leading-[18px] text-description max-h-[280px]">
					{messages.map((msg) => {
						const tool = parseTool(msg)
						if (!tool) return null
						const fileName = getFileName(tool.path ?? "")
						const lineRange = formatLineRange(tool.lineRange)
						return (
							<button
								className={cn(
									"group flex w-full min-w-0 items-center gap-2 rounded-md border border-transparent px-2 py-1 text-left text-description/75 transition-all duration-150",
									"hover:border-editor-group-border hover:bg-secondary/25 hover:text-foreground active:bg-secondary/45 active:scale-[0.997]",
									"cursor-pointer",
								)}
								key={msg.ts}
								onClick={() => handleOpenFile(tool.content)}
								type="button">
								<span className="font-medium shrink-0">Read</span>
								<span className="ph-no-capture min-w-0 truncate text-link hover:underline">
									{fileName}{lineRange}
								</span>
							</button>
						)
					})}
				</div>
			)}
		</div>
	)
})

ReadFileGroup.displayName = "ReadFileGroup"

function parseTool(msg: ShuncodeMessage): ShuncodeSayTool | null {
	try {
		return JSON.parse(msg.text || "{}") as ShuncodeSayTool
	} catch {
		return null
	}
}

function getFileName(path: string): string {
	return path.split(/[/\\]/).pop() || path
}

/** Format line range: "38-38" → " #L38", "1-100" → " #L1-100", undefined → "" */
function formatLineRange(lineRange: string | undefined): string {
	if (!lineRange) return ""
	const parts = lineRange.split("-")
	if (parts.length === 2 && parts[0] === parts[1]) {
		return ` #L${parts[0]}`
	}
	return ` #L${lineRange}`
}
