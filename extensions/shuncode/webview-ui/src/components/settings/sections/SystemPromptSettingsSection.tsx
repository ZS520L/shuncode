import { EmptyRequest, StringRequest } from "@shared/proto/shuncode/common"
import {
	BUILTIN_SYSTEM_PROMPT_PROFILE_ID,
	BUILTIN_SYSTEM_PROMPT_TEMPLATE,
	getActiveSystemPromptProfile,
	getSystemPromptProfiles,
	isBuiltinSystemPromptProfileId,
	normalizeSystemPromptSettings,
	serializeSystemPromptSettings,
	SYSTEM_PROMPT_VARIABLES,
	type SystemPromptProfile,
	type SystemPromptSettings,
} from "@shared/SystemPromptSettings"
import { VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Copy, Eye, Plus, RefreshCw, Trash2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useI18n } from "@/i18n"
import { StateServiceClient } from "@/services/grpc-client"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface SystemPromptSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const createProfile = (template = BUILTIN_SYSTEM_PROMPT_TEMPLATE): SystemPromptProfile => ({
	id: `custom-${Date.now()}`,
	name: "Custom Prompt",
	template,
})

const updateSystemPromptSettings = (settings: SystemPromptSettings) => {
	updateSetting("systemPromptSettings", serializeSystemPromptSettings(settings))
}

