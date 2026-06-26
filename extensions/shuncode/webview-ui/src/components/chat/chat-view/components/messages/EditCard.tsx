import { ShuncodeMessage, ShuncodeSayTool } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/shuncode/common"
import { ChevronDownIcon, ChevronRightIcon, FileCode2Icon, FileMinus2Icon, FilePlus2Icon, PencilIcon } from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cleanPathPrefix } from "@/components/common/CodeAccordian"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"

interface EditCardProps {
	message: ShuncodeMessage
}

/**
 * EditCard — compact card showing a file edit/create/delete in the main chat.
 * Clickable header opens the file. Chevron toggles diff preview.
 */
export const EditCard = memo(({ message }: EditCardProps) => {
	const { t } = useI18n()
	const [expanded, setExpanded] = useState(true)
	const tool = useMemo(() => {
		try {
			return JSON.parse(message.text || "{}") as ShuncodeSayTool
		} catch {
			return {} as ShuncodeSayTool
		}
	}, [message.text])

	const filePath = tool.path || ""
	const cleanPath = filePath ? cleanPathPrefix(filePath) : "file"
	const startLine = tool.startLineNumbers?.[0]

	const Icon = useMemo(() => {
		switch (tool.tool) {
			case "editedExistingFile": return PencilIcon
			case "newFileCreated": return FilePlus2Icon
			case "fileDeleted": return FileMinus2Icon
			default: return FileCode2Icon
		}
	}, [tool.tool])

	const hunkId = tool.hunkId

	const handleFileClick = useCallback(() => {
		if (!filePath) return
		let target: string
		if (hunkId) {
			target = `${filePath}?hunk=${hunkId}`
		} else if (startLine) {
			target = `${filePath}:${startLine}`
		} else {
			target = filePath
		}
		FileServiceClient.openFileRelativePath(StringRequest.create({ value: target })).catch((err) =>
			console.error("Failed to open file:", err),
		)
	}, [filePath, startLine, hunkId])

	// Parse diff lines and compute stats
	const { lines: diffLines, additions, deletions } = useMemo(() => {
		if (!tool.content) return { lines: null, additions: 0, deletions: 0 }
		const raw = tool.content.split("\n")
		if (raw.length === 0) return { lines: null, additions: 0, deletions: 0 }

		// For new files, all lines are additions (content has no +/- prefixes)
		if (tool.tool === "newFileCreated") {
			const parsed = raw.map((line) => ({ type: "add" as const, text: line }))
			return { lines: parsed, additions: raw.length, deletions: 0 }
		}

		let adds = 0
		let dels = 0
		const parsed = raw.map((line) => {
			if (line.startsWith("+")) {
				adds++
				return { type: "add" as const, text: line.slice(1) }
			}
			if (line.startsWith("-")) {
				dels++
				return { type: "del" as const, text: line.slice(1) }
			}
			return { type: "ctx" as const, text: line }
		})
		return { lines: parsed, additions: adds, deletions: dels }
	}, [tool.content])

	// Auto-scroll down while streaming
	const previewRef = useRef<HTMLPreElement>(null)
	useEffect(() => {
		if (message.partial && previewRef.current) {
			previewRef.current.scrollTop = previewRef.current.scrollHeight
		}
	}, [diffLines, message.partial])

	return (
		<div className="px-4 py-1">
			<div className="w-full rounded-lg border border-description/15 bg-[var(--vscode-editor-background)] overflow-hidden">
				{/* Header */}
				<div className="flex items-center gap-1.5 px-3 py-2 hover:bg-white/5 transition-colors">
					<button
						className="flex items-center gap-1.5 shrink-0 cursor-pointer bg-transparent border-none p-0"
						onClick={() => setExpanded(!expanded)}
						type="button"
						aria-label={expanded ? "Collapse" : "Expand"}>
						{expanded
							? <ChevronDownIcon className="size-3.5 text-description/60" />
							: <ChevronRightIcon className="size-3.5 text-description/60" />
						}
					</button>
					<Icon className="size-3.5 shrink-0 text-description/70" />
					<button
						className="text-[12px] font-medium text-foreground truncate cursor-pointer bg-transparent border-none p-0 hover:underline"
						onClick={handleFileClick}
						type="button">
						{cleanPath}
					</button>
					{startLine && <span className="text-description/50 text-[11px]">:{startLine}</span>}
					{/* Stats */}
					<div className="ml-auto flex items-center gap-1.5 text-[11px] shrink-0">
						{additions > 0 && <span className="text-green-400 font-medium">+{additions}</span>}
						{deletions > 0 && <span className="text-red-400 font-medium">-{deletions}</span>}
						{message.partial && <span className="text-description/50 animate-pulse">...</span>}
					</div>
				</div>

				{/* Diff preview */}
				{expanded && diffLines && (
					<pre ref={previewRef} className="m-0 px-3 pb-2 text-[11px] leading-[18px] whitespace-pre-wrap break-words font-mono max-h-[240px] overflow-y-auto">
						{diffLines.map((line, i) => (
							<div
								className={cn("px-2 -mx-1 rounded-sm", {
									"bg-red-500/10 text-[var(--vscode-editor-foreground)]": line.type === "del",
									"bg-green-500/10 text-[var(--vscode-editor-foreground)]": line.type === "add",
									"text-description/80": line.type === "ctx",
								})}
								// biome-ignore lint/suspicious/noArrayIndexKey: diff lines can repeat, index needed for stable key
								key={`${line.text}-${i}`}>
								{line.text || "\u00A0"}
							</div>
						))}
					</pre>
				)}
			</div>
		</div>
	)
})

EditCard.displayName = "EditCard"
