import { Anthropic } from "@anthropic-ai/sdk"
import { ShuncodeMessageMetricsInfo, ShuncodeMessageModelInfo } from "./metrics"

export type ShuncodePromptInputContent = string

export type ShuncodeMessageRole = "user" | "assistant"

export interface ShuncodeReasoningDetailParam {
	type: "reasoning.text" | string
	text: string
	signature: string
	format: "anthropic-claude-v1" | string
	index: number
}

interface ShuncodeSharedMessageParam {
	// The id of the response that the block belongs to
	call_id?: string
}

export const REASONING_DETAILS_PROVIDERS = ["shuncode", "openrouter"]

/**
 * An extension of Anthropic.MessageParam that includes Shuncode-specific fields: reasoning_details.
 * This ensures backward compatibility where the messages were stored in Anthropic format with additional
 * fields unknown to Anthropic SDK.
 */
export interface ShuncodeTextContentBlock extends Anthropic.TextBlockParam, ShuncodeSharedMessageParam {
	// reasoning_details only exists for providers listed in REASONING_DETAILS_PROVIDERS
	reasoning_details?: ShuncodeReasoningDetailParam[]
	// Thought Signature associates with Gemini
	signature?: string
}

export interface ShuncodeImageContentBlock extends Anthropic.ImageBlockParam, ShuncodeSharedMessageParam {}

export interface ShuncodeDocumentContentBlock extends Anthropic.DocumentBlockParam, ShuncodeSharedMessageParam {}

export interface ShuncodeUserToolResultContentBlock extends Anthropic.ToolResultBlockParam, ShuncodeSharedMessageParam {}

/**
 * Assistant only content types
 */
export interface ShuncodeAssistantToolUseBlock extends Anthropic.ToolUseBlockParam, ShuncodeSharedMessageParam {
	// reasoning_details only exists for providers listed in REASONING_DETAILS_PROVIDERS
	reasoning_details?: unknown[] | ShuncodeReasoningDetailParam[]
	// Thought Signature associates with Gemini
	signature?: string
}

export interface ShuncodeAssistantThinkingBlock extends Anthropic.ThinkingBlock, ShuncodeSharedMessageParam {
	// The summary items returned by OpenAI response API
	// The reasoning details that will be moved to the text block when finalized
	summary?: unknown[] | ShuncodeReasoningDetailParam[]
}

export interface ShuncodeAssistantRedactedThinkingBlock extends Anthropic.RedactedThinkingBlockParam, ShuncodeSharedMessageParam {}

export type ShuncodeToolResponseContent = ShuncodePromptInputContent | Array<ShuncodeTextContentBlock | ShuncodeImageContentBlock>

export type ShuncodeUserContent =
	| ShuncodeTextContentBlock
	| ShuncodeImageContentBlock
	| ShuncodeDocumentContentBlock
	| ShuncodeUserToolResultContentBlock

export type ShuncodeAssistantContent =
	| ShuncodeTextContentBlock
	| ShuncodeImageContentBlock
	| ShuncodeDocumentContentBlock
	| ShuncodeAssistantToolUseBlock
	| ShuncodeAssistantThinkingBlock
	| ShuncodeAssistantRedactedThinkingBlock

export type ShuncodeContent = ShuncodeUserContent | ShuncodeAssistantContent

/**
 * An extension of Anthropic.MessageParam that includes Shuncode-specific fields.
 * This ensures backward compatibility where the messages were stored in Anthropic format,
 * while allowing for additional metadata specific to Shuncode to avoid unknown fields in Anthropic SDK
 * added by ignoring the type checking for those fields.
 */
export interface ShuncodeStorageMessage extends Anthropic.MessageParam {
	/**
	 * Response ID associated with this message
	 */
	id?: string
	role: ShuncodeMessageRole
	content: ShuncodePromptInputContent | ShuncodeContent[]
	/**
	 * NOTE: model information used when generating this message.
	 * Internal use for message conversion only.
	 * MUST be removed before sending message to any LLM provider.
	 */
	modelInfo?: ShuncodeMessageModelInfo
	/**
	 * LLM operational and performance metrics for this message
	 * Includes token counts, costs.
	 */
	metrics?: ShuncodeMessageMetricsInfo
}

/**
 * Converts ShuncodeStorageMessage to Anthropic.MessageParam by removing Shuncode-specific fields
 * Shuncode-specific fields (like modelInfo, reasoning_details) are properly omitted.
 */
export function convertShuncodeStorageToAnthropicMessage(
	shuncodeMessage: ShuncodeStorageMessage,
	provider = "anthropic",
): Anthropic.MessageParam {
	const { role, content } = shuncodeMessage

	// Handle string content - fast path
	if (typeof content === "string") {
		return { role, content }
	}

	// Removes thinking block that has no signature (invalid thinking block that's incompatible with Anthropic API)
	const filteredContent = content.filter((b) => b.type !== "thinking" || !!b.signature)

	// Handle array content - strip Shuncode-specific fields for non-reasoning_details providers
	const shouldCleanContent = !REASONING_DETAILS_PROVIDERS.includes(provider)
	const cleanedContent = shouldCleanContent
		? filteredContent.map(cleanContentBlock)
		: (filteredContent as Anthropic.MessageParam["content"])

	return { role, content: cleanedContent }
}

/**
 * Clean a content block by removing Shuncode-specific fields and returning only Anthropic-compatible fields
 */
export function cleanContentBlock(block: ShuncodeContent): Anthropic.ContentBlock {
	// Fast path: if no Shuncode-specific fields exist, return as-is
	const hasShuncodeFields =
		"reasoning_details" in block ||
		"call_id" in block ||
		"summary" in block ||
		(block.type !== "thinking" && "signature" in block)

	if (!hasShuncodeFields) {
		return block as Anthropic.ContentBlock
	}

	// Removes Shuncode-specific fields & the signature field that's added for Gemini.
	// biome-ignore lint/correctness/noUnusedVariables: intentional destructuring to remove properties
	const { reasoning_details, call_id, summary, ...rest } = block as any

	// Remove signature from non-thinking blocks that were added for Gemini
	if (block.type !== "thinking" && rest.signature) {
		rest.signature = undefined
	}

	return rest satisfies Anthropic.ContentBlock
}
