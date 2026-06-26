import { ShuncodeMessage } from "@shared/ExtensionMessage"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import React, { useCallback, useLayoutEffect, useMemo, useState } from "react"
import { useI18n } from "@/i18n"
import Thumbnails from "@/components/common/Thumbnails"
import { getModeSpecificFields, normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { formatLargeNumber } from "@/utils/format"
import { getEnvironmentColor } from "@/utils/environmentColors"
import CopyTaskButton from "./buttons/CopyTaskButton"
import DeleteTaskButton from "./buttons/DeleteTaskButton"
import NewTaskButton from "./buttons/NewTaskButton"
import OpenDiskConversationHistoryButton from "./buttons/OpenDiskConversationHistoryButton"
import { CheckpointError } from "./CheckpointError"
import { FocusChain } from "./FocusChain"
import { highlightText } from "./Highlights"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const IS_DEV = process.env.IS_DEV === '"true"'
interface TaskHeaderProps {
	task: ShuncodeMessage
	totalCost: number
	lastApiReqTotalTokens?: number
	lastProgressMessageText?: string
	onClose: () => void
}

const BUTTON_CLASS = "max-h-3 border-0 font-bold bg-transparent hover:opacity-100 text-foreground"

const TaskHeader: React.FC<TaskHeaderProps> = ({
	task,
	totalCost,
	lastApiReqTotalTokens,
	lastProgressMessageText,
	onClose,
}) => {
	const { t } = useI18n()
	const {
		apiConfiguration,
		currentTaskItem,
		checkpointManagerErrorMessage,
		navigateToSettings,
		mode,
		expandTaskHeader: isTaskExpanded,
		setExpandTaskHeader: setIsTaskExpanded,
		environment,
	} = useExtensionState()

	const [isHighlightedTextExpanded, setIsHighlightedTextExpanded] = useState(false)
	const [isTextOverflowing, setIsTextOverflowing] = useState(false)
	const highlightedTextRef = React.useRef<HTMLDivElement>(null)

	const highlightedText = useMemo(() => highlightText(task.text, false), [task.text])

	// Check if text overflows the container (i.e., needs clamping)
	useLayoutEffect(() => {
		const el = highlightedTextRef.current
		if (el && isTaskExpanded && !isHighlightedTextExpanded) {
			// Check if content height exceeds the max-height
			setIsTextOverflowing(el.scrollHeight > el.clientHeight)
		}
	}, [task.text, isTaskExpanded, isHighlightedTextExpanded])

	// Handle click outside to collapse
	React.useEffect(() => {
		if (!isHighlightedTextExpanded) {
			return
		}

		const handleClickOutside = (event: MouseEvent) => {
			if (highlightedTextRef.current && !highlightedTextRef.current.contains(event.target as Node)) {
				setIsHighlightedTextExpanded(false)
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => document.removeEventListener("mousedown", handleClickOutside)
	}, [isHighlightedTextExpanded])

	// Simplified computed values
	const { selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, mode)
	const modeFields = getModeSpecificFields(apiConfiguration, mode)

	const isCostAvailable =
		(totalCost &&
			modeFields.apiProvider === "openai" &&
			modeFields.openAiModelInfo?.inputPrice &&
			modeFields.openAiModelInfo?.outputPrice) ||
		(modeFields.apiProvider !== "vscode-lm" &&
			modeFields.apiProvider !== "ollama" &&
			modeFields.apiProvider !== "lmstudio" &&
			modeFields.apiProvider !== "openai-codex") // Subscription-based, no per-token costs

	const contextWindow = selectedModelInfo?.contextWindow ?? 0
	const tokenPercentage = contextWindow ? ((lastApiReqTotalTokens ?? 0) / contextWindow) * 100 : 0

	// Event handlers
	const toggleTaskExpanded = useCallback(() => setIsTaskExpanded(!isTaskExpanded), [setIsTaskExpanded, isTaskExpanded])

	const handleCheckpointSettingsClick = useCallback(() => {
		navigateToSettings("editing")
	}, [navigateToSettings])

	const environmentBorderColor = getEnvironmentColor(environment, "border")

	return (
		<div className="py-2 px-4 flex flex-col gap-2">
			{/* [SHUNCODE] TEMPORARILY DISABLED — legacy Cline checkpoint error banner */}
			{/* <CheckpointError
				checkpointManagerErrorMessage={checkpointManagerErrorMessage}
				handleCheckpointSettingsClick={handleCheckpointSettingsClick}
			/> */}
			{/* Task Header — compact single row */}
			<div
				className={cn(
					"relative overflow-hidden cursor-pointer rounded-sm flex flex-col z-10 px-2 hover:opacity-100 bg-(--vscode-toolbar-hoverBackground)/65",
					{
						"opacity-100 border-1 pt-2 pb-2 gap-1.5": isTaskExpanded,
						"hover:bg-toolbar-hover border-1 py-1": !isTaskExpanded,
					},
				)}
				style={{
					borderColor: environmentBorderColor,
				}}>
				{/* === Main row: always visible, single line === */}
				<div
					aria-label={isTaskExpanded ? t("taskHeader.collapse") : t("taskHeader.expand")}
					className="flex items-center justify-between cursor-pointer min-w-0"
					onClick={toggleTaskExpanded}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault()
							e.stopPropagation()
							toggleTaskExpanded()
						}
					}}
					tabIndex={0}>
					{/* Left: chevron + text (text hidden when expanded to avoid duplication) */}
					<span className="flex items-center gap-1.5 min-w-0 overflow-hidden">
						<span className="shrink-0">
							{isTaskExpanded ? <ChevronDownIcon size="14" /> : <ChevronRightIcon size="14" />}
						</span>
						{!isTaskExpanded && (
							<span className="ph-no-capture text-sm whitespace-nowrap overflow-hidden text-ellipsis min-w-0" style={{ maxWidth: 250 }}>
							{highlightedText}
						</span>
						)}
					</span>

					{/* Right: price + tokens + close */}
					<span className="flex items-center gap-1.5 shrink-0 ml-2">
						{/* Price tag — only when cost > 0 */}
						{isCostAvailable && totalCost > 0 && (
							<span
								className="px-1 py-0.25 rounded-full text-badge-background bg-badge-foreground/80 text-xs"
								id="price-tag">
								{t("common.currencyPrefix")}{totalCost?.toFixed(4)}{t("common.currencySuffix")}
							</span>
						)}

						{/* Inline context window mini-bar */}
						{contextWindow > 0 && (
							<Tooltip>
								<TooltipTrigger asChild>
									<span
										className="flex items-center gap-1 text-xs text-description cursor-default"
										onClick={(e) => e.stopPropagation()}>
										<span>{formatLargeNumber(lastApiReqTotalTokens ?? 0)}</span>
										<span className="relative w-[120px] h-2.5 rounded-full bg-code-foreground/20 overflow-hidden">
											<span
												className="absolute inset-0 bg-code-foreground rounded-full transition-all"
												style={{ transform: `translateX(-${100 - (tokenPercentage || 0)}%)` }}
											/>
										</span>
										<span>{formatLargeNumber(contextWindow)}</span>
									</span>
								</TooltipTrigger>
								<TooltipContent side="bottom">
									{t("taskHeader.contextWindowUsageProgress")}: {Math.round(tokenPercentage)}% ({formatLargeNumber(lastApiReqTotalTokens ?? 0)} / {formatLargeNumber(contextWindow)})
								</TooltipContent>
							</Tooltip>
						)}

						{/* New task (close) button */}
						<NewTaskButton className={BUTTON_CLASS} onClick={onClose} />
					</span>
				</div>

				{/* === Expanded details === */}
				{isTaskExpanded && (
					<div className="flex flex-col break-words" key={`task-details-${currentTaskItem?.id}`}>
						{/* Action buttons */}
						<div className="flex gap-2 mx-1 mb-1 opacity-80">
							<CopyTaskButton className={BUTTON_CLASS} taskText={task.text} />
							<DeleteTaskButton
								className={BUTTON_CLASS}
								taskId={currentTaskItem?.id}
								taskSize={currentTaskItem?.size}
							/>
							{IS_DEV && (
								<OpenDiskConversationHistoryButton className={BUTTON_CLASS} taskId={currentTaskItem?.id} />
							)}
						</div>

						{/* Full task text */}
						<div
							className={cn(
								"ph-no-capture whitespace-pre-wrap break-words px-0.5 text-sm relative",
								"max-h-[4.5rem] overflow-hidden",
								{
									"max-h-[25vh] overflow-y-auto scroll-smooth": isHighlightedTextExpanded,
									"cursor-pointer": isTextOverflowing,
								},
							)}
							onClick={() => isTextOverflowing && setIsHighlightedTextExpanded(true)}
							ref={highlightedTextRef}
							style={
								!isHighlightedTextExpanded && isTextOverflowing
									? {
											WebkitMaskImage: "linear-gradient(to bottom, black 60%, transparent 100%)",
											maskImage: "linear-gradient(to bottom, black 60%, transparent 100%)",
										}
									: undefined
							}>
							{highlightedText}
						</div>

						{((task.images && task.images.length > 0) || (task.files && task.files.length > 0)) && (
							<Thumbnails files={task.files ?? []} images={task.images ?? []} />
						)}
					</div>
				)}
			</div>

			{/* Display Focus Chain To-Do List */}
			<FocusChain currentTaskItemId={currentTaskItem?.id} lastProgressMessageText={lastProgressMessageText} />
		</div>
	)
}

export default TaskHeader
