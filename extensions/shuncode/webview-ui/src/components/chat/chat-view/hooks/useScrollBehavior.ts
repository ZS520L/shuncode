import { ShuncodeMessage } from "@shared/ExtensionMessage"
import { useCallback, useEffect, useRef, useState } from "react"
import { ScrollBehavior } from "../types/chatTypes"
import { TurnData } from "../utils/messageUtils"

/**
 * Native-scroll chat scroll manager (no Virtuoso).
 *
 * Modes:
 * 1. AUTO-SCROLL (default): viewport follows content growth — user always sees
 *    the bottom of the last turn.  Triggered by content height increase
 *    (ResizeObserver) and turn count change.
 *
 * 2. USER-SCROLL: activated when the user scrolls/wheels UP away from the
 *    content bottom.  Auto-scroll is paused until the user scrolls back down
 *    to the live area (or clicks "scroll to bottom").
 *
 * "Content bottom" = scrollHeight − footerHeight.
 * Footer is a spacer (100vh) so the last turn can be pinned to the top
 * of the viewport.  We never auto-scroll *into* the footer.
 *
 * Last-turn pinning: when a new turn appears, we scroll so its top aligns
 * with the viewport top. Auto-scroll stays off (disableAutoScrollRef) until
 * the user scrolls near the content bottom or uses scroll-to-bottom — so
 * streaming height changes do not snap the view to the bottom.
 */

const NEAR_BOTTOM_PX = 80
const AT_BOTTOM_PX = 50

