import { ArrowRight, Trash2, X } from "lucide-react"
import React from "react"
import { useI18n } from "@/i18n"
import type { QueuedMessage } from "./hooks/useMessageQueue"

interface MessageQueueProps {
	queue: QueuedMessage[]
	selectedIndex: number
	onSendNow: () => void
	onRemoveSelected: () => void
	onClearQueue: () => void
	onSelectItem: (index: number) => void
}

export const MessageQueue: React.FC<MessageQueueProps> = ({
	queue,
	selectedIndex,
	onSendNow,
	onRemoveSelected,
	onClearQueue,
	onSelectItem,
}) => {
	const { t } = useI18n()
	if (queue.length === 0) {
		return null
	}

	return (
		<div className="message-queue">
			{/* Header with buttons */}
			<div className="message-queue-header">
				<span className="message-queue-title">
					{t("queue.inQueue")} ({queue.length})
				</span>
				<div className="message-queue-actions">
					<button className="message-queue-btn" onClick={onSendNow} title={t("queue.sendNow")}>
						<ArrowRight size={14} />
					</button>
					<button className="message-queue-btn" onClick={onRemoveSelected} title={t("queue.removeSelected")}>
						<Trash2 size={14} />
					</button>
					<button className="message-queue-btn" onClick={onClearQueue} title={t("queue.clearQueue")}>
						<X size={14} />
					</button>
				</div>
			</div>

			{/* Message list */}
			<div className="message-queue-list">
				{queue.map((msg, index) => (
					<div
						className={`message-queue-item ${index === selectedIndex ? "selected" : ""}`}
						key={msg.id}
						onClick={() => onSelectItem(index)}>
						<span className="message-queue-indicator">
							{/* allow-any-unicode-next-line */}
							{index === selectedIndex ? "›" : " "}
						</span>
						<span className="message-queue-text">
							{msg.text.length > 50 ? msg.text.substring(0, 50) + "..." : msg.text}
						</span>
						{msg.images.length > 0 && (
							<>
								{/* allow-any-unicode-next-line */}
								<span className="message-queue-badge">🖼 {msg.images.length}</span>
							</>
						)}
						{msg.files.length > 0 && (
							<>
								{/* allow-any-unicode-next-line */}
								<span className="message-queue-badge">📎 {msg.files.length}</span>
							</>
						)}
					</div>
				))}
			</div>
		</div>
	)
}
