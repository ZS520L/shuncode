import { EmptyRequest } from "@shared/proto/shuncode/common"
import type { OpenaiReasoningEffort } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { AtSignIcon, PlusIcon } from "lucide-react"
import type React from "react"
import { forwardRef, useCallback, useEffect, useRef, useState } from "react"
import DynamicTextArea from "react-textarea-autosize"
import { useWindowSize } from "react-use"
import ContextMenu from "@/components/chat/ContextMenu"
import ModelPickerModal from "@/components/chat/ModelPickerModal"
import SlashCommandMenu from "@/components/chat/SlashCommandMenu"
import Thumbnails from "@/components/common/Thumbnails"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { usePlatform } from "@/context/PlatformContext"
import { useShuncodeAuth } from "@/context/ShuncodeAuthContext"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { ContextMenuOptionType } from "@/utils/context-mentions"
import { useMetaKeyDetection, useShortcut } from "@/utils/hooks"
import ShuncodeRulesToggleModal from "../shuncode-rules/ShuncodeRulesToggleModal"
import {
	MODE_COLORS,
	ButtonGroup,
	ButtonContainer,
	ModelContainer,
	ModelButtonWrapper,
	ModelDisplayButton,
	ModelButtonContent,
} from "./chat-text-area/ChatTextArea.styles"
import ModeSwitcher from "./chat-text-area/ModeSwitcher"
import { useChatAttachments } from "./chat-text-area/useChatAttachments"
import { useInputHandlers } from "./chat-text-area/useInputHandlers"
import { useModelSelector } from "./chat-text-area/useModelSelector"
import { useTextHighlight } from "./chat-text-area/useTextHighlight"
import ServersToggleModal from "./ServersToggleModal"
import VoiceRecorder from "./VoiceRecorder"
import { updateSetting } from "../settings/utils/settingsHandlers"

const THINKING_EFFORT_OPTIONS: OpenaiReasoningEffort[] = ["low", "medium", "high", "xhigh"]

interface ChatTextAreaProps {
	inputValue: string
	activeQuote: string | null
	setInputValue: (value: string) => void
	sendingDisabled: boolean
	placeholderText: string
	selectedFiles: string[]
	selectedImages: string[]
	setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>
	setSelectedFiles: React.Dispatch<React.SetStateAction<string[]>>
	onSend: () => void
	onSelectFilesAndImages: () => void
	shouldDisableFilesAndImages: boolean
	onHeightChange?: (height: number) => void
	onFocusChange?: (isFocused: boolean) => void
	/** Show "AI working" indicator */
	isAiWorking?: boolean
	/** Cancel the currently running task */
	onCancel?: () => void
}

