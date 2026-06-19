import { ChevronRightIcon, LoaderCircleIcon } from "lucide-react"
import React, { useMemo } from "react"
import { cn } from "@/lib/utils"
import CodeAccordian from "../common/CodeAccordian"

interface SearchResultsDisplayProps {
	content: string
	isExpanded: boolean
	isLoading?: boolean
	onToggleExpand: () => void
	path: string
	filePattern?: string
}

const SearchResultsDisplay: React.FC<SearchResultsDisplayProps> = ({
	content,
	isExpanded,
	isLoading = false,
	onToggleExpand,
	path,
	filePattern,
}) => {
	const parsedData = useMemo(() => {
		// Check if this is a multi-workspace result
		const multiWorkspaceMatch = content.match(/^Found \d+ results? across \d+ workspaces?\./m)

		if (!multiWorkspaceMatch) {
			// Single workspace result - return as is
			return { isMultiWorkspace: false }
		}

		// Parse multi-workspace results
		const lines = content.split("\n")
		const sections: Array<{ workspace: string; content: string }> = []
		let currentWorkspace: string | null = null
		let currentContent: string[] = []

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]

			// Check for workspace header
			if (line.startsWith("## Workspace: ")) {
				// Save previous workspace section if exists
				if (currentWorkspace && currentContent.length > 0) {
					sections.push({
						workspace: currentWorkspace,
						content: currentContent.join("\n"),
					})
				}

				// Start new workspace section
				currentWorkspace = line.replace("## Workspace: ", "").trim()
				currentContent = []
			} else if (currentWorkspace) {
				// Add line to current workspace content
				currentContent.push(line)
			}
		}

		// Save last workspace section
		if (currentWorkspace && currentContent.length > 0) {
			sections.push({
				workspace: currentWorkspace,
				content: currentContent.join("\n"),
			})
		}

		return { isMultiWorkspace: true, sections, summaryLine: lines[0] }
	}, [content])

	const isOpen = isLoading || isExpanded
	const canToggle = !isLoading

	// For single workspace, use the standard CodeAccordian
	if (!parsedData.isMultiWorkspace) {
		return (
			<CodeAccordian
				code={content}
				isExpanded={isExpanded}
				isLoading={isLoading}
				language="plaintext"
				onToggleExpand={onToggleExpand}
				path={path + (filePattern ? `/(${filePattern})` : "")}
			/>
		)
	}

	// For multi-workspace results, render a custom view
	const { sections, summaryLine } = parsedData

	return (
		<div
			className={cn(
				"overflow-hidden rounded-md border border-editor-group-border bg-code transition-colors duration-150",
				{ "border-success/35 shadow-[inset_2px_0_0_var(--vscode-testing-iconPassed)]": isLoading },
			)}>
			<button
				aria-label={isOpen ? "Collapse search results" : "Expand search results"}
				className={cn(
					"group flex w-full items-center gap-2 py-2 px-2.5 text-left text-description transition-all duration-150 bg-transparent border-0",
					"hover:bg-secondary/25 hover:text-foreground active:bg-secondary/45 active:scale-[0.997]",
					{ "cursor-wait opacity-80": isLoading, "cursor-pointer select-none": canToggle },
				)}
				onClick={canToggle ? onToggleExpand : undefined}
				onKeyDown={(e) => {
					if (!canToggle) {
						return
					}
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault()
						e.stopPropagation()
						onToggleExpand()
					}
				}}
				tabIndex={0}
				type="button">
				<span className="flex size-4 shrink-0 items-center justify-center text-description transition-colors group-hover:text-foreground">
					{isLoading ? (
						<LoaderCircleIcon className="size-3.5 animate-spin" />
					) : (
						<ChevronRightIcon className={cn("size-3.5 transition-transform duration-150", { "rotate-90": isOpen })} />
					)}
				</span>
				<span>/</span>
				<span className="min-w-0 truncate font-medium group-hover:underline">
					{path + (filePattern ? `/(${filePattern})` : "")}
				</span>
				<div className="grow" />
				<span className="text-[11px] text-description/70 transition-colors group-hover:text-foreground">
					{isLoading ? "Streaming" : isOpen ? "Collapse" : "Expand"}
				</span>
			</button>

			{isOpen && (
				<div style={{ padding: "10px", borderTop: "1px solid var(--vscode-editorGroup-border)" }}>
					{/* Summary line */}
					<div
						style={{
							marginBottom: "12px",
							fontWeight: "bold",
							color: "var(--vscode-foreground)",
						}}>
						{summaryLine}
					</div>

					{/* Workspace sections */}
					{sections?.map((section: any, index: number) => (
						<div
							key={`workspace-${section.workspace}`}
							style={{ marginBottom: index < sections.length - 1 ? "16px" : 0 }}>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "6px",
									marginBottom: "8px",
									padding: "4px 8px",
									backgroundColor: "var(--vscode-editor-background)",
									borderRadius: "3px",
									border: "1px solid var(--vscode-editorWidget-border)",
								}}>
								<span
									className="codicon codicon-folder"
									style={{
										fontSize: "14px",
										color: "var(--vscode-symbolIcon-folderForeground)",
									}}></span>
								<span
									style={{
										fontWeight: "500",
										color: "var(--vscode-foreground)",
									}}>
									Workspace: {section.workspace}
								</span>
							</div>

							{/* Results for this workspace */}
							<div
								style={{
									backgroundColor: "var(--vscode-textCodeBlock-background)",
									padding: "8px",
									borderRadius: "3px",
									fontSize: "var(--vscode-editor-font-size)",
									fontFamily: "var(--vscode-editor-font-family)",
									lineHeight: "1.5",
									whiteSpace: "pre-wrap",
									wordBreak: "break-word",
									overflowWrap: "anywhere",
								}}>
								<pre style={{ margin: 0, fontFamily: "inherit" }}>{section.content.trim()}</pre>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

export default SearchResultsDisplay
