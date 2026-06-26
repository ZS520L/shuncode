import type { ToolUse } from "@core/assistant-message"
import { ShuncodeSayTool } from "@shared/ExtensionMessage"
import { ShuncodeDefaultTool } from "@shared/tools"
import type { ToolResponse } from "../../index"
import type { IToolHandler, IPartialBlockHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class EvaluateTaskHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ShuncodeDefaultTool.EVALUATE_TASK

	getDescription(_block: ToolUse): string {
		return `[evaluate_task]`
	}

	async handlePartialBlock(_block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const msg: ShuncodeSayTool = {
			tool: "evaluateTask",
			content: "Evaluating task...",
		}
		await uiHelpers.say("tool", JSON.stringify(msg), undefined, undefined, true)
	}

	async execute(config: TaskConfig, _block: ToolUse): Promise<ToolResponse> {
		const tracker = config.taskState.evaluationTracker
		const evaluation = tracker.getEvaluation()

		if (!evaluation) {
			const msg: ShuncodeSayTool = {
				tool: "evaluateTask",
				content: "No evaluation data available.",
			}
			await config.callbacks.say("tool", JSON.stringify(msg), undefined, undefined, false)
			return "No evaluation data available. This tool should be called after attempt_completion."
		}

		const { score, grade, findings, signals, needsFollowup } = evaluation

		// Format findings into readable text
		const findingsText = findings.length > 0
			? findings
				.map((f) => `  [${f.severity.toUpperCase()}] ${f.code}: ${f.message}`)
				.join("\n")
			: "  (无扣分项)"

		// Format verification commands
		const verificationText = signals.verificationCommands.length > 0
			? signals.verificationCommands
				.map((v) => `  - [${v.category}] ${v.command} → ${v.success ? "✓" : "✗"}`)
				.join("\n")
			: "  (无验证命令)"

		// Build the evaluation report
		const report = `
═══════════════════════════════════════════════
  TASK EVALUATION REPORT
═══════════════════════════════════════════════

Score: ${score}/100 (${gradeLabel(grade)})
Grade: ${grade.toUpperCase()}
Needs Followup: ${needsFollowup ? "YES" : "NO"}

─── Signals ───
• Tool calls: ${signals.toolCallCount} (edits: ${signals.editToolCallCount}, commands: ${signals.commandToolCallCount})
• Failed: ${signals.failedToolCallCount} | Rejected: ${signals.rejectedToolCallCount}
• Completion attempts: ${signals.completionAttempts}
• Mode violations: ${signals.modeViolationCount}
• Missing params: ${signals.missingParamCount}
• Repeated failure loops: ${signals.repeatedFailureLoopCount}
• Exploration warnings: ${signals.consecutiveExplorationWarnings}
• Has verification: ${signals.hasVerificationEvidence ? "YES" : "NO"}
• User feedback after completion: ${signals.userProvidedFeedbackAfterCompletion ? "YES" : "NO"}
• User feedback: ${signals.userFeedback || "none"}

─── Findings ───
${findingsText}

─── Verification Evidence ───
${verificationText}

═══════════════════════════════════════════════

Based on the above evaluation, provide CONCRETE optimization suggestions:

1. **System Prompt 优化建议** — 针对本次扣分项，系统提示词中哪些规则/指令需要加强或修改？给出具体修改建议（引用文件路径和位置）。

2. **Tool Handler 优化建议** — 哪些工具的行为逻辑需要调整？给出具体代码修改方向。

3. **工作流程建议** — 执行策略上有什么可以改进的？

关键源码路径：
- System Prompt: extensions/shuncode/src/shared/SystemPromptSettings.ts
- Tool Specs: extensions/shuncode/src/core/prompts/system-prompt/tools/
- Tool Handlers: extensions/shuncode/src/core/task/tools/handlers/
- Evaluation Logic: extensions/shuncode/src/core/task/evaluation/

注意：只给出建议，不要直接修改源码。用户会评估后决定是否让你执行修改。
`.trim()

		// Show the evaluation card in the UI
		const msg: ShuncodeSayTool = {
			tool: "evaluateTask",
			content: report,
			path: `${score}/100 (${grade.toUpperCase()})`,
		}
		await config.callbacks.say("tool", JSON.stringify(msg), undefined, undefined, false)

		return report
	}
}

function gradeLabel(grade: string): string {
	switch (grade) {
		case "excellent":
			return "优秀"
		case "good":
			return "良好"
		case "needs_attention":
			return "需改进"
		case "failed":
			return "失败"
		default:
			return grade
	}
}
