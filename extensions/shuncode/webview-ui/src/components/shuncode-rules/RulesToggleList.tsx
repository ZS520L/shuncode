import NewRuleRow from "./NewRuleRow"
import RuleRow from "./RuleRow"

function isMultiStepPath(filePath: string): boolean {
	return /\.(yaml|yml)$/i.test(filePath)
}

const RulesToggleList = ({
	rules,
	toggleRule,
	listGap = "medium",
	isGlobal,
	ruleType,
	showNewRule,
	showNoRules,
	isRemote = false,
	alwaysEnabledMap = {},
	onEditWorkflow,
	onRunWorkflow,
}: {
	rules: [string, boolean][]
	toggleRule: (rulePath: string, enabled: boolean) => void
	listGap?: "small" | "medium" | "large"
	isGlobal: boolean
	ruleType: string
	showNewRule: boolean
	showNoRules: boolean
	isRemote?: boolean
	alwaysEnabledMap?: Record<string, boolean>
	onEditWorkflow?: (rulePath: string) => void
	onRunWorkflow?: (rulePath: string) => void
}) => {
	const gapClasses = {
		small: "gap-0",
		medium: "gap-2.5",
		large: "gap-5",
	}

	const gapClass = gapClasses[listGap]

	return (
		<div className={`flex flex-col ${gapClass}`}>
			{rules.length > 0 ? (
				<>
				{rules.map(([rulePath, enabled]) => {
					const multiStep = ruleType === "workflow" && isMultiStepPath(rulePath)
					return (
						<RuleRow
							alwaysEnabled={alwaysEnabledMap[rulePath]}
							enabled={enabled}
							isGlobal={isGlobal}
							isMultiStep={multiStep}
							isRemote={isRemote}
							key={rulePath}
							onEditWorkflow={multiStep ? onEditWorkflow : undefined}
							onRunWorkflow={multiStep ? onRunWorkflow : undefined}
							rulePath={rulePath}
							ruleType={ruleType}
							toggleRule={toggleRule}
						/>
					)
				})}
					{showNewRule && <NewRuleRow isGlobal={isGlobal} ruleType={ruleType} />}
				</>
			) : (
				<>
					{showNoRules && (
						<div className="flex flex-col items-center gap-3 my-3 text-(--vscode-descriptionForeground)">
							{ruleType === "workflow" ? "No workflows found" : "No rules found"}
						</div>
					)}
					{showNewRule && <NewRuleRow isGlobal={isGlobal} ruleType={ruleType} />}
				</>
			)}
		</div>
	)
}

export default RulesToggleList