const truncateValue = (value: string, maxLength = 180) => {
	if (!value) return "—"
	return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

const SystemPromptSettingsSection = ({ renderSectionHeader }: SystemPromptSettingsSectionProps) => {
	const { t } = useI18n()
	const { systemPromptSettings } = useExtensionState()
	const textAreaRef = useRef<HTMLTextAreaElement>(null)

	const settings = useMemo(() => normalizeSystemPromptSettings(systemPromptSettings), [systemPromptSettings])
	const profiles = useMemo(() => getSystemPromptProfiles(settings), [settings])
	const activeProfile = useMemo(() => getActiveSystemPromptProfile(settings), [settings])
	const isBuiltinProfile = isBuiltinSystemPromptProfileId(activeProfile.id)

	const [draftName, setDraftName] = useState(activeProfile.name)
	const [draftTemplate, setDraftTemplate] = useState(activeProfile.template)
	const [preview, setPreview] = useState("")
	const [previewError, setPreviewError] = useState<string | undefined>()
	const [isPreviewLoading, setIsPreviewLoading] = useState(false)
	const [variableValues, setVariableValues] = useState<Record<string, string>>({})
	const [variableValuesError, setVariableValuesError] = useState<string | undefined>()
	const [isVariableValuesLoading, setIsVariableValuesLoading] = useState(false)
	const [expandedVariableName, setExpandedVariableName] = useState<string | undefined>()

	useEffect(() => {
		setDraftName(activeProfile.name)
		setDraftTemplate(activeProfile.template)
		setPreview("")
		setPreviewError(undefined)
	}, [activeProfile.id, activeProfile.name, activeProfile.template])

	const isDirty = !isBuiltinProfile && (draftName !== activeProfile.name || draftTemplate !== activeProfile.template)

	const commit = (next: SystemPromptSettings) => updateSystemPromptSettings(next)

	const updateActiveProfile = (updater: (profile: SystemPromptProfile) => SystemPromptProfile) => {
		if (isBuiltinProfile) return
		commit({
			...settings,
			profiles: settings.profiles.map((profile) => (profile.id === activeProfile.id ? updater(profile) : profile)),
		})
	}

	const addProfile = (template?: string) => {
		const profile = createProfile(template)
		commit({
			...settings,
			enabled: true,
			activeProfileId: profile.id,
			profiles: [...settings.profiles, profile],
		})
	}

	const deleteActiveProfile = () => {
		if (isBuiltinProfile) return
		commit({
			...settings,
			activeProfileId: BUILTIN_SYSTEM_PROMPT_PROFILE_ID,
			profiles: settings.profiles.filter((profile) => profile.id !== activeProfile.id),
		})
	}

	const saveDraft = () => {
		updateActiveProfile((profile) => ({
			...profile,
			name: draftName.trim() || profile.name,
			template: draftTemplate,
		}))
	}

	const insertVariable = (name: string) => {
		if (isBuiltinProfile) return
		const token = `{{${name}}}`
		const textarea = textAreaRef.current
		if (!textarea) {
			setDraftTemplate((value) => `${value}${token}`)
			return
		}

		const start = textarea.selectionStart
		const end = textarea.selectionEnd
		const next = `${draftTemplate.slice(0, start)}${token}${draftTemplate.slice(end)}`
		setDraftTemplate(next)
		requestAnimationFrame(() => {
			textarea.focus()
			textarea.setSelectionRange(start + token.length, start + token.length)
		})
	}

	const refreshVariableValues = async () => {
		setIsVariableValuesLoading(true)
		setVariableValuesError(undefined)
		try {
			const result = await StateServiceClient.getSystemPromptVariableValues(EmptyRequest.create({}))
			setVariableValues(JSON.parse(result.value || "{}"))
		} catch (error) {
			setVariableValues({})
			setVariableValuesError(error instanceof Error ? error.message : String(error))
		} finally {
			setIsVariableValuesLoading(false)
		}
	}

	useEffect(() => {
		refreshVariableValues()
	}, [])

	const expandedVariable = expandedVariableName
		? SYSTEM_PROMPT_VARIABLES.find((variable) => variable.name === expandedVariableName)
		: undefined
	const expandedVariableValue = expandedVariableName ? variableValues[expandedVariableName] || "" : ""

	const refreshPreview = async () => {
		setIsPreviewLoading(true)
		setPreviewError(undefined)
		try {
			const result = await StateServiceClient.getSystemPromptPreview(StringRequest.create({ value: draftTemplate }))
			setPreview(result.value)
		} catch (error) {
			setPreview("")
			setPreviewError(error instanceof Error ? error.message : String(error))
		} finally {
			setIsPreviewLoading(false)
		}
	}

	return (
		<div>
			{renderSectionHeader("system-prompt")}
			<Section>
				<div className="mb-3">
					<VSCodeCheckbox
						checked={settings.enabled}
						onChange={(e: any) => commit({ ...settings, enabled: e.target.checked === true })}>
						{t("systemPrompt.enableCustom")}
					</VSCodeCheckbox>
					<p className="text-xs mt-[4px] text-(--vscode-descriptionForeground)">
						{t("systemPrompt.enableCustomDescription")}
					</p>
				</div>

				<div className="mb-3">
					<label className="block text-sm font-medium mb-1" htmlFor="system-prompt-profile">
						{t("systemPrompt.activeProfile")}
					</label>
					<div className="flex gap-2 items-center">
						<VSCodeDropdown
							className="flex-1"
							currentValue={activeProfile.id}
							id="system-prompt-profile"
							onChange={(e: any) => commit({ ...settings, activeProfileId: e.target.currentValue })}>
							{profiles.map((profile) => (
								<VSCodeOption key={profile.id} value={profile.id}>
									{profile.name}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
						<VSCodeButton appearance="secondary" onClick={() => addProfile()} title={t("systemPrompt.newProfile")}>
							<Plus className="w-4 h-4" />
						</VSCodeButton>
						<VSCodeButton
							appearance="secondary"
							onClick={() => addProfile(activeProfile.template)}
							title={t("systemPrompt.duplicateProfile")}>
							<Copy className="w-4 h-4" />
						</VSCodeButton>
						<VSCodeButton
							appearance="secondary"
							disabled={isBuiltinProfile}
							onClick={deleteActiveProfile}
							title={t("systemPrompt.deleteProfile")}>
							<Trash2 className="w-4 h-4" />
						</VSCodeButton>
					</div>
				</div>

				<div className="mb-3">
					<label className="block text-sm font-medium mb-1" htmlFor="system-prompt-profile-name">
						{t("systemPrompt.profileName")}
					</label>
					<VSCodeTextField
						className="w-full"
						disabled={isBuiltinProfile}
						id="system-prompt-profile-name"
						onChange={(e: any) => setDraftName(e.target.value)}
						value={draftName}
					/>
				</div>

				<div className="mb-3">
					<label className="block text-sm font-medium mb-1" htmlFor="system-prompt-template">
						{t("systemPrompt.template")}
					</label>
					<textarea
						className="w-full box-border rounded p-2 text-sm font-mono"
						disabled={isBuiltinProfile}
						id="system-prompt-template"
						onChange={(e) => setDraftTemplate(e.target.value)}
						onWheel={(e) => {
							const el = e.currentTarget
							const atTop = el.scrollTop === 0 && e.deltaY < 0
							const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight && e.deltaY > 0
							if (!atTop && !atBottom) e.stopPropagation()
						}}
						ref={textAreaRef}
						rows={18}
						style={{
							background: "var(--vscode-input-background)",
							border: "1px solid var(--vscode-input-border, var(--vscode-widget-border))",
							color: "var(--vscode-input-foreground)",
							resize: "vertical",
							overscrollBehavior: "contain",
						}}
						value={draftTemplate}
					/>
					<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
						{isBuiltinProfile ? t("systemPrompt.builtinReadonly") : t("systemPrompt.templateDescription")}
					</p>
				</div>

				<div className="flex gap-2 mb-4">
					<VSCodeButton disabled={isBuiltinProfile || !isDirty} onClick={saveDraft}>
						{t("systemPrompt.saveProfile")}
					</VSCodeButton>
					<VSCodeButton
						appearance="secondary"
						disabled={isBuiltinProfile || !isDirty}
						onClick={() => {
							setDraftName(activeProfile.name)
							setDraftTemplate(activeProfile.template)
						}}>
						{t("systemPrompt.discardChanges")}
					</VSCodeButton>
				</div>

				<div
					className="p-3 rounded-md mb-4"
					style={{ border: "1px solid var(--vscode-widget-border)", background: "var(--vscode-editor-background)" }}>
					<div className="flex items-center justify-between gap-2 mb-2">
						<div>
							<div className="text-sm font-semibold flex items-center gap-2">
								<Eye className="w-4 h-4" />
								{t("systemPrompt.previewTitle")}
							</div>
							<p className="text-xs mt-[3px] mb-0 text-(--vscode-descriptionForeground)">
								{t("systemPrompt.previewDescription")}
							</p>
						</div>
						<VSCodeButton appearance="secondary" disabled={isPreviewLoading} onClick={refreshPreview}>
							<RefreshCw className="w-4 h-4 mr-1" />
							{isPreviewLoading ? t("systemPrompt.previewLoading") : t("systemPrompt.refreshPreview")}
						</VSCodeButton>
					</div>
					{previewError && <p className="text-xs text-error mb-2">{previewError}</p>}
					<textarea
						className="w-full box-border rounded p-2 text-xs font-mono"
						onWheel={(e) => {
							const el = e.currentTarget
							const atTop = el.scrollTop === 0 && e.deltaY < 0
							const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight && e.deltaY > 0
							if (!atTop && !atBottom) e.stopPropagation()
						}}
						readOnly
						rows={16}
						style={{
							background: "var(--vscode-input-background)",
							border: "1px solid var(--vscode-input-border, var(--vscode-widget-border))",
							color: "var(--vscode-input-foreground)",
							resize: "vertical",
							overscrollBehavior: "contain",
						}}
						value={preview || t("systemPrompt.previewPlaceholder")}
					/>
					{preview && (
						<p className="text-xs mt-[5px] mb-0 text-(--vscode-descriptionForeground)">
							{t("systemPrompt.previewLength", { count: preview.length })}
						</p>
					)}
				</div>

				<div
					className="p-3 rounded-md"
					style={{ border: "1px solid var(--vscode-widget-border)", background: "var(--vscode-editor-background)" }}>
					<div className="flex items-center justify-between gap-2 mb-2">
						<div className="text-sm font-semibold">{t("systemPrompt.availableVariables")}</div>
						<VSCodeButton appearance="secondary" disabled={isVariableValuesLoading} onClick={refreshVariableValues}>
							<RefreshCw className="w-4 h-4 mr-1" />
							{isVariableValuesLoading ? t("systemPrompt.variablesLoading") : t("systemPrompt.refreshVariables")}
						</VSCodeButton>
					</div>
					<p className="text-xs mt-0 mb-3 text-(--vscode-descriptionForeground)">{t("systemPrompt.variablesDescription")}</p>
					{variableValuesError && <p className="text-xs text-error mb-2">{variableValuesError}</p>}
					<div className="overflow-x-auto">
						<table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
							<thead>
								<tr className="text-left text-(--vscode-descriptionForeground)">
									<th className="pb-2 pr-3">{t("systemPrompt.variableColumn")}</th>
									<th className="pb-2 pr-3">{t("systemPrompt.meaningColumn")}</th>
									<th className="pb-2 pr-3">{t("systemPrompt.currentValueColumn")}</th>
									<th className="pb-2">{t("systemPrompt.actionColumn")}</th>
								</tr>
							</thead>
							<tbody>
								{SYSTEM_PROMPT_VARIABLES.map((variable) => {
									const value = variableValues[variable.name] || ""
									return (
										<tr key={variable.name} style={{ borderTop: "1px solid var(--vscode-widget-border)" }}>
											<td className="py-2 pr-3 align-top">
												<code>{`{{${variable.name}}}`}</code>
												<div className="mt-1 text-(--vscode-descriptionForeground)">{variable.category}</div>
											</td>
											<td className="py-2 pr-3 align-top">{variable.description}</td>
											<td className="py-2 pr-3 align-top">
												<button
													className="text-left cursor-pointer underline decoration-dotted"
													onClick={() => setExpandedVariableName(variable.name)}
													style={{
														background: "transparent",
														border: 0,
														color: "var(--vscode-descriptionForeground)",
														padding: 0,
													}}>
													{truncateValue(value)}
												</button>
											</td>
											<td className="py-2 align-top">
												<VSCodeButton appearance="secondary" disabled={isBuiltinProfile} onClick={() => insertVariable(variable.name)}>
													{t("systemPrompt.insertVariable")}
												</VSCodeButton>
											</td>
										</tr>
									)
								})}
							</tbody>
						</table>
					</div>
					{expandedVariable && (
						<div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--vscode-widget-border)" }}>
							<div className="flex items-center justify-between gap-2 mb-2">
								<div className="text-sm font-semibold">
									{t("systemPrompt.fullVariableValue", { variable: `{{${expandedVariable.name}}}` })}
								</div>
								<VSCodeButton appearance="secondary" onClick={() => setExpandedVariableName(undefined)}>
									{t("systemPrompt.closeVariableValue")}
								</VSCodeButton>
							</div>
							<textarea
								className="w-full box-border rounded p-2 text-xs font-mono"
								onWheel={(e) => {
									const el = e.currentTarget
									const atTop = el.scrollTop === 0 && e.deltaY < 0
									const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight && e.deltaY > 0
									if (!atTop && !atBottom) e.stopPropagation()
								}}
								readOnly
								rows={12}
								style={{
									background: "var(--vscode-input-background)",
									border: "1px solid var(--vscode-input-border, var(--vscode-widget-border))",
									color: "var(--vscode-input-foreground)",
									resize: "vertical",
									overscrollBehavior: "contain",
								}}
								value={expandedVariableValue || "—"}
							/>
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}

export default SystemPromptSettingsSection
