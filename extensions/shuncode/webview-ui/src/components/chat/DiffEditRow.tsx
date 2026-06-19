import { StringRequest } from "@shared/proto/shuncode/common"
import { ChevronDownIcon, LoaderCircleIcon } from "lucide-react"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"

/** File type icon for diff header */
function FileTypeIcon({ path }: { path: string }) {
	const ext = path.split(".").pop()?.toLowerCase() || ""
	let label: string
	let className: string
	switch (ext) {
		case "tsx":
		case "jsx":
			label = "⚛"
			className = "text-blue-400"
			break
		case "ts":
			label = "TS"
			className = "text-blue-500 text-[9px] font-bold"
			break
		case "js":
			label = "JS"
			className = "text-yellow-400 text-[9px] font-bold"
			break
		case "css":
		case "scss":
			label = "#"
			className = "text-purple-400 text-[10px] font-bold"
			break
		case "json":
			label = "{}"
			className = "text-yellow-500 text-[9px] font-bold"
			break
		case "py":
			label = "🐍"
			className = ""
			break
		case "rs":
			label = "🦀"
			className = ""
			break
		default:
			label = "⚙"
			className = "text-description"
			break
	}
	return <span className={cn("shrink-0 w-4 text-center", className)}>{label}</span>
}

interface Patch {
	action: string
	path: string
	lines: string[]
	additions: number
	deletions: number
}

// Constants for format markers
const MARKERS = {
	SEARCH_BLOCK: "------- SEARCH",
	SEARCH_SEPARATOR: "=======",
	REPLACE_BLOCK: "+++++++ REPLACE",
	NEW_BEGIN: "*** Begin Patch",
	NEW_END: "*** End Patch",
	FILE_PATTERN: /^\*\*\* (Add|Update|Delete) File: (.+)$/m,
} as const

interface DiffEditRowProps {
	patch: string
	path: string
	isLoading?: boolean
	startLineNumbers?: number[]
}

export const DiffEditRow = memo<DiffEditRowProps>(({ patch, path, isLoading, startLineNumbers }) => {
	const { parsedFiles, isStreaming } = useMemo(() => {
		const parsed = parsePatch(patch, path)
		return {
			parsedFiles: parsed.parsedFiles,
			isStreaming: isLoading || parsed.isStreaming,
		}
	}, [patch, path, isLoading])

	if (!path) {
		return null
	}

	return (
		<div className="space-y-4 rounded-xs">
			{parsedFiles.map((file, index) => (
				<FileBlock
					file={file}
					isStreaming={isStreaming}
					isToolStreaming={!!isLoading}
					key={`${file.path}-${index}`}
					startLineNumber={startLineNumbers?.[index]}
				/>
			))}
		</div>
	)
})

