import { describe, it } from "mocha"
import { expect } from "chai"
import { ThinkTagStreamParser } from "../think-tag-parser"

describe("ThinkTagStreamParser", () => {
	describe("basic <think> tags", () => {
		it("should extract reasoning from <think>...</think>", () => {
			const parser = new ThinkTagStreamParser()
			const result = parser.process("<think>plan here</think>visible text")
			expect(result.reasoning).to.equal("plan here")
			expect(result.text).to.equal("visible text")
		})

		it("should handle think block at start of response", () => {
			const parser = new ThinkTagStreamParser()
			const result = parser.process("<think>reasoning</think>output")
			expect(result.reasoning).to.equal("reasoning")
			expect(result.text).to.equal("output")
		})

		it("should handle multiple think blocks", () => {
			const parser = new ThinkTagStreamParser()
			const result = parser.process("<think>r1</think>text1<think>r2</think>text2")
			expect(result.reasoning).to.equal("r1r2")
			expect(result.text).to.equal("text1text2")
		})
	})

	describe("basic <thinking> tags", () => {
		it("should extract reasoning from <thinking>...</thinking>", () => {
			const parser = new ThinkTagStreamParser()
			const result = parser.process("<thinking>analysis here</thinking>answer")
			expect(result.reasoning).to.equal("analysis here")
			expect(result.text).to.equal("answer")
		})

		it("should handle <thinking> with newlines", () => {
			const parser = new ThinkTagStreamParser()
			const result = parser.process("<thinking>\nline1\nline2\n</thinking>result")
			expect(result.reasoning).to.equal("\nline1\nline2\n")
			expect(result.text).to.equal("result")
		})
	})

	describe("streaming — tags split across chunks", () => {
		it("should handle <think> split: '<th' + 'ink>' + 'reasoning' + '</think>'", () => {
			const parser = new ThinkTagStreamParser()
			let r = "", t = ""

			let out = parser.process("<th")
			r += out.reasoning; t += out.text
			out = parser.process("ink>")
			r += out.reasoning; t += out.text
			out = parser.process("reasoning")
			r += out.reasoning; t += out.text
			out = parser.process("</think>")
			r += out.reasoning; t += out.text
			out = parser.process("visible")
			r += out.reasoning; t += out.text

			expect(r).to.equal("reasoning")
			expect(t).to.equal("visible")
		})

		it("should handle <thinking> split across multiple chunks", () => {
			const parser = new ThinkTagStreamParser()
			let r = "", t = ""

			const chunks = ["<th", "inking", ">", "\nПоль", "зователь", " просит", "</thi", "nking>", "ответ"]
			for (const chunk of chunks) {
				const out = parser.process(chunk)
				r += out.reasoning
				t += out.text
			}

			expect(r).to.equal("\nПользователь просит")
			expect(t).to.equal("ответ")
		})

		it("should handle closing tag split: '</thi' + 'nk>'", () => {
			const parser = new ThinkTagStreamParser()
			let r = "", t = ""

			let out = parser.process("<think>plan")
			r += out.reasoning; t += out.text
			out = parser.process("</thi")
			r += out.reasoning; t += out.text
			out = parser.process("nk>")
			r += out.reasoning; t += out.text
			out = parser.process("text")
			r += out.reasoning; t += out.text

			expect(r).to.equal("plan")
			expect(t).to.equal("text")
		})

		it("should handle closing </thinking> split across chunks", () => {
			const parser = new ThinkTagStreamParser()
			let r = "", t = ""

			let out = parser.process("<thinking>analysis")
			r += out.reasoning; t += out.text
			out = parser.process("</think")
			r += out.reasoning; t += out.text
			out = parser.process("ing>")
			r += out.reasoning; t += out.text
			out = parser.process("answer")
			r += out.reasoning; t += out.text

			expect(r).to.equal("analysis")
			expect(t).to.equal("answer")
		})
	})

	describe("real-world Qwen3.5 streaming pattern", () => {
		it("should handle exact pattern from logs: '\\n\\n' + '<th' + 'inking' + '>' + content...", () => {
			const parser = new ThinkTagStreamParser()
			let r = "", t = ""

			const chunks = [
				"\n\n",
				"<th",
				"inking",
				">",
				"\n",
				"П",
				"оль",
				"зов",
				"атель",
				" прос",
				"ит",
				" изменить",
				"</thinking>",
				"\n\n",
				"<replace_in_file>",
			]

			for (const chunk of chunks) {
				const out = parser.process(chunk)
				r += out.reasoning
				t += out.text
			}

			expect(r).to.equal("\nПользователь просит изменить")
			expect(t).to.equal("\n\n\n\n<replace_in_file>")
		})
	})

	describe("startInThinkBlock mode", () => {
		it("should treat initial content as reasoning when startInThinkBlock=true", () => {
			const parser = new ThinkTagStreamParser(true)
			const result = parser.process("already thinking</think>visible")
			expect(result.reasoning).to.equal("already thinking")
			expect(result.text).to.equal("visible")
		})

		it("should work with </thinking> close when startInThinkBlock=true", () => {
			const parser = new ThinkTagStreamParser(true)
			const result = parser.process("already thinking</thinking>visible")
			expect(result.reasoning).to.equal("already thinking")
			expect(result.text).to.equal("visible")
		})
	})

	describe("edge cases", () => {
		it("should return empty reasoning and text for empty input", () => {
			const parser = new ThinkTagStreamParser()
			const result = parser.process("")
			expect(result.reasoning).to.equal("")
			expect(result.text).to.equal("")
		})

		it("should handle text with no think tags", () => {
			const parser = new ThinkTagStreamParser()
			const result = parser.process("just plain text")
			expect(result.reasoning).to.equal("")
			expect(result.text).to.equal("just plain text")
		})

		it("should handle empty think block", () => {
			const parser = new ThinkTagStreamParser()
			const result = parser.process("<think></think>text after")
			expect(result.reasoning).to.equal("")
			expect(result.text).to.equal("text after")
		})

		it("should handle empty thinking block", () => {
			const parser = new ThinkTagStreamParser()
			const result = parser.process("<thinking></thinking>text after")
			expect(result.reasoning).to.equal("")
			expect(result.text).to.equal("text after")
		})

		it("should not confuse <th with other tags like <thead>", () => {
			const parser = new ThinkTagStreamParser()
			let r = "", t = ""

			let out = parser.process("<th")
			r += out.reasoning; t += out.text
			out = parser.process("ead>")
			r += out.reasoning; t += out.text

			expect(r).to.equal("")
			// Parser might buffer <th waiting for ink/inking — acceptable
		})

		it("should handle mixed <think> and <thinking> across calls", () => {
			const parser = new ThinkTagStreamParser()
			let r = "", t = ""

			let out = parser.process("<think>first</think>")
			r += out.reasoning; t += out.text
			out = parser.process("between")
			r += out.reasoning; t += out.text
			out = parser.process("<thinking>second</thinking>")
			r += out.reasoning; t += out.text
			out = parser.process("end")
			r += out.reasoning; t += out.text

			expect(r).to.equal("firstsecond")
			expect(t).to.equal("betweenend")
		})

		it("should handle cyrillic content in reasoning", () => {
			const parser = new ThinkTagStreamParser()
			const result = parser.process("<thinking>Нужно проанализировать код</thinking>Готово")
			expect(result.reasoning).to.equal("Нужно проанализировать код")
			expect(result.text).to.equal("Готово")
		})
	})
})
