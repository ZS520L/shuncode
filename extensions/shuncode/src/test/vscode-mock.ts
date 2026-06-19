// Mock implementation of VSCode API for unit tests

// ==================== Core types ====================

export class Position {
	constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
	constructor(
		public readonly start: Position | number,
		public readonly end: Position | number,
		endChar?: number
	) {
		if (typeof start === 'number') {
			this.start = new Position(start, end as number)
			this.end = new Position(endChar ?? start, 0)
		}
	}
}

export class Selection extends Range {
	public active: Position
	constructor(anchor: Position, active: Position) {
		super(anchor, active)
		this.active = active
	}
}

export enum EndOfLine {
	LF = 1,
	CRLF = 2,
}

export enum OverviewRulerLane {
	Left = 1,
	Center = 2,
	Right = 4,
	Full = 7,
}

export enum TextEditorRevealType {
	Default = 0,
	InCenter = 1,
	InCenterIfOutsideViewport = 2,
	AtTop = 3,
}

// ==================== WorkspaceEdit ====================

export class WorkspaceEdit {
	private _edits: Array<{ uri: any; range: Range; newText: string }> = []

	replace(uri: any, range: Range, newText: string): void {
		this._edits.push({ uri, range, newText })
	}

	get edits() { return this._edits }
}

// ==================== EventEmitter ====================

export class EventEmitter<T> {
	private _listeners: Array<(e: T) => void> = []

	event = (listener: (e: T) => void) => {
		this._listeners.push(listener)
		return { dispose: () => {
			const idx = this._listeners.indexOf(listener)
			if (idx >= 0) this._listeners.splice(idx, 1)
		}}
	}

	fire(data: T): void {
		for (const listener of this._listeners) {
			listener(data)
		}
	}

	dispose(): void {
		this._listeners = []
	}
}

// ==================== Env ====================

export const env = {
	machineId: "test-machine-id",
	isTelemetryEnabled: true,
	onDidChangeTelemetryEnabled: (_callback: (enabled: boolean) => void) => {
		return { dispose: () => {} }
	},
}

// ==================== Workspace ====================

/** In-memory document store for tests. Tests can add documents via _addDocument(). */
const _documents: Map<string, { content: string; eol: EndOfLine }> = new Map()

export function _addDocument(fsPath: string, content: string, eol: EndOfLine = EndOfLine.LF): void {
	_documents.set(fsPath.toLowerCase(), { content, eol })
}

export function _getDocumentContent(fsPath: string): string | undefined {
	return _documents.get(fsPath.toLowerCase())?.content
}

export function _clearDocuments(): void {
	_documents.clear()
}

function _makeTextDocument(fsPath: string) {
	const entry = _documents.get(fsPath.toLowerCase())
	const content = entry?.content ?? ''
	const eol = entry?.eol ?? EndOfLine.LF
	const lines = content.split('\n')

	return {
		uri: Uri.file(fsPath),
		getText: () => content,
		lineCount: lines.length,
		lineAt: (line: number) => {
			const text = lines[line] ?? ''
			return {
				text,
				range: new Range(new Position(line, 0), new Position(line, text.length)),
				rangeIncludingLineBreak: new Range(new Position(line, 0), new Position(line + 1, 0)),
			}
		},
		eol,
		isDirty: false,
		save: async () => true,
		positionAt: (offset: number) => {
			let line = 0; let char = 0
			for (let i = 0; i < offset && i < content.length; i++) {
				if (content[i] === '\n') { line++; char = 0 } else { char++ }
			}
			return new Position(line, char)
		},
	}
}

const _configOverrides: Record<string, any> = {}

export function _setConfigOverride(section: string, key: string, value: any) {
	_configOverrides[`${section}.${key}`] = value
}

export function _clearConfigOverrides() {
	for (const k of Object.keys(_configOverrides)) delete _configOverrides[k]
}

