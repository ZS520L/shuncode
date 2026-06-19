import { ModelFamily } from "@/shared/prompts"
import { ShuncodeDefaultTool } from "@/shared/tools"
import type { ShuncodeToolSpec } from "../spec"

const GENERIC: ShuncodeToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ShuncodeDefaultTool.GENERATE_IMAGE,
	name: "generate_image",
	description: `Generates an image using a configured GPT Image model (e.g. gpt-image-1, gpt-image-2, dall-e-3).
- Takes a text prompt and generates an image based on the description
- Returns a base64-encoded image that will be displayed to the user
- Use this tool when the user asks you to create, draw, generate, or design an image
- Optionally specify size and quality parameters
- The generated image will be shown inline in the chat`,
	parameters: [
		{
			name: "prompt",
			required: true,
			instruction: "A detailed text description of the image to generate. Be specific about style, content, colors, composition, and any text to include.",
			usage: "A futuristic cityscape at sunset with neon lights reflecting off wet streets, cyberpunk style",
		},
		{
			name: "size",
			required: false,
			instruction: "The size of the generated image. Options: '1024x1024' (square), '1024x1536' (portrait), '1536x1024' (landscape), 'auto'. Defaults to 'auto'.",
			usage: "1024x1024",
		},
		{
			name: "quality",
			required: false,
			instruction: "The quality of the generated image. Options: 'low' (fast drafts), 'medium', 'high' (best quality). Defaults to 'medium'.",
			usage: "medium",
		},
	],
}

const NATIVE_NEXT_GEN: ShuncodeToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id: ShuncodeDefaultTool.GENERATE_IMAGE,
	name: "generate_image",
	description:
		"Generates an image using a configured GPT Image model. Use when the user asks to create, draw, generate, or design an image. Returns a base64 image displayed inline.",
	parameters: [
		{
			name: "prompt",
			required: true,
			instruction: "A detailed text description of the image to generate.",
		},
		{
			name: "size",
			required: false,
			instruction: "Image size: '1024x1024', '1024x1536', '1536x1024', or 'auto'. Defaults to 'auto'.",
		},
		{
			name: "quality",
			required: false,
			instruction: "Image quality: 'low', 'medium', or 'high'. Defaults to 'medium'.",
		},
	],
}

const NATIVE_GPT_5: ShuncodeToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const generate_image_variants = [GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN]
