import { mentionRegex } from "@shared/context-mentions"
import { type SlashCommand } from "@shared/slashCommands"
import type React from "react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { FileSearchRequest, FileSearchType } from "@shared/proto/shuncode/file"
import { StringRequest } from "@shared/proto/shuncode/common"
import {
	ContextMenuOptionType,
	getContextMenuOptionIndex,
	getContextMenuOptions,
	insertMention,
	insertMentionDirectly,
	removeMention,
	type SearchResult,
	shouldShowContextMenu,
} from "@/utils/context-mentions"
import {
	getMatchingSlashCommands,
	insertSlashCommand,
	removeSlashCommand,
	shouldShowSlashCommandsMenu,
	slashCommandDeleteRegex,
} from "@/utils/slash-commands"
import { isSafari } from "@/utils/platformUtils"
import { FileServiceClient } from "@/services/grpc-client"

const DEFAULT_CONTEXT_MENU_OPTION = getContextMenuOptionIndex(ContextMenuOptionType.File)

interface GitCommit {
	type: ContextMenuOptionType.Git
	value: string
	label: string
	description: string
}

interface UseInputHandlersParams {
	inputValue: string
	setInputValue: (value: string) => void
	cursorPosition: number
	setCursorPosition: React.Dispatch<React.SetStateAction<number>>
	sendingDisabled: boolean
	onSend: () => void
	textAreaRef: React.MutableRefObject<HTMLTextAreaElement | null>
	localWorkflowToggles: Record<string, boolean> | undefined
	globalWorkflowToggles: Record<string, boolean> | undefined
	remoteWorkflowToggles: Record<string, boolean> | undefined
	remoteConfigSettings: { remoteGlobalWorkflows?: any } | undefined
	selectedType: ContextMenuOptionType | null
	setSelectedType: React.Dispatch<React.SetStateAction<ContextMenuOptionType | null>>
}

