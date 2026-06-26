import { Int64Request } from "@shared/proto/shuncode/common"
import { RollbackPreviewFile } from "@shared/proto/shuncode/task"
import React, { useEffect, useMemo, useRef, useState } from "react"

import DynamicTextArea from "react-textarea-autosize"
import Thumbnails from "@/components/common/Thumbnails"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/common/AlertDialog"
import { useI18n } from "@/i18n"
import { TaskServiceClient } from "@/services/grpc-client"
import { highlightText } from "./task-header/Highlights"

interface UserMessageProps {
	text?: string
	files?: string[]
	images?: string[]
	messageTs?: number
	sendMessageFromChatRow?: (text: string, images: string[], files: string[]) => void
}

const UserMessage: React.FC<UserMessageProps> = ({ text, images, files, messageTs, sendMessageFromChatRow }) => {
	const { t } = useI18n()
	const [isEditing, setIsEditing] = useState(false)
	const [editedText, setEditedText] = useState(text || "")
	const [isHovered, setIsHovered] = useState(false)
	const [showDeleteDialog, setShowDeleteDialog] = useState(false)
	// Devin-style revert confirmation dialog state.
	// pendingAction tracks which operation the confirm button will run.
	const [revertAction, setRevertAction] = useState<null | "retry" | "delete">(null)
	const [previewFiles, setPreviewFiles] = useState<RollbackPreviewFile[] | null>(null)
	const textAreaRef = useRef<HTMLTextAreaElement>(null)
	const resendButtonRef = useRef<HTMLButtonElement>(null)

	const highlightedText = useMemo(() => highlightText(editedText || text), [editedText, text])

	// Fetch the rollback preview and open the confirmation dialog for the given action.
	const openRevertDialog = async (action: "retry" | "delete") => {
		if (!messageTs) return
		setRevertAction(action)
		setPreviewFiles(null) // null = loading
		try {
			const res = await TaskServiceClient.getRollbackPreview(Int64Request.create({ value: messageTs }))
			setPreviewFiles(res.files ?? [])
		} catch (err) {
			console.error("getRollbackPreview error:", err)
			setPreviewFiles([])
		}
	}

	const closeRevertDialog = () => {
		setRevertAction(null)
		setPreviewFiles(null)
	}

	// Show delete confirmation dialog (chat-only vs revert choice)
	const handleDelete = (e: React.MouseEvent) => {
		e.stopPropagation()
		if (!messageTs) return
		setShowDeleteDialog(true)
	}

	// Delete chat only (no file revert)
	const handleDeleteChatOnly = async () => {
		setShowDeleteDialog(false)
		if (!messageTs) return
		try {
			await TaskServiceClient.deleteFromMessageChatOnly(Int64Request.create({ value: messageTs }))
		} catch (err) {
			console.error("Delete from message (chat only) error:", err)
		}
	}

	// Delete chat and revert file changes — first show the revert preview dialog
	const handleDeleteAndRevert = () => {
		setShowDeleteDialog(false)
		openRevertDialog("delete")
	}

	// Retry: revert changes, delete history, resend same message — show preview first
	const handleRetry = (e: React.MouseEvent) => {
		e.stopPropagation()
		openRevertDialog("retry")
	}

	// Execute the confirmed revert action.
	const handleConfirmRevert = async () => {
		const action = revertAction
		closeRevertDialog()
		if (!messageTs || !action) return
		try {
			if (action === "retry") {
				await TaskServiceClient.retryFromMessage(Int64Request.create({ value: messageTs }))
			} else {
				await TaskServiceClient.deleteFromMessage(Int64Request.create({ value: messageTs }))
			}
		} catch (err) {
			console.error(`${action} from message error:`, err)
		}
	}


	// Resend: delete from this message + send edited text
	const handleResend = async () => {
		setIsEditing(false)
		if (!messageTs || editedText === text) return
		try {
			await TaskServiceClient.deleteFromMessage(Int64Request.create({ value: messageTs }))
			sendMessageFromChatRow?.(editedText, images || [], files || [])
		} catch (err) {
			console.error("Resend message error:", err)
		}
	}

	const handleClick = () => {
		if (!isEditing) {
			setIsEditing(true)
		}
	}

	// Select all text when entering edit mode
	useEffect(() => {
		if (isEditing && textAreaRef.current) {
			textAreaRef.current.select()
		}
	}, [isEditing])

	const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
		if (e.relatedTarget === resendButtonRef.current) return
		setIsEditing(false)
	}

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Escape") {
			setIsEditing(false)
		} else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
			e.preventDefault()
			handleResend()
		}
	}

	return (
		<div
			className="p-2.5 pr-1 my-1 text-badge-foreground rounded-xs"
			onClick={handleClick}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			style={{
				backgroundColor: isEditing ? "unset" : "var(--vscode-badge-background)",
				whiteSpace: "pre-line",
				wordWrap: "break-word",
				position: "relative",
			}}>
			{/* Delete/Retry buttons on hover */}
			{isHovered && !isEditing && messageTs && (
				<div
					style={{
						position: "absolute",
						top: "4px",
						right: "4px",
						display: "flex",
						gap: "4px",
						zIndex: 10,
					}}>
					{/* allow-any-unicode-next-line */}
					<ActionButton icon="↻" onClick={handleRetry} title={t("chat.retryRevertAndResend")} />
					{/* allow-any-unicode-next-line */}
					<ActionButton icon="🗑" onClick={handleDelete} title={t("chat.deleteRevertFromMessage")} />
				</div>
			)}
			{isEditing ? (
				<>
					<DynamicTextArea
						autoFocus
						onBlur={handleBlur}
						onChange={(e) => setEditedText(e.target.value)}
						onKeyDown={handleKeyDown}
						ref={textAreaRef}
						style={{
							width: "100%",
							backgroundColor: "var(--vscode-input-background)",
							color: "var(--vscode-input-foreground)",
							borderColor: "var(--vscode-input-border)",
							border: "1px solid",
							borderRadius: "2px",
							padding: "6px",
							fontFamily: "inherit",
							fontSize: "inherit",
							lineHeight: "inherit",
							boxSizing: "border-box",
							resize: "none",
							overflowX: "hidden",
							overflowY: "scroll",
							scrollbarWidth: "none",
						}}
						value={editedText}
					/>
					{editedText !== text && (
						<div style={{ display: "flex", gap: "8px", marginTop: "8px", justifyContent: "flex-end" }}>
							<button
								onClick={(e) => {
									e.stopPropagation()
									handleResend()
								}}
								ref={resendButtonRef}
								style={{
									backgroundColor: "var(--vscode-button-background)",
									color: "var(--vscode-button-foreground)",
									border: "none",
									padding: "4px 8px",
									borderRadius: "2px",
									fontSize: "9px",
									cursor: "pointer",
								}}
								title={t("chat.resendEdited")}>
								{t("chat.resend")}
							</button>
						</div>
					)}
				</>
			) : (
				<span className="ph-no-capture text-sm" style={{ display: "block" }}>
					{highlightedText}
				</span>
			)}
		{((images && images.length > 0) || (files && files.length > 0)) && (
			<Thumbnails files={files ?? []} images={images ?? []} style={{ marginTop: "8px" }} />
		)}

		{/* Delete confirmation dialog */}
		<AlertDialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t("chat.deleteDialog.title")}</AlertDialogTitle>
					<AlertDialogDescription>{t("chat.deleteDialog.description")}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={() => setShowDeleteDialog(false)}>
						{t("dialog.cancel")}
					</AlertDialogCancel>
					<AlertDialogAction appearance="secondary" onClick={handleDeleteChatOnly}>
						{t("chat.deleteDialog.chatOnly")}
					</AlertDialogAction>
					<AlertDialogAction onClick={handleDeleteAndRevert}>
						{t("chat.deleteDialog.chatAndRevert")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>

		{/* Devin-style revert confirmation dialog with per-file change preview */}
		<AlertDialog onOpenChange={(open) => !open && closeRevertDialog()} open={revertAction !== null}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t("chat.revertDialog.title")}</AlertDialogTitle>
				</AlertDialogHeader>
				<RevertPreviewList files={previewFiles} t={t} />
				<AlertDialogFooter>
					<AlertDialogCancel onClick={closeRevertDialog}>
						{t("chat.revertDialog.cancel")}
					</AlertDialogCancel>
					<AlertDialogAction onClick={handleConfirmRevert}>
						{t("chat.revertDialog.confirm")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	</div>
)
}

