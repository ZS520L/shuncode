import { EmptyRequest } from "@shared/proto/shuncode/common"
import {
	RefreshedRules,
	RuleScope,
	SaveWorkflowDefinitionRequest,
	ShuncodeRulesToggles,
	SkillInfo,
	ToggleAgentsRuleRequest,
	ToggleCursorRuleRequest,
	ToggleShuncodeRuleRequest,
	ToggleSkillRequest,
	ToggleWindsurfRuleRequest,
	ToggleWorkflowRequest,
} from "@shared/proto/shuncode/file"
import { NewTaskRequest } from "@shared/proto/shuncode/task"
import { StringRequest } from "@shared/proto/shuncode/common"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { useClickAway, useWindowSize } from "react-use"
import styled from "styled-components"
import PopupModalContainer from "@/components/common/PopupModalContainer"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { FileServiceClient, TaskServiceClient } from "@/services/grpc-client"
import { isMacOSOrLinux } from "@/utils/platformUtils"
import { WorkflowEditor, type WorkflowEditorData } from "@/components/workflow/WorkflowEditor"
import HookRow from "./HookRow"
import NewRuleRow from "./NewRuleRow"
import RuleRow from "./RuleRow"
import RulesToggleList from "./RulesToggleList"

const ShuncodeRulesToggleModal: React.FC = () => {
	const { t } = useI18n()
	const {
		globalShuncodeRulesToggles = {},
		localShuncodeRulesToggles = {},
		localCursorRulesToggles = {},
		localWindsurfRulesToggles = {},
		localAgentsRulesToggles = {},
		localWorkflowToggles = {},
		globalWorkflowToggles = {},
		globalSkillsToggles: _globalSkillsToggles = {},
		remoteRulesToggles = {},
		remoteWorkflowToggles = {},
		remoteConfigSettings = {},
		hooksEnabled,
		skillsEnabled,
		setGlobalShuncodeRulesToggles,
		setLocalShuncodeRulesToggles,
		setLocalCursorRulesToggles,
		setLocalWindsurfRulesToggles,
		setLocalAgentsRulesToggles,
		setLocalWorkflowToggles,
		setGlobalWorkflowToggles,
		setGlobalSkillsToggles,
		setRemoteRulesToggles,
		setRemoteWorkflowToggles,
	} = useExtensionState()
	const [globalHooks, setGlobalHooks] = useState<Array<{ name: string; enabled: boolean; absolutePath: string }>>([])
	const [workspaceHooks, setWorkspaceHooks] = useState<
		Array<{ workspaceName: string; hooks: Array<{ name: string; enabled: boolean; absolutePath: string }> }>
	>([])
	const [globalSkills, setGlobalSkills] = useState<SkillInfo[]>([])

	const isWindows = !isMacOSOrLinux()
	const [isVisible, setIsVisible] = useState(false)
	const buttonRef = useRef<HTMLDivElement>(null)
	const modalRef = useRef<HTMLDivElement>(null)
	const { width: viewportWidth, height: viewportHeight } = useWindowSize()
	const [arrowPosition, setArrowPosition] = useState(0)
	const [menuPosition, setMenuPosition] = useState(0)
	const [currentView, setCurrentView] = useState<"rules" | "workflows" | "scenarios" | "hooks" | "skills">("rules")
	const [editingWorkflow, setEditingWorkflow] = useState<{ filePath: string; data: WorkflowEditorData } | null>(null)

	// Auto-switch to rules tab if hooks become disabled while viewing hooks tab
	useEffect(() => {
		if (currentView === "hooks" && !hooksEnabled) {
			setCurrentView("rules")
		}
	}, [currentView, hooksEnabled])

	// Auto-switch to rules tab if skills become disabled while viewing skills tab
	useEffect(() => {
		if (currentView === "skills" && !skillsEnabled) {
			setCurrentView("rules")
		}
	}, [currentView, skillsEnabled])

	useEffect(() => {
		if (isVisible) {
			FileServiceClient.refreshRules({} as EmptyRequest)
				.then((response: RefreshedRules) => {
					// Update state with the response data using all available setters
					if (response.globalShuncodeRulesToggles?.toggles) {
						setGlobalShuncodeRulesToggles(response.globalShuncodeRulesToggles.toggles)
					}
					if (response.localShuncodeRulesToggles?.toggles) {
						setLocalShuncodeRulesToggles(response.localShuncodeRulesToggles.toggles)
					}
					if (response.localCursorRulesToggles?.toggles) {
						setLocalCursorRulesToggles(response.localCursorRulesToggles.toggles)
					}
					if (response.localWindsurfRulesToggles?.toggles) {
						setLocalWindsurfRulesToggles(response.localWindsurfRulesToggles.toggles)
					}
					if (response.localAgentsRulesToggles?.toggles) {
						setLocalAgentsRulesToggles(response.localAgentsRulesToggles.toggles)
					}
					if (response.localWorkflowToggles?.toggles) {
						setLocalWorkflowToggles(response.localWorkflowToggles.toggles)
					}
					if (response.globalWorkflowToggles?.toggles) {
						setGlobalWorkflowToggles(response.globalWorkflowToggles.toggles)
					}
				})
				.catch((error) => {
					console.error("Failed to refresh rules:", error)
				})
		}
	}, [
		isVisible,
		setGlobalShuncodeRulesToggles,
		setLocalShuncodeRulesToggles,
		setGlobalWorkflowToggles,
		setLocalCursorRulesToggles,
		setLocalWindsurfRulesToggles,
		setLocalWorkflowToggles,
	])

	// Refresh hooks when hooks tab becomes visible
	useEffect(() => {
		if (!isVisible || currentView !== "hooks") {
			return
		}

		const abortController = new AbortController()

		// Initial refresh when tab opens
		const refreshHooks = () => {
			if (abortController.signal.aborted) {
				return
			}

			FileServiceClient.refreshHooks({} as EmptyRequest)
				.then((response) => {
					if (!abortController.signal.aborted) {
						setGlobalHooks(response.globalHooks || [])
						setWorkspaceHooks(response.workspaceHooks || [])
					}
				})
				.catch((error) => {
					if (!abortController.signal.aborted) {
						console.error("Failed to refresh hooks:", error)
					}
				})
		}

		// Refresh immediately
		refreshHooks()

		// Poll every 1 second to detect filesystem changes
		const pollInterval = setInterval(refreshHooks, 1000)

		return () => {
			abortController.abort()
			clearInterval(pollInterval)
		}
	}, [isVisible, currentView])

	// Refresh skills when skills tab becomes visible
	useEffect(() => {
		if (!isVisible || currentView !== "skills") {
			return
		}

		let isCancelled = false

		const refreshSkills = () => {
			if (isCancelled) {
				return
			}

			FileServiceClient.refreshSkills({} as EmptyRequest)
				.then((response) => {
					if (!isCancelled) {
						setGlobalSkills(response.globalSkills || [])
					}
				})
				.catch((error) => {
					if (!isCancelled) {
						console.error("Failed to refresh skills:", error)
					}
				})
		}

		// Refresh immediately
		refreshSkills()

		// Poll every 1 second to detect filesystem changes
		const pollInterval = setInterval(refreshSkills, 1000)

		return () => {
			isCancelled = true
			clearInterval(pollInterval)
		}
	}, [isVisible, currentView])

	// Format global rules for display with proper typing
	const globalRules = Object.entries(globalShuncodeRulesToggles || {})
		.map(([path, enabled]): [string, boolean] => [path, enabled as boolean])
		.sort(([a], [b]) => a.localeCompare(b))

	// Format local rules for display with proper typing
	const localRules = Object.entries(localShuncodeRulesToggles || {})
		.map(([path, enabled]): [string, boolean] => [path, enabled as boolean])
		.sort(([a], [b]) => a.localeCompare(b))

	const cursorRules = Object.entries(localCursorRulesToggles || {})
		.map(([path, enabled]): [string, boolean] => [path, enabled as boolean])
		.sort(([a], [b]) => a.localeCompare(b))

	const windsurfRules = Object.entries(localWindsurfRulesToggles || {})
		.map(([path, enabled]): [string, boolean] => [path, enabled as boolean])
		.sort(([a], [b]) => a.localeCompare(b))

	const agentsRules = Object.entries(localAgentsRulesToggles || {})
		.map(([path, enabled]): [string, boolean] => [path, enabled as boolean])
		.sort(([a], [b]) => a.localeCompare(b))

	const isYamlPath = (p: string) => /\.(yaml|yml)$/i.test(p)

	const localWorkflows = Object.entries(localWorkflowToggles || {})
		.map(([path, enabled]): [string, boolean] => [path, enabled as boolean])
		.filter(([p]) => !isYamlPath(p))
		.sort(([a], [b]) => a.localeCompare(b))

	const globalWorkflows = Object.entries(globalWorkflowToggles || {})
		.map(([path, enabled]): [string, boolean] => [path, enabled as boolean])
		.filter(([p]) => !isYamlPath(p))
		.sort(([a], [b]) => a.localeCompare(b))

	const localScenarios = Object.entries(localWorkflowToggles || {})
		.map(([path, enabled]): [string, boolean] => [path, enabled as boolean])
		.filter(([p]) => isYamlPath(p))
		.sort(([a], [b]) => a.localeCompare(b))

	const globalScenarios = Object.entries(globalWorkflowToggles || {})
		.map(([path, enabled]): [string, boolean] => [path, enabled as boolean])
		.filter(([p]) => isYamlPath(p))
		.sort(([a], [b]) => a.localeCompare(b))

	// Get remote rules and workflows from remote config
	const remoteGlobalRules = remoteConfigSettings.remoteGlobalRules || []
	const remoteGlobalWorkflows = remoteConfigSettings.remoteGlobalWorkflows || []

	// Check if we have any remote rules or workflows
	const hasRemoteRules = remoteGlobalRules.length > 0
	const hasRemoteWorkflows = remoteGlobalWorkflows.length > 0

	// Handle toggle rule using gRPC
	const toggleRule = (isGlobal: boolean, rulePath: string, enabled: boolean) => {
		FileServiceClient.toggleShuncodeRule(
			ToggleShuncodeRuleRequest.create({
				scope: isGlobal ? RuleScope.GLOBAL : RuleScope.LOCAL,
				rulePath,
				enabled,
			}),
		)
			.then((response) => {
				// Update the local state with the response
				if (response.globalShuncodeRulesToggles?.toggles) {
					setGlobalShuncodeRulesToggles(response.globalShuncodeRulesToggles.toggles)
				}
				if (response.localShuncodeRulesToggles?.toggles) {
					setLocalShuncodeRulesToggles(response.localShuncodeRulesToggles.toggles)
				}
				if (response.remoteRulesToggles?.toggles) {
					setRemoteRulesToggles(response.remoteRulesToggles.toggles)
				}
			})
			.catch((error) => {
				console.error("Error toggling Shuncode rule:", error)
			})
	}

	const toggleCursorRule = (rulePath: string, enabled: boolean) => {
		FileServiceClient.toggleCursorRule(
			ToggleCursorRuleRequest.create({
				rulePath,
				enabled,
			}),
		)
			.then((response) => {
				// Update the local state with the response
				if (response.toggles) {
					setLocalCursorRulesToggles(response.toggles)
				}
			})
			.catch((error) => {
				console.error("Error toggling Cursor rule:", error)
			})
	}

	const toggleWindsurfRule = (rulePath: string, enabled: boolean) => {
		FileServiceClient.toggleWindsurfRule(
			ToggleWindsurfRuleRequest.create({
				rulePath,
				enabled,
			} as ToggleWindsurfRuleRequest),
		)
			.then((response: ShuncodeRulesToggles) => {
				if (response.toggles) {
					setLocalWindsurfRulesToggles(response.toggles)
				}
			})
			.catch((error) => {
				console.error("Error toggling Windsurf rule:", error)
			})
	}

	const toggleAgentsRule = (rulePath: string, enabled: boolean) => {
		FileServiceClient.toggleAgentsRule(
			ToggleAgentsRuleRequest.create({
				rulePath,
				enabled,
			} as ToggleAgentsRuleRequest),
		)
			.then((response: ShuncodeRulesToggles) => {
				if (response.toggles) {
					setLocalAgentsRulesToggles(response.toggles)
				}
			})
			.catch((error) => {
				console.error("Error toggling Agents rule:", error)
			})
	}

	// Toggle hook handler
	const toggleHook = (isGlobal: boolean, hookName: string, enabled: boolean, workspaceName?: string) => {
		FileServiceClient.toggleHook({
			metadata: {} as any,
			hookName,
			isGlobal,
			enabled,
			workspaceName,
		})
			.then((response) => {
				setGlobalHooks(response.hooksToggles?.globalHooks || [])
				setWorkspaceHooks(response.hooksToggles?.workspaceHooks || [])
			})
			.catch((error) => {
				console.error("Error toggling hook:", error)
			})
	}

	const toggleWorkflow = (isGlobal: boolean, workflowPath: string, enabled: boolean) => {
		FileServiceClient.toggleWorkflow(
			ToggleWorkflowRequest.create({
				workflowPath,
				enabled,
				scope: isGlobal ? RuleScope.GLOBAL : RuleScope.LOCAL,
			}),
		)
			.then((response) => {
				if (response.toggles) {
					if (isGlobal) {
						setGlobalWorkflowToggles(response.toggles)
					} else {
						setLocalWorkflowToggles(response.toggles)
					}
				}
			})
			.catch((err: Error) => {
				console.error("Failed to toggle workflow:", err)
			})
	}

	// Handle toggle for remote rules
	const toggleRemoteRule = (ruleName: string, enabled: boolean) => {
		FileServiceClient.toggleShuncodeRule(
			ToggleShuncodeRuleRequest.create({
				scope: RuleScope.REMOTE,
				rulePath: ruleName,
				enabled,
			}),
		)
			.then((response) => {
				// Update the local state with the response
				if (response.remoteRulesToggles?.toggles) {
					setRemoteRulesToggles(response.remoteRulesToggles.toggles)
				}
			})
			.catch((error) => {
				console.error("Error toggling remote rule:", error)
			})
	}

	// Handle toggle for remote workflows
	const toggleRemoteWorkflow = (workflowName: string, enabled: boolean) => {
		FileServiceClient.toggleWorkflow(
			ToggleWorkflowRequest.create({
				workflowPath: workflowName,
				enabled,
				scope: RuleScope.REMOTE,
			}),
		)
			.then((response) => {
				if (response.toggles) {
					setRemoteWorkflowToggles(response.toggles)
				}
			})
			.catch((error) => {
				console.error("Error toggling remote workflow:", error)
			})
	}

	// Handle toggle for skills
	const toggleSkill = (isGlobal: boolean, skillPath: string, enabled: boolean) => {
		FileServiceClient.toggleSkill(
			ToggleSkillRequest.create({
				skillPath,
				isGlobal,
				enabled,
			}),
		)
			.then((response) => {
				if (response.globalSkillsToggles) {
					setGlobalSkillsToggles(response.globalSkillsToggles)
				}
				setGlobalSkills((prev) => prev.map((s) => (s.path === skillPath ? { ...s, enabled } : s)))
			})
			.catch((error) => {
				console.error("Error toggling skill:", error)
			})
	}

	const handleRunWorkflow = useCallback(
		(rulePath: string) => {
			const fileName = rulePath.replace(/^.*[/\\]/, "").replace(/\.(yaml|yml|md|txt)$/i, "")
			TaskServiceClient.newTask(NewTaskRequest.create({ text: `/${fileName}`, images: [] })).catch((err) =>
				console.error("Failed to run workflow:", err),
			)
			setIsVisible(false)
		},
		[],
	)

	const handleEditWorkflow = useCallback(
		(rulePath: string) => {
			FileServiceClient.loadWorkflowDefinition(StringRequest.create({ value: rulePath }))
				.then((resp) => {
					setEditingWorkflow({
						filePath: resp.filePath || rulePath,
						data: {
							name: resp.name,
							description: resp.description || "",
							requiresInput: resp.requiresInput,
							steps: (resp.steps || []).map((s) => ({
								name: s.name,
								prompt: s.prompt,
								enabled: s.enabled,
								visible: s.visible,
							})),
						},
					})
				})
				.catch((err) => console.error("Failed to load workflow:", err))
		},
		[],
	)

	const handleSaveWorkflow = useCallback(
		(data: WorkflowEditorData) => {
			if (!editingWorkflow) return
			FileServiceClient.saveWorkflowDefinition(
				SaveWorkflowDefinitionRequest.create({
					filePath: editingWorkflow.filePath,
					name: data.name,
					description: data.description,
					version: 1,
					requiresInput: data.requiresInput,
					steps: data.steps.map((s) => ({
						name: s.name,
						prompt: s.prompt,
						enabled: s.enabled,
						visible: s.visible,
					})),
				}),
			)
				.then(() => setEditingWorkflow(null))
				.catch((err) => console.error("Failed to save workflow:", err))
		},
		[editingWorkflow],
	)

	// Close modal when clicking outside
	useClickAway(modalRef, () => {
		setIsVisible(false)
	})

	// Calculate positions for modal and arrow
	useEffect(() => {
		if (isVisible && buttonRef.current) {
			const buttonRect = buttonRef.current.getBoundingClientRect()
			const buttonCenter = buttonRect.left + buttonRect.width / 2
			const rightPosition = document.documentElement.clientWidth - buttonCenter - 5

			setArrowPosition(rightPosition)
			setMenuPosition(buttonRect.top + 1)
		}
	}, [isVisible, viewportWidth, viewportHeight])

	return (
		<div className="inline-flex min-w-0 max-w-full items-center" ref={modalRef}>
			<div className="inline-flex w-full items-center" ref={buttonRef}>
				<Tooltip>
					{!isVisible && <TooltipContent>{t("shuncodeRules.manageRulesWorkflows")}</TooltipContent>}
					<TooltipTrigger>
						<VSCodeButton
							appearance="icon"
							aria-label={isVisible ? t("shuncodeRules.hideRulesWorkflows") : t("shuncodeRules.showRulesWorkflows")}
							className="p-0 m-0 flex items-center"
							onClick={() => setIsVisible(!isVisible)}>
							<i className="codicon codicon-law" style={{ fontSize: "12.5px" }} />
						</VSCodeButton>
					</TooltipTrigger>
				</Tooltip>
			</div>

			{isVisible && (
				<PopupModalContainer $arrowPosition={arrowPosition} $menuPosition={menuPosition}>
					{editingWorkflow ? (
						<WorkflowEditor
							initial={editingWorkflow.data}
							onCancel={() => setEditingWorkflow(null)}
							onSave={handleSaveWorkflow}
						/>
					) : (
					<>
					{/* Fixed header section - tabs and description */}
					<div className="flex-shrink-0 px-2 pt-0">
						{/* Tabs container */}
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								marginBottom: "10px",
							}}>
							<div
								style={{
									display: "flex",
									gap: "1px",
									borderBottom: "1px solid var(--vscode-panel-border)",
								}}>
							<TabButton isActive={currentView === "rules"} onClick={() => setCurrentView("rules")}>
								{t("shuncodeRules.rules")}
							</TabButton>
							<TabButton isActive={currentView === "workflows"} onClick={() => setCurrentView("workflows")}>
								{t("shuncodeRules.workflows")}
							</TabButton>
							<TabButton isActive={currentView === "scenarios"} onClick={() => setCurrentView("scenarios")}>
								{t("workflow.scenarios")}
							</TabButton>
								{hooksEnabled && (
									<TabButton isActive={currentView === "hooks"} onClick={() => setCurrentView("hooks")}>
										{t("shuncodeRules.hooks")}
									</TabButton>
								)}
								{skillsEnabled && (
									<TabButton isActive={currentView === "skills"} onClick={() => setCurrentView("skills")}>
										{t("shuncodeRules.skills")}
									</TabButton>
								)}
							</div>
						</div>

						{/* Remote config banner */}
						{(currentView === "rules" && hasRemoteRules) || (currentView === "workflows" && hasRemoteWorkflows) ? (
							<div className="flex items-center gap-2 px-5 py-3 mb-4 bg-vscode-textBlockQuote-background border-l-[3px] border-vscode-textLink-foreground">
								<i className="codicon codicon-lock text-sm" />
								<span className="text-base">
									{currentView === "rules"
										? t("shuncodeRules.orgManagesRules")
										: t("shuncodeRules.orgManagesWorkflows")}
								</span>
							</div>
						) : null}

						{/* Description text */}
						<div className="text-xs text-description mb-4">
							{currentView === "rules" ? (
								<p>
									{t("shuncodeRules.rulesDescription")}{" "}
									<VSCodeLink className="text-xs" href="https://shuncode-ai.ru/ru/docs/shuncode-rules" style={{ display: "inline", fontSize: "inherit" }}>
										{t("shuncodeRules.docs")}
									</VSCodeLink>
								</p>
							) : currentView === "workflows" ? (
								<p>
									{t("shuncodeRules.workflowsDescription")}{" "}
									<span className="text-foreground font-bold">/workflow-name</span> in the chat.{" "}
									<VSCodeLink className="text-xs inline" href="https://shuncode-ai.ru/ru/docs/shuncode-rules">
										{t("shuncodeRules.docs")}
									</VSCodeLink>
								</p>
							) : currentView === "scenarios" ? (
								<p>
									{t("workflow.scenariosDescription")}
									{" "}{t("workflow.scenariosHint")}
								</p>
							) : currentView === "skills" ? (
								<p>
									{t("shuncodeRules.skillsDescriptionPrefix")} <span className="font-bold">use_skill</span>{" "}
									{t("shuncodeRules.skillsDescriptionSuffix")}
								</p>
							) : (
								<p>{t("shuncodeRules.hooksDescription")}</p>
							)}
						</div>
					</div>

					{/* Scrollable content area */}
					<div className="flex-1 overflow-y-auto px-2 pb-3" style={{ minHeight: 0 }}>
						{currentView === "rules" ? (
							<>
								{/* Remote Rules Section */}
								{hasRemoteRules && (
									<div className="mb-3">
										<div className="text-sm font-normal mb-2">{t("shuncodeRules.enterpriseRules")}</div>
										<div className="flex flex-col gap-0">
											{remoteGlobalRules.map((rule) => {
												const enabled = rule.alwaysEnabled || remoteRulesToggles[rule.name] === true
												return (
													<RuleRow
														alwaysEnabled={rule.alwaysEnabled}
														enabled={enabled}
														isGlobal={false}
														isRemote={true}
														key={rule.name}
														rulePath={rule.name}
														ruleType="shuncode"
														toggleRule={toggleRemoteRule}
													/>
												)
											})}
										</div>
									</div>
								)}

								{/* Global Rules Section */}
								<div className="mb-3">
									<div className="text-sm font-normal mb-2">{t("shuncodeRules.globalRules")}</div>

									{/* File-based Global Rules */}
									<RulesToggleList
										isGlobal={true}
										listGap="small"
										rules={globalRules}
										ruleType={"shuncode"}
										showNewRule={true}
										showNoRules={false}
										toggleRule={(rulePath, enabled) => toggleRule(true, rulePath, enabled)}
									/>
								</div>

								{/* Local Rules Section */}
								<div className="-mb-2.5">
									<div className="text-sm font-normal mb-2">{t("shuncodeRules.workspaceRules")}</div>
									<RulesToggleList
										isGlobal={false}
										listGap="small"
										rules={localRules}
										ruleType={"shuncode"}
										showNewRule={false}
										showNoRules={false}
										toggleRule={(rulePath, enabled) => toggleRule(false, rulePath, enabled)}
									/>

									<RulesToggleList
										isGlobal={false}
										listGap="small"
										rules={cursorRules}
										ruleType={"cursor"}
										showNewRule={false}
										showNoRules={false}
										toggleRule={toggleCursorRule}
									/>
									<RulesToggleList
										isGlobal={false}
										listGap="small"
										rules={windsurfRules}
										ruleType={"windsurf"}
										showNewRule={false}
										showNoRules={false}
										toggleRule={toggleWindsurfRule}
									/>
									<RulesToggleList
										isGlobal={false}
										listGap="small"
										rules={agentsRules}
										ruleType={"agents"}
										showNewRule={true}
										showNoRules={false}
										toggleRule={toggleAgentsRule}
									/>
								</div>
							</>
						) : currentView === "workflows" ? (
							<>
								{/* Remote Workflows Section */}
								{hasRemoteWorkflows && (
									<div className="mb-3">
										<div className="text-sm font-normal mb-2">{t("shuncodeRules.enterpriseWorkflows")}</div>
										<div className="flex flex-col gap-0">
											{remoteGlobalWorkflows.map((workflow) => {
												const enabled =
													workflow.alwaysEnabled || remoteWorkflowToggles[workflow.name] === true
												return (
													<RuleRow
														alwaysEnabled={workflow.alwaysEnabled}
														enabled={enabled}
														isGlobal={false}
														isRemote={true}
														key={workflow.name}
														rulePath={workflow.name}
														ruleType="workflow"
														toggleRule={toggleRemoteWorkflow}
													/>
												)
											})}
										</div>
									</div>
								)}

								{/* Global Workflows Section */}
								<div className="mb-3">
									<div className="text-sm font-normal mb-2">{t("shuncodeRules.globalWorkflows")}</div>
									<RulesToggleList
										isGlobal={true}
										listGap="small"
										rules={globalWorkflows}
										ruleType={"workflow"}
										showNewRule={true}
										showNoRules={false}
										toggleRule={(rulePath, enabled) => toggleWorkflow(true, rulePath, enabled)}
									/>
								</div>

								{/* Local Workflows Section */}
								<div className="-mb-2.5">
									<div className="text-sm font-normal mb-2">{t("shuncodeRules.workspaceWorkflows")}</div>
									<RulesToggleList
										isGlobal={false}
										listGap="small"
										rules={localWorkflows}
										ruleType={"workflow"}
										showNewRule={true}
										showNoRules={false}
										toggleRule={(rulePath, enabled) => toggleWorkflow(false, rulePath, enabled)}
									/>
								</div>
							</>
						) : currentView === "scenarios" ? (
							<>
								{/* Global Scenarios */}
								{globalScenarios.length > 0 && (
									<div className="mb-3">
										<div className="text-sm font-normal mb-2">{t("workflow.globalScenarios")}</div>
										<RulesToggleList
											isGlobal={true}
											listGap="small"
											onEditWorkflow={handleEditWorkflow}
											onRunWorkflow={handleRunWorkflow}
											rules={globalScenarios}
											ruleType={"workflow"}
											showNewRule={false}
											showNoRules={false}
											toggleRule={(rulePath, enabled) => toggleWorkflow(true, rulePath, enabled)}
										/>
									</div>
								)}

								{/* Local Scenarios */}
								<div className="mb-3">
									<div className="text-sm font-normal mb-2">{t("workflow.workspaceScenarios")}</div>
									<RulesToggleList
										isGlobal={false}
										listGap="small"
										onEditWorkflow={handleEditWorkflow}
										onRunWorkflow={handleRunWorkflow}
										rules={localScenarios}
										ruleType={"workflow"}
										showNewRule={false}
										showNoRules={false}
										toggleRule={(rulePath, enabled) => toggleWorkflow(false, rulePath, enabled)}
									/>
								</div>

								{/* New scenario */}
								<div className="-mb-2.5">
									<NewRuleRow isGlobal={false} ruleType="multi-step-workflow" />
								</div>
							</>
						) : currentView === "hooks" ? (
							<>
								<div className="text-xs text-description mb-4">
									<p>
										{t("shuncodeRules.hooksToggleHint")}{" "}
										<VSCodeLink
											className="text-xs"
											href="https://shuncode-ai.ru/ru/docs/shuncode-rules"
											style={{ display: "inline", fontSize: "inherit" }}>
											{t("shuncodeRules.docs")}
										</VSCodeLink>
									</p>
								</div>
								{/* Hooks Tab */}
								{/* Windows warning banner */}
								{isWindows && (
									<div className="flex items-center gap-2 px-5 py-3 mb-4 bg-vscode-inputValidation-warningBackground border-l-[3px] border-vscode-inputValidation-warningBorder">
										<i className="codicon codicon-warning text-sm" />
										<span className="text-base">{t("shuncodeRules.hookTogglingWindowsBanner")}</span>
									</div>
								)}

								{/* Global Hooks */}
								<div className="mb-3">
									<div className="text-sm font-normal mb-2">{t("shuncodeRules.globalHooks")}</div>
									<div className="flex flex-col gap-0">
										{globalHooks
											.sort((a, b) => a.name.localeCompare(b.name))
											.map((hook) => (
												<HookRow
													absolutePath={hook.absolutePath}
													enabled={hook.enabled}
													hookName={hook.name}
													isGlobal={true}
													isWindows={isWindows}
													key={hook.name}
													onDelete={(hooksToggles) => {
														// Use response data directly, no need to refresh
														setGlobalHooks(hooksToggles.globalHooks || [])
														setWorkspaceHooks(hooksToggles.workspaceHooks || [])
													}}
													onToggle={(name: string, newEnabled: boolean) =>
														toggleHook(true, name, newEnabled)
													}
												/>
											))}
										<NewRuleRow
											existingHooks={globalHooks.map((h) => h.name)}
											isGlobal={true}
											ruleType="hook"
										/>
									</div>
								</div>

								{/* Workspace Hooks - one section per workspace */}
								{workspaceHooks.map((workspace, index) => (
									<div
										className={index === workspaceHooks.length - 1 ? "-mb-2.5" : "mb-3"}
										key={workspace.workspaceName}>
										<div className="text-sm font-normal mb-2">
											{workspace.workspaceName}/.shuncoderules/hooks/
										</div>
										<div className="flex flex-col gap-0">
											{workspace.hooks
												.sort((a, b) => a.name.localeCompare(b.name))
												.map((hook) => (
													<HookRow
														absolutePath={hook.absolutePath}
														enabled={hook.enabled}
														hookName={hook.name}
														isGlobal={false}
														isWindows={isWindows}
														key={hook.absolutePath}
														onDelete={(hooksToggles) => {
															// Use response data directly, no need to refresh
															setGlobalHooks(hooksToggles.globalHooks || [])
															setWorkspaceHooks(hooksToggles.workspaceHooks || [])
														}}
														onToggle={(name: string, newEnabled: boolean) =>
															toggleHook(false, name, newEnabled, workspace.workspaceName)
														}
														workspaceName={workspace.workspaceName}
													/>
												))}
											<NewRuleRow
												existingHooks={workspace.hooks.map((h) => h.name)}
												isGlobal={false}
												ruleType="hook"
												workspaceName={workspace.workspaceName}
											/>
										</div>
									</div>
								))}
							</>
						) : currentView === "skills" ? (
							<>
								{/* Global Skills Section */}
								<div className="mb-3">
									<div className="text-sm font-normal mb-2">{t("shuncodeRules.globalSkills")}</div>
									<div className="flex flex-col gap-0">
										{globalSkills
											.sort((a, b) => a.name.localeCompare(b.name))
											.map((skill) => (
												<RuleRow
													enabled={skill.enabled}
													isGlobal={true}
													key={skill.path}
													rulePath={skill.path}
													ruleType="skill"
													toggleRule={(path, enabled) => toggleSkill(true, path, enabled)}
												/>
											))}
										<NewRuleRow isGlobal={true} ruleType="skill" />
									</div>
								</div>
							</>
						) : null}
					</div>
				</>
					)}
				</PopupModalContainer>
			)}
		</div>
	)
}

const StyledTabButton = styled.button<{ isActive: boolean }>`
	background: none;
	border: none;
	border-bottom: 2px solid ${(props) => (props.isActive ? "var(--vscode-foreground)" : "transparent")};
	color: ${(props) => (props.isActive ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)")};
	padding: 8px 16px;
	cursor: pointer;
	font-size: 13px;
	margin-bottom: -1px;
	font-family: inherit;

	&:hover {
		color: var(--vscode-foreground);
	}
`

export const TabButton = ({
	children,
	isActive,
	onClick,
}: {
	children: React.ReactNode
	isActive: boolean
	onClick: () => void
}) => (
	<StyledTabButton aria-pressed={isActive} isActive={isActive} onClick={onClick}>
		{children}
	</StyledTabButton>
)

export default ShuncodeRulesToggleModal
