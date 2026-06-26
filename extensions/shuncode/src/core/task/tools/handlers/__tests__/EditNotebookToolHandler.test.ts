import { describe, it, beforeEach } from "mocha"
import should from "should"

/**
 * Tests for EditNotebookToolHandler's notebook manipulation logic.
 *
 * Since the handler directly operates on JSON (notebook structure),
 * we test the core logic by extracting and exercising the pure functions
 * and simulating the notebook editing operations without VS Code dependencies.
 */

// ==================== Notebook helpers (mirror handler internals) ====================

interface NotebookCell {
	cell_type: "code" | "markdown" | "raw"
	source: string[]
	metadata: Record<string, unknown>
	execution_count?: number | null
	outputs?: unknown[]
}

interface NotebookJSON {
	nbformat: number
	nbformat_minor: number
	metadata: Record<string, unknown>
	cells: NotebookCell[]
}

function languageToCellType(lang: string): "code" | "markdown" | "raw" {
	const lower = lang.toLowerCase().trim()
	if (lower === "markdown") return "markdown"
	if (lower === "raw") return "raw"
	return "code"
}

function sourceToLines(text: string): string[] {
	return text.split("\n").map((line, i, arr) => (i < arr.length - 1 ? line + "\n" : line))
}

function createEmptyNotebook(lang: string = "python"): NotebookJSON {
	return {
		nbformat: 4,
		nbformat_minor: 5,
		metadata: {},
		cells: [],
	}
}

function createSampleNotebook(): NotebookJSON {
	return {
		nbformat: 4,
		nbformat_minor: 5,
		metadata: {
			kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
		},
		cells: [
			{
				cell_type: "markdown",
				source: ["# My Notebook\n", "This is a test notebook."],
				metadata: {},
			},
			{
				cell_type: "code",
				source: ["import numpy as np\n", "\n", "x = np.array([1, 2, 3])"],
				metadata: {},
				execution_count: null,
				outputs: [],
			},
			{
				cell_type: "code",
				source: ["print(x)"],
				metadata: {},
				execution_count: 1,
				outputs: [],
			},
		],
	}
}

/**
 * Simulates inserting a new cell into a notebook (mirrors handler logic).
 */
function insertCell(
	notebook: NotebookJSON,
	cellIdx: number,
	cellLanguage: string,
	newString: string,
): { notebook: NotebookJSON; insertedAt: number } {
	const insertIdx = Math.min(cellIdx, notebook.cells.length)
	const cellType = languageToCellType(cellLanguage)
	const newCell: NotebookCell = {
		cell_type: cellType,
		source: sourceToLines(newString),
		metadata: {},
	}
	if (cellType === "code") {
		newCell.execution_count = null
		newCell.outputs = []
	}
	notebook.cells.splice(insertIdx, 0, newCell)
	return { notebook, insertedAt: insertIdx }
}

/**
 * Simulates editing a cell via search & replace (mirrors handler logic).
 */
function editCell(
	notebook: NotebookJSON,
	cellIdx: number,
	oldString: string,
	newString: string,
	cellLanguage: string,
): { error?: string; notebook: NotebookJSON } {
	if (cellIdx >= notebook.cells.length) {
		return {
			error: `Cell index ${cellIdx} is out of range. The notebook has ${notebook.cells.length} cells.`,
			notebook,
		}
	}

	const cell = notebook.cells[cellIdx]
	const cellSource = Array.isArray(cell.source) ? cell.source.join("") : String(cell.source)

	const matchIndex = cellSource.indexOf(oldString)
	if (matchIndex === -1) {
		return { error: `old_string not found in cell ${cellIdx}`, notebook }
	}

	const newSource = cellSource.substring(0, matchIndex) + newString + cellSource.substring(matchIndex + oldString.length)
	cell.source = sourceToLines(newSource)

	const newCellType = languageToCellType(cellLanguage)
	if (cell.cell_type !== newCellType) {
		cell.cell_type = newCellType
		if (newCellType === "code" && !cell.outputs) {
			cell.outputs = []
			cell.execution_count = null
		}
	}

	return { notebook }
}