const ChatTextArea = forwardRef<HTMLTextAreaElement, ChatTextAreaProps>(
	(
		{
			inputValue,
			setInputValue,
			sendingDisabled,
			placeholderText,
			selectedFiles,
			selectedImages,
			setSelectedImages,
			setSelectedFiles,
			onSend,
			onSelectFilesAndImages,
			shouldDisableFilesAndImages,
			onHeightChange,
			onFocusChange,
			isAiWorking,
			onCancel,
		},
		ref,
	) => {
		const { t } = useI18n()
		const {
			mode,
			apiConfiguration,
			openRouterModels,
			platform,
			localWorkflowToggles,
			globalWorkflowToggles,
			remoteWorkflowToggles,
			remoteConfigSettings,
			showChatModelSelector: showModelSelector,
			setShowChatModelSelector: setShowModelSelector,
			openaiReasoningEffort,
			dictationSettings,
			navigateToSettings,
			navigateToAccount,
		} = useExtensionState()
		const { shuncodeUser } = useShuncodeAuth()
		const [isTextAreaFocused, setIsTextAreaFocused] = useState(false)
		const [isVoiceRecording, setIsVoiceRecording] = useState(false)
		const [isVoiceProcessing, setIsVoiceProcessing] = useState(false)
		const [thumbnailsHeight, setThumbnailsHeight] = useState(0)
		const [textAreaBaseHeight, setTextAreaBaseHeight] = useState<number | undefined>(undefined)
		const [cursorPosition, setCursorPosition] = useState(0)
		const [selectedType, setSelectedType] = useState<ContextMenuOptionType | null>(null)
		const [showThinkingEffortMenu, setShowThinkingEffortMenu] = useState(false)
		const [localThinkingEffort, setLocalThinkingEffort] = useState<OpenaiReasoningEffort>(openaiReasoningEffort || "xhigh")
		const selectedThinkingEffort = localThinkingEffort
		const pendingThinkingEffortUpdateRef = useRef<Promise<unknown> | null>(null)

		const { highlightLayerRef, textAreaRef, updateHighlights } = useTextHighlight({
			inputValue,
			localWorkflowToggles,
			globalWorkflowToggles,
			remoteWorkflowToggles,
			remoteGlobalWorkflows: remoteConfigSettings?.remoteGlobalWorkflows,
		})

		const {
			showContextMenu,
			setShowContextMenu,
			showSlashCommandsMenu,
			selectedSlashCommandsIndex,
			setSelectedSlashCommandsIndex,
			slashCommandsQuery,
			searchQuery,
			selectedMenuIndex,
			setSelectedMenuIndex,
			fileSearchResults,
			searchLoading,
			queryItems,
			intendedCursorPosition,
			setIntendedCursorPosition,
			pendingInsertions,
			setPendingInsertions,
			isMouseDownOnMenu,
			contextMenuContainerRef,
			slashCommandsMenuContainerRef,
			handleKeyDown,
			handleInputChange,
			handleMentionSelect,
			handleSlashCommandsSelect,
			handleBlur,
			handleMenuMouseDown,
			handleKeyUp,
			updateCursorPosition,
		} = useInputHandlers({
			inputValue,
			setInputValue,
			cursorPosition,
			setCursorPosition,
			sendingDisabled,
			onSend,
			textAreaRef,
			localWorkflowToggles,
			globalWorkflowToggles,
			remoteWorkflowToggles,
			remoteConfigSettings,
			selectedType,
			setSelectedType,
		})

		const modelSelectorRef = useRef<HTMLDivElement>(null)
		const { width: viewportWidth, height: viewportHeight } = useWindowSize()
		const buttonRef = useRef<HTMLDivElement>(null)
		const [_arrowPosition, setArrowPosition] = useState(0)
		const [_menuPosition, setMenuPosition] = useState(0)
		const [, metaKeyChar] = useMetaKeyDetection(platform)

		const {
			isDraggingOver,
			showUnsupportedFileError,
			showDimensionError,
			handlePaste,
			handleDragEnter,
			onDragOver,
			handleDragLeave,
			onDrop,
		} = useChatAttachments({
			inputValue,
			cursorPosition,
			selectedImages,
			selectedFiles,
			shouldDisableFilesAndImages,
			setInputValue,
			setCursorPosition,
			setIntendedCursorPosition,
			setSelectedImages,
			setShowContextMenu,
			textAreaRef,
			setPendingInsertions,
		})

		const handleThumbnailsHeightChange = useCallback((height: number) => {
			setThumbnailsHeight(height)
		}, [])

		useEffect(() => {
			if (selectedImages.length === 0 && selectedFiles.length === 0) {
				setThumbnailsHeight(0)
			}
		}, [selectedImages, selectedFiles])

		const { modelDisplayName, switchToMode, onModeToggle } = useModelSelector({
			mode,
			apiConfiguration,
			openRouterModels,
			showModelSelector,
			inputValue,
			selectedImages,
			selectedFiles,
			setInputValue,
			textAreaRef,
		})

		useShortcut(usePlatform().togglePlanActKeys, onModeToggle, { disableTextInputs: false })

		const handleContextButtonClick = useCallback(() => {
			// Focus the textarea first
			textAreaRef.current?.focus()

			// If input is empty, just insert @
			if (!inputValue.trim()) {
				const event = {
					target: {
						value: "@",
						selectionStart: 1,
					},
				} as React.ChangeEvent<HTMLTextAreaElement>
				handleInputChange(event)
				updateHighlights()
				return
			}

			// If input ends with space or is empty, just append @
			if (inputValue.endsWith(" ")) {
				const event = {
					target: {
						value: inputValue + "@",
						selectionStart: inputValue.length + 1,
					},
				} as React.ChangeEvent<HTMLTextAreaElement>
				handleInputChange(event)
				updateHighlights()
				return
			}

			// Otherwise add space then @
			const event = {
				target: {
					value: inputValue + " @",
					selectionStart: inputValue.length + 2,
				},
			} as React.ChangeEvent<HTMLTextAreaElement>
			handleInputChange(event)
			updateHighlights()
		}, [inputValue, handleInputChange, updateHighlights])

		const handleModelButtonClick = () => {
			setShowModelSelector(!showModelSelector)
		}

		useEffect(() => {
			setLocalThinkingEffort(openaiReasoningEffort || "xhigh")
		}, [openaiReasoningEffort])

		const handleThinkingEffortSelect = useCallback(
			(effort: OpenaiReasoningEffort) => {
				setLocalThinkingEffort(effort)
				setShowThinkingEffortMenu(false)
				const updatePromise = updateSetting("openaiReasoningEffort", effort).finally(() => {
					if (pendingThinkingEffortUpdateRef.current === updatePromise) {
						pendingThinkingEffortUpdateRef.current = null
					}
				})
				pendingThinkingEffortUpdateRef.current = updatePromise
				textAreaRef.current?.focus()
			},
			[textAreaRef],
		)

		// Calculate arrow position and menu position based on button location
		useEffect(() => {
			if (showModelSelector && buttonRef.current) {
				const buttonRect = buttonRef.current.getBoundingClientRect()
				const buttonCenter = buttonRect.left + buttonRect.width / 2

				// Calculate distance from right edge of viewport using viewport coordinates
				const rightPosition = document.documentElement.clientWidth - buttonCenter - 5

				setArrowPosition(rightPosition)
				setMenuPosition(buttonRect.top + 1) // Added +1 to move menu down by 1px
			}
		}, [showModelSelector, viewportWidth, viewportHeight])

		useEffect(() => {
			if (!showModelSelector) {
				// Attempt to save if possible
				// NOTE: we cannot call this here since it will create an infinite loop between this effect and the callback since getLatestState will update state. Instead we should submitapiconfig when the menu is explicitly closed, rather than as an effect of showModelSelector changing.
				// handleApiConfigSubmit()

				// Reset any active styling by blurring the button
				const button = buttonRef.current?.querySelector("a")
				if (button) {
					button.blur()
				}
			}
		}, [showModelSelector])

		return (
			<div>
				<div
					className="relative flex transition-colors ease-in-out duration-100 px-3.5 py-2.5"
					onDragEnter={handleDragEnter}
					onDragLeave={handleDragLeave}
					onDragOver={onDragOver}
					onDrop={onDrop}>
					{/* PulsingBorder removed — replaced with simple mic animation in VoiceRecorder */}

					{showDimensionError && (
						<div className="absolute inset-2.5 bg-[rgba(var(--vscode-errorForeground-rgb),0.1)] border-2 border-error rounded-xs flex items-center justify-center z-10 pointer-events-none">
							<span className="text-error font-bold text-xs text-center">{t("chat.imageTooBig")}</span>
						</div>
					)}
					{showUnsupportedFileError && (
						<div className="absolute inset-2.5 bg-[rgba(var(--vscode-errorForeground-rgb),0.1)] border-2 border-error rounded-xs flex items-center justify-center z-10 pointer-events-none">
							<span className="text-error font-bold text-xs">{t("chat.nonImageDisabled")}</span>
						</div>
					)}
					{showSlashCommandsMenu && (
						<div ref={slashCommandsMenuContainerRef}>
							<SlashCommandMenu
								globalWorkflowToggles={globalWorkflowToggles}
								localWorkflowToggles={localWorkflowToggles}
								onMouseDown={handleMenuMouseDown}
								onSelect={handleSlashCommandsSelect}
								query={slashCommandsQuery}
								remoteWorkflows={remoteConfigSettings?.remoteGlobalWorkflows}
								remoteWorkflowToggles={remoteWorkflowToggles}
								selectedIndex={selectedSlashCommandsIndex}
								setSelectedIndex={setSelectedSlashCommandsIndex}
							/>
						</div>
					)}

					{showContextMenu && (
						<div ref={contextMenuContainerRef}>
							<ContextMenu
								dynamicSearchResults={fileSearchResults}
								isLoading={searchLoading}
								onMouseDown={handleMenuMouseDown}
								onSelect={handleMentionSelect}
								queryItems={queryItems}
								searchQuery={searchQuery}
								selectedIndex={selectedMenuIndex}
								selectedType={selectedType}
								setSelectedIndex={setSelectedMenuIndex}
							/>
						</div>
					)}
					<div
						className={cn(
							"absolute bottom-2.5 top-2.5 whitespace-pre-wrap break-words rounded-xs overflow-hidden bg-input-background",
							isTextAreaFocused || isVoiceRecording
								? "left-3.5 right-3.5"
								: "left-3.5 right-3.5 border border-input-border",
						)}
						ref={highlightLayerRef}
						style={{
							position: "absolute",
							pointerEvents: "none",
							whiteSpace: "pre-wrap",
							wordWrap: "break-word",
							color: "transparent",
							overflow: "hidden",
							fontFamily: "var(--vscode-font-family)",
							fontSize: "var(--vscode-editor-font-size)",
							lineHeight: "var(--vscode-editor-line-height)",
							borderRadius: 2,
							borderLeft: isTextAreaFocused || isVoiceRecording ? 0 : undefined,
							borderRight: isTextAreaFocused || isVoiceRecording ? 0 : undefined,
							borderTop: isTextAreaFocused || isVoiceRecording ? 0 : undefined,
							borderBottom: isTextAreaFocused || isVoiceRecording ? 0 : undefined,
							padding: `9px ${dictationSettings?.dictationEnabled ? "48" : "28"}px ${9 + thumbnailsHeight}px 9px`,
						}}
					/>
					<DynamicTextArea
						autoFocus={true}
						data-testid="chat-input"
						maxRows={10}
						minRows={3}
						onBlur={() => {
							handleBlur(onFocusChange)
							setIsTextAreaFocused(false)
						}}
						onChange={(e) => {
							handleInputChange(e)
							updateHighlights()
						}}
						onFocus={() => {
							setIsTextAreaFocused(true)
							onFocusChange?.(true) // Call prop on focus
						}}
						onHeightChange={(height) => {
							if (textAreaBaseHeight === undefined || height < textAreaBaseHeight) {
								setTextAreaBaseHeight(height)
							}
							onHeightChange?.(height)
						}}
						onKeyDown={handleKeyDown}
						onKeyUp={handleKeyUp}
						onMouseUp={updateCursorPosition}
						onPaste={handlePaste}
						onScroll={() => updateHighlights()}
						onSelect={updateCursorPosition}
						placeholder={showUnsupportedFileError || showDimensionError ? "" : placeholderText}
						ref={(el) => {
							if (typeof ref === "function") {
								ref(el)
							} else if (ref) {
								ref.current = el
							}
							textAreaRef.current = el
						}}
						style={{
							width: "100%",
							boxSizing: "border-box",
							backgroundColor: "transparent",
							color: "var(--vscode-input-foreground)",
							//border: "1px solid var(--vscode-input-border)",
							borderRadius: 2,
							fontFamily: "var(--vscode-font-family)",
							fontSize: "var(--vscode-editor-font-size)",
							lineHeight: "var(--vscode-editor-line-height)",
							resize: "none",
							overflowX: "hidden",
							overflowY: "scroll",
							scrollbarWidth: "none",
							// Since we have maxRows, when text is long enough it starts to overflow the bottom padding, appearing behind the thumbnails. To fix this, we use a transparent border to push the text up instead. (https://stackoverflow.com/questions/42631947/maintaining-a-padding-inside-of-text-area/52538410#52538410)
							// borderTop: "9px solid transparent",
							borderLeft: 0,
							borderRight: 0,
							borderTop: 0,
							borderBottom: `${thumbnailsHeight}px solid transparent`,
							borderColor: "transparent",
							// borderRight: "54px solid transparent",
							// borderLeft: "9px solid transparent", // NOTE: react-textarea-autosize doesn't calculate correct height when using borderLeft/borderRight so we need to use horizontal padding instead
							// Instead of using boxShadow, we use a div with a border to better replicate the behavior when the textarea is focused
							// boxShadow: "0px 0px 0px 1px var(--vscode-input-border)",
							padding: `9px ${dictationSettings?.dictationEnabled ? "48" : "28"}px 9px 9px`,
							cursor: "text",
							flex: 1,
							zIndex: 1,
							outline:
								isDraggingOver && !showUnsupportedFileError // Only show drag outline if not showing error
									? "2px dashed var(--vscode-focusBorder)"
									: isTextAreaFocused
										? `1px solid ${MODE_COLORS[mode] || "var(--vscode-focusBorder)"}`
										: "none",
							outlineOffset: isDraggingOver && !showUnsupportedFileError ? "1px" : "0px", // Add offset for drag-over outline
						}}
						value={inputValue}
					/>
					{!inputValue && selectedImages.length === 0 && selectedFiles.length === 0 && (
						<div className="text-xs absolute bottom-5 left-6.5 right-16 text-(--vscode-input-placeholderForeground)/50 whitespace-nowrap overflow-hidden text-ellipsis pointer-events-none z-1">
							{t("chat.contextHint")}
						</div>
					)}
					{(selectedImages.length > 0 || selectedFiles.length > 0) && (
						<Thumbnails
							files={selectedFiles}
							images={selectedImages}
							onHeightChange={handleThumbnailsHeightChange}
							setFiles={setSelectedFiles}
							setImages={setSelectedImages}
							style={{
								position: "absolute",
								paddingTop: 4,
								bottom: 14,
								left: 22,
								right: 47, // (54 + 9) + 4 extra padding
								zIndex: 2,
							}}
						/>
					)}
					<div
						className="absolute flex items-end bottom-4.5 right-5 z-10 h-8 text-xs"
						style={{ height: textAreaBaseHeight }}>
						<div className="flex flex-row items-center">
							{dictationSettings?.featureEnabled &&
								(dictationSettings?.dictationEnabled && dictationSettings?.voiceReady ? (
									<VoiceRecorder
										disabled={sendingDisabled}
										isAuthenticated={!!shuncodeUser?.uid}
										language={dictationSettings?.dictationLanguage || "en"}
										onAuthRequired={navigateToAccount}
										onProcessingStateChange={(isProcessing, message) => {
											setIsVoiceProcessing(isProcessing)
											if (isProcessing && message) {
												// Show processing message in input
												setInputValue(`${inputValue} [${message}]`.trim())
											}
										}}
										onRecordingStateChange={setIsVoiceRecording}
										onTranscription={(text) => {
											// Remove any processing text first
											const processingPattern = /\s*\[Transcribing\.\.\.\]$/
											const cleanedValue = inputValue.replace(processingPattern, "")

											if (!text) {
												setInputValue(cleanedValue)
												return
											}

											// Append the transcribed text to the cleaned input
											const newValue = cleanedValue + (cleanedValue ? " " : "") + text
											setInputValue(newValue)
											// Focus the textarea and move cursor to end
											setTimeout(() => {
												if (textAreaRef.current) {
													textAreaRef.current.focus()
													const length = newValue.length
													textAreaRef.current.setSelectionRange(length, length)
												}
											}, 0)
										}}
									/>
								) : (
									/* Inactive mic — click opens Voice settings */
									<Tooltip>
										<TooltipTrigger asChild>
											<div
												className="pt-1 input-icon-button mr-1.5 text-base mt-0.5 opacity-40 cursor-pointer"
												onClick={() => navigateToSettings("voice")}>
												<span className="codicon codicon-mic" />
											</div>
										</TooltipTrigger>
										<TooltipContent side="top">{t("voice.setupRequired")}</TooltipContent>
									</Tooltip>
								))}
							<div className="relative mr-1.5">
								<button
									className="h-6 rounded-sm border border-editor-group-border bg-input-background px-1.5 text-[10px] uppercase text-description transition-colors duration-150 hover:bg-secondary/25 hover:text-foreground active:bg-secondary/45"
									onClick={() => setShowThinkingEffortMenu((prev) => !prev)}
									title="Thinking effort"
									type="button">
									{selectedThinkingEffort}
								</button>
								{showThinkingEffortMenu && (
									<div className="absolute bottom-full right-0 z-50 mb-1 min-w-20 overflow-hidden rounded-md border border-editor-group-border bg-dropdown-background shadow-md">
										{THINKING_EFFORT_OPTIONS.map((effort) => (
											<button
												className={cn(
													"block w-full px-2 py-1 text-left text-[11px] uppercase text-description transition-colors duration-150 hover:bg-secondary/25 hover:text-foreground",
													{ "bg-secondary/35 text-foreground": effort === selectedThinkingEffort },
												)}
												key={effort}
												onClick={() => handleThinkingEffortSelect(effort)}
												type="button">
												{effort}
											</button>
										))}
									</div>
								)}
							</div>
							{isAiWorking ? (
								<div
									className={cn(
										"input-icon-button",
										"codicon codicon-debug-stop text-sm text-description hover:text-foreground",
									)}
									data-testid="stop-button"
									onClick={() => {
										if (onCancel) {
											onCancel()
										} else {
											TaskServiceClient.cancelTask(EmptyRequest.create({})).catch((err) => {
												console.error("[Stop] cancelTask failed:", err)
											})
										}
									}}
									title={t("chat.stopAI")}
								/>
							) : (
								// Кнопка Send — disabled при записи голоса и транскрипции
								<div
									className={cn(
										"input-icon-button",
										{ disabled: sendingDisabled || isVoiceRecording || isVoiceProcessing },
										"codicon codicon-send text-sm",
									)}
									data-testid="send-button"
									onClick={async () => {
										if (!sendingDisabled && !isVoiceRecording && !isVoiceProcessing) {
											await pendingThinkingEffortUpdateRef.current
											setIsTextAreaFocused(false)
											onSend()
										}
									}}
								/>
							)}
						</div>
					</div>
				</div>
				<div className="flex justify-between items-center -mt-[2px] px-3 pb-2">
					{/* Always render both components, but control visibility with CSS */}
					<div className="relative flex-1 min-w-0 h-5">
						{/* ButtonGroup - always in DOM but visibility controlled */}
						<ButtonGroup className="absolute top-0 left-0 right-0 ease-in-out w-full h-5 z-10 flex items-center">
							<Tooltip>
								<TooltipContent>{t("chat.addContext")}</TooltipContent>
								<TooltipTrigger>
									<VSCodeButton
										appearance="icon"
										aria-label={t("chat.addContext")}
										className="p-0 m-0 flex items-center"
										data-testid="context-button"
										onClick={handleContextButtonClick}>
										<ButtonContainer>
											<AtSignIcon size={12} />
										</ButtonContainer>
									</VSCodeButton>
								</TooltipTrigger>
							</Tooltip>

							<Tooltip>
								<TooltipContent>{t("chat.addFiles")}</TooltipContent>
								<TooltipTrigger>
									<VSCodeButton
										appearance="icon"
										aria-label={t("chat.addFiles")}
										className="p-0 m-0 flex items-center"
										data-testid="files-button"
										disabled={shouldDisableFilesAndImages}
										onClick={() => {
											if (!shouldDisableFilesAndImages) {
												onSelectFilesAndImages()
											}
										}}>
										<ButtonContainer>
											<PlusIcon size={13} />
										</ButtonContainer>
									</VSCodeButton>
								</TooltipTrigger>
							</Tooltip>

							<ServersToggleModal />

							<ShuncodeRulesToggleModal />

							<ModelContainer ref={modelSelectorRef}>
								<ModelPickerModal
									currentMode={mode}
									isOpen={showModelSelector}
									onOpenChange={setShowModelSelector}>
									<ModelButtonWrapper ref={buttonRef}>
										<ModelDisplayButton
											disabled={false}
											isActive={showModelSelector}
											onClick={handleModelButtonClick}
											role="button"
											tabIndex={0}
											title={t("chat.selectModel")}>
											<ModelButtonContent className="text-xs">{modelDisplayName}</ModelButtonContent>
										</ModelDisplayButton>
									</ModelButtonWrapper>
								</ModelPickerModal>
							</ModelContainer>
						</ButtonGroup>
					</div>
					{/* Mode selector (Plan / Act / Ask / Debug) */}
					<ModeSwitcher mode={mode} onSwitchMode={switchToMode} />
				</div>
			</div>
		)
	},
)

export default ChatTextArea
