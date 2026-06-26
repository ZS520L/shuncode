import {
	BrainIcon,
	ChevronRightIcon,
	FilePlus2Icon,
	FoldVerticalIcon,
	ImageUpIcon,
	LightbulbIcon,
	Link2Icon,
	LoaderCircleIcon,
	PencilIcon,
	SearchIcon,
	SquareArrowOutUpRightIcon,
	SquareMinusIcon,
} from "lucide-react"
import type { ShuncodeMessage, ShuncodeSayTool } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/shuncode/common"
import { cn } from "@/lib/utils"
import { FileServiceClient, UiServiceClient } from "@/services/grpc-client"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import CodeAccordian, { cleanPathPrefix } from "../common/CodeAccordian"
import { DiffEditRow } from "./DiffEditRow"
import FastContextDisplay from "./FastContextDisplay"
import SearchResultsDisplay from "./SearchResultsDisplay"

const HEADER_CLASSNAMES = "flex items-center gap-2.5 mb-3"

const COLOR_MAP = {
	red: "var(--vscode-errorForeground)",
	yellow: "var(--vscode-editorWarning-foreground)",
	green: "var(--vscode-charts-green)",
} as const

function CodiconIcon({ name, color, rotation, title }: { name: string; color?: string; rotation?: number; title?: string }) {
	return (
		<span
			className={`codicon codicon-${name} ph-no-capture`}
			style={{
				color: color ? COLOR_MAP[color as keyof typeof COLOR_MAP] || color : "var(--vscode-foreground)",
				marginBottom: "-1.5px",
				transform: rotation ? `rotate(${rotation}deg)` : undefined,
			}}
			title={title}
		/>
	)
}

function OutsideWorkspaceIcon({ title }: { title: string }) {
	return <CodiconIcon name="sign-out" color="yellow" rotation={-90} title={title} />
}

const InvisibleSpacer = () => <div aria-hidden className="h-px" />