const FileBlock = memo<{ file: Patch; isStreaming: boolean; isToolStreaming: boolean; startLineNumber?: number }>(
	({ file, isStreaming, isToolStreaming, startLineNumber }) => {
		const { t } = useI18n()
		const [isExpanded, setIsExpanded] = useState(true)
		const [showAllLines, setShowAllLines] = useState(isStreaming)
		const wasStreamingRef = useRef(isStreaming)
		const scrollContainerRef = useRef<HTMLDivElement>(null)
		const shouldFollowRef = useRef(true)
		const isProgrammaticScrollRef = useRef(false)

		useEffect(() => {
			const wasStreaming = wasStreamingRef.current
			wasStreamingRef.current = isStreaming

			if (isStreaming) {
				setIsExpanded(true)
				setShowAllLines(true)
				return
			}

			if (wasStreaming) {
				setIsExpanded(true)
				setShowAllLines(false)
			}
		}, [isStreaming])

		// Auto-scroll to bottom during streaming
		useEffect(() => {
			const container = scrollContainerRef.current
			if (!isExpanded || !isStreaming || !shouldFollowRef.current || !container) {
				return
			}

			isProgrammaticScrollRef.current = true
			container.scrollTop = container.scrollHeight - container.clientHeight

			requestAnimationFrame(() => {
				isProgrammaticScrollRef.current = false
			})
		}, [file.lines.length, isExpanded, isStreaming])

		const handleScroll = () => {
			const container = scrollContainerRef.current
			if (!container || isProgrammaticScrollRef.current) {
				return
			}

			const { scrollTop, scrollHeight, clientHeight } = container
			shouldFollowRef.current = Math.abs(scrollHeight - clientHeight - scrollTop) < 10
		}

		const handleOpenFile = (event: React.MouseEvent, atLine?: number) => {
			event.stopPropagation()

			if (file.path) {
				// If line number provided, use format "path:line"
				const pathWithLine = atLine ? `${file.path}:${atLine}` : file.path
				FileServiceClient.openFileRelativePath(StringRequest.create({ value: pathWithLine })).catch((err) =>
					console.error("Failed to open file:", err),
				)
			}
		}

		// Only calculate line numbers if we have actual positions from the backend
		// When startLineNumber is undefined (e.g., V2 diff or no match indices), we skip line numbers entirely
		const lineNumbers = useMemo(() => {
			if (startLineNumber === undefined) {
				return undefined
			}

			let oldLine = startLineNumber
			let newLine = startLineNumber

			return file.lines.map((line) => {
				const isAddition = line.startsWith("+")
				const isDeletion = line.startsWith("-")
				const isContext = !isAddition && !isDeletion

				if (isDeletion) {
					const display = oldLine
					oldLine += 1
					return display
				}

				const display = newLine
				newLine += 1
				if (isContext) {
					oldLine += 1
				}
				return display
			})
		}, [file.lines, startLineNumber])

		return (
			<div className="overflow-hidden rounded-xl border border-editor-group-border bg-code shadow-sm">
				<div
					className="group flex w-full items-center justify-between gap-2 bg-code px-4 py-3 text-left transition-colors hover:bg-secondary/20 active:bg-secondary/35"
					onClick={() => setIsExpanded((prev) => !prev)}
					role="button"
					tabIndex={0}
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault()
							setIsExpanded((prev) => !prev)
						}
					}}>
					<div className="flex min-w-0 flex-1 items-center gap-2">
						{isToolStreaming ? (
							<LoaderCircleIcon aria-hidden className="size-4 shrink-0 animate-spin text-description" />
						) : (
							<FileTypeIcon path={file.path} />
						)}
						<button
							className="min-w-0 truncate text-left font-medium text-foreground transition-colors hover:underline"
							onClick={(e) => handleOpenFile(e, startLineNumber)}
							title={startLineNumber ? `${t("chat.openAtLine")} ${startLineNumber}` : t("chat.openFileInEditor")}
							type="button">
							{file.path.split("/").pop() || file.path}
						</button>
					</div>
					<DiffStats additions={file.additions} deletions={file.deletions} />
				</div>

				{isExpanded && (
					<div
						className={cn("border-t border-code-block-background overflow-x-auto", {
							"max-h-80 overflow-y-auto": showAllLines,
						})}
						onScroll={handleScroll}
						ref={scrollContainerRef}>
						<div className="font-mono text-xs w-max min-w-full">
							{(() => {
								const totalLines = file.lines.length
								const previewLineCount = isStreaming || showAllLines ? totalLines : Math.min(totalLines, 5)
								const shouldCollapse = !showAllLines && !isStreaming && totalLines > previewLineCount
								const hiddenCount = shouldCollapse ? totalLines - previewLineCount : 0

								if (shouldCollapse) {
									return (
										<>
											{file.lines.slice(0, previewLineCount).map((line, index) => (
												<DiffLine
													key={`${index}-${line.slice(0, 20)}`}
													line={line}
													lineNumber={lineNumbers?.[index]}
												/>
											))}
											<button
												className="flex w-full items-center justify-center gap-1 py-1.5 text-description transition-colors hover:bg-secondary/30 hover:text-foreground active:bg-secondary/50"
												onClick={() => setShowAllLines(true)}
												title={t("chat.clickToShowAllLines")}
												type="button">
												<ChevronDownIcon className="size-4" />
												<span className="text-xs">... {hiddenCount} hidden lines ...</span>
											</button>
										</>
									)
								}

								return file.lines.map((line, index) => (
									<DiffLine
										key={`${index}-${line.slice(0, 20)}`}
										line={line}
										lineNumber={lineNumbers?.[index]}
									/>
								))
							})()}
						</div>
					</div>
				)}
			</div>
		)
	},
	(prev, next) =>
		prev.isStreaming === next.isStreaming &&
		prev.isToolStreaming === next.isToolStreaming &&
		prev.startLineNumber === next.startLineNumber &&
		prev.file.path === next.file.path &&
		prev.file.action === next.file.action &&
		prev.file.additions === next.file.additions &&
		prev.file.deletions === next.file.deletions &&
		prev.file.lines === next.file.lines,
)

const DiffStats = memo<{ additions: number; deletions: number }>(({ additions, deletions }) => (
	<div className="text-xs text-gray-500 flex">
		{additions > 0 && <span className="text-success">+{additions}</span>}
		{/* allow-any-unicode-next-line */}
		{additions > 0 && deletions > 0 && <span className="mx-1">·</span>}
		{deletions > 0 && <span className="text-error">-{deletions}</span>}
	</div>
))

