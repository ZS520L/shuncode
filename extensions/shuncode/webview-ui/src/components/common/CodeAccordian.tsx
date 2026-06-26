import { ChevronRightIcon, LoaderCircleIcon } from "lucide-react"
import { memo, useMemo } from "react"
import CodeBlock from "@/components/common/CodeBlock"
import { cn } from "@/lib/utils"
import { getLanguageFromPath } from "@/utils/getLanguageFromPath"
import { Button } from "../ui/button"

interface CodeAccordianProps {
	code?: string
	diff?: string
	language?: string | undefined
	path?: string
	isFeedback?: boolean
	isConsoleLogs?: boolean
	isExpanded: boolean
	onToggleExpand: () => void
	isLoading?: boolean
}

/*
We need to remove leading non-alphanumeric characters from the path in order for our leading ellipses trick to work.
^: Anchors the match to the start of the string.
[^a-zA-Z0-9]+: Matches one or more characters that are not alphanumeric.
The replace method removes these matched characters, effectively trimming the string up to the first alphanumeric character.
*/
export const cleanPathPrefix = (path: string): string => path.replace(/^[^\u4e00-\u9fa5a-zA-Z0-9]+/, "")

const CodeAccordian = ({
	code,
	diff,
	language,
	path,
	isFeedback,
	isConsoleLogs,
	isExpanded,
	onToggleExpand,
	isLoading,
}: CodeAccordianProps) => {
	const inferredLanguage = useMemo(
		() => code && (language ?? (path ? getLanguageFromPath(path) : undefined)),
		[path, language, code],
	)

	const numberOfEdits = useMemo(() => {
		if (code) {
			return (code.match(/[-]{3,} SEARCH/g) || []).length || undefined
		}
		return undefined
	}, [code])

	const isOpen = isLoading || isExpanded
	const canToggle = !isLoading

	return (
		<div
			className={cn(
				"overflow-hidden rounded-md border border-editor-group-border bg-code transition-colors duration-150",
				{ "border-success/35 shadow-[inset_2px_0_0_var(--vscode-testing-iconPassed)]": isLoading },
			)}>
			{(path || isFeedback || isConsoleLogs) && (
				<Button
					aria-label={isOpen ? "Collapse code block" : "Expand code block"}
					className={cn(
						"group flex w-full items-center gap-2 py-2 px-2.5 text-description transition-all duration-150",
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
					variant="text">
					<span className="flex size-4 shrink-0 items-center justify-center text-description transition-colors group-hover:text-foreground">
						{isLoading ? (
							<LoaderCircleIcon className="size-3.5 animate-spin" />
						) : (
							<ChevronRightIcon className={cn("size-3.5 transition-transform duration-150", { "rotate-90": isOpen })} />
						)}
					</span>
					{isFeedback || isConsoleLogs ? (
						<div className="flex min-w-0 items-center">
							<span className={`mr-1.5 codicon codicon-${isFeedback ? "feedback" : "output"}`} />
							<span className="truncate font-medium">
								{isFeedback ? "User Edits" : "Console Logs"}
							</span>
						</div>
					) : (
						<span className="min-w-0 truncate text-left font-medium [direction:rtl] group-hover:underline">
							{path?.startsWith(".") && <span>.</span>}
							{path && !path.startsWith(".") && <span>/</span>}
							{cleanPathPrefix(path ?? "") + "\u200E"}
						</span>
					)}
					<div className="grow" />
					{numberOfEdits !== undefined && (
						<div className="mr-1.5 flex shrink-0 items-center text-description transition-colors group-hover:text-foreground">
							<span className="codicon codicon-diff-single mr-1" />
							<span>{numberOfEdits}</span>
						</div>
					)}
					<span className="text-[11px] text-description/70 transition-colors group-hover:text-foreground">
						{isLoading ? "Streaming" : isOpen ? "Collapse" : "Expand"}
					</span>
				</Button>
			)}
			{(!(path || isFeedback || isConsoleLogs) || isOpen) && (
				<div
					className={cn("overflow-x-auto max-w-full border-t border-editor-group-border", {
						"max-h-64 overflow-y-auto": isLoading,
						"overflow-y-hidden": !isLoading,
						"border-t-0": !(path || isFeedback || isConsoleLogs),
					})}>
					<CodeBlock
						source={`${"```"}${diff !== undefined ? "diff" : inferredLanguage}\n${(
							code ?? diff ?? ""
						).trim()}\n${"```"}`}
					/>
				</div>
			)}
		</div>
	)
}

// memo does shallow comparison of props, so if you need it to re-render when a nested object changes, you need to pass a custom comparison function
export default memo(CodeAccordian)
