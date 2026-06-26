import { getSystemPrompt } from "@core/prompts/system-prompt"
import { String as StringResponse, StringRequest } from "@shared/proto/shuncode/common"
import type { Controller } from ".."
import { buildSystemPromptPreviewContext } from "./systemPromptPreviewContext"

export async function getSystemPromptPreview(controller: Controller, request: StringRequest): Promise<StringResponse> {
	const context = await buildSystemPromptPreviewContext(controller, request.value || "")
	const { systemPrompt } = await getSystemPrompt(context)
	return StringResponse.create({ value: systemPrompt })
}