// Renders the per-file change list for the revert confirmation dialog.
// - files === null  → loading state
// - files === []    → no changes to revert
// - otherwise       → one row per file, showing "Deleted"/"Created" or +/- line counts
interface RevertPreviewListProps {
	files: RollbackPreviewFile[] | null
	t: (key: string) => string
}

const RevertPreviewList: React.FC<RevertPreviewListProps> = ({ files, t }) => {
	if (files === null) {
		return (
			<div style={{ padding: "8px 0", fontSize: "12px", opacity: 0.8 }}>
				{t("chat.revertDialog.loading")}
			</div>
		)
	}

	if (files.length === 0) {
		return (
			<div style={{ padding: "8px 0", fontSize: "12px", opacity: 0.8 }}>
				{t("chat.revertDialog.noChanges")}
			</div>
		)
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "4px 0", maxHeight: "240px", overflowY: "auto" }}>
			{files.map((f) => {
				const name = f.displayPath || f.fsPath
				return (
					<div
						key={f.fsPath}
						style={{
							display: "flex",
							alignItems: "center",
							gap: "8px",
							fontSize: "12px",
							fontFamily: "var(--vscode-editor-font-family, monospace)",
						}}>
						<span
							style={{
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								color: "var(--vscode-foreground)",
							}}
							title={f.fsPath}>
							{name}
						</span>
						<RevertChangeBadge file={f} t={t} />
					</div>
				)
			})}
		</div>
	)
}

