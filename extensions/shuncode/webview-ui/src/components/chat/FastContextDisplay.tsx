import { LoaderCircleIcon } from "lucide-react"
import React, { useState } from "react"
import type { ShuncodeSayTool } from "@shared/ExtensionMessage"
import { cn } from "@/lib/utils"

/** Binoculars icon matching Windsurf's Fast Context branding */
function BinocularsIcon({ className, animate }: { className?: string; animate?: boolean }) {
	return (
		<svg
			className={className}
			viewBox="0 0 1024 1024"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			style={animate ? {
				animation: "binocularsPrecession 1.5s linear infinite",
				transformOrigin: "center center",
			} : undefined}>
			<path d="M825.12 306.784c-22.864-23.168-40.912-41.472-52-69.104-43.072-107.36-121.52-133.408-180.704-122.08-35.296 6.832-65.888 26.816-88.416 54.976-22.528-28.16-53.12-48.16-88.416-54.96-59.088-11.36-137.632 14.672-180.704 122.08-11.088 27.616-29.136 45.92-52 69.088C124.224 366.24 51.584 440 48.16 700.736 46.4 816.752 139.84 912 256 912c114.88 0 208-93.12 208-208s-93.12-208-208-208a206.72 206.72 0 0 0-109.872 31.616c21.616-91.552 59.184-129.648 93.696-164.64 25.68-26.032 52.224-52.944 69.296-95.52 21.2-52.832 55.392-80.112 91.296-73.296C432.032 200.272 464 234.448 464 288v16h80v-16c0-53.552 31.984-87.728 63.584-93.84 36-6.832 70.08 20.48 91.296 73.312 17.072 42.56 43.616 69.472 69.28 95.504 34.528 34.992 72.096 73.088 93.712 164.64A206.72 206.72 0 0 0 752 496c-114.88 0-208 93.12-208 208s93.12 208 208 208c116.16 0 209.6-95.248 207.84-211.264-3.424-260.736-76.064-334.496-134.72-393.952zM256 576a128 128 0 0 1 0 256c-69.968 0-126.752-56.176-127.888-125.888C128.896 627.696 189.44 576 256 576z m496 256a128 128 0 0 1 0-256c66.288 0 127.104 51.44 127.888 130.112C878.752 775.84 821.968 832 752 832z m-144-464H400l-32 80h272l-32-80z" fill="currentColor" />
			{animate && (
				<style>{`
					@keyframes binocularsPrecession {
						0% { transform: perspective(80px) rotateX(21deg) rotateZ(0deg); }
						25% { transform: perspective(80px) rotateY(-21deg) rotateZ(0deg); }
						50% { transform: perspective(80px) rotateX(-21deg) rotateZ(0deg); }
						75% { transform: perspective(80px) rotateY(21deg) rotateZ(0deg); }
						100% { transform: perspective(80px) rotateX(21deg) rotateZ(0deg); }
					}
				`}</style>
			)}
		</svg>
	)
}

interface FastContextDisplayProps {
	tool: ShuncodeSayTool
	isStreaming: boolean
}

interface FoundFile {
	filePath: string
	startLine: number
	endLine: number
	relevance?: string
}

const OPERATION_ICONS: Record<string, string> = {
	grep: "⊙",
	read_file: "📄",
	find_files: "🔍",
}

const OPERATION_LABELS: Record<string, string> = {
	grep: "Grepping",
	read_file: "Reading",
	find_files: "Finding",
}

/** Get file extension for icon styling */
function getFileExtIcon(filePath: string): { label: string; className: string } {
	const ext = filePath.split(".").pop()?.toLowerCase() || ""
	switch (ext) {
		case "tsx":
		case "jsx":
			return { label: "⚛", className: "text-blue-400" }
		case "ts":
			return { label: "TS", className: "text-blue-500 text-[9px] font-bold" }
		case "js":
			return { label: "JS", className: "text-yellow-400 text-[9px] font-bold" }
		case "css":
		case "scss":
			return { label: "🎨", className: "" }
		case "json":
			return { label: "{}", className: "text-yellow-500 text-[9px] font-bold" }
		default:
			return { label: "📄", className: "" }
	}
}

/** Get just the filename from a path */
function getFileName(filePath: string): string {
	return filePath.split("/").pop() || filePath
}

