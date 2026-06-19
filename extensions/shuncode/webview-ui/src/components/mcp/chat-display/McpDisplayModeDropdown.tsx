import { McpDisplayMode } from "@shared/McpDisplayMode"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import { useI18n } from "@/i18n"

interface McpDisplayModeDropdownProps {
	value: McpDisplayMode
	onChange: (mode: McpDisplayMode) => void
	id?: string
	className?: string
	style?: React.CSSProperties
	onClick?: (e: React.MouseEvent) => void
}

const McpDisplayModeDropdown: React.FC<McpDisplayModeDropdownProps> = ({ value, onChange, id, className, style, onClick }) => {
	const { t } = useI18n()
	const handleChange = (e: any) => {
		const newMode = e.target.value as McpDisplayMode
		onChange(newMode)
	}

	return (
		<VSCodeDropdown className={className} id={id} onChange={handleChange} onClick={onClick} style={style} value={value}>
			<VSCodeOption value="plain">{t("mcp.plainText")}</VSCodeOption>
			<VSCodeOption value="rich">{t("mcp.richDisplay")}</VSCodeOption>
			<VSCodeOption value="markdown">Markdown</VSCodeOption>
		</VSCodeDropdown>
	)
}

export default McpDisplayModeDropdown
