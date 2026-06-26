/**
 * ApprovalBar - рендерит pending approvals из useSession.
 *
 * Заменяет ActionButtons + buttonConfig.ts.
 * Каждый approval несёт свой конфиг кнопок (primaryText/secondaryText)
 * вместо вывода кнопок из типа последнего сообщения.
 */

import React, { useCallback, useState } from "react"
import type { PendingApproval } from "../../hooks/useSession"

interface ApprovalBarProps {
	approvals: PendingApproval[]
	onApprove: (approvalId: string, feedback?: string) => void
	onReject: (approvalId: string, feedback?: string) => void
}

/**
 * Renders pending approval requests from the session pipeline.
 * Each approval card shows tool info and approve/reject buttons.
 */
export const ApprovalBar: React.FC<ApprovalBarProps> = ({ approvals, onApprove, onReject }) => {
	const [processingId, setProcessingId] = useState<string | null>(null)

	const handleApprove = useCallback(
		(id: string) => {
			if (processingId) return
			setProcessingId(id)
			onApprove(id)
			// Reset after a short delay (backend will remove from approvals via event)
			setTimeout(() => setProcessingId(null), 500)
		},
		[onApprove, processingId],
	)

	const handleReject = useCallback(
		(id: string) => {
			if (processingId) return
			setProcessingId(id)
			onReject(id)
			setTimeout(() => setProcessingId(null), 500)
		},
		[onReject, processingId],
	)

	if (approvals.length === 0) return null

	return (
		<div className="flex flex-col gap-1 px-4 py-2">
			{approvals.map((approval) => (
				<div
					key={approval.id}
					className="flex items-center justify-between gap-2 rounded-md border border-(--vscode-editorWidget-border) bg-(--vscode-editorWidget-background) px-3 py-2"
				>
					<div className="flex flex-col gap-0.5 min-w-0 flex-1">
						<span className="text-xs font-medium text-(--vscode-foreground) truncate">
							{approval.description ?? approval.toolType}
						</span>
					</div>
					<div className="flex gap-2 shrink-0">
						<button
							className="px-3 py-1 text-xs rounded bg-(--vscode-button-background) text-(--vscode-button-foreground) hover:bg-(--vscode-button-hoverBackground) disabled:opacity-50"
							disabled={processingId === approval.id}
							onClick={() => handleApprove(approval.id)}
						>
							{approval.primaryText ?? "Approve"}
						</button>
						<button
							className="px-3 py-1 text-xs rounded bg-(--vscode-button-secondaryBackground) text-(--vscode-button-secondaryForeground) hover:bg-(--vscode-button-secondaryHoverBackground) disabled:opacity-50"
							disabled={processingId === approval.id}
							onClick={() => handleReject(approval.id)}
						>
							{approval.secondaryText ?? "Reject"}
						</button>
					</div>
				</div>
			))}
		</div>
	)
}
