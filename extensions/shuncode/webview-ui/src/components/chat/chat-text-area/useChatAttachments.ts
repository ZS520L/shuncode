import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { CHAT_CONSTANTS } from "@/components/chat/chat-view/constants"
import { FileServiceClient } from "@/services/grpc-client"
import { RelativePathsRequest } from "@shared/proto/shuncode/file"

const { MAX_IMAGES_AND_FILES_PER_MESSAGE } = CHAT_CONSTANTS

const getImageDimensions = (dataUrl: string): Promise<{ width: number; height: number }> => {
	return new Promise((resolve, reject) => {
		const img = new Image()
		img.onload = () => {
			if (img.width > 7999 || img.height > 7999) {
				reject(new Error(`Image dimensions ${img.width}x${img.height} exceed 7999px limit.`))
			} else {
				resolve({ width: img.width, height: img.height })
			}
		}
		img.onerror = () => reject(new Error("Failed to load image"))
		img.src = dataUrl
	})
}

interface UseChatAttachmentsParams {
	inputValue: string
	cursorPosition: number
	selectedImages: string[]
	selectedFiles: string[]
	shouldDisableFilesAndImages: boolean
	setInputValue: (value: string) => void
	setCursorPosition: (pos: number) => void
	setIntendedCursorPosition: (pos: number | null) => void
	setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>
	setShowContextMenu: (show: boolean) => void
	textAreaRef: React.RefObject<HTMLTextAreaElement | null>
	setPendingInsertions: React.Dispatch<React.SetStateAction<string[]>>
}

export interface ChatAttachmentsResult {
	isDraggingOver: boolean
	showUnsupportedFileError: boolean
	showDimensionError: boolean
	handlePaste: (e: React.ClipboardEvent) => Promise<void>
	handleDragEnter: (e: React.DragEvent) => void
	onDragOver: (e: React.DragEvent) => void
	handleDragLeave: (e: React.DragEvent) => void
	onDrop: (e: React.DragEvent) => Promise<void>
}

