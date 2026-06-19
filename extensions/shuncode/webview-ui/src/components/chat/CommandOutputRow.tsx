import { COMMAND_OUTPUT_STRING, COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { ShuncodeMessage } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/shuncode/common"
import { CheckIcon, CopyIcon } from "lucide-react"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import { ShuncodeCompactIcon } from "@/assets/ShuncodeCompactIcon"
import { Button } from "@/components/ui/button"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"
import CodeBlock from "../common/CodeBlock"
import ExpandHandle from "./ExpandHandle"

export const CommandOutputContent = memo(
	({
		output,
		isOutputFullyExpanded,
		onToggle,
		isContainerExpanded,
	}: {
		output: string
		isOutputFullyExpanded: boolean
		onToggle: () => void
		isContainerExpanded: boolean
	}) => {
		const { t } = useI18n()
		const outputLines = output.split("\n")
		const lineCount = outputLines.length
		const shouldAutoShow = lineCount <= 5
		const outputRef = useRef<HTMLDivElement>(null)

		// Auto-scroll to bottom when output changes (only when showing limited output)
		useEffect(() => {
			if (!isOutputFullyExpanded && outputRef.current) {
				// Direct scrollTop manipulation
				outputRef.current.scrollTop = outputRef.current.scrollHeight

				// Another attempt with more delay (for slower renders) to ensure scrolling works
				setTimeout(() => {
					if (outputRef.current) {
						outputRef.current.scrollTop = outputRef.current.scrollHeight
					}
				}, 50)
			}
		}, [output, isOutputFullyExpanded])

		// Don't render anything if container is collapsed
		if (!isContainerExpanded) {
			return null
		}

		// Check if output contains a log file path indicator
		// allow-any-unicode-next-line
		const logFilePathMatch = output.match(/📋 Output is being logged to: ([^\n]+)/)
		const logFilePath = logFilePathMatch ? logFilePathMatch[1].trim() : null

		// Render output with clickable log file path
		const renderOutput = () => {
			if (!logFilePath) {
				return <CodeBlock forceWrap={true} source={`${"```"}shell\n${output}\n${"```"}`} />
			}

			// Split output into parts: before log path, log path line, after log path
			// allow-any-unicode-next-line
			const logPathLineStart = output.indexOf("📋 Output is being logged to:")
			const logPathLineEnd = output.indexOf("\n", logPathLineStart)
			const beforeLogPath = output.substring(0, logPathLineStart)
			const afterLogPath = logPathLineEnd !== -1 ? output.substring(logPathLineEnd) : ""

			// Extract just the filename from the full path for display
			const fileName = logFilePath.split("/").pop() || logFilePath

			return (
				<div className="border border-editor-group-border rounded-sm">
					{beforeLogPath && <CodeBlock forceWrap={true} source={`${"```"}shell\n${beforeLogPath}\n${"```"}`} />}
					<div
						className="flex flex-wrap items-center gap-1.5 px-3 py-2 mx-2 my-1.5 rounded-sm bg-banner-background cursor-pointer hover:brightness-110 transition-colors"
						onClick={() => {
							FileServiceClient.openFile(StringRequest.create({ value: logFilePath })).catch((err) =>
								console.error("Failed to open log file:", err),
							)
						}}
						title={`${t("chat.clickToOpen")}: ${logFilePath}`}>
						<span className="shrink-0">{t("chat.outputLoggedTo")}</span>
						<span className="text-vscode-textLink-foreground underline break-all">{fileName}</span>
					</div>
					{afterLogPath && <CodeBlock forceWrap={true} source={`${"```"}shell\n${afterLogPath}\n${"```"}`} />}
				</div>
			)
		}

		return (
			<div
				className={cn("w-full relative pb-0 overflow-visible border-t border-editor-group-border bg-code", {
					"rounded-b-none": lineCount > 5,
				})}>
				<div
					className={cn("text-white scroll-smooth bg-code overflow-y-auto", {
						"max-h-[75px]": !shouldAutoShow && !isOutputFullyExpanded,
						"max-h-[200px]": !shouldAutoShow && isOutputFullyExpanded,
						"overflow-y-visible": shouldAutoShow,
					})}
					ref={outputRef}>
					<div className="bg-code">{renderOutput()}</div>
				</div>
				{/* Show notch only if there's more than 5 lines */}
				{lineCount > 5 && <ExpandHandle isExpanded={isOutputFullyExpanded} onToggle={onToggle} />}
			</div>
		)
	},
)

CommandOutputContent.displayName = "CommandOutputContent"

export const CommandOutputRow = memo(
	({
		message,
		isCommandExecuting = false,
		isCommandPending = false,
		isCommandCompleted = false,
		isBackgroundExec = false, // vscodeTerminalExecutionMode === "backgroundExec"
		onCancelCommand,
		icon,
		title,
		isOutputFullyExpanded,
		setIsOutputFullyExpanded,
	}: {
		message: ShuncodeMessage
		isCommandExecuting?: boolean
		isCommandPending?: boolean
		isCommandCompleted?: boolean
		isBackgroundExec?: boolean
		onCancelCommand?: () => void
		icon?: JSX.Element | null
		title?: JSX.Element | null
		isOutputFullyExpanded: boolean
		setIsOutputFullyExpanded: (expanded: boolean) => void
	}) => {
		const { t } = useI18n()
		const splitMessage = (text: string) => {
			const outputIndex = text.indexOf(COMMAND_OUTPUT_STRING)
			if (outputIndex === -1) {
				return { command: text, output: "" }
			}
			return {
				command: text.slice(0, outputIndex).trim(),
				output: text
					.slice(outputIndex + COMMAND_OUTPUT_STRING.length)
					.trim()
					.split("")
					.map((char) => {
						switch (char) {
							case "\t":
								return "→   "
							case "\b":
								// allow-any-unicode-next-line
								return "⌫"
							case "\f":
								// allow-any-unicode-next-line
								return "⏏"
							case "\v":
								// allow-any-unicode-next-line
								return "⇳"
							default:
								return char
						}
					})
					.join(""),
			}
		}

		const { command: rawCommand, output } = splitMessage(message.text || "")

		const requestsApproval = rawCommand.endsWith(COMMAND_REQ_APP_STRING)
		const command = requestsApproval ? rawCommand.slice(0, -COMMAND_REQ_APP_STRING.length) : rawCommand
		const showCancelButton =
			(isCommandExecuting || isCommandPending) && typeof onCancelCommand === "function" && isBackgroundExec
		const [copiedCommand, setCopiedCommand] = useState(false)
		const handleCopyCommand = useCallback(() => {
			if (!command) {
				return
			}
			navigator.clipboard.writeText(command).then(() => {
				setCopiedCommand(true)
				setTimeout(() => setCopiedCommand(false), 1500)
			})
		}, [command])

		// Check if this is a Shuncode subagent command (only on VSCode platform, not JetBrains/standalone)
		const isSubagentCommand = PLATFORM_CONFIG.type === PlatformType.VSCODE && command.trim().startsWith("shuncode ")
		let subagentPrompt: string | undefined

		if (isSubagentCommand) {
			// Parse the shuncode command to extract prompt
			// Format: shuncode "prompt"
			const shuncodeCommandRegex = /^shuncode\s+"([^"]+)"(?:\s+--no-interactive)?/
			const match = command.match(shuncodeCommandRegex)

			if (match) {
				subagentPrompt = match[1]
			}
		}

		// Customize icon and title for subagent commands
		const displayIcon = isSubagentCommand ? (
			<span className="text-foreground mb-[-1.5px]">
				<ShuncodeCompactIcon />
			</span>
		) : (
			icon
		)

		const displayTitle = isSubagentCommand ? (
			<span className="text-foreground font-bold">{t("chat.shuncodeWantsToUseSubagent")}</span>
		) : (
			title
		)

		const commandHeader = (
			<div className="flex items-center gap-2.5 mb-3">
				{displayIcon}
				{displayTitle}
			</div>
		)

		return (
			<>
				{commandHeader}
				<div
					className="overflow-hidden rounded-md border border-editor-group-border bg-code shadow-sm"
					style={{
						transition: "border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease",
					}}>
					{command && (
						<div className="bg-code/95 flex items-center justify-between px-3 py-2 border-b border-editor-group-border overflow-hidden">
							<div className="flex items-center gap-2 flex-1 min-w-0">
								<div
									className={cn("bg-description rounded-full w-2 h-2 shrink-0", {
										"bg-success animate-pulse": isCommandExecuting,
										"bg-editor-warning-foreground": isCommandPending,
									})}
								/>
								<span
									className={cn("text-description font-medium text-base shrink-0", {
										"text-success": isCommandExecuting,
										"text-editor-warning-foreground": isCommandPending,
									})}>
									{getCommandStatusText(isCommandExecuting, isCommandPending, isCommandCompleted, t)}
								</span>
							</div>
							<div className="flex items-center gap-2 shrink-0">
								{showCancelButton && (
									<Button
										onClick={(e) => {
											e.stopPropagation()
											if (isBackgroundExec) {
												onCancelCommand?.()
											} else {
												// For regular terminal mode, show a message
												alert(t("chat.commandRunningInVscodeTerminal"))
											}
										}}
										size="sm"
										variant="secondary">
										{isBackgroundExec ? t("chat.cancel") : t("chat.stop")}
									</Button>
								)}
							</div>
						</div>
					)}

					{isSubagentCommand && subagentPrompt && (
						<div className="p-2.5 border-b border-editor-group-border">
							<div className="mb-0">
								<strong>{t("chat.prompt")}:</strong>{" "}
								<span className="ph-no-capture font-editor">{subagentPrompt}</span>
							</div>
						</div>
					)}

					{!isSubagentCommand && command && (
						<div
							className={cn(
								"group flex items-center gap-2 px-3 py-2.5 text-sm bg-code/80 transition-all duration-150",
								"hover:bg-secondary/40 active:bg-secondary/60 active:scale-[0.997]",
								{
									"border-t border-success/35 shadow-[inset_2px_0_0_var(--vscode-testing-iconPassed)]": isCommandExecuting,
									"border-t border-editor-warning-foreground/35 shadow-[inset_2px_0_0_var(--vscode-editorWarning-foreground)]": isCommandPending,
									"border-t border-editor-group-border": !isCommandExecuting && !isCommandPending,
								},
							)}>
							<span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-editor-group-border bg-background/60 text-description transition-colors group-hover:text-foreground">
								<i className="codicon codicon-terminal" />
							</span>
							<div className="flex min-w-0 flex-1 items-center gap-2 font-editor">
								<span className="shrink-0 text-description/80">$</span>
								<code className="ph-no-capture min-w-0 flex-1 truncate bg-transparent text-[13px] leading-5 text-foreground/85 group-hover:text-foreground">
									{command}
								</code>
							</div>
							<Button
								aria-label="Copy command"
								className="h-7 w-7 shrink-0 rounded-md text-description opacity-0 transition-all duration-150 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 active:scale-95"
								onClick={(e) => {
									e.preventDefault()
									e.stopPropagation()
									handleCopyCommand()
								}}
								size="icon"
								title="Copy command"
								variant="ghost">
								{copiedCommand ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
							</Button>
						</div>
					)}

					{output.length > 0 && (
						<CommandOutputContent
							isContainerExpanded={true}
							isOutputFullyExpanded={isOutputFullyExpanded}
							onToggle={() => setIsOutputFullyExpanded(!isOutputFullyExpanded)}
							output={output}
						/>
					)}
				</div>
				{requestsApproval && (
					<div className="flex items-center gap-2.5 p-2 text-[12px] text-editor-warning-foreground">
						<i className="codicon codicon-warning"></i>
						<span>{t("chat.commandRequiresApproval")}</span>
					</div>
				)}
			</>
		)
	},
)

CommandOutputRow.displayName = "CommandOutputRow"

const CommandStatusMap = {
	executing: "chat.commandStatus.running",
	pending: "chat.commandStatus.pending",
	completed: "chat.commandStatus.completed",
	skipped: "chat.commandStatus.skipped",
}

function getCommandStatusText(
	isExecuting: boolean,
	isPending: boolean,
	isCompleted: boolean,
	t: (key: string) => string,
): string {
	if (isExecuting) {
		return t(CommandStatusMap.executing)
	}
	if (isPending) {
		return t(CommandStatusMap.pending)
	}
	if (isCompleted) {
		return t(CommandStatusMap.completed)
	}
	return t(CommandStatusMap.skipped)
}
