import type { ShuncodeMessage, ShuncodeSayTool } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/shuncode/common"
import { ChevronRightIcon, FileCode2Icon } from "lucide-react"
import { memo, useCallback, useState } from "react"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"

interface ReadFileGroupProps {
	messages: ShuncodeMessage[]
}

/**
 * Renders a collapsible group of consecutive readFile tool calls for the same file.
 * Header: "˅ Read  filename.tsx"
 * Children: "   Read  filename.tsx #L1-100" etc.
 */
export const ReadFileGroup = memo(({ messages }: ReadFileGroupProps) => {
	const [isExpanded, setIsExpanded] = useState(false)

	// Parse first message to get file info
	const firstTool = parseTool(messages[0])
	const fileName = getFileName(firstTool?.path || "")

	const handleOpenFile = useCallback((absolutePath: string | undefined) => {
		if (!absolutePath) return
		FileServiceClient.openFile(StringRequest.create({ value: absolutePath })).catch((err) =>
			console.error("Failed to open file:", err),
		)
	}, [])

	return (
		<div className="py-0.5">
			{/* Collapsible header */}
			<button
				className={cn(
					"flex items-center gap-2 py-1 px-1 text-[13px] text-description w-full text-left",
					"cursor-pointer hover:text-foreground transition-colors",
				)}
				onClick={() => setIsExpanded(!isExpanded)}
				type="button">
				<ChevronRightIcon
					className={cn("size-3 shrink-0 opacity-70 transition-transform duration-150", {
						"rotate-90": isExpanded,
					})}
				/>
				<FileCode2Icon className="size-3.5 shrink-0 opacity-70" />
				<span className="text-foreground/80 font-medium shrink-0">Read</span>
				<span className="ph-no-capture min-w-0 truncate text-link">
					{fileName}
				</span>
			</button>

			{/* Expanded children */}
			{isExpanded && (
				<div className="ml-5 space-y-0">
					{messages.map((msg) => {
						const tool = parseTool(msg)
						if (!tool) return null
						const lineRange = tool.lineRange ? ` #L${tool.lineRange}` : ""
						return (
							<button
								className="flex items-center gap-2 py-1 px-1 text-[13px] text-description w-full text-left cursor-pointer hover:text-foreground transition-colors"
								key={msg.ts}
								onClick={() => handleOpenFile(tool.content)}
								type="button">
								<span className="text-foreground/80 font-medium shrink-0">Read</span>
								<span className="ph-no-capture min-w-0 truncate text-link hover:underline">
									{getFileName(tool.path ?? "")}{lineRange}
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
