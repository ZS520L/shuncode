import type { ShuncodeMessage, ShuncodeSayTool } from "@shared/ExtensionMessage"
import { memo, useMemo } from "react"
import FastContextDisplay from "@/components/chat/FastContextDisplay"

interface FastContextCardProps {
	message: ShuncodeMessage
}

/**
 * Renders a FastContext tool call directly without ChatRow wrapper.
 * This avoids the extra pt-2.5 px-4 padding that ChatRow adds.
 */
export const FastContextCard = memo(({ message }: FastContextCardProps) => {
	const tool = useMemo(() => {
		try {
			return JSON.parse(message.text || "{}") as ShuncodeSayTool
		} catch {
			return {} as ShuncodeSayTool
		}
	}, [message.text])

	const isStreaming = message.partial === true

	return (
		<div className="px-4 py-0.5">
			<FastContextDisplay tool={tool} isStreaming={isStreaming} />
		</div>
	)
})

FastContextCard.displayName = "FastContextCard"