// ==================== Tests ====================

describe("EditNotebookToolHandler", () => {
	// ==================== languageToCellType ====================

	describe("languageToCellType", () => {
		it("should map 'python' to 'code'", () => {
			languageToCellType("python").should.equal("code")
		})

		it("should map 'markdown' to 'markdown'", () => {
			languageToCellType("markdown").should.equal("markdown")
		})

		it("should map 'raw' to 'raw'", () => {
			languageToCellType("raw").should.equal("raw")
		})

		it("should map 'javascript' to 'code'", () => {
			languageToCellType("javascript").should.equal("code")
		})

		it("should map 'typescript' to 'code'", () => {
			languageToCellType("typescript").should.equal("code")
		})

		it("should map 'r' to 'code'", () => {
			languageToCellType("r").should.equal("code")
		})

		it("should map 'sql' to 'code'", () => {
			languageToCellType("sql").should.equal("code")
		})

		it("should map 'shell' to 'code'", () => {
			languageToCellType("shell").should.equal("code")
		})

		it("should map 'other' to 'code'", () => {
			languageToCellType("other").should.equal("code")
		})

		it("should be case-insensitive", () => {
			languageToCellType("MARKDOWN").should.equal("markdown")
			languageToCellType("Python").should.equal("code")
			languageToCellType("RAW").should.equal("raw")
		})

		it("should trim whitespace", () => {
			languageToCellType("  markdown  ").should.equal("markdown")
		})
	})

	// ==================== sourceToLines ====================

	describe("sourceToLines", () => {
		it("should split single line without trailing newline", () => {
			const lines = sourceToLines("hello")
			lines.should.deepEqual(["hello"])
		})

		it("should add newlines to all lines except last", () => {
			const lines = sourceToLines("line1\nline2\nline3")
			lines.should.deepEqual(["line1\n", "line2\n", "line3"])
		})

		it("should handle empty string", () => {
			const lines = sourceToLines("")
			lines.should.deepEqual([""])
		})

		it("should handle single newline", () => {
			const lines = sourceToLines("\n")
			lines.should.deepEqual(["\n", ""])
		})

		it("should handle multi-line code", () => {
			const code = "import os\n\ndef main():\n    print('hello')"
			const lines = sourceToLines(code)
			lines.length.should.equal(4)
			lines[0].should.equal("import os\n")
			lines[1].should.equal("\n")
			lines[2].should.equal("def main():\n")
			lines[3].should.equal("    print('hello')")
		})
	})

	// ==================== Insert cell ====================

	describe("insertCell", () => {
		let notebook: NotebookJSON

		beforeEach(() => {
			notebook = createSampleNotebook()
		})

		it("should insert a code cell at index 0", () => {
			const { notebook: nb, insertedAt } = insertCell(notebook, 0, "python", "x = 1")
			insertedAt.should.equal(0)
			nb.cells.length.should.equal(4) // was 3
			nb.cells[0].cell_type.should.equal("code")
			nb.cells[0].source.should.deepEqual(["x = 1"])
			should(nb.cells[0].execution_count).be.null()
			nb.cells[0].outputs!.should.deepEqual([])
		})

		it("should insert a markdown cell", () => {
			const { notebook: nb } = insertCell(notebook, 0, "markdown", "# Title")
			nb.cells[0].cell_type.should.equal("markdown")
			nb.cells[0].source.should.deepEqual(["# Title"])
			// Markdown cells should NOT have execution_count/outputs
			should(nb.cells[0].execution_count).be.undefined()
		})

		it("should clamp index to end if out of range", () => {
			const { insertedAt } = insertCell(notebook, 999, "python", "code")
			insertedAt.should.equal(3) // clamped to length
		})

		it("should insert at the end", () => {
			const { notebook: nb, insertedAt } = insertCell(notebook, 3, "python", "last cell")
			insertedAt.should.equal(3)
			nb.cells.length.should.equal(4)
			nb.cells[3].source.should.deepEqual(["last cell"])
		})

		it("should insert into empty notebook", () => {
			const empty = createEmptyNotebook()
			const { notebook: nb, insertedAt } = insertCell(empty, 0, "python", "first cell")
			insertedAt.should.equal(0)
			nb.cells.length.should.equal(1)
		})

		it("should handle multi-line content", () => {
			const content = "import numpy as np\nx = np.zeros(10)\nprint(x)"
			const { notebook: nb } = insertCell(notebook, 1, "python", content)
			nb.cells[1].source.length.should.equal(3)
			nb.cells[1].source[0].should.equal("import numpy as np\n")
			nb.cells[1].source[1].should.equal("x = np.zeros(10)\n")
			nb.cells[1].source[2].should.equal("print(x)")
		})

		it("should insert raw cell", () => {
			const { notebook: nb } = insertCell(notebook, 0, "raw", "raw text")
			nb.cells[0].cell_type.should.equal("raw")
		})
	})

	// ==================== Edit cell ====================

	describe("editCell", () => {
		let notebook: NotebookJSON

		beforeEach(() => {
			notebook = createSampleNotebook()
		})

		it("should replace text in a code cell", () => {
			const result = editCell(notebook, 1, "np.array([1, 2, 3])", "np.zeros(10)", "python")
			should(result.error).be.undefined()
			const source = result.notebook.cells[1].source.join("")
			source.should.containEql("np.zeros(10)")
			source.should.not.containEql("np.array([1, 2, 3])")
		})

		it("should replace text in a markdown cell", () => {
			const result = editCell(notebook, 0, "test notebook", "production notebook", "markdown")
			should(result.error).be.undefined()
			const source = result.notebook.cells[0].source.join("")
			source.should.containEql("production notebook")
		})

		it("should return error for out-of-range index", () => {
			const result = editCell(notebook, 5, "anything", "new", "python")
			result.error!.should.containEql("out of range")
		})

		it("should return error when old_string not found", () => {
			const result = editCell(notebook, 1, "THIS_DOES_NOT_EXIST", "new", "python")
			result.error!.should.containEql("not found")
		})

		it("should replace only the first occurrence", () => {
			// Create a cell with duplicate text
			notebook.cells.push({
				cell_type: "code",
				source: ["x = 1\nx = 1\nx = 1"],
				metadata: {},
				execution_count: null,
				outputs: [],
			})
			const idx = notebook.cells.length - 1
			const result = editCell(notebook, idx, "x = 1", "x = 2", "python")
			should(result.error).be.undefined()
			const source = result.notebook.cells[idx].source.join("")
			// Should have exactly 2 occurrences of "x = 1" left (replaced only first)
			const matches = source.match(/x = 1/g)
			matches!.length.should.equal(2)
			source.should.containEql("x = 2")
		})

		it("should handle replacing entire cell content", () => {
			const fullContent = notebook.cells[2].source.join("")
			const result = editCell(notebook, 2, fullContent, "print('new content')", "python")
			should(result.error).be.undefined()
			const newSource = result.notebook.cells[2].source.join("")
			newSource.should.equal("print('new content')")
		})

		it("should handle replacing with empty string (deletion)", () => {
			const result = editCell(notebook, 2, "print(x)", "", "python")
			should(result.error).be.undefined()
			const source = result.notebook.cells[2].source.join("")
			source.should.equal("")
		})

		it("should change cell_type when language changes", () => {
			notebook.cells[1].cell_type.should.equal("code")
			const result = editCell(notebook, 1, "import numpy as np", "import numpy as np", "markdown")
			should(result.error).be.undefined()
			result.notebook.cells[1].cell_type.should.equal("markdown")
		})

		it("should preserve execution_count for code cells", () => {
			notebook.cells[2].execution_count = 5
			const result = editCell(notebook, 2, "print(x)", "print(y)", "python")
			should(result.error).be.undefined()
			// execution_count is preserved (handler doesn't reset it)
			result.notebook.cells[2].execution_count!.should.equal(5)
		})

		it("should handle cell source as joined string with newlines", () => {
			// Cell 1 has source: ["import numpy as np\n", "\n", "x = np.array([1, 2, 3])"]
			// The joined source should contain the multi-line content
			const result = editCell(
				notebook,
				1,
				"import numpy as np\n\nx = np.array([1, 2, 3])",
				"import pandas as pd\n\ndf = pd.DataFrame()",
				"python",
			)
			should(result.error).be.undefined()
			const source = result.notebook.cells[1].source.join("")
			source.should.containEql("import pandas as pd")
			source.should.containEql("df = pd.DataFrame()")
		})
	})

	// ==================== Notebook structure ====================

	describe("notebook structure", () => {
		it("should create a valid empty notebook", () => {
			const nb = createEmptyNotebook()
			nb.nbformat.should.equal(4)
			nb.nbformat_minor.should.equal(5)
			nb.cells.should.be.an.Array()
			nb.cells.length.should.equal(0)
		})

		it("should maintain valid JSON after insert", () => {
			const nb = createEmptyNotebook()
			insertCell(nb, 0, "python", "x = 1")
			const json = JSON.stringify(nb)
			const parsed = JSON.parse(json) as NotebookJSON
			parsed.cells.length.should.equal(1)
			parsed.cells[0].cell_type.should.equal("code")
		})

		it("should maintain valid JSON after edit", () => {
			const nb = createSampleNotebook()
			editCell(nb, 1, "np.array([1, 2, 3])", "np.zeros(5)", "python")
			const json = JSON.stringify(nb)
			const parsed = JSON.parse(json) as NotebookJSON
			parsed.cells.length.should.equal(3)
		})

		it("should preserve notebook metadata after edits", () => {
			const nb = createSampleNotebook()
			const originalMeta = JSON.stringify(nb.metadata)
			editCell(nb, 1, "np.array([1, 2, 3])", "np.zeros(5)", "python")
			JSON.stringify(nb.metadata).should.equal(originalMeta)
		})

		it("should preserve other cells when editing one", () => {
			const nb = createSampleNotebook()
			const cell0Before = JSON.stringify(nb.cells[0])
			const cell2Before = JSON.stringify(nb.cells[2])
			editCell(nb, 1, "np.array([1, 2, 3])", "np.zeros(5)", "python")
			JSON.stringify(nb.cells[0]).should.equal(cell0Before)
			JSON.stringify(nb.cells[2]).should.equal(cell2Before)
		})

		it("should shift existing cells when inserting", () => {
			const nb = createSampleNotebook()
			const originalCell0 = JSON.stringify(nb.cells[0])
			insertCell(nb, 0, "python", "new first cell")
			// Original cell 0 should now be at index 1
			JSON.stringify(nb.cells[1]).should.equal(originalCell0)
		})
	})

	// ==================== Edge cases ====================

	describe("edge cases", () => {
		it("should handle cell with empty source", () => {
			const nb = createSampleNotebook()
			nb.cells[1].source = [""]
			const result = editCell(nb, 1, "", "new content", "python")
			should(result.error).be.undefined()
			result.notebook.cells[1].source.join("").should.equal("new content")
		})

		it("should handle cell source that is a string instead of array", () => {
			const nb = createSampleNotebook()
			;(nb.cells[1] as any).source = "single string source"
			const result = editCell(nb, 1, "single string", "replaced", "python")
			should(result.error).be.undefined()
		})

		it("should handle unicode content", () => {
			const nb = createSampleNotebook()
			const result = editCell(nb, 0, "test notebook", "тестовый ноутбук 📓", "markdown")
			should(result.error).be.undefined()
			result.notebook.cells[0].source.join("").should.containEql("тестовый ноутбук 📓")
		})

		it("should handle content with special regex characters", () => {
			const nb = createEmptyNotebook()
			insertCell(nb, 0, "python", "result = re.match(r'\\d+\\.\\d+', text)")
			const source = nb.cells[0].source.join("")
			source.should.containEql("re.match")
		})

		it("should handle very long cell content", () => {
			const longContent = Array.from({ length: 1000 }, (_, i) => `line_${i} = ${i}`).join("\n")
			const nb = createEmptyNotebook()
			insertCell(nb, 0, "python", longContent)
			nb.cells[0].source.length.should.equal(1000)
		})
	})
})
