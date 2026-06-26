import { COMMAND_OUTPUT_STRING } from "@shared/combineCommandSequences"
import {
	COMPLETION_RESULT_CHANGES_FLAG,
	ShuncodeApiReqInfo,
	ShuncodeAskQuestion,
	ShuncodeAskUseMcpServer,
	ShuncodeMessage,
	ShuncodePlanModeResponse,
	ShuncodeSayGenerateExplanation,
	ShuncodeSayTool,
} from "@shared/ExtensionMessage"
import { BooleanRequest } from "@shared/proto/shuncode/common"
import { Mode } from "@shared/storage/types"
import deepEqual from "fast-deep-equal"
import {
	ArrowRightIcon,
	BellIcon,
	CheckIcon,
	CircleSlashIcon,
	CircleXIcon,
	FilePlus2Icon,
	LightbulbIcon,
	LoaderCircleIcon,
	RefreshCwIcon,
	SettingsIcon,
	TerminalIcon,
	TriangleAlertIcon,
} from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSize } from "react-use"
import { OptionsButtons } from "@/components/chat/OptionsButtons"
import { WithCopyButton } from "@/components/common/CopyButton"
import McpResponseDisplay from "@/components/mcp/chat-display/McpResponseDisplay"
import McpResourceRow from "@/components/mcp/configuration/tabs/installed/server-row/McpResourceRow"
import McpToolRow from "@/components/mcp/configuration/tabs/installed/server-row/McpToolRow"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { UiServiceClient } from "@/services/grpc-client"
import { findMatchingResourceOrTemplate, getMcpServerDisplayName } from "@/utils/mcp"
import CodeAccordian from "../common/CodeAccordian"
import { CommandOutputContent, CommandOutputRow } from "./CommandOutputRow"
import { CompletionOutputRow } from "./CompletionOutputRow"
import ErrorRow from "./ErrorRow"
import HookMessage from "./HookMessage"
import { MarkdownRow } from "./MarkdownRow"
import NewTaskPreview from "./NewTaskPreview"
import PlanCompletionOutputRow from "./PlanCompletionOutputRow"
import QuoteButton from "./QuoteButton"
import ReportBugPreview from "./ReportBugPreview"
import { RequestStartRow } from "./RequestStartRow"
import { ThinkingRow } from "./ThinkingRow"
import { ToolRow } from "./ToolRow"
import UserMessage from "./UserMessage"
import { useQuoteButton } from "./useQuoteButton"

const HEADER_CLASSNAMES = "flex items-center gap-2.5 mb-3"

interface ChatRowProps {
	message: ShuncodeMessage
	isExpanded: boolean
	onToggleExpand: (ts: number) => void
	lastModifiedMessage?: ShuncodeMessage
	isLast: boolean
	onHeightChange?: (isTaller: boolean) => void
	inputValue?: string
	sendMessageFromChatRow?: (text: string, images: string[], files: string[]) => void
	onSetQuote: (text: string) => void
	onCancelCommand?: () => void
	mode?: Mode
	reasoningContent?: string
	responseStarted?: boolean
	isRequestInProgress?: boolean
}

export type { QuoteButtonState } from "./useQuoteButton"

interface ChatRowContentProps extends Omit<ChatRowProps, "onHeightChange"> {}

export const ProgressIndicator = () => <LoaderCircleIcon className="size-2 mr-2 animate-spin" />
const InvisibleSpacer = () => <div aria-hidden className="h-px" />

const ChatRow = memo(
	(props: ChatRowProps) => {
		const { isLast, onHeightChange, message } = props
		// Store the previous height to compare with the current height
		// This allows us to detect changes without causing re-renders
		const prevHeightRef = useRef(0)

		const [chatrow, { height }] = useSize(
			<div className="relative pt-2.5 px-4">
				<ChatRowContent {...props} />
			</div>,
		)

		useEffect(() => {
			const isInitialRender = prevHeightRef.current === 0
			if (isLast && height !== 0 && height !== Infinity && height !== prevHeightRef.current) {
				if (!isInitialRender) {
					onHeightChange?.(height > prevHeightRef.current)
				}
				prevHeightRef.current = height
			}
		}, [height, isLast, onHeightChange, message])

		// we cannot return null as virtuoso does not support it so we use a separate visibleMessages array to filter out messages that should not be rendered
		return chatrow
	},
	// memo does shallow comparison of props, so we need to do deep comparison of arrays/objects whose properties might change
	deepEqual,
)