// Diff line component with deep background tints for clear visibility
const DiffLine = memo<{ line: string; lineNumber?: number; showLineNumberColumn?: boolean }>(
	({ line, lineNumber, showLineNumberColumn = true }) => {
		const isAddition = line.startsWith("+")
		const isDeletion = line.startsWith("-")
		const hasSpacePrefix = line.startsWith("+ ") || line.startsWith("- ")
		// Extract just the code content (without +/- prefix)
		const code = isAddition || isDeletion ? line.slice(hasSpacePrefix ? 2 : 1) : line
		// Get the prefix character to display
		const prefix = isAddition ? "+" : isDeletion ? "-" : " "

		return (
			<div
				className={cn(
					"flex text-xs font-mono",
					// Deep saturated background tints for clear diff visibility
					isAddition && "bg-green-900/40",
					isDeletion && "bg-red-900/40",
				)}>
				{/* Line number column - always reserve space to prevent layout shift during streaming */}
				{showLineNumberColumn && (
					<span
						className={cn(
							"w-10 min-w-10 text-right pr-2 py-0.5 select-none",
							isAddition && "text-green-400/60",
							isDeletion && "text-red-400/60",
							!isAddition && !isDeletion && "text-description/50",
						)}>
						{lineNumber ?? ""}
					</span>
				)}
				{/* Prefix character (+/-) */}
				<span
					className={cn(
						"w-4 min-w-4 text-center py-0.5 select-none",
						isAddition && "text-green-400",
						isDeletion && "text-red-400",
						!isAddition && !isDeletion && "text-description/50",
					)}>
					{prefix}
				</span>
				{/* Code content - keep readable with normal text color */}
				<span
					className={cn(
						"flex-1 pr-2 py-0.5 whitespace-nowrap",
						isAddition && "text-green-300",
						isDeletion && "text-red-300",
						!isAddition && !isDeletion && "text-editor-foreground",
					)}>
					{code}
				</span>
			</div>
		)
	},
)

// ============================================================================
// Parsing Functions
// ============================================================================

interface ParseResult {
	parsedFiles: Patch[]
	isStreaming: boolean
}

/**
 * Main parsing function that detects format and delegates to appropriate parser
 */
function parsePatch(patch: string, path: string): ParseResult {
	// Try old format first (------- SEARCH / ======= / +++++++ REPLACE)
	if (patch.includes(MARKERS.SEARCH_BLOCK)) {
		const results = parseAllSearchReplaceBlocks(patch, path)
		if (results.length > 0) {
			// Count how many complete blocks we have (those ending with REPLACE marker)
			const replaceCount = (patch.match(/\+{7,} REPLACE/g) || []).length
			const searchCount = (patch.match(/-{7,} SEARCH/g) || []).length
			return {
				parsedFiles: results,
				isStreaming: replaceCount < searchCount,
			}
		}
	}

	// Try new format (*** Begin Patch / *** End Patch)
	if (patch.includes(MARKERS.NEW_BEGIN)) {
		const endIndex = patch.indexOf(MARKERS.NEW_END)
		const isComplete = endIndex !== -1

		const beginIndex = patch.indexOf(MARKERS.NEW_BEGIN)
		const contentStart = beginIndex + MARKERS.NEW_BEGIN.length
		const contentEnd = isComplete ? endIndex : patch.length
		const patchContent = patch.substring(contentStart, contentEnd).trim()

		const parsed = parseNewFormat(patchContent)
		if (parsed.length > 0) {
			return { parsedFiles: parsed, isStreaming: !isComplete }
		}
	}

	// Fallback: treat entire patch as a new file addition
	if (path && patch) {
		const lines = patch.split("\n")
		return {
			parsedFiles: [
				{
					action: "Add",
					path,
					lines: lines.map((line) => `+ ${line}`),
					additions: lines.length,
					deletions: 0,
				},
			],
			isStreaming: true,
		}
	}

	return { parsedFiles: [], isStreaming: true }
}

/**
 * Parse new format patches (*** Add/Update/Delete File: path)
 * Splits each @@ chunk into a separate Patch object so each chunk can have its own startLineNumber
 */
