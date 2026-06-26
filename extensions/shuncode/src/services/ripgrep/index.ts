import { ShuncodeIgnoreController } from "@core/ignore/ShuncodeIgnoreController"
import * as childProcess from "child_process"
import * as path from "path"
import * as readline from "readline"
import { Logger } from "@/shared/services/Logger"
import { getBinaryLocation } from "@/utils/fs"

/*
This file provides functionality to perform regex searches on files using ripgrep.
Inspired by: https://github.com/DiscreteTom/vscode-ripgrep-utils

Key components:
* execRipgrep: Executes the ripgrep command and returns the output.
* regexSearchFiles: The main function that performs regex searches on files.
   - Parameters:
	 * cwd: The current working directory (for relative path calculation)
	 * directoryPath: The directory to search in
	 * regex: The regular expression to search for (Rust regex syntax)
	 * filePattern: Optional glob pattern to filter files (default: '*')
   - Returns: A formatted string containing search results with context

The search results include:
- Relative file paths
- 2 lines of context before and after each match
- Matches formatted with pipe characters for easy reading

Usage example:
const results = await regexSearchFiles('/path/to/cwd', '/path/to/search', 'TODO:', '*.ts');

rel/path/to/app.ts
│----
│function processData(data: any) {
│  // Some processing logic here
│  // TODO: Implement error handling
│  return processedData;
│}
│----

rel/path/to/helper.ts
│----
│  let result = 0;
│  for (let i = 0; i < input; i++) {
│    // TODO: Optimize this function for performance
│    result += Math.pow(i, 2);
│  }
│----
*/

interface SearchResult {
	filePath: string
	line: number
	column: number
	match: string
	beforeContext: string[]
	afterContext: string[]
}

const MAX_RESULTS = 300
const RG_MAX_COUNT = 500
const RG_THREADS = 4
const RG_TIMEOUT_MS = 15_000

function isLikelyLiteralPattern(pattern: string): boolean {
	// Treat patterns without common regex metacharacters as literals
	return !/[\\^$.|?*+()[\]{}]/.test(pattern)
}

async function execRipgrep(args: string[]): Promise<string> {
	const binPath: string = await getBinaryLocation("rg")

	return new Promise((resolve, reject) => {
		const rgProcess = childProcess.spawn(binPath, args)
		let settled = false
		// cross-platform alternative to head, which is ripgrep author's recommendation for limiting output.
		const rl = readline.createInterface({
			input: rgProcess.stdout,
			crlfDelay: Infinity, // treat \r\n as a single line break even if it's split across chunks. This ensures consistent behavior across different operating systems.
		})

		let output = ""
		let lineCount = 0
		const maxLines = MAX_RESULTS * 5 // limiting ripgrep output with max lines since there's no other way to limit results. it's okay that we're outputting as json, since we're parsing it line by line and ignore anything that's not part of a match. This assumes each result is at most 5 lines.

		rl.on("line", (line) => {
			if (lineCount < maxLines) {
				output += line + "\n"
				lineCount++
			} else {
				rl.close()
				rgProcess.kill()
			}
		})

		let errorOutput = ""
		rgProcess.stderr.on("data", (data) => {
			errorOutput += data.toString()
		})
		const timeout = setTimeout(() => {
			if (settled) return
			settled = true
			rl.close()
			rgProcess.kill()
			reject(new Error(`ripgrep timed out after ${RG_TIMEOUT_MS}ms`))
		}, RG_TIMEOUT_MS)
		rl.on("close", () => {
			if (settled) return
			settled = true
			clearTimeout(timeout)
			if (errorOutput) {
				reject(new Error(`ripgrep process error: ${errorOutput}`))
			} else {
				resolve(output)
			}
		})
		rgProcess.on("error", (error) => {
			if (settled) return
			settled = true
			clearTimeout(timeout)
			reject(new Error(`ripgrep process error: ${error.message}`))
		})
	})
}

export async function regexSearchFiles(
	cwd: string,
	directoryPath: string,
	regex: string,
	filePattern?: string,
	shuncodeIgnoreController?: ShuncodeIgnoreController,
): Promise<string> {
	const args = [
		"--json",
		"--max-count",
		String(RG_MAX_COUNT),
		"--threads",
		String(RG_THREADS),
		"-e",
		regex,
		"--glob",
		filePattern || "*",
		"--context",
		"1",
		directoryPath,
	]
	if (isLikelyLiteralPattern(regex)) {
		args.unshift("--fixed-strings")
	}

	let output: string
	try {
		output = await execRipgrep(args)
	} catch (error) {
		throw Error("Error calling ripgrep", { cause: error })
	}
	const results: SearchResult[] = []
	let currentResult: Partial<SearchResult> | null = null

	output.split("\n").forEach((line) => {
		if (line) {
			try {
				const parsed = JSON.parse(line)
				if (parsed.type === "match") {
					if (currentResult) {
						results.push(currentResult as SearchResult)
					}
					currentResult = {
						filePath: parsed.data.path.text,
						line: parsed.data.line_number,
						column: parsed.data.submatches[0].start,
						match: parsed.data.lines.text,
						beforeContext: [],
						afterContext: [],
					}
				} else if (parsed.type === "context" && currentResult) {
					if (parsed.data.line_number < currentResult.line!) {
						currentResult.beforeContext!.push(parsed.data.lines.text)
					} else {
						currentResult.afterContext!.push(parsed.data.lines.text)
					}
				}
			} catch (error) {
				Logger.error("Error parsing ripgrep output:", error)
			}
		}
	})

	if (currentResult) {
		results.push(currentResult as SearchResult)
	}

	// Filter results using ShuncodeIgnoreController if provided
	const filteredResults = shuncodeIgnoreController
		? results.filter((result) => shuncodeIgnoreController.validateAccess(result.filePath))
		: results

	return formatResults(filteredResults, cwd)
}