export function useInputHandlers({
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
}: UseInputHandlersParams) {
	const [gitCommits, setGitCommits] = useState<GitCommit[]>([])
	const [showSlashCommandsMenu, setShowSlashCommandsMenu] = useState(false)
	const [selectedSlashCommandsIndex, setSelectedSlashCommandsIndex] = useState(0)
	const [slashCommandsQuery, setSlashCommandsQuery] = useState("")
	const slashCommandsMenuContainerRef = useRef<HTMLDivElement>(null)

	const [showContextMenu, setShowContextMenu] = useState(false)
	const [searchQuery, setSearchQuery] = useState("")
	const [isMouseDownOnMenu, setIsMouseDownOnMenu] = useState(false)
	const [selectedMenuIndex, setSelectedMenuIndex] = useState(-1)
	const [justDeletedSpaceAfterMention, setJustDeletedSpaceAfterMention] = useState(false)
	const [justDeletedSpaceAfterSlashCommand, setJustDeletedSpaceAfterSlashCommand] = useState(false)
	const [intendedCursorPosition, setIntendedCursorPosition] = useState<number | null>(null)
	const contextMenuContainerRef = useRef<HTMLDivElement>(null)

	const [fileSearchResults, setFileSearchResults] = useState<SearchResult[]>([])
	const [searchLoading, setSearchLoading] = useState(false)
	const [pendingInsertions, setPendingInsertions] = useState<string[]>([])

	const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const currentSearchQueryRef = useRef<string>("")

	useEffect(() => {
		if (selectedType === ContextMenuOptionType.Git || /^[a-f0-9]+$/i.test(searchQuery)) {
			FileServiceClient.searchCommits(StringRequest.create({ value: searchQuery || "" }))
				.then((response) => {
					if (response.commits) {
						const commits: GitCommit[] = response.commits.map(
							(commit: { hash: string; shortHash: string; subject: string; author: string; date: string }) => ({
								type: ContextMenuOptionType.Git,
								value: commit.hash,
								label: commit.subject,
								description: `${commit.shortHash} by ${commit.author} on ${commit.date}`,
							}),
						)
						setGitCommits(commits)
					}
				})
				.catch((error) => {
					console.error("Error searching commits:", error)
				})
		}
	}, [selectedType, searchQuery])

	const queryItems = [
		{ type: ContextMenuOptionType.Problems, value: "problems" },
		{ type: ContextMenuOptionType.Terminal, value: "terminal" },
		...gitCommits,
	]

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (contextMenuContainerRef.current && !contextMenuContainerRef.current.contains(event.target as Node)) {
				setShowContextMenu(false)
			}
		}
		if (showContextMenu) {
			document.addEventListener("mousedown", handleClickOutside)
		}
		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [showContextMenu, setShowContextMenu])

	useEffect(() => {
		const handleClickOutsideSlashMenu = (event: MouseEvent) => {
			if (
				slashCommandsMenuContainerRef.current &&
				!slashCommandsMenuContainerRef.current.contains(event.target as Node)
			) {
				setShowSlashCommandsMenu(false)
			}
		}
		if (showSlashCommandsMenu) {
			document.addEventListener("mousedown", handleClickOutsideSlashMenu)
		}
		return () => {
			document.removeEventListener("mousedown", handleClickOutsideSlashMenu)
		}
	}, [showSlashCommandsMenu])

	const handleMentionSelect = useCallback(
		(type: ContextMenuOptionType, value?: string) => {
			if (type === ContextMenuOptionType.NoResults) {
				return
			}

			if (
				type === ContextMenuOptionType.File ||
				type === ContextMenuOptionType.Folder ||
				type === ContextMenuOptionType.Git
			) {
				if (!value) {
					setSelectedType(type)
					setSearchQuery("")
					setSelectedMenuIndex(0)

					if (type === ContextMenuOptionType.File || type === ContextMenuOptionType.Folder) {
						setSearchLoading(true)

						let searchType: FileSearchType | undefined
						if (type === ContextMenuOptionType.File) {
							searchType = FileSearchType.FILE
						} else if (type === ContextMenuOptionType.Folder) {
							searchType = FileSearchType.FOLDER
						}

						FileServiceClient.searchFiles(
							FileSearchRequest.create({
								query: "",
								mentionsRequestId: "",
								selectedType: searchType,
							}),
						)
							.then((results) => {
								setFileSearchResults((results.results || []) as SearchResult[])
								setSearchLoading(false)
							})
							.catch((error) => {
								console.error("Error searching files:", error)
								setFileSearchResults([])
								setSearchLoading(false)
							})
					}
					return
				}
			}

			setShowContextMenu(false)
			setSelectedType(null)
			const queryLength = searchQuery.length
			setSearchQuery("")

			if (textAreaRef.current) {
				let insertValue = value || ""
				if (type === ContextMenuOptionType.URL) {
					insertValue = value || ""
				} else if (type === ContextMenuOptionType.File || type === ContextMenuOptionType.Folder) {
					insertValue = value || ""
				} else if (type === ContextMenuOptionType.Problems) {
					insertValue = "problems"
				} else if (type === ContextMenuOptionType.Terminal) {
					insertValue = "terminal"
				} else if (type === ContextMenuOptionType.Git) {
					insertValue = value || ""
				}

				const { newValue, mentionIndex } = insertMention(
					textAreaRef.current.value,
					cursorPosition,
					insertValue,
					queryLength,
				)

				setInputValue(newValue)
				const newCursorPosition = newValue.indexOf(" ", mentionIndex + insertValue.length) + 1
				setCursorPosition(newCursorPosition)
				setIntendedCursorPosition(newCursorPosition)

				setTimeout(() => {
					if (textAreaRef.current) {
						textAreaRef.current.blur()
						textAreaRef.current.focus()
					}
				}, 0)
			}
		},
		[setInputValue, cursorPosition, searchQuery],
	)

	const handleSlashCommandsSelect = useCallback(
		(command: SlashCommand) => {
			setShowSlashCommandsMenu(false)
			const queryLength = slashCommandsQuery.length
			setSlashCommandsQuery("")

			if (textAreaRef.current) {
				const { newValue, commandIndex } = insertSlashCommand(
					textAreaRef.current.value,
					command.name,
					queryLength,
					cursorPosition,
				)
				const newCursorPosition = newValue.indexOf(" ", commandIndex + 1 + command.name.length) + 1

				setInputValue(newValue)
				setCursorPosition(newCursorPosition)
				setIntendedCursorPosition(newCursorPosition)

				setTimeout(() => {
					if (textAreaRef.current) {
						textAreaRef.current.blur()
						textAreaRef.current.focus()
					}
				}, 0)
			}
		},
		[setInputValue, slashCommandsQuery, cursorPosition],
	)

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (showSlashCommandsMenu) {
				if (event.key === "Escape") {
					setShowSlashCommandsMenu(false)
					setSlashCommandsQuery("")
					return
				}

				if (event.key === "ArrowUp" || event.key === "ArrowDown") {
					event.preventDefault()
					setSelectedSlashCommandsIndex((prevIndex) => {
						const direction = event.key === "ArrowUp" ? -1 : 1
						const allCommands = getMatchingSlashCommands(
							slashCommandsQuery,
							localWorkflowToggles,
							globalWorkflowToggles,
							remoteWorkflowToggles,
							remoteConfigSettings?.remoteGlobalWorkflows,
						)
						if (allCommands.length === 0) {
							return prevIndex
						}
						const totalCommandCount = allCommands.length
						const newIndex = (prevIndex + direction + totalCommandCount) % totalCommandCount
						return newIndex
					})
					return
				}

				if ((event.key === "Enter" || event.key === "Tab") && selectedSlashCommandsIndex !== -1) {
					event.preventDefault()
					const commands = getMatchingSlashCommands(
						slashCommandsQuery,
						localWorkflowToggles,
						globalWorkflowToggles,
						remoteWorkflowToggles,
						remoteConfigSettings?.remoteGlobalWorkflows,
					)
					if (commands.length > 0) {
						handleSlashCommandsSelect(commands[selectedSlashCommandsIndex])
					}
					return
				}
			}
			if (showContextMenu) {
				if (event.key === "Escape") {
					setShowContextMenu(false)
					setSelectedType(null)
					setSelectedMenuIndex(DEFAULT_CONTEXT_MENU_OPTION)
					setSearchQuery("")
					return
				}

				if (event.key === "ArrowUp" || event.key === "ArrowDown") {
					event.preventDefault()
					setSelectedMenuIndex((prevIndex) => {
						const direction = event.key === "ArrowUp" ? -1 : 1
						const options = getContextMenuOptions(searchQuery, selectedType, queryItems, fileSearchResults)
						const optionsLength = options.length

						if (optionsLength === 0) {
							return prevIndex
						}

						const selectableOptions = options.filter(
							(option) =>
								option.type !== ContextMenuOptionType.URL && option.type !== ContextMenuOptionType.NoResults,
						)

						if (selectableOptions.length === 0) {
							return -1
						}

						const currentSelectableIndex = selectableOptions.indexOf(options[prevIndex])
						const newSelectableIndex =
							(currentSelectableIndex + direction + selectableOptions.length) % selectableOptions.length
						return options.indexOf(selectableOptions[newSelectableIndex])
					})
					return
				}
				if ((event.key === "Enter" || event.key === "Tab") && selectedMenuIndex !== -1) {
					event.preventDefault()
					const selectedOption = getContextMenuOptions(searchQuery, selectedType, queryItems, fileSearchResults)[
						selectedMenuIndex
					]
					if (
						selectedOption &&
						selectedOption.type !== ContextMenuOptionType.URL &&
						selectedOption.type !== ContextMenuOptionType.NoResults
					) {
						const mentionValue = selectedOption.label?.includes(":") ? selectedOption.label : selectedOption.value
						handleMentionSelect(selectedOption.type, mentionValue)
					}
					return
				}
			}

			const isComposing = isSafari ? event.nativeEvent.keyCode === 229 : (event.nativeEvent?.isComposing ?? false)
			if (event.key === "Enter" && !event.shiftKey && !isComposing) {
				event.preventDefault()
				if (!sendingDisabled) {
					onSend()
				}
			}

			if (event.key === "Backspace" && !isComposing) {
				const charBeforeCursor = inputValue[cursorPosition - 1]
				const charAfterCursor = inputValue[cursorPosition + 1]

				const charBeforeIsWhitespace =
					charBeforeCursor === " " || charBeforeCursor === "\n" || charBeforeCursor === "\r\n"
				const charAfterIsWhitespace =
					charAfterCursor === " " || charAfterCursor === "\n" || charAfterCursor === "\r\n"

				if (
					charBeforeIsWhitespace &&
					inputValue.slice(0, cursorPosition - 1).match(new RegExp(mentionRegex.source + "$"))
				) {
					const newCursorPosition = cursorPosition - 1
					if (!charAfterIsWhitespace) {
						event.preventDefault()
						textAreaRef.current?.setSelectionRange(newCursorPosition, newCursorPosition)
						setCursorPosition(newCursorPosition)
					}
					setCursorPosition(newCursorPosition)
					setJustDeletedSpaceAfterMention(true)
					setJustDeletedSpaceAfterSlashCommand(false)
				} else if (charBeforeIsWhitespace && inputValue.slice(0, cursorPosition - 1).match(slashCommandDeleteRegex)) {
					const newCursorPosition = cursorPosition - 1
					if (!charAfterIsWhitespace) {
						event.preventDefault()
						textAreaRef.current?.setSelectionRange(newCursorPosition, newCursorPosition)
						setCursorPosition(newCursorPosition)
					}
					setCursorPosition(newCursorPosition)
					setJustDeletedSpaceAfterSlashCommand(true)
					setJustDeletedSpaceAfterMention(false)
				} else if (justDeletedSpaceAfterMention) {
					const { newText, newPosition } = removeMention(inputValue, cursorPosition)
					if (newText !== inputValue) {
						event.preventDefault()
						setInputValue(newText)
						setIntendedCursorPosition(newPosition)
					}
					setJustDeletedSpaceAfterMention(false)
					setShowContextMenu(false)
				} else if (justDeletedSpaceAfterSlashCommand) {
					const { newText, newPosition } = removeSlashCommand(inputValue, cursorPosition)
					if (newText !== inputValue) {
						event.preventDefault()
						setInputValue(newText)
						setIntendedCursorPosition(newPosition)
					}
					setJustDeletedSpaceAfterSlashCommand(false)
					setShowSlashCommandsMenu(false)
				} else {
					setJustDeletedSpaceAfterMention(false)
					setJustDeletedSpaceAfterSlashCommand(false)
				}
			}
		},
		[
			onSend,
			showContextMenu,
			searchQuery,
			selectedMenuIndex,
			handleMentionSelect,
			selectedType,
			inputValue,
			cursorPosition,
			setInputValue,
			justDeletedSpaceAfterMention,
			queryItems,
			fileSearchResults,
			showSlashCommandsMenu,
			selectedSlashCommandsIndex,
			slashCommandsQuery,
			handleSlashCommandsSelect,
			sendingDisabled,
		],
	)

	useLayoutEffect(() => {
		if (intendedCursorPosition !== null && textAreaRef.current) {
			textAreaRef.current.setSelectionRange(intendedCursorPosition, intendedCursorPosition)
			setIntendedCursorPosition(null)
		}
	}, [inputValue, intendedCursorPosition])

	useEffect(() => {
		if (pendingInsertions.length === 0 || !textAreaRef.current) {
			return
		}

		const path = pendingInsertions[0]
		const currentTextArea = textAreaRef.current
		const currentValue = currentTextArea.value
		const currentCursorPos =
			intendedCursorPosition ??
			(currentTextArea.selectionStart >= 0 ? currentTextArea.selectionStart : currentValue.length)

		const { newValue, mentionIndex } = insertMentionDirectly(currentValue, currentCursorPos, path)

		setInputValue(newValue)

		const newCursorPosition = mentionIndex + path.length + 2
		setIntendedCursorPosition(newCursorPosition)

		setPendingInsertions((prev) => prev.slice(1))
	}, [pendingInsertions, setInputValue])

	const handleInputChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			const newValue = e.target.value
			const newCursorPosition = e.target.selectionStart
			setInputValue(newValue)
			setCursorPosition(newCursorPosition)
			let showMenu = shouldShowContextMenu(newValue, newCursorPosition)
			const showSlash = shouldShowSlashCommandsMenu(newValue, newCursorPosition)

			if (showSlash) {
				showMenu = false
			}

			setShowSlashCommandsMenu(showSlash)
			setShowContextMenu(showMenu)

			if (showSlash) {
				const beforeCursor = newValue.slice(0, newCursorPosition)
				const slashIndex = beforeCursor.lastIndexOf("/")
				const query = newValue.slice(slashIndex + 1, newCursorPosition)
				setSlashCommandsQuery(query)
				setSelectedSlashCommandsIndex(0)
			} else {
				setSlashCommandsQuery("")
				setSelectedSlashCommandsIndex(0)
			}

			if (showMenu) {
				const lastAtIndex = newValue.lastIndexOf("@", newCursorPosition - 1)
				const query = newValue.slice(lastAtIndex + 1, newCursorPosition)
				setSearchQuery(query)
				currentSearchQueryRef.current = query

				if (query.length > 0) {
					setSelectedMenuIndex(0)

					if (searchTimeoutRef.current) {
						clearTimeout(searchTimeoutRef.current)
					}

					setSearchLoading(true)

					const searchType =
						selectedType === ContextMenuOptionType.File
							? FileSearchType.FILE
							: selectedType === ContextMenuOptionType.Folder
								? FileSearchType.FOLDER
								: undefined

					let workspaceHint: string | undefined
					let searchQueryStr = query
					const workspaceHintMatch = query.match(/^([\w-]+):\/(.*)$/)
					if (workspaceHintMatch) {
						workspaceHint = workspaceHintMatch[1]
						searchQueryStr = workspaceHintMatch[2]
					}

					searchTimeoutRef.current = setTimeout(() => {
						FileServiceClient.searchFiles(
							FileSearchRequest.create({
								query: searchQueryStr,
								mentionsRequestId: query,
								selectedType: searchType,
								workspaceHint: workspaceHint,
							}),
						)
							.then((results) => {
								setFileSearchResults((results.results || []) as SearchResult[])
								setSearchLoading(false)
							})
							.catch((error) => {
								console.error("Error searching files:", error)
								setFileSearchResults([])
								setSearchLoading(false)
							})
					}, 200)
				} else {
					setSelectedMenuIndex(DEFAULT_CONTEXT_MENU_OPTION)
				}
			} else {
				setSearchQuery("")
				setSelectedMenuIndex(-1)
				setFileSearchResults([])
			}
		},
		[setInputValue, setFileSearchResults, selectedType],
	)

	useEffect(() => {
		if (!showContextMenu) {
			setSelectedType(null)
		}
	}, [showContextMenu])

	const handleBlur = useCallback(
		(onFocusChange?: (isFocused: boolean) => void) => {
			if (!isMouseDownOnMenu) {
				setShowContextMenu(false)
				setShowSlashCommandsMenu(false)
			}
			onFocusChange?.(false)
		},
		[isMouseDownOnMenu],
	)

	const handleMenuMouseDown = useCallback(() => {
		setIsMouseDownOnMenu(true)
	}, [])

	const updateCursorPosition = useCallback(() => {
		if (textAreaRef.current) {
			setCursorPosition(textAreaRef.current.selectionStart)
		}
	}, [])

	const handleKeyUp = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
				updateCursorPosition()
			}
		},
		[updateCursorPosition],
	)

	return {
		// State
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
		// Refs
		contextMenuContainerRef,
		slashCommandsMenuContainerRef,
		// Handlers
		handleKeyDown,
		handleInputChange,
		handleMentionSelect,
		handleSlashCommandsSelect,
		handleBlur,
		handleMenuMouseDown,
		handleKeyUp,
		updateCursorPosition,
	}
}