export function useScrollBehavior(
	messages: ShuncodeMessage[],
	_visibleMessages: ShuncodeMessage[],
	turns: TurnData[],
	expandedRows: Record<number, boolean>,
	setExpandedRows: React.Dispatch<React.SetStateAction<Record<number, boolean>>>,
): ScrollBehavior & {
	showScrollToBottom: boolean
	setShowScrollToBottom: React.Dispatch<React.SetStateAction<boolean>>
	isAtBottom: boolean
	setIsAtBottom: React.Dispatch<React.SetStateAction<boolean>>
	pendingScrollToMessage: number | null
	setPendingScrollToMessage: React.Dispatch<React.SetStateAction<number | null>>
} {
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	const disableAutoScrollRef = useRef(false)

	const [showScrollToBottom, setShowScrollToBottom] = useState(false)
	const [isAtBottom, setIsAtBottom] = useState(true)
	const [pendingScrollToMessage, setPendingScrollToMessage] = useState<number | null>(null)

	// --- refs for internal bookkeeping ---
	const scrollerRef = useRef<HTMLElement | null>(null)
	const prevScrollHeightRef = useRef(0)
	const isPinningRef = useRef(false)
	const userInteractingRef = useRef(false)
	const turnsRef = useRef(turns)
	turnsRef.current = turns
	const prevTurnCountRef = useRef(turns.length)
	const prevMessagesLengthRef = useRef(messages.length)
	const resizeObserverRef = useRef<ResizeObserver | null>(null)
	const scrollFollowRafRef = useRef<number | null>(null)
	const wheelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Grace: after programmatic scroll, ignore wheel/scroll events briefly
	// so the browser's own scroll event from our scrollTo doesn't get
	// misclassified as "user scrolling".
	const programmaticScrollUntilRef = useRef(0)

	// ---------- helpers ----------

	const getFooterPixels = useCallback(() => window.innerHeight, [])

	const getContentMaxScroll = useCallback(
		(scroller: HTMLElement) => {
			return Math.max(0, scroller.scrollHeight - getFooterPixels() - scroller.clientHeight)
		},
		[getFooterPixels],
	)

	/** Scroll to content bottom (not into footer). */
	const scrollToContentBottom = useCallback(
		(scroller: HTMLElement, behavior: ScrollBehavior_CSS = "auto") => {
			const maxScroll = getContentMaxScroll(scroller)
			if (scroller.scrollTop < maxScroll) {
				programmaticScrollUntilRef.current = Date.now() + 80
				scroller.scrollTo({ top: maxScroll, behavior })
			}
			prevScrollHeightRef.current = scroller.scrollHeight
		},
		[getContentMaxScroll],
	)

	// --- public API ---

	const scrollToBottomAuto = useCallback(() => {
		disableAutoScrollRef.current = false
		setShowScrollToBottom(false)
		const scroller = scrollerRef.current
		if (scroller) {
			scrollToContentBottom(scroller, "auto")
		}
	}, [scrollToContentBottom])

	const scrollToBottomSmooth = useCallback(() => {
		if (scrollFollowRafRef.current != null) cancelAnimationFrame(scrollFollowRafRef.current)
		scrollFollowRafRef.current = requestAnimationFrame(() => {
			scrollFollowRafRef.current = null
			const scroller = scrollerRef.current
			if (!scroller || disableAutoScrollRef.current || isPinningRef.current) return
			scrollToContentBottom(scroller, "auto")
		})
	}, [scrollToContentBottom])

	// --- scrollToMessage ---

	const scrollToMessage = useCallback(
		(messageIndex: number) => {
			const targetMessage = messages[messageIndex]
			if (!targetMessage) {
				setPendingScrollToMessage(null)
				return
			}

			let turnIndex = -1
			for (let t = 0; t < turns.length; t++) {
				const turn = turns[t]
				if (turn.userMessage.ts === targetMessage.ts) { turnIndex = t; break }
				for (const item of turn.items) {
					if (Array.isArray(item)) {
						if (item.some((m) => m.ts === targetMessage.ts)) { turnIndex = t; break }
					} else if (item.ts === targetMessage.ts) { turnIndex = t; break }
				}
				if (turnIndex !== -1) break
			}

			if (turnIndex !== -1) {
				setPendingScrollToMessage(null)
				disableAutoScrollRef.current = true
				setShowScrollToBottom(true)

				requestAnimationFrame(() => {
					const scroller = scrollerRef.current
					if (!scroller) return
					const turnEl = scroller.querySelector(`[data-turn-index="${turnIndex}"]`) as HTMLElement | null
					if (turnEl) {
						programmaticScrollUntilRef.current = Date.now() + 200
						turnEl.scrollIntoView({ block: "start", behavior: "smooth" })
					}
				})
			} else {
				setPendingScrollToMessage(null)
			}
		},
		[messages, turns],
	)

	// --- toggleRowExpansion ---

	const toggleRowExpansion = useCallback(
		(ts: number) => {
			const isCollapsing = expandedRows[ts] ?? false

			setExpandedRows((prev) => ({ ...prev, [ts]: !prev[ts] }))

			if (!isCollapsing) {
				disableAutoScrollRef.current = true
				setShowScrollToBottom(true)
			} else {
				// collapsing — clamp scroll so we don't have empty space below content
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						const scroller = scrollerRef.current
						if (!scroller) return
						const maxScroll = getContentMaxScroll(scroller)
						if (scroller.scrollTop > maxScroll) {
							scroller.scrollTop = maxScroll
						}
						prevScrollHeightRef.current = scroller.scrollHeight
					})
				})
			}
		},
		[expandedRows, setExpandedRows, getContentMaxScroll],
	)

	// --- handleRowHeightChange (called by ChatRow for last message) ---

	const handleRowHeightChange = useCallback(
		(isTaller: boolean) => {
			if (disableAutoScrollRef.current || isPinningRef.current) return
			const scroller = scrollerRef.current
			if (!scroller) return

			if (isTaller) {
				scrollToBottomSmooth()
			} else {
				requestAnimationFrame(() => {
					const maxScroll = getContentMaxScroll(scroller)
					if (scroller.scrollTop > maxScroll) {
						scroller.scrollTop = maxScroll
					}
					prevScrollHeightRef.current = scroller.scrollHeight
				})
			}
		},
		[scrollToBottomSmooth, getContentMaxScroll],
	)

	// ==================== Scroller ref callback ====================

	const onScrollerRef = useCallback((ref: HTMLElement | null) => {
		scrollerRef.current = ref
		if (ref) {
			prevScrollHeightRef.current = ref.scrollHeight
		}
	}, [])

	// ==================== User interaction detection ====================
	// We track wheel / touchstart / pointerdown on the scroller to know
	// when the *user* (not our code) is driving scroll position.

	useEffect(() => {
		const scroller = scrollerRef.current
		if (!scroller) return

		const onWheel = (e: WheelEvent) => {
			userInteractingRef.current = true

			if (e.deltaY < 0) {
				disableAutoScrollRef.current = true
				programmaticScrollUntilRef.current = 0
				setShowScrollToBottom(true)
			}

			if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current)
			wheelTimeoutRef.current = setTimeout(() => {
				userInteractingRef.current = false
			}, 150)
		}

		const markUserInteraction = () => {
			userInteractingRef.current = true
		}
		const clearUserInteraction = () => {
			userInteractingRef.current = false
		}

		scroller.addEventListener("wheel", onWheel, { passive: true })
		scroller.addEventListener("touchstart", markUserInteraction, { passive: true })
		scroller.addEventListener("pointerdown", markUserInteraction, { passive: true })
		scroller.addEventListener("touchend", clearUserInteraction, { passive: true })
		scroller.addEventListener("pointerup", clearUserInteraction, { passive: true })

		return () => {
			scroller.removeEventListener("wheel", onWheel)
			scroller.removeEventListener("touchstart", markUserInteraction)
			scroller.removeEventListener("pointerdown", markUserInteraction)
			scroller.removeEventListener("touchend", clearUserInteraction)
			scroller.removeEventListener("pointerup", clearUserInteraction)
			if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current)
		}
	}, [scrollerRef.current])

	// ==================== Scroll event — auto-scroll toggle ====================

	useEffect(() => {
		const scroller = scrollerRef.current
		if (!scroller) return

		const handleScroll = () => {
			if (isPinningRef.current) return

			if (Date.now() < programmaticScrollUntilRef.current && !userInteractingRef.current) return

			const footerPx = getFooterPixels()
			const distanceFromContent =
				scroller.scrollHeight - footerPx - scroller.scrollTop - scroller.clientHeight

			const nearBottom = distanceFromContent <= NEAR_BOTTOM_PX

			if (nearBottom) {
				disableAutoScrollRef.current = false
				setShowScrollToBottom(false)
			} else if (userInteractingRef.current) {
				disableAutoScrollRef.current = true
				setShowScrollToBottom(true)
			}

			setIsAtBottom(distanceFromContent <= AT_BOTTOM_PX)
		}

		scroller.addEventListener("scroll", handleScroll, { passive: true })
		return () => scroller.removeEventListener("scroll", handleScroll)
	}, [scrollerRef.current, getFooterPixels])

	// ==================== ResizeObserver — follow content growth ====================

	useEffect(() => {
		const scroller = scrollerRef.current
		if (!scroller) return

		// Observe the first child (the actual content wrapper) if available,
		// otherwise the scroller itself.
		const target = scroller.firstElementChild ?? scroller

		const ro = new ResizeObserver(() => {
			if (isPinningRef.current || disableAutoScrollRef.current) return

			const curHeight = scroller.scrollHeight
			const prevHeight = prevScrollHeightRef.current

			if (curHeight > prevHeight) {
				// Content grew → follow it
				scrollToContentBottom(scroller, "auto")
			} else if (curHeight < prevHeight) {
				// Content shrank → clamp
				const maxScroll = getContentMaxScroll(scroller)
				if (scroller.scrollTop > maxScroll) {
					scroller.scrollTop = maxScroll
				}
			}
			prevScrollHeightRef.current = curHeight
		})

		ro.observe(target)
		resizeObserverRef.current = ro

		return () => {
			ro.disconnect()
			resizeObserverRef.current = null
		}
	}, [scrollerRef.current, scrollToContentBottom, getContentMaxScroll])

	// ==================== New turn pinning ====================

	useEffect(() => {
		const prevTurnCount = prevTurnCountRef.current
		const curTurnCount = turns.length
		const prevMsgLen = prevMessagesLengthRef.current
		const curMsgLen = messages.length

		prevTurnCountRef.current = curTurnCount
		prevMessagesLengthRef.current = curMsgLen

		if (curMsgLen <= prevMsgLen) return

		if (curTurnCount > prevTurnCount) {
			const scroller = scrollerRef.current
			if (!scroller) return

			isPinningRef.current = true
			disableAutoScrollRef.current = true

			// Wait for DOM to render the new turn element
			requestAnimationFrame(() => {
				const lastTurnEl = scroller.querySelector(
					`[data-turn-index="${curTurnCount - 1}"]`,
				) as HTMLElement | null

				if (lastTurnEl) {
					programmaticScrollUntilRef.current = Date.now() + 200
					const elTop = lastTurnEl.offsetTop - scroller.offsetTop
					scroller.scrollTo({ top: elTop, behavior: "auto" })
				}

				requestAnimationFrame(() => {
					isPinningRef.current = false
					// Keep disableAutoScrollRef true: user is reading from the pinned top;
					// handleScroll re-enables follow when they scroll near the bottom.
					setShowScrollToBottom(true)
					if (scroller) {
						prevScrollHeightRef.current = scroller.scrollHeight
					}
				})
			})
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [messages.length, turns.length])

	// ==================== Pending scroll to message ====================

	useEffect(() => {
		if (pendingScrollToMessage !== null) {
			scrollToMessage(pendingScrollToMessage)
		}
	}, [pendingScrollToMessage, turns, scrollToMessage])

	useEffect(() => {
		if (!messages?.length) {
			setShowScrollToBottom(false)
		}
	}, [messages.length])

	// ==================== Cleanup ====================

	useEffect(
		() => () => {
			if (scrollFollowRafRef.current != null) {
				cancelAnimationFrame(scrollFollowRafRef.current)
			}
			if (wheelTimeoutRef.current != null) {
				clearTimeout(wheelTimeoutRef.current)
			}
		},
		[],
	)

	return {
		scrollContainerRef,
		disableAutoScrollRef,
		scrollToBottomSmooth,
		scrollToBottomAuto,
		scrollToMessage,
		toggleRowExpansion,
		handleRowHeightChange,
		showScrollToBottom,
		setShowScrollToBottom,
		isAtBottom,
		setIsAtBottom,
		pendingScrollToMessage,
		setPendingScrollToMessage,
		onScrollerRef,
	}
}

type ScrollBehavior_CSS = "auto" | "smooth"