function isImageFile(filePath: string): boolean {
	const imageExtensions = [".png", ".jpg", ".jpeg", ".webp"]
	const extension = filePath.toLowerCase().split(".").pop()
	return extension ? imageExtensions.includes(`.${extension}`) : false
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

interface ToolRowProps {
	tool: ShuncodeSayTool
	message: ShuncodeMessage
	backgroundEditEnabled: boolean
	isExpanded: boolean
	onToggleExpand: () => void
}

export function ToolRow({ tool, message, backgroundEditEnabled, isExpanded, onToggleExpand }: ToolRowProps) {
	const { t } = useI18n()
	const { navigateToSettings } = useExtensionState()
	const outsideWs = tool.operationIsLocatedInWorkspace === false
	const isStreaming = message.partial === true

	switch (tool.tool) {
		case "editedExistingFile": {
			const content = tool?.content || ""
			const isApplyingPatch = content?.startsWith("%%bash") && !content.endsWith("*** End Patch\nEOF")
			const editToolTitle = isApplyingPatch ? t("chat.createsPatchesForFile") : t("chat.wantsToEditFile")
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<PencilIcon className="size-2" />
						{outsideWs && <OutsideWorkspaceIcon title={t("chat.fileOutsideWorkspace")} />}
						<span style={{ fontWeight: "bold" }}>{editToolTitle}</span>
					</div>
					{backgroundEditEnabled && tool.path && tool.content ? (
						<DiffEditRow
							isLoading={isStreaming}
							patch={tool.content}
							path={tool.path}
							startLineNumbers={tool.startLineNumbers}
						/>
					) : (
						<CodeAccordian
							code={tool.content}
							isExpanded={isExpanded}
							isLoading={isStreaming}
							onToggleExpand={onToggleExpand}
							path={tool.path!}
						/>
					)}
				</div>
			)
		}
		case "fileDeleted":
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<SquareMinusIcon className="size-2" />
						{outsideWs && <OutsideWorkspaceIcon title={t("chat.fileOutsideWorkspace")} />}
						<span style={{ fontWeight: "bold" }}>{t("chat.wantsToDeleteFile")}</span>
					</div>
					<CodeAccordian
						code={tool.content}
						isExpanded={isExpanded}
						isLoading={isStreaming}
						onToggleExpand={onToggleExpand}
						path={tool.path!}
					/>
				</div>
			)
		case "newFileCreated":
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<FilePlus2Icon className="size-2" />
						{outsideWs && <OutsideWorkspaceIcon title={t("chat.fileOutsideWorkspace")} />}
						<span className="font-bold">{t("chat.wantsToCreateFile")}</span>
					</div>
					{backgroundEditEnabled && tool.path && tool.content ? (
						<DiffEditRow
							isLoading={isStreaming}
							patch={tool.content}
							path={tool.path}
							startLineNumbers={tool.startLineNumbers}
						/>
					) : (
						<CodeAccordian
							code={tool.content!}
							isExpanded={isExpanded}
							isLoading={isStreaming}
							onToggleExpand={onToggleExpand}
							path={tool.path!}
						/>
					)}
				</div>
			)
		case "readFile":
		case "readFiles" as any: {
			const isImage = isImageFile(tool.path || "")
			const canOpen = !isImage && !isStreaming && tool.tool === "readFile"
			const fileName = (tool.path ?? "").split(/[/\\]/).pop() || cleanPathPrefix(tool.path ?? "")
			const lineRangeDisplay = formatLineRange(tool.lineRange)
			return (
				<div>
					<div
						className="flex items-center gap-2 px-2 pb-1 text-[13px] text-description cursor-pointer hover:text-foreground transition-colors"
						onClick={() => {
							if (canOpen) {
								FileServiceClient.openFile(StringRequest.create({ value: tool.content })).catch((err) =>
									console.error("Failed to open file:", err),
								)
							}
						}}>
						{isImage ? (
							<ImageUpIcon className="size-3 shrink-0" style={{ opacity: 0.7 }} />
						) : (
							<span className="codicon codicon-folder shrink-0 text-[12px]" style={{ opacity: 0.7 }} />
						)}
						<span className="text-foreground/80 font-medium shrink-0">Read</span>
						<span className="ph-no-capture min-w-0 truncate text-link hover:underline">
							{fileName}{lineRangeDisplay}
						</span>
						{isStreaming && <LoaderCircleIcon className="size-3 animate-spin shrink-0" />}
					</div>
				</div>
			)
		}
		case "listFilesTopLevel":
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<CodiconIcon name="folder-opened" />
						{outsideWs && <OutsideWorkspaceIcon title={t("chat.outsideWorkspace")} />}
						<span style={{ fontWeight: "bold" }}>
							{message.type === "ask" ? t("chat.wantsToListTopLevelFiles") : t("chat.listedTopLevelFiles")}
						</span>
					</div>
					<CodeAccordian
						code={tool.content!}
						isExpanded={isExpanded}
						isLoading={isStreaming}
						language="shell-session"
						onToggleExpand={onToggleExpand}
						path={tool.path!}
					/>
				</div>
			)
		case "listFilesRecursive":
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<CodiconIcon name="folder-opened" />
						{outsideWs && <OutsideWorkspaceIcon title={t("chat.outsideWorkspace")} />}
						<span style={{ fontWeight: "bold" }}>
							{message.type === "ask"
								? t("chat.wantsToListFilesRecursive")
								: t("chat.listedFilesRecursive")}
						</span>
					</div>
					<CodeAccordian
						code={tool.content!}
						isExpanded={isExpanded}
						isLoading={isStreaming}
						language="shell-session"
						onToggleExpand={onToggleExpand}
						path={tool.path!}
					/>
				</div>
			)
		case "goToDefinition":
		case "findReferences":
		case "getHover":
		case "listCodeDefinitionNames":
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<CodiconIcon name="file-code" />
						{outsideWs && <OutsideWorkspaceIcon title={t("chat.fileOutsideWorkspace")} />}
						<span style={{ fontWeight: "bold" }}>
							{message.type === "ask"
								? t("chat.wantsToListCodeDefinitions")
								: t("chat.listedCodeDefinitions")}
						</span>
					</div>
					<CodeAccordian
						code={tool.content!}
						isExpanded={isExpanded}
						isLoading={isStreaming}
						onToggleExpand={onToggleExpand}
						path={tool.path!}
					/>
				</div>
			)
		case "glob":
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<CodiconIcon name="search" />
						{outsideWs && <OutsideWorkspaceIcon title={t("chat.outsideWorkspace")} />}
						<span style={{ fontWeight: "bold" }}>
							{message.type === "ask" ? t("chat.wantsToSearchByPattern") : t("chat.foundFilesByPattern")}
						</span>
					</div>
					<CodeAccordian
						code={tool.content!}
						isExpanded={isExpanded}
						isLoading={isStreaming}
						language="shell-session"
						onToggleExpand={onToggleExpand}
						path={tool.path!}
					/>
				</div>
			)
		case "searchFiles":
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<CodiconIcon name="search" />
						{outsideWs && <OutsideWorkspaceIcon title={t("chat.outsideWorkspace")} />}
						<span className="font-bold">
							{t("chat.wantsToSearchInFolder")} <code className="break-all">{tool.regex}</code>:
						</span>
					</div>
					<SearchResultsDisplay
						content={tool.content!}
						filePattern={tool.filePattern}
						isExpanded={isExpanded}
						isLoading={isStreaming}
						onToggleExpand={onToggleExpand}
						path={tool.path!}
					/>
				</div>
			)
		case "summarizeTask": {
			const isOpen = isStreaming || isExpanded
			const canToggle = !isStreaming
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<FoldVerticalIcon className="size-2" />
						<span className="font-bold">{t("chat.condensingHistory")}</span>
					</div>
					<div
						className={cn(
							"bg-code overflow-hidden border border-editor-group-border rounded-md transition-colors duration-150",
							{ "border-success/35 shadow-[inset_2px_0_0_var(--vscode-testing-iconPassed)]": isStreaming },
						)}>
						<button
							aria-label={isOpen ? t("chat.collapseSummary") : t("chat.expandSummary")}
							className={cn(
								"group flex w-full items-center gap-2 py-2 px-2.5 text-left text-description bg-transparent border-0 transition-all duration-150",
								"hover:bg-secondary/25 hover:text-foreground active:bg-secondary/45 active:scale-[0.997]",
								{ "cursor-wait opacity-80": isStreaming, "cursor-pointer select-none": canToggle },
							)}
							onClick={canToggle ? onToggleExpand : undefined}
							type="button">
							<span className="flex size-4 shrink-0 items-center justify-center text-description transition-colors group-hover:text-foreground">
								{isStreaming ? (
									<LoaderCircleIcon className="size-3.5 animate-spin" />
								) : (
									<ChevronRightIcon className={cn("size-3.5 transition-transform duration-150", { "rotate-90": isOpen })} />
								)}
							</span>
							<span className="font-medium">{t("chat.summary")}</span>
							{!isOpen && (
								<span className="ph-no-capture min-w-0 flex-1 truncate text-left [direction:rtl] group-hover:underline">
									{tool.content + "\u200E"}
								</span>
							)}
							<div className="grow" />
							<span className="text-[11px] text-description/70 transition-colors group-hover:text-foreground">
								{isStreaming ? "Streaming" : isOpen ? "Collapse" : "Expand"}
							</span>
						</button>
						{isOpen && (
							<div className="ph-no-capture break-words whitespace-pre-wrap border-t border-editor-group-border px-3 py-2 text-description">
								{tool.content}
							</div>
						)}
					</div>
				</div>
			)
		}
		case "webFetch": {
			const canOpen = Boolean(tool.path) && !isStreaming
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<Link2Icon className="size-2" />
						{outsideWs && <OutsideWorkspaceIcon title={t("chat.externalUrl")} />}
						<span className="font-bold">
							{message.type === "ask" ? t("chat.wantsToFetchUrl") : t("chat.fetchedUrl")}
						</span>
					</div>
					<button
						className={cn(
							"group flex w-full items-center gap-2 bg-code rounded-md overflow-hidden border border-editor-group-border py-2 px-2.5 text-left text-description transition-all duration-150",
							"hover:bg-secondary/25 hover:text-foreground active:bg-secondary/45 active:scale-[0.997]",
							{ "cursor-wait opacity-80 border-success/35 shadow-[inset_2px_0_0_var(--vscode-testing-iconPassed)]": isStreaming, "cursor-pointer select-none": canOpen },
						)}
						disabled={!canOpen}
						onClick={() => {
							if (tool.path) {
								UiServiceClient.openUrl(StringRequest.create({ value: tool.path })).catch((err) => {
									console.error("Failed to open URL:", err)
								})
							}
						}}
						type="button">
						<span className="ph-no-capture min-w-0 truncate text-left text-link underline [direction:rtl]">
							{tool.path + "\u200E"}
						</span>
						<div className="grow" />
						{isStreaming ? (
							<LoaderCircleIcon className="size-3.5 animate-spin shrink-0" />
						) : (
							<SquareArrowOutUpRightIcon className="size-3 shrink-0 transition-colors group-hover:text-foreground" />
						)}
					</button>
				</div>
			)
		}
		case "webSearch":
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<SearchIcon className="size-2 rotate-90" />
						{outsideWs && <OutsideWorkspaceIcon title={t("chat.externalSearch")} />}
						<span className="font-bold">
							{message.type === "ask" ? t("chat.wantsToWebSearch") : t("chat.webSearched")}
						</span>
					</div>
					<div
						className={cn(
							"bg-code border border-editor-group-border overflow-hidden rounded-md select-text py-2 px-2.5 transition-colors duration-150",
							{ "border-success/35 shadow-[inset_2px_0_0_var(--vscode-testing-iconPassed)]": isStreaming },
						)}>
						<div className="flex items-center gap-2 text-description">
							<span className="ph-no-capture min-w-0 truncate text-left [direction:rtl]">
								{tool.path + "\u200E"}
							</span>
							<div className="grow" />
							{isStreaming && <LoaderCircleIcon className="size-3.5 animate-spin shrink-0" />}
						</div>
					</div>
				</div>
			)
		case "useSkill":
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<LightbulbIcon className="size-2" />
						<span className="font-bold">{t("chat.loadedSkill")}</span>
					</div>
					<div
						className={cn(
							"bg-code border border-editor-group-border overflow-hidden rounded-md py-2 px-2.5 transition-colors duration-150",
							{ "border-success/35 shadow-[inset_2px_0_0_var(--vscode-testing-iconPassed)]": isStreaming },
						)}>
						<div className="flex items-center gap-2 text-description">
							<span className="ph-no-capture min-w-0 truncate font-medium">{tool.path}</span>
							<div className="grow" />
							{isStreaming && <LoaderCircleIcon className="size-3.5 animate-spin shrink-0" />}
						</div>
					</div>
				</div>
			)
		case "memory": {
			const action = tool.action || "write"
			const statusText = tool.status === "success" ? "Memory was updated" : "Memory"
			const detailText = action === "delete" ? "Deleted a memory" : action === "read" ? "Read a memory" : action === "list" ? "Listed memories" : "Created or updated a memory"

			return (
				<div
					className={cn(
						"rounded-md overflow-hidden border border-editor-group-border bg-code transition-colors duration-150",
						{ "border-success/35 shadow-[inset_2px_0_0_var(--vscode-testing-iconPassed)]": isStreaming },
					)}>
					<div className="flex items-center gap-2 px-3 py-2 text-description bg-input-background/40">
						<BrainIcon className="size-3 text-charts-green" />
						<span className="flex-1 font-medium">{statusText}</span>
						{isStreaming && <LoaderCircleIcon className="size-3.5 animate-spin shrink-0" />}
						<button
							className="text-link hover:text-link-hover hover:underline active:opacity-80 cursor-pointer bg-transparent border-0 p-0 transition-colors"
							onClick={() => navigateToSettings("memory")}
							type="button">
							Manage →
						</button>
					</div>
					<div className="px-3 py-2 text-description border-t border-editor-group-border">
						<div>{detailText}</div>
						{tool.path && <div className="ph-no-capture text-xs opacity-70 truncate mt-1">{cleanPathPrefix(tool.path)}</div>}
					</div>
				</div>
			)
		}
		case "fastContext":
			return (
				<div>
					<FastContextDisplay tool={tool} isStreaming={isStreaming} />
				</div>
			)
		case "generateImage":
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<ImageUpIcon className="size-2" />
						<span className="font-bold">
							{isStreaming ? "Generating image..." : "Generated image"}
						</span>
					</div>
					<div
						className={cn(
							"bg-code border border-editor-group-border overflow-hidden rounded-md select-text py-2 px-2.5 transition-colors duration-150",
							{ "border-success/35 shadow-[inset_2px_0_0_var(--vscode-testing-iconPassed)]": isStreaming },
						)}>
						<div className="flex items-center gap-2 text-description">
							<span className="ph-no-capture min-w-0 truncate text-left">
								{tool.path || ""}
							</span>
							<div className="grow" />
							{isStreaming && <LoaderCircleIcon className="size-3.5 animate-spin shrink-0" />}
						</div>
					</div>
				</div>
			)
		case "evaluateTask": {
			const score = tool.path || ""
			const content = tool.content || ""
			const gradeColor = score.includes("EXCELLENT")
				? "var(--vscode-charts-green)"
				: score.includes("GOOD")
					? "var(--vscode-charts-blue)"
					: score.includes("NEEDS_ATTENTION")
						? "var(--vscode-editorWarning-foreground)"
						: score.includes("FAILED")
							? "var(--vscode-errorForeground)"
							: "var(--vscode-foreground)"
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<CodiconIcon name="checklist" color={gradeColor} />
						<span className="font-bold">Task Evaluation</span>
						{score && (
							<span
								className="ml-1 px-1.5 py-0.5 rounded text-xs font-semibold"
								style={{
									color: gradeColor,
									backgroundColor: `color-mix(in srgb, ${gradeColor} 15%, transparent)`,
									border: `1px solid color-mix(in srgb, ${gradeColor} 30%, transparent)`,
								}}>
								{score}
							</span>
						)}
					</div>
					<div
						className={cn(
							"bg-code border border-editor-group-border overflow-hidden rounded-md transition-colors duration-150",
							{ "border-success/35 shadow-[inset_2px_0_0_var(--vscode-testing-iconPassed)]": isStreaming },
						)}>
						<div
							className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-input-background/60"
							onClick={onToggleExpand}>
							<ChevronRightIcon
								className={cn("size-3 transition-transform duration-150", { "rotate-90": isExpanded })}
							/>
							<span className="flex-1 text-description font-medium">
								{isStreaming ? "Evaluating..." : "Evaluation Report"}
							</span>
							{isStreaming && <LoaderCircleIcon className="size-3.5 animate-spin shrink-0" />}
						</div>
						{isExpanded && content && (
							<div className="px-3 py-2 border-t border-editor-group-border">
								<pre className="text-xs text-description whitespace-pre-wrap font-mono leading-relaxed m-0 select-text">
									{content}
								</pre>
							</div>
						)}
					</div>
				</div>
			)
		}
		default:
			return <InvisibleSpacer />
	}
}
