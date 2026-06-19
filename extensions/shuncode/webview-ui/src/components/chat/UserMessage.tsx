import { Int64Request } from "@shared/proto/shuncode/common"
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
	const textAreaRef = useRef<HTMLTextAreaElement>(null)
	const resendButtonRef = useRef<HTMLButtonElement>(null)

	const highlightedText = useMemo(() => highlightText(editedText || text), [editedText, text])

	// Show delete confirmation dialog
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

	// Delete chat and revert file changes
	const handleDeleteAndRevert = async () => {
		setShowDeleteDialog(false)
		if (!messageTs) return
		try {
			await TaskServiceClient.deleteFromMessage(Int64Request.create({ value: messageTs }))
		} catch (err) {
			console.error("Delete from message error:", err)
		}
	}

	// Retry: revert changes, delete history, resend same message
	const handleRetry = async (e: React.MouseEvent) => {
		e.stopPropagation()
		if (!messageTs) return
		try {
			await TaskServiceClient.retryFromMessage(Int64Request.create({ value: messageTs }))
		} catch (err) {
			console.error("Retry from message error:", err)
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
	</div>
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
				backgroundColor: "var(--vscode-button-secondaryBackground)",
				color: "var(--vscode-button-secondaryForeground)",
				border: "none",
				padding: "2px 6px",
				borderRadius: "3px",
				fontSize: "12px",
				cursor: "pointer",
				opacity: 0.8,
				transition: "opacity 0.15s",
			}}
			title={title}>
			{icon}
		</button>
	)
}

export default UserMessage
