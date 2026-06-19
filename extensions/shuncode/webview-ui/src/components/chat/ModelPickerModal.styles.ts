import styled from "styled-components"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"

export const PLAN_MODE_COLOR = "var(--vscode-activityWarningBadge-background)"
export const ACT_MODE_COLOR = "var(--vscode-focusBorder)"

export const SearchContainer = styled.div`
	padding: 4px 10px;
	min-height: 28px;
	box-sizing: border-box;
	border-bottom: 1px solid var(--vscode-editorGroup-border);
	display: flex;
	align-items: center;
	gap: 8px;
`

export const SearchInput = styled.input`
	flex: 1;
	background: transparent;
	border: none;
	outline: none;
	font-size: 11px;
	color: var(--vscode-foreground);
	&:focus {
		outline: none;
	}
	&::placeholder {
		color: var(--vscode-descriptionForeground);
		opacity: 0.7;
	}
`

export const SettingsSection = styled.div`
	position: relative;
	padding: 4px 10px;
	border-bottom: 1px solid var(--vscode-editorGroup-border);
	display: flex;
	flex-direction: column;
`

export const IconToggle = styled.button<{ $isActive: boolean; $isDisabled?: boolean; $isHidden?: boolean }>`
	display: ${(props) => (props.$isHidden ? "none" : "flex")};
	align-items: center;
	justify-content: center;
	width: 24px;
	height: 24px;
	background: transparent;
	border: none;
	border-radius: 4px;
	cursor: ${(props) => (props.$isDisabled ? "not-allowed" : "pointer")};
	color: ${(props) =>
		props.$isDisabled
			? "var(--vscode-disabledForeground)"
			: props.$isActive
				? "var(--vscode-textLink-foreground)"
				: "var(--vscode-descriptionForeground)"};
	opacity: ${(props) => (props.$isDisabled ? 0.4 : 1)};
	transition: all 0.15s ease;
	&:hover {
		background: ${(props) => (props.$isDisabled ? "transparent" : "var(--vscode-list-hoverBackground)")};
	}
`

export const ProviderRow = styled.div`
	display: flex;
	align-items: center;
	gap: 6px;
	cursor: pointer;
	&:hover {
		opacity: 0.8;
	}
`

export const ProviderDropdownPortal = styled.div`
	position: fixed;
	display: flex;
	flex-direction: column;
	padding: 4px 0;
	background: ${CODE_BLOCK_BG_COLOR};
	border: 1px solid var(--vscode-editorGroup-border);
	border-radius: 4px;
	max-height: 200px;
	overflow-y: auto;
	z-index: 2000;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
`

export const ProviderDropdownItem = styled.div<{ $isSelected: boolean }>`
	display: flex;
	align-items: center;
	padding: 4px 8px;
	cursor: pointer;
	font-size: 11px;
	color: ${(props) => (props.$isSelected ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)")};
	border-radius: 3px;
	&:hover {
		background: var(--vscode-list-hoverBackground);
	}
`

export const ModelListContainer = styled.div`
	flex: 1;
	overflow-y: auto;
	min-height: 0;
	scrollbar-width: thin;
	&::-webkit-scrollbar {
		width: 6px;
	}
	&::-webkit-scrollbar-thumb {
		background: transparent;
		border-radius: 3px;
	}
	&:hover::-webkit-scrollbar-thumb {
		background: var(--vscode-scrollbarSlider-background);
	}
`

export const ModelItemContainer = styled.div<{ $isSelected: boolean }>`
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 4px 10px;
	min-height: 28px;
	box-sizing: border-box;
	cursor: pointer;
	background: ${(props) => (props.$isSelected ? "var(--vscode-list-activeSelectionBackground)" : "transparent")};
	&:hover {
		background: var(--vscode-list-hoverBackground);
	}
`

export const ModelInfoRow = styled.div`
	display: flex;
	align-items: center;
	gap: 6px;
	flex: 1;
	min-width: 0;
`

export const ModelName = styled.span`
	font-size: 11px;
	color: var(--vscode-foreground);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
`

export const ModelProvider = styled.span`
	font-size: 10px;
	color: var(--vscode-descriptionForeground);
	white-space: nowrap;
	@media (max-width: 280px) {
		display: none;
	}
`

export const ModelLabel = styled.span`
	font-size: 9px;
	color: var(--vscode-textLink-foreground);
	text-transform: uppercase;
	letter-spacing: 0.5px;
	font-weight: 500;
	margin-left: auto;
	margin-right: 8px;
`

export const EmptyState = styled.div`
	padding: 12px 10px;
	text-align: center;
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
`

export const EmptyModelRow = styled.div`
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 8px 10px;
	min-height: 28px;
	box-sizing: border-box;
	background: ${CODE_BLOCK_BG_COLOR};
	position: sticky;
	top: 0;
	z-index: 1;
	border-bottom: 1px solid var(--vscode-editorGroup-border);
`

export const CurrentModelRow = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 6px;
	padding: 4px 10px;
	min-height: 28px;
	box-sizing: border-box;
	cursor: pointer;
	background: linear-gradient(var(--vscode-list-activeSelectionBackground), var(--vscode-list-activeSelectionBackground)),
		${CODE_BLOCK_BG_COLOR};
	position: sticky;
	top: 0;
	z-index: 1;
`

export const SplitModeRow = styled.div`
	display: flex;
	align-items: stretch;
	gap: 0;
	position: sticky;
	top: 0;
	z-index: 1;
	background: ${CODE_BLOCK_BG_COLOR};
`

export const SplitModeCell = styled.div<{ $isActive: boolean }>`
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 4px 10px;
	min-height: 28px;
	box-sizing: border-box;
	cursor: pointer;
	flex: 1;
	min-width: 0;
	background: ${(props) =>
		props.$isActive
			? `linear-gradient(var(--vscode-list-activeSelectionBackground), var(--vscode-list-activeSelectionBackground)), ${CODE_BLOCK_BG_COLOR}`
			: "transparent"};
	border-bottom: 2px solid ${(props) => (props.$isActive ? "var(--vscode-focusBorder)" : "transparent")};
	&:hover {
		background: var(--vscode-list-hoverBackground);
	}
`

export const SplitModeLabel = styled.span<{ $mode: "plan" | "act" }>`
	font-size: 9px;
	font-weight: 600;
	color: ${(props) => (props.$mode === "plan" ? PLAN_MODE_COLOR : ACT_MODE_COLOR)};
	text-transform: uppercase;
`

export const SplitModeModel = styled.span`
	font-size: 10px;
	color: var(--vscode-foreground);
	flex: 1;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
`

export const SettingsOnlyContainer = styled.div`
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 12px 10px;
`

export const ConfiguredModelName = styled.span`
	font-size: 11px;
	color: var(--vscode-foreground);
	font-weight: 500;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

export const SettingsOnlyLink = styled.div`
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	padding: 6px 0;
	margin-top: 4px;
	cursor: pointer;
	color: var(--vscode-textLink-foreground);
	font-size: 11px;
	&:hover {
		text-decoration: underline;
	}
`
