import { useCallback, useLayoutEffect, useRef } from "react"
import { mentionRegexGlobal } from "@shared/context-mentions"
import {
	slashCommandRegexGlobal,
	validateSlashCommand,
} from "@/utils/slash-commands"

interface UseTextHighlightParams {
	inputValue: string
	localWorkflowToggles: Record<string, boolean> | undefined
	globalWorkflowToggles: Record<string, boolean> | undefined
	remoteWorkflowToggles: Record<string, boolean> | undefined
	remoteGlobalWorkflows: any
}

export function useTextHighlight({
	inputValue,
	localWorkflowToggles,
	globalWorkflowToggles,
	remoteWorkflowToggles,
	remoteGlobalWorkflows,
}: UseTextHighlightParams) {
	const highlightLayerRef = useRef<HTMLDivElement>(null)
	const textAreaRef = useRef<HTMLTextAreaElement | null>(null)

	const updateHighlights = useCallback(() => {
		if (!textAreaRef.current || !highlightLayerRef.current) {
			return
		}

		let processedText = textAreaRef.current.value

		processedText = processedText
			.replace(/\n$/, "\n\n")
			.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] || c)
			.replace(mentionRegexGlobal, '<mark class="mention-context-textarea-highlight">$&</mark>')

		slashCommandRegexGlobal.lastIndex = 0
		let hasHighlightedSlashCommand = false
		processedText = processedText.replace(slashCommandRegexGlobal, (match, prefix, command) => {
			if (hasHighlightedSlashCommand) {
				return match
			}
			const commandName = command.substring(1)
			const isValidCommand = validateSlashCommand(
				commandName,
				localWorkflowToggles,
				globalWorkflowToggles,
				remoteWorkflowToggles,
				remoteGlobalWorkflows,
			)
			if (isValidCommand) {
				hasHighlightedSlashCommand = true
				return `${prefix}<mark class="mention-context-textarea-highlight">${command}</mark>`
			}
			return match
		})

		highlightLayerRef.current.innerHTML = processedText
		highlightLayerRef.current.scrollTop = textAreaRef.current.scrollTop
		highlightLayerRef.current.scrollLeft = textAreaRef.current.scrollLeft
	}, [localWorkflowToggles, globalWorkflowToggles, remoteWorkflowToggles, remoteGlobalWorkflows])

	useLayoutEffect(() => {
		updateHighlights()
	}, [inputValue, updateHighlights])

	return { highlightLayerRef, textAreaRef, updateHighlights }
}