function parseNewFormat(content: string): Patch[] {
	const files: Patch[] = []
	const lines = content.split("\n")

	let currentFile: { action: string; path: string } | null = null
	let currentChunk: Patch | null = null

	const pushCurrentChunk = () => {
		if (currentChunk && currentChunk.lines.length > 0) {
			files.push(currentChunk)
		}
	}

	const startNewChunk = () => {
		if (!currentFile) {
			return
		}
		pushCurrentChunk()
		currentChunk = {
			action: currentFile.action,
			path: currentFile.path,
			lines: [],
			additions: 0,
			deletions: 0,
		}
	}

	for (const line of lines) {
		const fileMatch = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/)

		if (fileMatch) {
			// New file - push any existing chunk and start fresh
			pushCurrentChunk()
			currentFile = {
				action: fileMatch[1],
				path: fileMatch[2].trim(),
			}
			currentChunk = null // Will be created when we see content or @@
		} else if (line.trim() === "@@") {
			// @@ marker means start of a new chunk - split here
			startNewChunk()
		} else if (currentFile && line.trim()) {
			// Content line - ensure we have a chunk to add to
			if (!currentChunk) {
				currentChunk = {
					action: currentFile.action,
					path: currentFile.path,
					lines: [],
					additions: 0,
					deletions: 0,
				}
			}
			currentChunk.lines.push(line)
			if (line[0] === "+") {
				currentChunk.additions++
			} else if (line[0] === "-") {
				currentChunk.deletions++
			}
		}
	}

	// Push the last chunk
	pushCurrentChunk()

	return files
}

/**
 * Parse all SEARCH/REPLACE blocks from a diff string
 * Returns an array of Patch objects, one per SEARCH/REPLACE block
 */
function parseAllSearchReplaceBlocks(patch: string, path: string): Patch[] {
	const results: Patch[] = []
	const searchRegex = /-{7,} SEARCH/g
	let match: RegExpExecArray | null

	// Find all SEARCH markers and extract each block
	const searchPositions: number[] = []
	for (;;) {
		match = searchRegex.exec(patch)
		if (match === null) {
			break
		}
		searchPositions.push(match.index)
	}

	// Parse each block
	for (let i = 0; i < searchPositions.length; i++) {
		const start = searchPositions[i]
		// The end is either the next SEARCH marker or the end of the patch
		const end = i < searchPositions.length - 1 ? searchPositions[i + 1] : patch.length
		const blockContent = patch.substring(start, end)

		const parsed = parseSearchReplaceFormat(blockContent, path)
		if (parsed) {
			results.push(parsed)
		}
	}

	return results
}

/**
 * Parse a single SEARCH REPLACE diff format block (------- SEARCH / ======= / +++++++ REPLACE)
 * Converts SEARCH block to deletions (-) and REPLACE block to additions (+)
 */
function parseSearchReplaceFormat(patch: string, path: string): Patch | undefined {
	const searchIndex = patch.indexOf(MARKERS.SEARCH_BLOCK)
	if (searchIndex === -1) {
		return undefined
	}

	// Extract file metadata if present
	const fileMatch = patch.match(MARKERS.FILE_PATTERN)

	const result: Patch = {
		action: fileMatch?.[1] ?? "Update",
		path: fileMatch?.[2]?.trim() ?? path ?? "",
		lines: [],
		additions: 0,
		deletions: 0,
	}

	// Extract content after SEARCH marker
	const afterSearch = patch.substring(searchIndex + MARKERS.SEARCH_BLOCK.length).replace(/^\r?\n/, "")

	const separatorIndex = afterSearch.indexOf(MARKERS.SEARCH_SEPARATOR)

	if (separatorIndex === -1) {
		// Still streaming - only SEARCH block available
		const searchContent = afterSearch.trimEnd()
		addLinesToPatch(result, searchContent, "-")
		return result
	}

	// Extract SEARCH block (deletions)
	const searchContent = afterSearch.substring(0, separatorIndex).replace(/\r?\n$/, "")
	addLinesToPatch(result, searchContent, "-")

	// Extract REPLACE block (additions)
	const afterSeparator = afterSearch.substring(separatorIndex + MARKERS.SEARCH_SEPARATOR.length).replace(/^\r?\n/, "")
	const replaceEndIndex = afterSeparator.indexOf(MARKERS.REPLACE_BLOCK)

	const replaceContent =
		replaceEndIndex !== -1 ? afterSeparator.substring(0, replaceEndIndex).replace(/\r?\n$/, "") : afterSeparator.trimEnd()

	addLinesToPatch(result, replaceContent, "+")

	return result
}

/**
 * Helper to add lines to a patch with the specified prefix
 */
function addLinesToPatch(patch: Patch, content: string, prefix: "+" | "-"): void {
	const lines = content.split("\n")
	for (const line of lines) {
		patch.lines.push(`${prefix} ${line}`)
		if (prefix === "+") {
			patch.additions++
		} else {
			patch.deletions++
		}
	}
}