const MAX_RIPGREP_MB = 0.25
const MAX_BYTE_SIZE = MAX_RIPGREP_MB * 1024 * 1024 // 0./25MB in bytes
const TOP_K_FILES = 10 // Show full context for top-K files, then collapse
const COLLAPSE_THRESHOLD = 50 // Start collapsing if total results exceed this

function formatResults(results: SearchResult[], cwd: string): string {
	const groupedResults: { [key: string]: SearchResult[] } = {}

	// Group results by file name
	results.slice(0, MAX_RESULTS).forEach((result) => {
		const relativeFilePath = path.relative(cwd, result.filePath)
		if (!groupedResults[relativeFilePath]) {
			groupedResults[relativeFilePath] = []
		}
		groupedResults[relativeFilePath].push(result)
	})

	const totalResults = Math.min(results.length, MAX_RESULTS)
	const fileCount = Object.keys(groupedResults).length

	// Structured summary header
	let output = ""
	if (results.length >= MAX_RESULTS) {
		output += `<search_results total="${MAX_RESULTS}+" files="${fileCount}" truncated="true">\n`
	} else {
		output += `<search_results total="${totalResults}" files="${fileCount}">\n`
	}

	// Track byte size
	let byteSize = Buffer.byteLength(output, "utf8")
	let wasLimitReached = false

	// Sort files by match count (most relevant first)
	const sortedFiles = Object.entries(groupedResults).sort((a, b) => b[1].length - a[1].length)

	// Decide display mode: full vs collapsed
	const shouldCollapse = totalResults > COLLAPSE_THRESHOLD && fileCount > TOP_K_FILES
	const fullDisplayFiles = shouldCollapse ? sortedFiles.slice(0, TOP_K_FILES) : sortedFiles
	const collapsedFiles = shouldCollapse ? sortedFiles.slice(TOP_K_FILES) : []

	// Full display for top-K files
	for (const [filePath, fileResults] of fullDisplayFiles) {
		// Check if adding this file's path would exceed the byte limit
		const filePathString = `${filePath.toPosix()} (${fileResults.length} match${fileResults.length > 1 ? "es" : ""})\n\u2502----\n`
		const filePathBytes = Buffer.byteLength(filePathString, "utf8")

		if (byteSize + filePathBytes >= MAX_BYTE_SIZE) {
			wasLimitReached = true
			break
		}

		output += filePathString
		byteSize += filePathBytes

		for (let resultIndex = 0; resultIndex < fileResults.length; resultIndex++) {
			const result = fileResults[resultIndex]
			const allLines = [...result.beforeContext, result.match, ...result.afterContext]

			// Calculate bytes in all lines for this result
			let resultBytes = 0
			const resultLines: string[] = []

			for (const line of allLines) {
				const trimmedLine = line?.trimEnd() ?? ""
				const lineString = `\u2502${trimmedLine}\n`
				const lineBytes = Buffer.byteLength(lineString, "utf8")

				// Check if adding this line would exceed the byte limit
				if (byteSize + resultBytes + lineBytes >= MAX_BYTE_SIZE) {
					wasLimitReached = true
					break
				}

				resultLines.push(lineString)
				resultBytes += lineBytes
			}

			// If we hit the limit in the middle of processing lines, break out of the result loop
			if (wasLimitReached) {
				break
			}

			// Add all lines for this result to the output
			resultLines.forEach((line) => {
				output += line
			})
			byteSize += resultBytes

			// Add separator between results if needed
			if (resultIndex < fileResults.length - 1) {
				const separatorString = "\u2502----\n"
				const separatorBytes = Buffer.byteLength(separatorString, "utf8")

				if (byteSize + separatorBytes >= MAX_BYTE_SIZE) {
					wasLimitReached = true
					break
				}

				output += separatorString
				byteSize += separatorBytes
			}

			// Check if we've hit the byte limit
			if (byteSize >= MAX_BYTE_SIZE) {
				wasLimitReached = true
				break
			}
		}

		// If we hit the limit, break out of the file loop
		if (wasLimitReached) {
			break
		}

		const closingString = "\u2502----\n\n"
		const closingBytes = Buffer.byteLength(closingString, "utf8")

		if (byteSize + closingBytes >= MAX_BYTE_SIZE) {
			wasLimitReached = true
			break
		}

		output += closingString
		byteSize += closingBytes
	}

	// Collapsed files: just show path + match count (one line each)
	if (collapsedFiles.length > 0 && !wasLimitReached) {
		const collapsedHeader = `\n--- ${collapsedFiles.length} additional files (collapsed) ---\n`
		const collapsedHeaderBytes = Buffer.byteLength(collapsedHeader, "utf8")
		if (byteSize + collapsedHeaderBytes < MAX_BYTE_SIZE) {
			output += collapsedHeader
			byteSize += collapsedHeaderBytes

			for (const [filePath, fileResults] of collapsedFiles) {
				const line = `  ${filePath.toPosix()} (${fileResults.length})\n`
				const lineBytes = Buffer.byteLength(line, "utf8")
				if (byteSize + lineBytes >= MAX_BYTE_SIZE) {
					wasLimitReached = true
					break
				}
				output += line
				byteSize += lineBytes
			}
		}
	}

	// Add narrowing hints and closing tag
	let footer = ""
	if (wasLimitReached || results.length >= MAX_RESULTS) {
		footer += `\n[Results truncated. To narrow: use file_pattern (e.g. "*.ts") or a more specific regex.]`
	}
	footer += "\n</search_results>"

	if (byteSize + Buffer.byteLength(footer, "utf8") < MAX_BYTE_SIZE + 200) {
		output += footer
	}

	return output.trim()
}