const FastContextDisplay: React.FC<FastContextDisplayProps> = ({ tool, isStreaming }) => {
	const [isExpanded, setIsExpanded] = useState(true)
	const query = tool.query || tool.content || ""
	const turns = tool.turns || []
	const foundFiles: FoundFile[] = tool.foundFiles || []
	const status = tool.status || (isStreaming ? "searching" : "complete")
	const resultCount = tool.resultCount
	const durationMs = tool.durationMs

	const isComplete = status === "complete" || status === "error"
	const canToggle = !isStreaming || isComplete

	// Windsurf-style: when complete, show found files; when searching, show turns
	const shouldShowFoundFiles = isComplete && foundFiles.length > 0

	return (
		<div
			className={cn(
				"overflow-hidden rounded-md border border-editor-group-border bg-code transition-colors duration-150",
				{ "border-success/35 shadow-[inset_2px_0_0_var(--vscode-testing-iconPassed)]": isStreaming && !isComplete },
			)}>
			{/* Header */}
			<button
				className={cn(
					"group flex w-full items-center gap-2 py-2 px-2.5 text-left text-description bg-transparent border-0 transition-all duration-150",
					"hover:bg-secondary/25 hover:text-foreground active:bg-secondary/45 active:scale-[0.997]",
					{ "cursor-pointer select-none": canToggle, "cursor-wait": !canToggle },
				)}
				onClick={() => canToggle && setIsExpanded(!isExpanded)}
				type="button">
				<BinocularsIcon className={cn("size-4 shrink-0", isStreaming && !isComplete ? "text-description" : "text-charts-green")} animate={isStreaming && !isComplete} />
				<span className="font-medium text-foreground">Fast Context</span>
				<span className="ph-no-capture min-w-0 flex-1 truncate text-description text-xs">
					{query}
				</span>
				<div className="grow" />
				{isComplete && durationMs && (
					<span className="text-[11px] text-description/70 shrink-0">
						in {(durationMs / 1000).toFixed(2)}s
					</span>
				)}
				{isComplete && resultCount !== undefined && (
					<span className="text-[11px] text-charts-green shrink-0 ml-1">
						{resultCount} results
					</span>
				)}
			</button>

			{/* Expanded body */}
			{isExpanded && (
				<div className="border-t border-editor-group-border px-3 py-2 space-y-2">
					{/* During search: show turns with reasoning + operations */}
					{!isComplete && turns.length > 0 && (
						<div className="space-y-2">
							{turns.map((turn, tIdx) => (
								<div key={tIdx} className="space-y-1">
									{/* Turn reasoning (Windsurf-style italic text) */}
									{turn.reasoning && (
										<div className="text-xs text-description/80">
											{turn.reasoning}
										</div>
									)}
									{/* Turn operations */}
									{turn.operations.length > 0 && (
										<div className="space-y-0.5">
											{turn.operations.map((op, i) => (
												<div key={i} className="flex items-center gap-1.5 text-xs text-description">
													<span className="shrink-0 w-3 text-center">
														{op.status === "running" ? (
															<LoaderCircleIcon className="size-2.5 animate-spin inline-block" />
														) : (
															<span className="text-[10px] text-charts-green">{OPERATION_ICONS[op.type] || "⊙"}</span>
														)}
													</span>
													<span className="font-medium text-foreground/80">
														{OPERATION_LABELS[op.type] || op.type}
													</span>
													<span className="ph-no-capture truncate min-w-0 flex-1 font-mono text-[11px]">
														{op.args}
													</span>
													{op.duration !== undefined && (
														<span className="text-[10px] text-description/60 shrink-0">
															{op.duration < 1000 ? `${op.duration}ms` : `${(op.duration / 1000).toFixed(1)}s`}
														</span>
													)}
												</div>
											))}
										</div>
									)}
								</div>
							))}
						</div>
					)}

					{/* Sailing indicator */}
					{!isComplete && (
						<div className="text-[11px] text-charts-green animate-pulse">
							Sailing...
						</div>
					)}

					{/* After completion: show found files (Windsurf-style) */}
					{shouldShowFoundFiles && (
						<div className="space-y-0.5">
							{foundFiles.map((file, i) => {
								const icon = getFileExtIcon(file.filePath)
								const fileName = getFileName(file.filePath)
								return (
									<div key={i} className="flex items-center gap-2 text-xs py-0.5">
										<span className={cn("shrink-0 w-4 text-center", icon.className)}>
											{icon.label}
										</span>
										<span className="font-medium text-foreground">
											{fileName}
										</span>
										<span className="text-description/70 text-[11px]">
											L{file.startLine}-{file.endLine}
										</span>
									</div>
								)
							})}
						</div>
					)}

					{/* Error state */}
					{status === "error" && (
						<div className="text-[11px] text-error pt-1">
							{tool.content}
						</div>
					)}
				</div>
			)}
		</div>
	)
}

export default FastContextDisplay
