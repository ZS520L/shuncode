import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"

const id = ShuncodeDefaultTool.EVALUATE_TASK

const GENERIC: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "evaluate_task",
	description:
		"Evaluate the just-completed task's quality and provide optimization suggestions. Call this AFTER attempt_completion to reflect on task execution quality. Returns the evaluation score, findings, and expects you to output concrete suggestions for improving the system prompt and tool handlers. The user will decide whether to apply the suggestions.",
	parameters: [],
}

export const evaluate_task_variants = [GENERIC]