// Shows the change summary for a single file: "Deleted"/"Created" for created/deleted
// files, otherwise red -N (removed) and green +N (added) line counts.
const RevertChangeBadge: React.FC<{ file: RollbackPreviewFile; t: (key: string) => string }> = ({ file, t }) => {
	if (file.kind === "created") {
		return <span style={{ color: "var(--vscode-errorForeground)" }}>{t("chat.revertDialog.deleted")}</span>
	}
	if (file.kind === "deleted") {
		return <span style={{ color: "var(--vscode-charts-green, #4caf50)" }}>{t("chat.revertDialog.created")}</span>
	}
	// Fallback: a modified file with no countable line delta still gets a neutral
	// "changed" badge so the row never looks empty.
	if (file.addedLines === 0 && file.removedLines === 0) {
		return <span style={{ opacity: 0.7 }}>{t("chat.revertDialog.changed")}</span>
	}
	return (
		<span style={{ display: "inline-flex", gap: "6px" }}>
			{file.addedLines > 0 && (
				<span style={{ color: "var(--vscode-errorForeground)" }}>{`-${file.addedLines}`}</span>
			)}
			{file.removedLines > 0 && (
				<span style={{ color: "var(--vscode-charts-green, #4caf50)" }}>{`+${file.removedLines}`}</span>
			)}
		</span>
	)
}



// Action button for Delete/Retry
interface ActionButtonProps {
	icon: string
	onClick: (e: React.MouseEvent) => void
	title: string
}

const ActionButton: React.FC<ActionButtonProps> = ({ icon, onClick, title }) => {
	return (
		<button
			onClick={onClick}
			onMouseEnter={(e) => {
				e.currentTarget.style.opacity = "1"
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.opacity = "0.8"
			}}
			style={{
				backgroundColor: "var(--vscode-editorWidget-background)",
				color: "var(--vscode-foreground)",
				border: "1px solid var(--vscode-contrastBorder, var(--vscode-panel-border))",
				boxShadow: "0 1px 4px var(--vscode-widget-shadow)",
				padding: "2px 6px",
				borderRadius: "3px",
				fontSize: "12px",
				cursor: "pointer",
				opacity: 0.95,
				transition: "opacity 0.15s, background-color 0.15s, border-color 0.15s",
			}}
			title={title}>
			{icon}
		</button>
	)
}

export default UserMessage
