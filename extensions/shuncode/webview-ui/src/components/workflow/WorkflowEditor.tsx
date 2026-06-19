import { PlusIcon } from "lucide-react"
import React, { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/i18n"
import { WorkflowStepData, WorkflowStepRow } from "./WorkflowStepRow"

export interface WorkflowEditorData {
	name: string
	description: string
	requiresInput: boolean
	steps: WorkflowStepData[]
}

interface WorkflowEditorProps {
	initial?: WorkflowEditorData
	onSave: (data: WorkflowEditorData) => void
	onCancel: () => void
}

const DEFAULT_STEP: WorkflowStepData = {
	name: "",
	prompt: "",
	enabled: true,
	visible: true,
}

export const WorkflowEditor: React.FC<WorkflowEditorProps> = ({ initial, onSave, onCancel }) => {
	const { t } = useI18n()
	const [data, setData] = useState<WorkflowEditorData>(
		initial ?? {
			name: "",
			description: "",
			requiresInput: true,
			steps: [{ ...DEFAULT_STEP, name: t("workflow.defaultStepName", { n: 1 }) }],
		},
	)

	const updateField = useCallback(<K extends keyof WorkflowEditorData>(field: K, value: WorkflowEditorData[K]) => {
		setData((prev) => ({ ...prev, [field]: value }))
	}, [])

	const updateStep = useCallback((index: number, step: WorkflowStepData) => {
		setData((prev) => ({
			...prev,
			steps: prev.steps.map((s, i) => (i === index ? step : s)),
		}))
	}, [])

	const moveStep = useCallback((from: number, to: number) => {
		setData((prev) => {
			const steps = [...prev.steps]
			const [moved] = steps.splice(from, 1)
			steps.splice(to, 0, moved)
			return { ...prev, steps }
		})
	}, [])

	const deleteStep = useCallback((index: number) => {
		setData((prev) => ({
			...prev,
			steps: prev.steps.filter((_, i) => i !== index),
		}))
	}, [])

	const addStep = useCallback(() => {
		setData((prev) => ({
			...prev,
			steps: [...prev.steps, { ...DEFAULT_STEP, name: t("workflow.defaultStepName", { n: prev.steps.length + 1 }) }],
		}))
	}, [t])

	const canSave = data.name.trim() && data.steps.length > 0 && data.steps.some((s) => s.name.trim() && s.prompt.trim())

	const handleSave = useCallback(() => {
		if (!canSave) return
		onSave(data)
	}, [canSave, data, onSave])

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--vscode-panel-border)" }}>
				<button
					className="text-sm opacity-60 hover:opacity-100"
					onClick={onCancel}
					type="button">
					{t("workflow.back")}
				</button>
				<span className="text-sm font-medium flex-1 text-center">
					{initial ? t("workflow.editScenario") : t("workflow.newScenarioTitle")}
				</span>
				<div className="w-12" />
			</div>

			{/* Scrollable body */}
			<div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
				{/* Name */}
				<div>
					<label className="text-xs text-description mb-1 block">{t("workflow.name")}</label>
					<input
						className="w-full bg-(--vscode-input-background) text-(--vscode-input-foreground) border rounded-sm px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
						onChange={(e) => updateField("name", e.target.value)}
						placeholder={t("workflow.namePlaceholder")}
						style={{ borderColor: "var(--vscode-input-border)" }}
						type="text"
						value={data.name}
					/>
				</div>

				{/* Description */}
				<div>
					<label className="text-xs text-description mb-1 block">{t("workflow.description")}</label>
					<input
						className="w-full bg-(--vscode-input-background) text-(--vscode-input-foreground) border rounded-sm px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
						onChange={(e) => updateField("description", e.target.value)}
						placeholder={t("workflow.descriptionPlaceholder")}
						style={{ borderColor: "var(--vscode-input-border)" }}
						type="text"
						value={data.description}
					/>
				</div>

				{/* Requires input toggle */}
				<label className="flex items-center gap-2 cursor-pointer select-none">
					<input
						checked={data.requiresInput}
						className="accent-blue-500"
						onChange={(e) => updateField("requiresInput", e.target.checked)}
						type="checkbox"
					/>
					<span className="text-sm">{t("workflow.requiresInput")}</span>
				</label>

				{/* Steps */}
				<div>
					<label className="text-xs text-description mb-2 block">
						{t("workflow.steps")} ({data.steps.length})
					</label>
					<div className="flex flex-col gap-2">
						{data.steps.map((step, i) => (
							<WorkflowStepRow
								index={i}
								key={i}
								onChange={updateStep}
								onDelete={deleteStep}
								onMoveDown={(idx) => moveStep(idx, idx + 1)}
								onMoveUp={(idx) => moveStep(idx, idx - 1)}
								step={step}
								total={data.steps.length}
							/>
						))}
					</div>

					<button
						className="w-full mt-2 flex items-center justify-center gap-1.5 py-2 rounded-sm text-sm opacity-60 hover:opacity-100 border border-dashed"
						onClick={addStep}
						style={{ borderColor: "var(--vscode-panel-border)" }}
						type="button">
						<PlusIcon size={14} />
						{t("workflow.addStep")}
					</button>
				</div>
			</div>

			{/* Footer */}
			<div
				className="flex items-center justify-end gap-2 px-4 py-3 border-t"
				style={{ borderColor: "var(--vscode-panel-border)" }}>
				<Button onClick={onCancel} variant="secondary">
					{t("workflow.cancel")}
				</Button>
				<Button disabled={!canSave} onClick={handleSave}>
					{t("workflow.save")}
				</Button>
			</div>
		</div>
	)
}