export default ChatRow

export const ChatRowContent = memo(
	({
		message,
		isExpanded,
		onToggleExpand,
		lastModifiedMessage,
		isLast,
		inputValue,
		sendMessageFromChatRow,
		onSetQuote,
		onCancelCommand,
		mode,
		isRequestInProgress,
		reasoningContent,
		responseStarted,
	}: ChatRowContentProps) => {
		const { t } = useI18n()
		const {
			backgroundEditEnabled,
			mcpServers,
			mcpMarketplaceCatalog,
			onRelinquishControl,
			vscodeTerminalExecutionMode,
			shuncodeMessages,
		} = useExtensionState()
		const [seeNewChangesDisabled, setSeeNewChangesDisabled] = useState(false)
		const [explainChangesDisabled, setExplainChangesDisabled] = useState(false)
		const contentRef = useRef<HTMLDivElement>(null)
		const markdownRenderedRef = useRef<HTMLDivElement>(null)
		const { quoteButtonState, handleQuoteClick, handleMouseUp } = useQuoteButton(contentRef, onSetQuote)

		// Command output expansion state (for all messages, but only used by command messages)
		const [isOutputFullyExpanded, setIsOutputFullyExpanded] = useState(false)
		const prevCommandExecutingRef = useRef<boolean>(false)

		const hasAutoExpandedRef = useRef(false)
		const hasAutoCollapsedRef = useRef(false)
		const prevIsLastRef = useRef(isLast)

		// Auto-expand completion output when it's the last message (runs once per message)
		useEffect(() => {
			const isCompletionResult = message.ask === "completion_result" || message.say === "completion_result"

			// Auto-expand if it's last and we haven't already auto-expanded
			if (isLast && isCompletionResult && !hasAutoExpandedRef.current) {
				hasAutoExpandedRef.current = true
				hasAutoCollapsedRef.current = false // Reset the auto-collapse flag when expanding
			}
		}, [isLast, message.ask, message.say])

		// Auto-collapse completion output ONCE when transitioning from last to not-last
		useEffect(() => {
			const isCompletionResult = message.ask === "completion_result" || message.say === "completion_result"
			const wasLast = prevIsLastRef.current

			// Only auto-collapse if transitioning from last to not-last, and we haven't already auto-collapsed
			if (wasLast && !isLast && isCompletionResult && !hasAutoCollapsedRef.current) {
				hasAutoCollapsedRef.current = true
				hasAutoExpandedRef.current = false // Reset the auto-expand flag when collapsing
			}

			prevIsLastRef.current = isLast
		}, [isLast, message.ask, message.say])

		const [cost, apiReqCancelReason, apiReqStreamingFailedMessage] = useMemo(() => {
			if (message.text != null && message.say === "api_req_started") {
				const info: ShuncodeApiReqInfo = JSON.parse(message.text)
				return [info.cost, info.cancelReason, info.streamingFailedMessage, info.retryStatus]
			}
			return [undefined, undefined, undefined, undefined, undefined]
		}, [message.text, message.say])

		// when resuming task last won't be api_req_failed but a resume_task message so api_req_started will show loading spinner. that's why we just remove the last api_req_started that failed without streaming anything
		const apiRequestFailedMessage =
			isLast && lastModifiedMessage?.ask === "api_req_failed" // if request is retried then the latest message is a api_req_retried
				? lastModifiedMessage?.text
				: undefined

		const type = message.type === "ask" ? message.ask : message.say

		const isCommandMessage = type === "command"
		// Check if command has output to determine if it's actually executing
		const commandHasOutput = message.text?.includes(COMMAND_OUTPUT_STRING) ?? false
		// A command is executing if it has output but hasn't completed yet
		const isCommandExecuting = isCommandMessage && !message.commandCompleted && commandHasOutput
		// A command is pending if it hasn't started (no output) and hasn't completed
		const isCommandPending = isCommandMessage && isLast && !message.commandCompleted && !commandHasOutput
		const isCommandCompleted = isCommandMessage && message.commandCompleted === true

		const isMcpServerResponding = isLast && lastModifiedMessage?.say === "mcp_server_request_started"

		const handleToggle = useCallback(() => {
			onToggleExpand(message.ts)
		}, [onToggleExpand, message.ts])

		// Use the onRelinquishControl hook instead of message event
		useEffect(() => {
			return onRelinquishControl(() => {
				setSeeNewChangesDisabled(false)
				setExplainChangesDisabled(false)
			})
		}, [onRelinquishControl])

		const [icon, title] = useMemo(() => {
			switch (type) {
				case "error":
					return [
						<span className="codicon codicon-error text-error mb-[-1.5px]" />,
						<span className="text-error font-bold">{t("chat.error")}</span>,
					]
				case "mistake_limit_reached":
					return [
						<CircleXIcon className="text-error size-2" />,
						<span className="text-error font-bold">{t("chat.mistakeLimitReached")}</span>,
					]
				case "command":
					return [
						<TerminalIcon className="text-foreground size-2" />,
						<span className="font-bold text-foreground">{t("chat.commandSuggestion")}</span>,
					]
				case "use_mcp_server":
					const mcpServerUse = JSON.parse(message.text || "{}") as ShuncodeAskUseMcpServer
					return [
						isMcpServerResponding ? (
							<ProgressIndicator />
						) : (
							<span className="codicon codicon-server text-foreground mb-[-1.5px]" />
						),
						<span className="ph-no-capture font-bold text-foreground break-words">
							{t("chat.wantsTo")}{" "}
							{mcpServerUse.type === "use_mcp_tool" ? t("chat.useMcpTool") : t("chat.accessMcpResource")}{" "}
							{t("chat.onMcpServer")}{" "}
							<code className="break-all">
								{getMcpServerDisplayName(mcpServerUse.serverName, mcpMarketplaceCatalog)}
							</code>
							:
						</span>,
					]
				case "completion_result":
					return [null, null]
				case "api_req_started":
					// API request rows no longer render the request payload/cost accordion.
					// Thinking/reasoning is handled directly in the api_req_started renderer below.
					return [null, null]
				case "followup":
					return [
						<span className="codicon codicon-question text-foreground mb-[-1.5px]" />,
						<span className="font-bold text-foreground">{t("chat.followupQuestion")}</span>,
					]
				default:
					return [null, null]
			}
		}, [
			type,
			cost,
			apiRequestFailedMessage,
			isCommandExecuting,
			isCommandPending,
			apiReqCancelReason,
			isMcpServerResponding,
			message.text,
		])

		const tool = useMemo(() => {
			if (message.ask === "tool" || message.say === "tool") {
				return JSON.parse(message.text || "{}") as ShuncodeSayTool
			}
			return null
		}, [message.ask, message.say, message.text])

		const conditionalRulesInfo = useMemo(() => {
			if (message.say !== "conditional_rules_applied" || !message.text) {
				return null
			}
			try {
				const parsed = JSON.parse(message.text) as unknown
				if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as any).rules)) {
					return null
				}
				return parsed as {
					rules: Array<{ name: string; matchedConditions: Record<string, string[]> }>
				}
			} catch {
				return null
			}
		}, [message.say, message.text])

		// Reset output expansion state when command stops (completes or is cancelled)
		useEffect(() => {
			// If command was executing and now isn't, clean up
			if (isCommandMessage && prevCommandExecutingRef.current && !isCommandExecuting) {
				setIsOutputFullyExpanded(false)
			}

			// Update ref for next render
			prevCommandExecutingRef.current = isCommandExecuting
		}, [isCommandMessage, isCommandExecuting])

		// Auto-expand when command runs >500ms — rAF + performance.now(), no setTimeout
		useEffect(() => {
			if (!isCommandMessage || !isCommandExecuting || isExpanded) {
				return
			}
			const start = performance.now()
			let rafId = 0
			const tick = () => {
				if (performance.now() - start >= 500) {
					onToggleExpand(message.ts)
					return
				}
				rafId = requestAnimationFrame(tick)
			}
			rafId = requestAnimationFrame(tick)
			return () => cancelAnimationFrame(rafId)
		}, [isCommandMessage, isCommandExecuting, isExpanded, onToggleExpand, message.ts])

		if (conditionalRulesInfo) {
			const names = conditionalRulesInfo.rules.map((r: { name: string }) => r.name).join(", ")
			return (
				<div className={HEADER_CLASSNAMES}>
					<span style={{ fontWeight: "bold" }}>{t("chat.appliedConditionalRules")}</span>
					<span className="ph-no-capture break-words whitespace-pre-wrap">{names}</span>
				</div>
			)
		}

		if (tool) {
			return (
				<ToolRow
					tool={tool}
					message={message}
					backgroundEditEnabled={backgroundEditEnabled ?? false}
					isExpanded={isExpanded}
					onToggleExpand={handleToggle}
				/>
			)
		}

		if (message.ask === "command" || message.say === "command") {
			return (
				<CommandOutputRow
					icon={icon}
					isBackgroundExec={vscodeTerminalExecutionMode === "backgroundExec"}
					isCommandCompleted={isCommandCompleted}
					isCommandExecuting={isCommandExecuting}
					isCommandPending={isCommandPending}
					isOutputFullyExpanded={isOutputFullyExpanded}
					message={message}
					onCancelCommand={onCancelCommand}
					setIsOutputFullyExpanded={setIsOutputFullyExpanded}
					title={title}
				/>
			)
		}

		if (message.ask === "use_mcp_server" || message.say === "use_mcp_server") {
			const useMcpServer = JSON.parse(message.text || "{}") as ShuncodeAskUseMcpServer
			const server = mcpServers.find((server) => server.name === useMcpServer.serverName)
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						{icon}
						{title}
					</div>

					<div className="bg-code rounded-xs py-2 px-2.5 mt-2">
						{useMcpServer.type === "access_mcp_resource" && (
							<McpResourceRow
								item={{
									...(findMatchingResourceOrTemplate(
										useMcpServer.uri || "",
										server?.resources,
										server?.resourceTemplates,
									) || {
										name: "",
										mimeType: "",
										description: "",
									}),
									uri: useMcpServer.uri || "",
								}}
							/>
						)}

						{useMcpServer.type === "use_mcp_tool" && (
							<div>
								<div onClick={(e) => e.stopPropagation()}>
									<McpToolRow
										serverName={useMcpServer.serverName}
										tool={{
											name: useMcpServer.toolName || "",
											description:
												server?.tools?.find((tool) => tool.name === useMcpServer.toolName)?.description ||
												"",
											autoApprove:
												server?.tools?.find((tool) => tool.name === useMcpServer.toolName)?.autoApprove ||
												false,
										}}
									/>
								</div>
								{useMcpServer.arguments && useMcpServer.arguments !== "{}" && (
									<div className="mt-2">
										<div className="mb-1 opacity-80 uppercase">{t("chat.arguments")}</div>
										<CodeAccordian
											code={useMcpServer.arguments}
											isExpanded={true}
											language="json"
											onToggleExpand={handleToggle}
										/>
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			)
		}

		switch (message.type) {
			case "say":
				switch (message.say) {
					case "api_req_started": {
						const isFinal = cost != null && !apiRequestFailedMessage && !apiReqStreamingFailedMessage
						if (isFinal && !reasoningContent) {
							return <InvisibleSpacer />
						}
						return (
							<RequestStartRow
								apiReqStreamingFailedMessage={apiReqStreamingFailedMessage}
								apiRequestFailedMessage={apiRequestFailedMessage}
								cost={cost}
								handleToggle={handleToggle}
								isExpanded={isExpanded}
								message={message}
								mode={mode}
								reasoningContent={reasoningContent}
								responseStarted={responseStarted}
								shuncodeMessages={shuncodeMessages}
							/>
						)
					}
					case "api_req_finished":
						return <InvisibleSpacer /> // we should never see this message type
					case "mcp_server_response":
						return <McpResponseDisplay responseText={message.text || ""} />
					case "mcp_notification":
						return (
							<div className="flex items-start gap-2 py-2.5 px-3 bg-quote rounded-sm text-base text-foreground opacity-90 mb-2">
								<BellIcon className="mt-0.5 size-2 text-notification-foreground shrink-0" />
								<div className="break-words flex-1">
									<span className="font-medium">{t("chat.mcpNotification")}: </span>
									<span className="ph-no-capture">{message.text}</span>
								</div>
							</div>
						)
					case "text": {
						return (
							<WithCopyButton
								markdownDualCopy={{
									markdownSource: message.text || "",
									renderedRef: markdownRenderedRef,
								}}
								onMouseUp={handleMouseUp}
								position="bottom-right"
								ref={contentRef}>
								<div className="flex items-center">
									<div className={cn("flex-1 min-w-0 pl-1")} ref={markdownRenderedRef}>
										<MarkdownRow markdown={message.text} showCursor={false} />
									</div>
								</div>
								{message.images && message.images.length > 0 && (
									<div className="flex flex-wrap gap-2 mt-2 pl-1">
										{message.images.map((img, idx) => (
											<img
												key={idx}
												src={img}
												alt={`Generated image ${idx + 1}`}
												className="max-w-full rounded-md border border-editor-group-border"
												style={{ maxHeight: 512 }}
											/>
										))}
									</div>
								)}
								{quoteButtonState.visible && (
									<QuoteButton
										left={quoteButtonState.left}
										onClick={handleQuoteClick}
										top={quoteButtonState.top}
									/>
								)}
							</WithCopyButton>
						)
					}
					case "reasoning": {
						return (
							<ThinkingRow
								isExpanded={isExpanded}
								isThinking={message.partial === true}
								isVisible={true}
								onToggle={handleToggle}
								reasoningContent={message.text}
								showTitle={true}
								startTime={message.ts}
							/>
						)
					}
					case "user_feedback":
						return (
							<UserMessage
								files={message.files}
								images={message.images}
								messageTs={message.ts}
								sendMessageFromChatRow={sendMessageFromChatRow}
								text={message.text}
							/>
						)
					case "user_feedback_diff":
						const tool = JSON.parse(message.text || "{}") as ShuncodeSayTool
						return (
							<div className="w-full -mt-2.5">
								<CodeAccordian
									diff={tool.diff!}
									isExpanded={isExpanded}
									isFeedback={true}
									onToggleExpand={handleToggle}
								/>
							</div>
						)
					case "error":
						return <ErrorRow errorType="error" message={message} />
					case "diff_error":
						return <ErrorRow errorType="diff_error" message={message} />
					case "shuncodeignore_error":
						return <ErrorRow errorType="shuncodeignore_error" message={message} />
					case "checkpoint_created":
						return <InvisibleSpacer />
					case "load_mcp_documentation":
						return (
							<div className="text-foreground flex items-center opacity-70 text-[12px] py-1 px-0">
								<i className="codicon codicon-book mr-1.5" />
								{t("chat.loadingMcpDocs")}
							</div>
						)
					case "generate_explanation": {
						let explanationInfo: ShuncodeSayGenerateExplanation = {
							title: "code changes",
							fromRef: "",
							toRef: "",
							status: "generating",
						}
						try {
							if (message.text) {
								explanationInfo = JSON.parse(message.text)
							}
						} catch {
							// Use defaults if parsing fails
						}
						// Check if generation was interrupted:
						// 1. If status is "generating" but this isn't the last message, it was interrupted
						// 2. If status is "generating" and lastModifiedMessage is a resume ask, task was just cancelled
						const wasCancelled =
							explanationInfo.status === "generating" &&
							(!isLast ||
								lastModifiedMessage?.ask === "resume_task" ||
								lastModifiedMessage?.ask === "resume_completed_task")
						const isGenerating = explanationInfo.status === "generating" && !wasCancelled
						const isError = explanationInfo.status === "error"
						return (
							<div className="bg-code flex flex-col border border-editor-group-border rounded-sm py-2.5 px-3">
								<div className="flex items-center">
									{isGenerating ? (
										<ProgressIndicator />
									) : isError ? (
										<CircleXIcon className="size-2 mr-2 text-error" />
									) : wasCancelled ? (
										<CircleSlashIcon className="size-2 mr-2" />
									) : (
										<CheckIcon className="size-2 mr-2 text-success" />
									)}
									<span className="font-semibold">
										{isGenerating
											? t("chat.generatingExplanation")
											: isError
												? t("chat.failedToGenerateExplanation")
												: wasCancelled
													? t("chat.explanationCancelled")
													: t("chat.explanationGenerated")}
									</span>
								</div>
								{isError && explanationInfo.error && (
									<div className="opacity-80 ml-6 mt-1.5 text-error break-words">{explanationInfo.error}</div>
								)}
								{!isError && (explanationInfo.title || explanationInfo.fromRef) && (
									<div className="opacity-80 ml-6 mt-1.5">
										<div>{explanationInfo.title}</div>
										{explanationInfo.fromRef && (
											<div className="opacity-70 mt-1.5 break-all text-xs">
												<code className="bg-quote rounded-sm py-0.5 pr-1.5">
													{explanationInfo.fromRef}
												</code>
												<ArrowRightIcon className="inline size-2 mx-1" />
												<code className="bg-quote rounded-sm py-0.5 px-1.5">
													{explanationInfo.toRef || t("chat.workingDirectory")}
												</code>
											</div>
										)}
									</div>
								)}
							</div>
						)
					}
					case "completion_result": {
						const hasChanges = message.text?.endsWith(COMPLETION_RESULT_CHANGES_FLAG) ?? false
						const completionText = hasChanges
							? message.text?.slice(0, -COMPLETION_RESULT_CHANGES_FLAG.length)
							: message.text

						return (
							<CompletionOutputRow
								contentRef={contentRef}
								explainChangesDisabled={explainChangesDisabled}
								handleMouseUp={handleMouseUp}
								handleQuoteClick={handleQuoteClick}
								headClassNames={HEADER_CLASSNAMES}
								messageTs={message.ts}
								quoteButtonState={quoteButtonState}
								seeNewChangesDisabled={seeNewChangesDisabled}
								setExplainChangesDisabled={setExplainChangesDisabled}
								setSeeNewChangesDisabled={setSeeNewChangesDisabled}
								showActionRow={hasChanges}
								stream={false}
								text={completionText || ""}
							/>
						)
					}
					case "shell_integration_warning":
						return (
							<div className="flex flex-col bg-warning/20 p-2 rounded-xs border border-error">
								<div className="flex items-center mb-1">
									<TriangleAlertIcon className="mr-2 size-2 stroke-3 text-error" />
									<span className="font-medium text-foreground">{t("chat.shellIntegrationUnavailable")}</span>
								</div>
								<div className="text-foreground opacity-80">
									{t("chat.shellIntegrationWarningText")} ({/* allow-any-unicode-next-line */}
									<code>CMD/CTRL + Shift + P</code> → "Update"){t("chat.shellIntegrationWarningMiddle")} (
									{/* allow-any-unicode-next-line */}
									<code>CMD/CTRL + Shift + P</code> → "Terminal: Select Default Profile")
									{t("chat.shellIntegrationWarningEnd")}
								<a className="px-1" href="https://shuncode-ai.ru/ru/docs/terminal-troubleshooting">
									{t("chat.stillHavingIssues")}
								</a>
								</div>
							</div>
						)
					case "error_retry":
						try {
							const retryInfo = JSON.parse(message.text || "{}")
							const { attempt, maxAttempts, delaySeconds, failed, errorMessage } = retryInfo
							const isFailed = failed === true

							return (
								<div className="flex flex-col gap-2">
									{errorMessage && (
										<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere text-xs">{errorMessage}</p>
									)}
									<div className="flex flex-col bg-quote p-0 rounded-[3px] text-[12px]">
										<div className="flex items-center mb-1">
											{isFailed && !isRequestInProgress ? (
												<TriangleAlertIcon className="mr-2 size-2" />
											) : (
												<RefreshCwIcon className="mr-2 size-2 animate-spin" />
											)}
											<span className="font-medium text-foreground">
												{isFailed ? t("chat.autoRetryFailed") : t("chat.autoRetryRunning")}
											</span>
										</div>
										<div className="text-foreground opacity-80">
											{isFailed ? (
												<span>
													{t("chat.autoRetryFailedAfter")} <strong>{maxAttempts}</strong>{" "}
													{t("chat.attempts")}. {t("chat.manualInterventionRequired")}
												</span>
											) : (
												<span>
													{t("chat.attempt")} <strong>{attempt}</strong> {t("chat.of")}{" "}
													<strong>{maxAttempts}</strong> - {t("chat.retryIn")} {delaySeconds}{" "}
													{t("chat.seconds")}
													...
												</span>
											)}
										</div>
									</div>
								</div>
							)
						} catch (_e) {
							// Fallback if JSON parsing fails
							return (
								<div className="text-foreground">
									<MarkdownRow markdown={message.text} />
								</div>
							)
						}
					case "hook_status":
						return <HookMessage CommandOutput={CommandOutputContent} message={message} />
					case "hook_output_stream":
						// hook_output_stream messages are combined with hook_status messages, so we don't render them separately
						return <InvisibleSpacer />
					case "shell_integration_warning_with_suggestion":
						const isBackgroundModeEnabled = vscodeTerminalExecutionMode === "backgroundExec"
						return (
							<div className="p-2 bg-link/10 border border-link/30 rounded-xs">
								<div className="flex items-center mb-1">
									<LightbulbIcon className="mr-1.5 size-2 text-link" />
									<span className="font-medium text-foreground">{t("chat.shellIntegrationIssues")}</span>
								</div>
								<div className="text-foreground opacity-90 mb-2">
									{t("chat.shellIntegrationIssuesDescription")}
								</div>
								<button
									className={cn(
										"bg-button-background text-button-foreground border-0 rounded-xs py-1.5 px-3 text-[12px] flex items-center gap-1.5 cursor-pointer hover:bg-button-hover",
										{
											"cursor-default opacity-80 bg-success": isBackgroundModeEnabled,
										},
									)}
									disabled={isBackgroundModeEnabled}
									onClick={async () => {
										try {
											// Enable background terminal execution mode
											await UiServiceClient.setTerminalExecutionMode(BooleanRequest.create({ value: true }))
										} catch (error) {
											console.error("Failed to enable background terminal:", error)
										}
									}}>
									<SettingsIcon className="size-2" />
									{isBackgroundModeEnabled
										? t("chat.backgroundTerminalEnabled")
										: t("chat.enableBackgroundTerminal")}
								</button>
							</div>
						)
					case "task_progress":
						return <InvisibleSpacer />
					case "workflow_step_start": {
						try {
							const stepData = JSON.parse(message.text || "{}")
							return (
								<div className="flex items-center gap-2 py-1.5 px-2 my-1 rounded text-xs text-description border border-dashed"
									style={{ borderColor: "var(--vscode-panel-border)" }}>
									<span className="codicon codicon-play text-green-400" style={{ fontSize: 12 }} />
								<span className="font-medium">
									{t("workflow.stepProgress", { current: (stepData.stepIndex ?? 0) + 1, total: stepData.totalSteps ?? "?", name: stepData.stepName ?? "" })}
								</span>
								{stepData.silent && (
									<span className="codicon codicon-eye-closed opacity-50 ml-auto" title={t("workflow.silentModeLabel")} style={{ fontSize: 12 }} />
								)}
								</div>
							)
						} catch {
							return <InvisibleSpacer />
						}
					}
					default:
						return (
							<div>
								{title && (
									<div className={HEADER_CLASSNAMES}>
										{icon}
										{title}
									</div>
								)}
								<div className="pt-1">
									<MarkdownRow markdown={message.text} />
								</div>
							</div>
						)
				}
			case "ask":
				switch (message.ask) {
					case "mistake_limit_reached":
						return <ErrorRow errorType="mistake_limit_reached" message={message} />
					case "completion_result":
						if (message.text) {
							const askHasChanges = message.text.endsWith(COMPLETION_RESULT_CHANGES_FLAG) ?? false
							const askCompletionText = askHasChanges
								? message.text.slice(0, -COMPLETION_RESULT_CHANGES_FLAG.length)
								: message.text
							return (
								<CompletionOutputRow
									contentRef={contentRef}
									explainChangesDisabled={explainChangesDisabled}
									handleMouseUp={handleMouseUp}
									handleQuoteClick={handleQuoteClick}
									headClassNames={HEADER_CLASSNAMES}
									messageTs={message.ts}
									quoteButtonState={quoteButtonState}
									seeNewChangesDisabled={seeNewChangesDisabled}
									setExplainChangesDisabled={setExplainChangesDisabled}
									setSeeNewChangesDisabled={setSeeNewChangesDisabled}
									showActionRow={askHasChanges}
									stream={false}
									text={askCompletionText || ""}
								/>
							)
						} else {
							// Virtuoso cannot handle zero-height items; render a spacer instead of null
							return <InvisibleSpacer />
						}
					case "followup":
						let question: string | undefined
						let options: string[] | undefined
						let selected: string | undefined
						try {
							const parsedMessage = JSON.parse(message.text || "{}") as ShuncodeAskQuestion
							question = parsedMessage.question
							options = parsedMessage.options
							selected = parsedMessage.selected
						} catch (_e) {
							// legacy messages would pass question directly
							question = message.text
						}

						return (
							<div>
								{title && (
									<div className={HEADER_CLASSNAMES}>
										{icon}
										{title}
									</div>
								)}
								<WithCopyButton
									className="pt-1"
									markdownDualCopy={{
										markdownSource: question ?? message.text ?? "",
										renderedRef: markdownRenderedRef,
									}}
									onMouseUp={handleMouseUp}
									position="bottom-right"
									ref={contentRef}>
									<div ref={markdownRenderedRef}>
										<MarkdownRow markdown={question} />
									</div>
									{quoteButtonState.visible && (
										<QuoteButton
											left={quoteButtonState.left}
											onClick={() => {
												handleQuoteClick()
											}}
											top={quoteButtonState.top}
										/>
									)}
								</WithCopyButton>
								<OptionsButtons
									inputValue={inputValue}
									isActive={
										(isLast && lastModifiedMessage?.ask === "followup") ||
										(!selected && options && options.length > 0)
									}
									options={options}
									selected={selected}
								/>
							</div>
						)
					case "new_task":
						return (
							<div>
								<div className={HEADER_CLASSNAMES}>
									<FilePlus2Icon className="size-2" />
									<span className="text-foreground font-bold">{t("chat.wantsToStartNewTask")}</span>
								</div>
								<NewTaskPreview context={message.text || ""} />
							</div>
						)
					case "condense":
						return (
							<div>
								<div className={HEADER_CLASSNAMES}>
									<FilePlus2Icon className="size-2" />
									<span className="text-foreground font-bold">{t("chat.wantsToCondenseConversation")}</span>
								</div>
								<NewTaskPreview context={message.text || ""} />
							</div>
						)
					case "report_bug":
						return (
							<div>
								<div className={HEADER_CLASSNAMES}>
									<FilePlus2Icon className="size-2" />
									<span className="text-foreground font-bold">{t("chat.wantsToCreateGithubIssue")}</span>
								</div>
								<ReportBugPreview data={message.text || ""} />
							</div>
						)
					case "plan_mode_respond": {
						let response: string | undefined
						let options: string[] | undefined
						let selected: string | undefined
						try {
							const parsedMessage = JSON.parse(message.text || "{}") as ShuncodePlanModeResponse
							response = parsedMessage.response
							options = parsedMessage.options
							selected = parsedMessage.selected
						} catch (_e) {
							// legacy messages would pass response directly
							response = message.text
						}
					return (
						<div>
							<PlanCompletionOutputRow
								headClassNames={HEADER_CLASSNAMES}
								mode={mode}
								text={response || message.text || ""}
							/>
								<OptionsButtons
									inputValue={inputValue}
									isActive={
										(isLast && lastModifiedMessage?.ask === "plan_mode_respond") ||
										(!selected && options && options.length > 0)
									}
									options={options}
									selected={selected}
								/>
							</div>
						)
					}
					default:
						return <InvisibleSpacer />
				}
		}
	},
)