export function useChatAttachments({
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
}: UseChatAttachmentsParams): ChatAttachmentsResult {
	const [isDraggingOver, setIsDraggingOver] = useState(false)
	const [showUnsupportedFileError, setShowUnsupportedFileError] = useState(false)
	const [showDimensionError, setShowDimensionError] = useState(false)
	const unsupportedFileTimerRef = useRef<NodeJS.Timeout | null>(null)
	const dimensionErrorTimerRef = useRef<NodeJS.Timeout | null>(null)

	const showDimensionErrorMessage = useCallback(() => {
		setShowDimensionError(true)
		if (dimensionErrorTimerRef.current) {
			clearTimeout(dimensionErrorTimerRef.current)
		}
		dimensionErrorTimerRef.current = setTimeout(() => {
			setShowDimensionError(false)
			dimensionErrorTimerRef.current = null
		}, 3000)
	}, [])

	const showUnsupportedFileErrorMessage = useCallback(() => {
		setShowUnsupportedFileError(true)
		if (unsupportedFileTimerRef.current) {
			clearTimeout(unsupportedFileTimerRef.current)
		}
		unsupportedFileTimerRef.current = setTimeout(() => {
			setShowUnsupportedFileError(false)
			unsupportedFileTimerRef.current = null
		}, 3000)
	}, [])

	const readImageFiles = useCallback(
		(imageFiles: File[]): Promise<(string | null)[]> => {
			return Promise.all(
				imageFiles.map(
					(file) =>
						new Promise<string | null>((resolve) => {
							const reader = new FileReader()
							reader.onloadend = async () => {
								if (reader.error) {
									console.error("Error reading file:", reader.error)
									resolve(null)
								} else {
									const result = reader.result
									if (typeof result === "string") {
										try {
											await getImageDimensions(result)
											resolve(result)
										} catch (error) {
											console.warn((error as Error).message)
											showDimensionErrorMessage()
											resolve(null)
										}
									} else {
										resolve(null)
									}
								}
							}
							reader.readAsDataURL(file)
						}),
				),
			)
		},
		[showDimensionErrorMessage],
	)

	const handlePaste = useCallback(
		async (e: React.ClipboardEvent) => {
			const items = e.clipboardData.items

			const pastedText = e.clipboardData.getData("text")
			const urlRegex = /^\S+:\/\/\S+$/
			if (urlRegex.test(pastedText.trim())) {
				e.preventDefault()
				const trimmedUrl = pastedText.trim()
				const newValue = inputValue.slice(0, cursorPosition) + trimmedUrl + " " + inputValue.slice(cursorPosition)
				setInputValue(newValue)
				const newCursorPosition = cursorPosition + trimmedUrl.length + 1
				setCursorPosition(newCursorPosition)
				setIntendedCursorPosition(newCursorPosition)
				setShowContextMenu(false)

				setTimeout(() => {
					if (textAreaRef.current) {
						textAreaRef.current.blur()
						textAreaRef.current.focus()
					}
				}, 0)

				return
			}

			const acceptedTypes = ["png", "jpeg", "webp"]
			const imageItems = Array.from(items).filter((item) => {
				const [type, subtype] = item.type.split("/")
				return type === "image" && acceptedTypes.includes(subtype)
			})
			if (!shouldDisableFilesAndImages && imageItems.length > 0) {
				e.preventDefault()
				const imagePromises = imageItems.map((item) => {
					return new Promise<string | null>((resolve) => {
						const blob = item.getAsFile()
						if (!blob) {
							resolve(null)
							return
						}
						const reader = new FileReader()
						reader.onloadend = async () => {
							if (reader.error) {
								console.error("Error reading file:", reader.error)
								resolve(null)
							} else {
								const result = reader.result
								if (typeof result === "string") {
									try {
										await getImageDimensions(result)
										resolve(result)
									} catch (error) {
										console.warn((error as Error).message)
										showDimensionErrorMessage()
										resolve(null)
									}
								} else {
									resolve(null)
								}
							}
						}
						reader.readAsDataURL(blob)
					})
				})
				const imageDataArray = await Promise.all(imagePromises)
				const dataUrls = imageDataArray.filter((dataUrl): dataUrl is string => dataUrl !== null)
				if (dataUrls.length > 0) {
					const filesAndImagesLength = selectedImages.length + selectedFiles.length
					const availableSlots = MAX_IMAGES_AND_FILES_PER_MESSAGE - filesAndImagesLength

					if (availableSlots > 0) {
						const imagesToAdd = Math.min(dataUrls.length, availableSlots)
						setSelectedImages((prevImages) => [...prevImages, ...dataUrls.slice(0, imagesToAdd)])
					}
				} else {
					console.warn("No valid images were processed")
				}
			}
		},
		[
			shouldDisableFilesAndImages,
			setSelectedImages,
			selectedImages,
			selectedFiles,
			cursorPosition,
			setInputValue,
			inputValue,
			showDimensionErrorMessage,
			setCursorPosition,
			setIntendedCursorPosition,
			setShowContextMenu,
			textAreaRef,
		],
	)

	const handleTextDrop = useCallback(
		(text: string) => {
			const newValue = inputValue.slice(0, cursorPosition) + text + inputValue.slice(cursorPosition)
			setInputValue(newValue)
			const newCursorPosition = cursorPosition + text.length
			setCursorPosition(newCursorPosition)
			setIntendedCursorPosition(newCursorPosition)
		},
		[inputValue, cursorPosition, setInputValue, setCursorPosition, setIntendedCursorPosition],
	)

	const handleDragEnter = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault()
			setIsDraggingOver(true)

			if (e.dataTransfer.types.includes("Files")) {
				const items = Array.from(e.dataTransfer.items)
				const hasNonImageFile = items.some((item) => {
					if (item.kind === "file") {
						const type = item.type.split("/")[0]
						return type !== "image"
					}
					return false
				})

				if (hasNonImageFile) {
					showUnsupportedFileErrorMessage()
				}
			}
		},
		[showUnsupportedFileErrorMessage],
	)

	const onDragOver = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault()
			if (!isDraggingOver) {
				setIsDraggingOver(true)
			}
		},
		[isDraggingOver],
	)

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		const dropZone = e.currentTarget as HTMLElement
		if (!dropZone.contains(e.relatedTarget as Node)) {
			setIsDraggingOver(false)
		}
	}, [])

	// Global drag end detection
	useEffect(() => {
		const handleGlobalDragEnd = () => {
			setIsDraggingOver(false)
		}

		document.addEventListener("dragend", handleGlobalDragEnd)

		return () => {
			document.removeEventListener("dragend", handleGlobalDragEnd)
		}
	}, [])

	const onDrop = useCallback(
		async (e: React.DragEvent) => {
			e.preventDefault()
			setIsDraggingOver(false)

			setShowUnsupportedFileError(false)
			if (unsupportedFileTimerRef.current) {
				clearTimeout(unsupportedFileTimerRef.current)
				unsupportedFileTimerRef.current = null
			}

			// --- 1. VSCode Explorer Drop Handling ---
			let uris: string[] = []
			const resourceUrlsData = e.dataTransfer.getData("resourceurls")
			const vscodeUriListData = e.dataTransfer.getData("application/vnd.code.uri-list")

			if (resourceUrlsData) {
				try {
					uris = JSON.parse(resourceUrlsData)
					uris = uris.map((uri) => decodeURIComponent(uri))
				} catch (error) {
					console.error("Failed to parse resourceurls JSON:", error)
					uris = []
				}
			}

			if (uris.length === 0 && vscodeUriListData) {
				uris = vscodeUriListData.split("\n").map((uri) => uri.trim())
			}

			const validUris = uris.filter(
				(uri) =>
					uri &&
					(uri.startsWith("vscode-file:") || uri.startsWith("file:") || uri.startsWith("vscode-remote:")),
			)

			if (validUris.length > 0) {
				setPendingInsertions([])
				let initialCursorPos = inputValue.length
				if (textAreaRef.current) {
					initialCursorPos = textAreaRef.current.selectionStart
				}
				setIntendedCursorPosition(initialCursorPos)

				FileServiceClient.getRelativePaths(RelativePathsRequest.create({ uris: validUris }))
					.then((response) => {
						if (response.paths.length > 0) {
							setPendingInsertions((prev) => [...prev, ...response.paths])
						}
					})
					.catch((error) => {
						console.error("Error getting relative paths:", error)
					})
				return
			}

			const text = e.dataTransfer.getData("text")
			if (text) {
				handleTextDrop(text)
				return
			}

			// --- 3. Image Drop Handling ---
			const files = Array.from(e.dataTransfer.files)
			const acceptedTypes = ["png", "jpeg", "webp"]
			const imageFiles = files.filter((file) => {
				const [type, subtype] = file.type.split("/")
				return type === "image" && acceptedTypes.includes(subtype)
			})

			if (shouldDisableFilesAndImages || imageFiles.length === 0) {
				return
			}

			const imageDataArray = await readImageFiles(imageFiles)
			const dataUrls = imageDataArray.filter((dataUrl): dataUrl is string => dataUrl !== null)

			if (dataUrls.length > 0) {
				const filesAndImagesLength = selectedImages.length + selectedFiles.length
				const availableSlots = MAX_IMAGES_AND_FILES_PER_MESSAGE - filesAndImagesLength

				if (availableSlots > 0) {
					const imagesToAdd = Math.min(dataUrls.length, availableSlots)
					setSelectedImages((prevImages) => [...prevImages, ...dataUrls.slice(0, imagesToAdd)])
				}
			} else {
				console.warn("No valid images were processed")
			}
		},
		[
			inputValue,
			selectedImages,
			selectedFiles,
			shouldDisableFilesAndImages,
			setSelectedImages,
			setIntendedCursorPosition,
			setPendingInsertions,
			textAreaRef,
			handleTextDrop,
			readImageFiles,
		],
	)

	return {
		isDraggingOver,
		showUnsupportedFileError,
		showDimensionError,
		handlePaste,
		handleDragEnter,
		onDragOver,
		handleDragLeave,
		onDrop,
	}
}
