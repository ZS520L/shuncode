import { ChevronDownIcon, ChevronRightIcon, GripVerticalIcon, TrashIcon } from "lucide-react"
import React, { memo, useCallback, useState } from "react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/i18n"

export interface WorkflowStepData {
	name: string
	prompt: string
	enabled: boolean
	visible: boolean
}

interface WorkflowStepRowProps {
	step: WorkflowStepData
	index: number
	total: number
	onChange: (index: number, step: WorkflowStepData) => void
	onMoveUp: (index: number) => void
	onMoveDown: (index: number) => void
	onDelete: (index: number) => void
}

export const WorkflowStepRow: React.FC<WorkflowStepRowProps> = memo(
	({ step, index, total, onChange, onMoveUp, onMoveDown, onDelete }) => {
		const { t } = useI18n()
		const [isExpanded, setIsExpanded] = useState(true)

		const toggleExpand = useCallback(() => setIsExpanded((p) => !p), [])

		const updateField = useCallback(
			<K extends keyof WorkflowStepData>(field: K, value: WorkflowStepData[K]) => {
				onChange(index, { ...step, [field]: value })
			},
			[index, step, onChange],
		)

		return (
			<div
				className={cn("border rounded-sm overflow-hidden", {
					"opacity-50": !step.enabled,
					"border-l-2 border-l-blue-500": step.enabled,
				})}
				style={{ borderColor: "var(--vscode-panel-border)" }}>
				{/* Header — click to expand/collapse */}
				<div
					className="flex items-center gap-1.5 px-2 py-1.5 bg-(--vscode-toolbar-hoverBackground)/30 cursor-pointer select-none"
					onClick={toggleExpand}>
					<GripVerticalIcon className="shrink-0 opacity-40" size={14} />

					{isExpanded ? (
						<ChevronDownIcon className="shrink-0 opacity-50" size={14} />
					) : (
						<ChevronRightIcon className="shrink-0 opacity-50" size={14} />
					)}

					<span className="text-xs opacity-60 shrink-0 w-4 text-center">{index + 1}</span>

					<input
						className="flex-1 min-w-0 bg-transparent border-0 outline-0 text-sm text-foreground focus:outline-none"
						onChange={(e) => updateField("name", e.target.value)}
						onClick={(e) => e.stopPropagation()}
						placeholder={t("workflow.stepNamePlaceholder")}
						type="text"
						value={step.name}
					/>

					<button
						className={cn("px-1.5 py-0.5 rounded text-xs font-medium shrink-0", {
							"bg-green-700/30 text-green-400": step.enabled,
							"bg-gray-700/30 text-gray-500": !step.enabled,
						})}
						onClick={(e) => {
							e.stopPropagation()
							updateField("enabled", !step.enabled)
						}}
						title={step.enabled ? t("workflow.disableStep") : t("workflow.enableStep")}
						type="button">
						{step.enabled ? t("workflow.stepOn") : t("workflow.stepOff")}
					</button>

					<button
						className="p-0.5 opacity-60 hover:opacity-100 shrink-0"
						onClick={(e) => {
							e.stopPropagation()
							updateField("visible", !step.visible)
						}}
						title={step.visible ? t("workflow.silentMode") : t("workflow.showOutput")}
						type="button">
						<span
							className={cn("codicon", {
								"codicon-eye": step.visible,
								"codicon-eye-closed": !step.visible,
							})}
							style={{ fontSize: 14 }}
						/>
					</button>

					<button
						className="p-0.5 opacity-40 hover:opacity-100 shrink-0 disabled:opacity-20"
						disabled={index === 0}
						onClick={(e) => {
							e.stopPropagation()
							onMoveUp(index)
						}}
						title={t("workflow.moveUp")}
						type="button">
						<span className="codicon codicon-arrow-up" style={{ fontSize: 14 }} />
					</button>

					<button
						className="p-0.5 opacity-40 hover:opacity-100 shrink-0 disabled:opacity-20"
						disabled={index === total - 1}
						onClick={(e) => {
							e.stopPropagation()
							onMoveDown(index)
						}}
						title={t("workflow.moveDown")}
						type="button">
						<span className="codicon codicon-arrow-down" style={{ fontSize: 14 }} />
					</button>

					<button
						className="p-0.5 opacity-40 hover:opacity-100 text-red-400 shrink-0"
						onClick={(e) => {
							e.stopPropagation()
							onDelete(index)
						}}
						title={t("workflow.deleteStep")}
						type="button">
						<TrashIcon size={14} />
					</button>
				</div>

				{/* Prompt textarea */}
				{isExpanded && (
					<div className="px-3 pb-2 pt-1">
						<textarea
							className="w-full min-h-[80px] bg-(--vscode-input-background) text-(--vscode-input-foreground) border rounded-sm p-2 text-sm resize-y outline-none focus:border-blue-500"
							onChange={(e) => updateField("prompt", e.target.value)}
							placeholder={t("workflow.stepPromptPlaceholder")}
							style={{ borderColor: "var(--vscode-input-border)" }}
							value={step.prompt}
						/>
					</div>
				)}
			</div>
		)
	},
)

WorkflowStepRow.displayName = "WorkflowStepRow"
