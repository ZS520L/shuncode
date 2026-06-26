import { CreateHookRequest, CreateSkillRequest, RuleFileRequest } from "@shared/proto/index.shuncode"
import { PlusIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useClickAway } from "react-use"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"

interface NewRuleRowProps {
	isGlobal: boolean
	ruleType?: string
	existingHooks?: string[]
	workspaceName?: string
}

const HOOK_TYPES = [
	{ name: "TaskStart", description: "Executes when a new task begins" },
	{ name: "TaskResume", description: "Executes when a task is resumed" },
	{ name: "TaskCancel", description: "Executes when a task is cancelled" },
	{ name: "TaskComplete", description: "Executes when a task completes" },
	{ name: "PreToolUse", description: "Executes before any tool is used" },
	{ name: "PostToolUse", description: "Executes after any tool is used" },
	{ name: "UserPromptSubmit", description: "Executes when user submits a prompt" },
	{ name: "PreCompact", description: "Executes before conversation compaction" },
]

const NewRuleRow: React.FC<NewRuleRowProps> = ({ isGlobal, ruleType, existingHooks = [], workspaceName }) => {
	const { t } = useI18n()
	const [isExpanded, setIsExpanded] = useState(false)
	const [filename, setFilename] = useState("")
	const inputRef = useRef<HTMLInputElement>(null)
	const [error, setError] = useState<string | null>(null)

	const componentRef = useRef<HTMLDivElement>(null)

	// Calculate available hook types by filtering out existing hooks
	const availableHookTypes = useMemo(() => HOOK_TYPES.filter((type) => !existingHooks.includes(type.name)), [existingHooks])

	// Focus the input when expanded
	useEffect(() => {
		if (isExpanded && inputRef.current) {
			inputRef.current.focus()
		}
	}, [isExpanded])

	useClickAway(componentRef, () => {
		if (isExpanded) {
			setIsExpanded(false)
			setFilename("")
			setError(null)
		}
	})

	const getExtension = (filename: string): string => {
		if (filename.startsWith(".") && !filename.includes(".", 1)) {
			return ""
		}
		const match = filename.match(/\.[^.]+$/)
		return match ? match[0].toLowerCase() : ""
	}

	const isValidExtension = (ext: string): boolean => {
		if (ruleType === "workflow") {
			return ext === "" || ext === ".md" || ext === ".txt" || ext === ".yaml" || ext === ".yml"
		}
		return ext === "" || ext === ".md" || ext === ".txt"
	}

	const handleCreateHook = async (hookName: string) => {
		if (!hookName) {
			return
		}

		try {
			await FileServiceClient.createHook(
				CreateHookRequest.create({
					hookName,
					isGlobal,
					workspaceName,
				}),
			)
		} catch (err) {
			console.error("Error creating hook:", err)
		}
	}

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		if (filename.trim()) {
			const trimmedFilename = filename.trim()

			// Skills use directory names, not file extensions
			if (ruleType === "skill") {
				// Validate skill name - only allow alphanumeric, dashes, underscores
				if (!/^[a-zA-Z0-9_-]+$/.test(trimmedFilename)) {
					setError(t("shuncodeRules.skillNameValidation"))
					return
				}

				try {
					await FileServiceClient.createSkillFile(
						CreateSkillRequest.create({
							skillName: trimmedFilename,
							isGlobal,
						}),
					)
				} catch (err) {
					console.error("Error creating skill:", err)
				}

				setFilename("")
				setError(null)
				setIsExpanded(false)
				return
			}

			// Multi-step workflow: force .yaml extension, strip any user-provided extension
			if (ruleType === "multi-step-workflow") {
				const sanitized = trimmedFilename.replace(/\.(yaml|yml|md|txt)$/i, "")
				if (!/^[\p{L}\p{N}_-]+$/u.test(sanitized)) {
					setError(t("workflow.validationError"))
					return
				}
				const finalFilename = `${sanitized}.yaml`
				try {
					await FileServiceClient.createRuleFile(
						RuleFileRequest.create({
							isGlobal,
							filename: finalFilename,
							type: "workflow",
						}),
					)
				} catch (err) {
					console.error("Error creating multi-step workflow:", err)
				}
				setFilename("")
				setError(null)
				setIsExpanded(false)
				return
			}

			const extension = getExtension(trimmedFilename)

			if (!isValidExtension(extension)) {
				setError(t("shuncodeRules.allowedExtensions"))
				return
			}

			let finalFilename = trimmedFilename
			if (extension === "") {
				finalFilename = `${trimmedFilename}.md`
			}

			try {
				await FileServiceClient.createRuleFile(
					RuleFileRequest.create({
						isGlobal,
						filename: finalFilename,
						type: ruleType || "shuncode",
					}),
				)
			} catch (err) {
				console.error("Error creating rule file:", err)
			}

			setFilename("")
			setError(null)
			setIsExpanded(false)
		}
	}

	const _handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			setIsExpanded(false)
			setFilename("")
		}
	}

	return (
		<div
			className={cn("mb-2.5 transition-all duration-300 ease-in-out", {
				"opacity-100": isExpanded,
				"opacity-70 hover:opacity-100": !isExpanded,
			})}
			onClick={() => !isExpanded && ruleType !== "hook" && setIsExpanded(true)}
			ref={componentRef}>
			<div
				className={cn(
					"flex items-center px-2 py-4 rounded bg-input-background transition-all duration-300 ease-in-out h-5",
					{
						"shadow-sm": isExpanded,
					},
				)}>
				{ruleType === "hook" ? (
					<>
						<label className="sr-only" htmlFor="hook-type-select">
							Select hook type to create
						</label>
						<span className="sr-only" id="hook-select-description">
							Choose a hook type to create. Hooks execute at specific points in ShunCode's lifecycle. Available:{" "}
							{availableHookTypes.map((h) => h.name).join(", ")}
						</span>
						<select
							aria-describedby="hook-select-description"
							aria-label={t("shuncodeRules.selectHookTypeToCreate")}
							className="flex-1 bg-input-background text-input-foreground border-0 outline-0 rounded focus:outline-none focus:ring-0 focus:border-transparent px-2 cursor-pointer"
							disabled={availableHookTypes.length === 0}
							id="hook-type-select"
							onChange={(e) => {
								if (e.target.value) {
									handleCreateHook(e.target.value)
									// Reset selection after creating
									e.target.value = ""
								}
							}}
							style={{
								fontStyle: "italic",
								appearance: "none",
								backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23cccccc' d='M6 9L1 4h10z'/%3E%3C/svg%3E")`,
								backgroundRepeat: "no-repeat",
								backgroundPosition: "right 8px center",
								paddingRight: "24px",
							}}
							value="">
							<option disabled value="">
								{availableHookTypes.length === 0 ? t("shuncodeRules.allHooksCreated") : t("shuncodeRules.newHook")}
							</option>
							{availableHookTypes.map((hook) => (
								<option key={hook.name} title={hook.description} value={hook.name}>
									{hook.name}
								</option>
							))}
						</select>
					</>
				) : (
					<form className="flex flex-1 items-center" onSubmit={handleSubmit}>
						<input
							className={cn(
								"flex-1 bg-input-background text-input-foreground border-0 outline-0 rounded focus:outline-none focus:ring-0 focus:border-transparent",
								{
									italic: !isExpanded,
								},
							)}
							onChange={(e) => setFilename(e.target.value)}
							placeholder={
								isExpanded
									? ruleType === "multi-step-workflow"
										? "deploy, review, test..."
										: ruleType === "workflow"
											? t("shuncodeRules.workflowNameHint")
											: ruleType === "skill"
												? t("shuncodeRules.skillNameHint")
												: t("shuncodeRules.ruleNameHint")
									: ruleType === "multi-step-workflow"
										? t("workflow.newScenario")
										: ruleType === "workflow"
											? t("shuncodeRules.newWorkflowFile")
											: ruleType === "skill"
												? t("shuncodeRules.newSkill")
												: t("shuncodeRules.newRuleFile")
							}
							ref={inputRef}
							type="text"
							value={isExpanded ? filename : ""}
						/>

						<Button
							aria-label={
								isExpanded
									? ruleType === "skill"
										? t("shuncodeRules.createSkill")
										: t("shuncodeRules.createFile")
									: ruleType === "workflow"
										? t("shuncodeRules.newWorkflowFile")
										: ruleType === "skill"
											? t("shuncodeRules.newSkill")
											: t("shuncodeRules.newRuleFile")
							}
							className="mx-0.5"
							onClick={(e) => {
								e.stopPropagation()
								if (!isExpanded) {
									setIsExpanded(true)
								}
							}}
							size="icon"
							title={
								isExpanded
									? ruleType === "skill"
										? t("shuncodeRules.createSkill")
										: t("shuncodeRules.createFile")
									: t("shuncodeRules.newFile")
							}
							type={isExpanded ? "submit" : "button"}
							variant="icon">
							<PlusIcon />
						</Button>
					</form>
				)}
			</div>
			{isExpanded && error && <div className="text-error text-xs mt-1 ml-2">{error}</div>}
		</div>
	)
}

export default NewRuleRow
