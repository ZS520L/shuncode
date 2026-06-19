import { MouseEvent, RefObject, useCallback, useState } from "react"

export interface QuoteButtonState {
	visible: boolean
	top: number
	left: number
	selectedText: string
}

const EMPTY_STATE: QuoteButtonState = { visible: false, top: 0, left: 0, selectedText: "" }

export function useQuoteButton(
	contentRef: RefObject<HTMLDivElement | null>,
	onSetQuote: (text: string) => void,
) {
	const [quoteButtonState, setQuoteButtonState] = useState<QuoteButtonState>(EMPTY_STATE)

	const handleQuoteClick = useCallback(() => {
		onSetQuote(quoteButtonState.selectedText)
		window.getSelection()?.removeAllRanges()
		setQuoteButtonState(EMPTY_STATE)
	}, [onSetQuote, quoteButtonState.selectedText])

	const handleMouseUp = useCallback((_event: MouseEvent<HTMLDivElement>) => {
		const targetElement = _event.target as Element
		const isClickOnButton = !!targetElement.closest(".quote-button-class")

		queueMicrotask(() => {
			const selection = window.getSelection()
			const selectedText = selection?.toString().trim() ?? ""

			let shouldShowButton = false
			let buttonTop = 0
			let buttonLeft = 0
			let textToQuote = ""

			if (selectedText && contentRef.current && selection && selection.rangeCount > 0 && !selection.isCollapsed) {
				const range = selection.getRangeAt(0)
				const rangeRect = range.getBoundingClientRect()
				const containerRect = contentRef.current?.getBoundingClientRect()

				if (containerRect) {
					const tolerance = 5
					const isSelectionWithin =
						rangeRect.top >= containerRect.top &&
						rangeRect.left >= containerRect.left &&
						rangeRect.bottom <= containerRect.bottom + tolerance &&
						rangeRect.right <= containerRect.right

					if (isSelectionWithin) {
						shouldShowButton = true
						const buttonHeight = 30
						buttonTop = rangeRect.top - containerRect.top - buttonHeight - 5
						buttonLeft = Math.max(0, rangeRect.left - containerRect.left)
						textToQuote = selectedText
					}
				}
			}

			if (shouldShowButton) {
				setQuoteButtonState({ visible: true, top: buttonTop, left: buttonLeft, selectedText: textToQuote })
			} else if (!isClickOnButton) {
				setQuoteButtonState(EMPTY_STATE)
			}
		})
	}, [contentRef])

	return { quoteButtonState, handleQuoteClick, handleMouseUp }
}