export const workspace = {
	getConfiguration: (section?: string) => ({
		get: (key: string, defaultValue?: any) => {
			const fullKey = `${section}.${key}`
			if (fullKey in _configOverrides) return _configOverrides[fullKey]
			if (section === "shuncode" && key === "telemetrySetting") return "enabled"
			if (section === "telemetry" && key === "telemetryLevel") return "all"
			return defaultValue
		},
	}),
	openTextDocument: async (uriOrPath: any) => {
		const fsPath = typeof uriOrPath === 'string' ? uriOrPath : (uriOrPath?.fsPath ?? uriOrPath)
		// If document registered in mock store → return it.
		// If not registered → return empty document (backward compat with old tests).
		// HunkApplier.readFile has its own fs.existsSync fallback for real "not found" errors.
		return _makeTextDocument(fsPath)
	},
	applyEdit: async (_edit: WorkspaceEdit) => {
		for (const edit of (_edit as any)._edits || []) {
			const key = (edit.uri?.fsPath ?? '').toLowerCase()
			const entry = _documents.get(key)
			if (entry) {
				const start = edit.range.start as Position
				const end = edit.range.end as Position

				// Full-range replacement: positionAt(0) → positionAt(length)
				// HunkApplier.writeFile uses this to replace entire content
				const lines = entry.content.split('\n')
				const isFullRange = start.line === 0 && start.character === 0 &&
					(end.line >= lines.length - 1 ||
					 (end.line === lines.length - 1 && end.character >= lines[end.line].length))

				if (isFullRange) {
					entry.content = edit.newText
				} else {
					// Partial range replacement (line-based)
					const newLines = edit.newText ? edit.newText.split('\n') : ['']
					if (newLines.length > 1 && newLines[newLines.length - 1] === '') {
						newLines.pop()
					}
					lines.splice(start.line, end.line - start.line, ...newLines)
					entry.content = lines.join('\n')
				}
			}
		}
		return true
	},
	get textDocuments() {
		// Return mock TextDocuments for all registered in-memory documents
		const docs: any[] = []
		for (const [key] of _documents) {
			docs.push(_makeTextDocument(key))
		}
		return docs
	},
	onDidChangeTextDocument: (_callback: any) => ({ dispose: () => {} }),
	fs: {
		createDirectory: async (_uri: any) => {},
		writeFile: async (_uri: any, _content: Uint8Array) => {},
		delete: async (_uri: any) => {},
	},
}

// ==================== Window ====================

export const window = {
	showErrorMessage: (_message: string) => Promise.resolve(),
	showWarningMessage: (_message: string) => Promise.resolve(),
	showInformationMessage: (_message: string) => Promise.resolve(),
	createTextEditorDecorationType: (_options: any) => ({
		key: "mock-decoration-type",
		dispose: () => {},
	}),
	visibleTextEditors: [] as any[],
	activeTextEditor: undefined as any,
	showTextDocument: async (doc: any) => ({
		document: doc,
		selection: new Selection(new Position(0, 0), new Position(0, 0)),
		revealRange: () => {},
		setDecorations: () => {},
	}),
	onDidChangeVisibleTextEditors: (_callback: any) => ({ dispose: () => {} }),
	createWebviewTextEditorInset: (_editor: any, _line: number, _height: number, _options?: any) => ({
		webview: { html: '', onDidReceiveMessage: (_cb: any) => ({ dispose: () => {} }) },
		onDidDispose: (_cb: any) => ({ dispose: () => {} }),
		dispose: () => {},
	}),
}

// ==================== Commands ====================

export const commands = {
	executeCommand: (_command: string, ..._args: any[]) => Promise.resolve(),
	registerCommand: (_command: string, _callback: (...args: any[]) => any) => ({ dispose: () => {} }),
}

// ==================== Uri ====================

export const Uri = {
	file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }),
	parse: (uri: string) => ({ fsPath: uri, toString: () => uri }),
}

// ==================== WebviewEditorInset ====================

export interface WebviewEditorInset {
	readonly webview: { html: string; onDidReceiveMessage: (cb: any) => { dispose: () => void } }
	readonly onDidDispose: (cb: any) => { dispose: () => void }
	dispose(): void
}

// ==================== Exports ====================

export const ExtensionContextMock = {}
export const StatusBarAlignmentMock = { Left: 1, Right: 2 }
export const ViewColumnMock = { One: 1, Two: 2, Three: 3 }
