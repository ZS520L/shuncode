/**
 * DiffSystem v3 — Cursor-like diff system facade
 *
 * Single entry point for all diff operations.
 * Public API is backward-compatible with v2 callers (tool handlers, retry/delete).
 *
 * Internal architecture: DiffStore → Engine (HunkApplier/Reverter/PositionTracker) → UI (InlineDiffRenderer)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { t } from '../../i18n/backend-i18n';

// v3 types
import { Hunk, HunkType, FileChangeKind } from './storage/types';


// v3 storage
import { DiffStore } from './storage/DiffStore';
import { FileSnapshotStorage } from './storage/FileSnapshotStorage';

// v3 engine
import { SystemEditGuard } from './engine/SystemEditGuard';
import { PositionTracker } from './engine/PositionTracker';
import { HunkApplier } from './engine/HunkApplier';
import { HunkReverter } from './engine/HunkReverter';

// v3 UI
import { InlineDiffRenderer } from './ui/InlineDiffRenderer';
import { KeyboardNavigation } from './ui/KeyboardNavigation';

// Bridge to webview (PendingChangesBar)
import { getPendingChangesStorage } from './storage/PendingChangesStorage';

// Syntax validation
import { syntaxValidator, type ChangeValidationResult } from '@/services/tree-sitter/SyntaxValidator';

export class DiffSystem implements vscode.Disposable {
	// Storage
	private readonly store: DiffStore;
	private readonly snapshotStorage: FileSnapshotStorage;

	// Engine
	private readonly editGuard: SystemEditGuard;
	private readonly positionTracker: PositionTracker;
	private readonly hunkApplier: HunkApplier;
	private readonly hunkReverter: HunkReverter;

	// UI
	private readonly renderer: InlineDiffRenderer;
	private readonly keyboardNav: KeyboardNavigation;

	// State
	private initialized = false;
	private disposables: vscode.Disposable[] = [];
	private currentResponseGroupId: string | null = null;
	private currentTaskId: string | null = null;
	private readonly context: vscode.ExtensionContext;

	/**
	 * Loop detection: tracks consecutive overlap-reject cycles per file.
	 * Key: fsPath (lowercase), Value: count of consecutive auto-rejected overlaps.
	 * Reset when a hunk is applied without overlap, or on checkpoint start.
	 */
	private readonly overlapCycleCount = new Map<string, number>();
	private static readonly MAX_OVERLAP_CYCLES = 5;


	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		// Storage
		this.store = new DiffStore(context.workspaceState);
		this.snapshotStorage = new FileSnapshotStorage(context.globalStorageUri.fsPath);
		this.editGuard = new SystemEditGuard();

		// Engine
		this.positionTracker = new PositionTracker(this.store);
		this.hunkApplier = new HunkApplier(
			this.store,
			this.snapshotStorage,
			this.positionTracker,
			this.editGuard,
		);
		this.hunkReverter = new HunkReverter(
			this.store,
			this.snapshotStorage,
			this.positionTracker,
			this.editGuard,
		);

		// UI
		this.renderer = new InlineDiffRenderer();
		this.keyboardNav = new KeyboardNavigation(this.store);
	}

	// ==================== Lifecycle ====================

	async initialize(clearOnStartup: boolean = false): Promise<void> {
		if (this.initialized) return;

		await this.snapshotStorage.initialize();

		// Ensure PendingChangesStorage is ready before we use it
		getPendingChangesStorage().initialize(this.context);

		if (clearOnStartup) {
			console.log('[DiffSystem] DEV MODE: Clearing old pending diffs on startup');
			this.store.clearAll();
			await getPendingChangesStorage().clear();
		}

		// Clean up orphaned ResponseGroups from previous sessions
		// (active RGs with no pending hunks = stale leftovers that pollute rollback queries)
		this.store.cleanupOrphanedResponseGroups();

		// Wire reactive UI to store
		this.renderer.initialize(this.store);

		// Bridge: sync DiffStore → PendingChangesStorage → webview
		this.syncStoreToWebview();

		// Register Accept/Reject commands
		this.registerCommands();

		// Register keyboard navigation
		this.keyboardNav.registerCommands();

		// Listen for manual edits: update existing hunks when user edits inside them
		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument(async (e) => {
				if (this.editGuard.isSystemEdit()) return;

				const editor = vscode.window.activeTextEditor;
				if (!editor || editor.document !== e.document) return;

				const fsPath = editor.document.uri.fsPath;
				if (!this.store.hasPendingChangesForFile(fsPath)) return;

				await this.handleManualEdit(fsPath, e.contentChanges);
			}),
		);

		// Restore View Zones for visible editors on startup
		if (!clearOnStartup) {
			const editors = vscode.window.visibleTextEditors;
			for (const editor of editors) {
				const hunks = this.store.getPendingHunksByFile(editor.document.uri.fsPath);
				for (const hunk of hunks) {
					await this.renderer.createZonesForHunk(editor, hunk);
				}
			}
		}

		// Restore View Zones when editor tabs become visible (e.g. tab switch, reopen)
		this.disposables.push(
			vscode.window.onDidChangeVisibleTextEditors(async (editors) => {
				for (const editor of editors) {
					const fsPath = editor.document.uri.fsPath;
					const hunks = this.store.getPendingHunksByFile(fsPath);
					for (const hunk of hunks) {
						if (!this.renderer.hasZonesFor(hunk.id)) {
							await this.renderer.createZonesForHunk(editor, hunk);
						}
					}
				}
			}),
		);

		// Set initial context for keybindings
		this.updatePendingContext();

		this.initialized = true;
		console.log('[DiffSystem] Initialized (v3 architecture)');
	}

	/**
	 * Syncs DiffStore events to PendingChangesStorage so the webview
	 * PendingChangesBar stays up to date.
	 */
	private syncStoreToWebview(): void {
		const pending = getPendingChangesStorage();

		this.disposables.push(
			this.store.onDidChange(async (event) => {
				switch (event.type) {
					case 'hunkAdded': {
						const h = event.hunk;
						await pending.add({
							id: h.id,
							fsPath: h.fsPath,
							lineNumber: h.currentStartLine,
							removedLines: h.removedLines,
							addedLines: h.addedLines,
							timestamp: Date.now(),
							checkpointId: h.responseGroupId,
						});
						break;
					}
					case 'hunkUpdated': {
						// Remove old entry, add updated one
						const h = event.hunk;
						await pending.remove(h.id);
						await pending.add({
							id: h.id,
							fsPath: h.fsPath,
							lineNumber: h.currentStartLine,
							removedLines: h.removedLines,
							addedLines: h.addedLines,
							timestamp: Date.now(),
							checkpointId: h.responseGroupId,
						});
						break;
					}
					case 'hunkRemoved':
						await pending.remove(event.hunkId);
						break;
					case 'cleared':
						await pending.clear();
						break;
					// hunkPositionChanged — не критично для бара
				}

				// Update context for keybindings (when clause)
				this.updatePendingContext();
			}),
		);
	}

	private _pendingContextScheduled = false;

	/**
	 * Update VS Code context key 'shuncode.hasPendingHunks' for keybinding when-clauses.
	 * Coalesced via queueMicrotask to avoid N setContext calls during a batch.
	 */
	private updatePendingContext(): void {
		if (this._pendingContextScheduled) return;
		this._pendingContextScheduled = true;
		queueMicrotask(() => {
			this._pendingContextScheduled = false;
			const hasPending = this.store.getPendingCount() > 0;
			vscode.commands.executeCommand('setContext', 'shuncode.hasPendingHunks', hasPending);
		});
	}

	private registerCommands(): void {
		this.disposables.push(
			vscode.commands.registerCommand('shuncode.diff.accept', async (pendingId: string) => {
				await this.acceptChange(pendingId);
			}),
			vscode.commands.registerCommand('shuncode.diff.reject', async (pendingId: string) => {
				await this.rejectChange(pendingId);
			}),
			vscode.commands.registerCommand('shuncode.diff.acceptAllInFile', async () => {
				const editor = vscode.window.activeTextEditor;
				if (editor) await this.acceptAllForFile(editor.document.uri.fsPath);
			}),
			vscode.commands.registerCommand('shuncode.diff.rejectAllInFile', async () => {
				const editor = vscode.window.activeTextEditor;
				if (editor) await this.rejectAllForFile(editor.document.uri.fsPath);
			}),
			vscode.commands.registerCommand('shuncode.diff.clearAll', async () => {
				await this.clearAll();
				vscode.window.showInformationMessage(t('diff.allCleared'));
			}),
		);
	}

	private ensureInitialized(): void {
		if (!this.initialized) {
			throw new Error('DiffSystem not initialized. Call initialize() first.');
		}
	}

	// ==================== Checkpoint / ResponseGroup ====================

	/**
	 * Start a new checkpoint (ResponseGroup) for grouping changes.
	 * @param description — what the AI is doing
	 * @param messageTs — chat message timestamp for Retry/Delete binding
	 */
	async startCheckpoint(description?: string, messageTs?: number): Promise<string> {
		this.ensureInitialized();

		if (this.currentResponseGroupId) {
			await this.finishCheckpoint();
		}

		const ts = messageTs ?? Date.now();
		this.currentResponseGroupId = this.store.createResponseGroup(ts, description, this.currentTaskId ?? undefined);
		this.overlapCycleCount.clear();
		console.log('[DiffSystem] Started ResponseGroup:', this.currentResponseGroupId, 'messageTs:', ts, 'taskId:', this.currentTaskId);
		return this.currentResponseGroupId;
	}

	/**
	 * Finish the current checkpoint (no-op in v3, ResponseGroup stays active until hunks resolve).
	 */
	async finishCheckpoint(): Promise<string | undefined> {
		this.ensureInitialized();
		if (!this.currentResponseGroupId) return undefined;

		const id = this.currentResponseGroupId;
		this.currentResponseGroupId = null;
		return id;
	}

	/**
	 * Set current task ID. All new ResponseGroups will be tagged with this taskId.
	 * Called by Controller.initTask() / clearTask().
	 */
	setCurrentTaskId(taskId: string | null): void {
		this.currentTaskId = taskId;
		console.log('[DiffSystem] setCurrentTaskId:', taskId);
	}

	/**
	 * Get current task ID.
	 */
	getCurrentTaskId(): string | null {
		return this.currentTaskId;
	}

	// ==================== Manual edit handling ====================

	/**
	 * Handle a manual (non-system) edit in a file with pending hunks.
	 * - Editing inside an existing hunk → refresh hunk content from document
	 * - Editing outside hunks → only recalculate positions for hunks below
	 * - If content returns to original → hunk auto-removed
	 */
	private async handleManualEdit(
		fsPath: string,
		contentChanges: readonly vscode.TextDocumentContentChangeEvent[],
	): Promise<void> {
		// Process changes in reverse order (bottom-to-top) to preserve line numbers
		const sorted = [...contentChanges].sort(
			(a, b) => b.range.start.line - a.range.start.line,
		);

		for (const change of sorted) {
			const editLine = change.range.start.line + 1; // 1-based
			const linesAdded = change.text.split('\n').length - 1;
			const linesRemoved = change.range.end.line - change.range.start.line;
			const delta = linesAdded - linesRemoved;

			// Find if this edit is inside any existing pending hunk
			const pendingHunks = this.store.getPendingHunksByFile(fsPath);
			const insideHunk = pendingHunks.find(
				(h) => editLine >= h.currentStartLine && editLine < h.currentEndLine,
			);

			if (insideHunk) {
				// Don't modify the hunk — VS Code's decoration/viewzone tracking
				// automatically adjusts ranges when lines are inserted/deleted.
				// Updating the store would trigger expensive zone rebuild cycles.
				// Check synchronously: if content returned to original, remove hunk.
				this.checkAutoRemove(insideHunk.id, fsPath);
			}

			// Recalculate positions for hunks BELOW the edit point (any delta)
			if (delta !== 0) {
				this.positionTracker.recalculate(fsPath, editLine, editLine + Math.max(linesRemoved, 1), delta);
			}
		}
	}

	/**
	 * Check if a hunk's current content matches the original (removedLines).
	 * If so, mark it accepted — user reverted the AI change manually.
	 */
	private checkAutoRemove(hunkId: string, fsPath: string): void {
		const hunk = this.store.getHunk(hunkId);
		if (!hunk || hunk.status !== 'pending') return;

		const doc = vscode.workspace.textDocuments.find(
			(d) => d.uri.fsPath.toLowerCase() === fsPath.toLowerCase(),
		);
		if (!doc) return;

		// Read current lines in hunk range
		const currentLines: string[] = [];
		for (let i = hunk.currentStartLine - 1; i < hunk.currentEndLine - 1 && i < doc.lineCount; i++) {
			currentLines.push(doc.lineAt(i).text);
		}

		// Normalize: strip trailing \r from removedLines (Windows line endings from diff library)
		const normalizedRemoved = hunk.removedLines.map((l) => l.replace(/\r$/, ''));

		console.log('[DiffSystem] Auto-remove check:', hunkId,
			'current:', JSON.stringify(currentLines),
			'original:', JSON.stringify(normalizedRemoved));

		if (this.arraysEqual(currentLines, normalizedRemoved)) {
			console.log('[DiffSystem] Auto-remove: content matches original, removing hunk:', hunkId);
			this.store.updateHunkStatus(hunkId, 'accepted');
		}
	}

	/** Compare two string arrays for equality */
	private arraysEqual(a: string[], b: string[]): boolean {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (a[i] !== b[i]) return false;
		}
		return true;
	}

	// ==================== Pre-save & Snapshot ====================

	/**
	 * Ensure file is saved and snapshot is taken before the first AI edit
	 * within the current ResponseGroup.
	 *
	 * Steps:
	 * 1. Open document
	 * 2. If dirty (unsaved user edits) → save
	 * 3. If no snapshot yet for this file in this RG → take snapshot
	 */
	private async preSaveAndSnapshot(fsPath: string, rgId: string, messageTs: number): Promise<void> {
		// Skip if snapshot already exists for this file in this ResponseGroup
		if (this.snapshotStorage.hasSnapshotForResponseGroup(fsPath, rgId)) {
			console.log(`[DiffSystem] Snapshot already exists for ${path.basename(fsPath)} in RG ${rgId.slice(0, 8)}, skipping`);
			return;
		}

		const doc = await vscode.workspace.openTextDocument(fsPath);

		// Save unsaved user edits before AI modifies the file
		if (doc.isDirty) {
			console.log('[DiffSystem] Saving dirty file before AI edit:', fsPath);
			await doc.save();
		}

		// Take snapshot of current file content
		const content = doc.getText();
		const snapId = this.snapshotStorage.saveBeforeAI(fsPath, rgId, messageTs, content);
		console.log(`[DiffSystem] Snapshot saved: ${snapId} for ${path.basename(fsPath)} (messageTs=${messageTs}, size=${content.length}, rgId=${rgId.slice(0, 8)})`);
	}

	/**
	 * Get the messageTs for the current ResponseGroup (for snapshot binding).
	 */
	private getCurrentMessageTs(): number {
		if (!this.currentResponseGroupId) return Date.now();
		const rg = this.store.getResponseGroup(this.currentResponseGroupId);
		return rg?.chatMessageTs ?? Date.now();
	}

	// ==================== Overlap Detection ====================

	/**
	 * Apply a diff operation with overlap detection.
	 * If pending hunks overlap with the target range, reject them first (bottom-to-top),
	 * then apply the new operation on clean text.
	 *
	 * @param fsPath - file path
	 * @param startLine - 1-indexed start of new change
	 * @param endLine - 1-indexed exclusive end of new change
	 * @param operation - function that performs the actual hunk application
	 * @returns hunk ID from the operation
	 */
	async applyWithOverlapCheck(
		fsPath: string,
		startLine: number,
		endLine: number,
		operation: () => Promise<string>,
	): Promise<string> {
		const pendingHunks = this.store.getPendingHunksByFile(fsPath);

		// Find all pending hunks that overlap OR are adjacent to [startLine, endLine)
		// Adjacent hunks (touching boundaries) cause double-buttons, so include them too.
		const overlapping = pendingHunks.filter(h =>
			h.currentStartLine <= endLine && h.currentEndLine >= startLine
		);

		const key = fsPath.toLowerCase();

		if (overlapping.length > 0) {
			// Loop detection: if the model keeps rewriting the same spot, stop it
			const prev = this.overlapCycleCount.get(key) ?? 0;
			const next = prev + 1;
			this.overlapCycleCount.set(key, next);

			if (next > DiffSystem.MAX_OVERLAP_CYCLES) {
				const msg = `Loop detected: ${next} consecutive overlap-reject cycles on ${path.basename(fsPath)} ` +
					`(lines ${startLine}-${endLine}). Blocking further edits to prevent corruption.`;
				console.error(`[DiffSystem] ${msg}`);
				throw new Error(msg);
			}

			console.log(`[DiffSystem] Overlap detected: ${overlapping.length} hunks conflict with [${startLine}, ${endLine}) [cycle ${next}/${DiffSystem.MAX_OVERLAP_CYCLES}]`);

			// Reject bottom-to-top to preserve upper positions
			const sorted = [...overlapping].sort((a, b) => b.currentStartLine - a.currentStartLine);
			for (const old of sorted) {
				console.log(`[DiffSystem] Auto-rejecting overlapping hunk ${old.id} (lines ${old.currentStartLine}-${old.currentEndLine})`);
				await this.hunkReverter.reject(old.id);
			}
		} else {
			// No overlap — reset cycle counter for this file
			this.overlapCycleCount.delete(key);
		}

		return await operation();
	}

	// ==================== Apply changes ====================

	/** Tracks documents already loaded during this session to skip redundant openTextDocument calls */
	private readonly _loadedDocs = new Set<string>();

	/**
	 * Ensure the document is loaded in memory (for WorkspaceEdit in HunkApplier).
	 * Skips if already loaded in this session.
	 */
	private async ensureDocumentLoaded(fsPath: string): Promise<void> {
		const key = fsPath.toLowerCase();
		if (this._loadedDocs.has(key)) return;
		await vscode.workspace.openTextDocument(fsPath);
		this._loadedDocs.add(key);
	}

	private ensureResponseGroup(): string {
		if (!this.currentResponseGroupId) {
			this.currentResponseGroupId = this.store.createResponseGroup(
				Date.now(),
				'Auto-started checkpoint',
				this.currentTaskId ?? undefined,
			);
			console.log('[DiffSystem] Auto-started ResponseGroup:', this.currentResponseGroupId, 'taskId:', this.currentTaskId);
		}
		return this.currentResponseGroupId;
	}

	/**
	 * Replace lines in a file (Cursor-like).
	 * originalLines removed, newLines replace them. View Zone shows deleted lines.
	 *
	 * v4: Pre-saves dirty files, takes snapshot, checks for overlaps.
	 */
	async replaceLines(
		fsPath: string,
		startLine: number,
		originalLines: string[],
		newLines: string[],
	): Promise<string> {
		this.ensureInitialized();
		const rgId = this.ensureResponseGroup();
		const messageTs = this.getCurrentMessageTs();
		await this.ensureDocumentLoaded(fsPath);

		// v4: Pre-save and snapshot before first AI edit
		await this.preSaveAndSnapshot(fsPath, rgId, messageTs);

		// v4: Overlap detection → reject overlapping, then apply
		const endLine = startLine + originalLines.length;
		const hunkId = await this.applyWithOverlapCheck(
			fsPath,
			startLine,
			endLine,
			() => this.hunkApplier.applyReplacement(fsPath, startLine, originalLines, newLines, rgId),
		);

		return hunkId;
	}

	/**
	 * Delete lines from a file. View Zone shows deleted content as ghost.
	 *
	 * v4: Pre-saves dirty files, takes snapshot, checks for overlaps.
	 */
	async deleteLines(fsPath: string, startLine: number, count: number): Promise<string> {
		this.ensureInitialized();
		const rgId = this.ensureResponseGroup();
		const messageTs = this.getCurrentMessageTs();
		await this.ensureDocumentLoaded(fsPath);

		// v4: Pre-save and snapshot before first AI edit
		await this.preSaveAndSnapshot(fsPath, rgId, messageTs);

		// v4: Overlap detection → reject overlapping, then apply
		const endLine = startLine + count;
		const hunkId = await this.applyWithOverlapCheck(
			fsPath,
			startLine,
			endLine,
			async () => {
				const result = await this.hunkApplier.applyDeletion(fsPath, startLine, count, rgId);
				return result.hunkId;
			},
		);

		return hunkId;
	}

	/**
	 * Add (insert) lines after a specific line.
	 *
	 * v4: Pre-saves dirty files, takes snapshot, checks for overlaps.
	 */
	async addLines(fsPath: string, afterLine: number, newLines: string[]): Promise<string> {
		this.ensureInitialized();
		const rgId = this.ensureResponseGroup();
		const messageTs = this.getCurrentMessageTs();
		await this.ensureDocumentLoaded(fsPath);

		// v4: Pre-save and snapshot before first AI edit
		await this.preSaveAndSnapshot(fsPath, rgId, messageTs);

		// For additions, overlap check targets the insertion point
		// (afterLine is where new lines go — check if any hunk spans that point)
		const hunkId = await this.applyWithOverlapCheck(
			fsPath,
			afterLine + 1,   // 1-indexed: line after which we insert
			afterLine + 1,   // same point (zero-width range for insertion)
			() => this.hunkApplier.applyAddition(fsPath, afterLine, newLines, rgId),
		);

		return hunkId;
	}

	/**
	 * Mark the FileChange for `fsPath` in the current ResponseGroup as a brand-new
	 * file creation (kind='created'). Call this right after the first addLines() on
	 * a freshly-created empty file.
	 *
	 * Why: addLines/replaceLines register the FileChange as 'modified' by default.
	 * For a truly new file the correct rollback is to DELETE it, not restore it to
	 * an empty snapshot. rollbackFromMessage keys this behavior off kind==='created'.
	 */
	markFileAsCreated(fsPath: string): void {
		this.ensureInitialized();
		const rgId = this.currentResponseGroupId;
		if (!rgId) return;
		const fc = this.store.getFileChangeByFile(rgId, fsPath);
		if (fc) {
			this.store.updateFileChangeKind(fc.id, 'created');
			console.log(`[DiffSystem] Marked ${path.basename(fsPath)} as 'created' (FileChange ${fc.id.slice(0, 8)})`);
		} else {
			console.warn(`[DiffSystem] markFileAsCreated: no FileChange found for ${path.basename(fsPath)} in RG ${rgId.slice(0, 8)}`);
		}
	}

	// showDiffVisualization() REMOVED in v4.
	// All file writes go through replaceLines/deleteLines/addLines → HunkApplier.
	// mergeWithExistingHunk() REMOVED in v4.
	// Replaced by applyWithOverlapCheck: reject old overlapping hunks → apply new.


	// ==================== Accept / Reject ====================

	async acceptChange(pendingId: string): Promise<void> {
		this.ensureInitialized();
		const hunk = this.store.getHunk(pendingId);
		await this.hunkReverter.accept(pendingId);
		// Store fires hunkRemoved → renderer removes zones

		// Update baseline snapshot to include the accepted change.
		// After accept the baseline = "user-approved state" so rejectAll
		// restores to it instead of to the pre-AI original.
		if (hunk) {
			await this.updateBaselineAfterAccept(hunk.fsPath);

			// v4: Cleanup snapshots when no pending hunks remain for this file
			this.checkSnapshotCleanup(hunk.fsPath);
		}
	}

	async rejectChange(pendingId: string): Promise<void> {
		this.ensureInitialized();

		// Get hunk info before reject (for zone cleanup)
		const hunk = this.store.getHunk(pendingId);
		const fsPath = hunk?.fsPath;

		await this.hunkReverter.reject(pendingId);
		// Store fires hunkRemoved → renderer removes rejected zone
		// Store fires hunkPositionChanged → renderer updates shifted zones

		// For remaining hunks: force-refresh zones (reject changes file content)
		if (fsPath) {
			const remaining = this.store.getPendingHunksByFile(fsPath);

			if (remaining.length === 0) {
				await this.deleteFileIfEmpty(fsPath);
			} else {
				const editor = vscode.window.visibleTextEditors.find(
					(e) => e.document.uri.fsPath.toLowerCase() === fsPath.toLowerCase(),
				);
				if (editor) {
					for (const h of remaining) {
						if (!this.renderer.hasZonesFor(h.id)) {
							await this.renderer.createZonesForHunk(editor, h);
						}
					}
				}
			}

			// v4: Cleanup snapshots when no pending hunks remain for this file
			this.checkSnapshotCleanup(fsPath);
		}
	}

	async acceptAllForFile(fsPath: string): Promise<void> {
		this.ensureInitialized();
		await this.hunkReverter.acceptAllForFile(fsPath);
		this.renderer.clearForFile(fsPath);
	}

	async rejectAllForFile(fsPath: string): Promise<void> {
		this.ensureInitialized();
		await this.hunkReverter.rejectAllForFile(fsPath);
		this.renderer.clearForFile(fsPath);
		await this.deleteFileIfEmpty(fsPath);
	}

	/**
	 * Reject all pending hunks across all files.
	 *
	 * Preferred strategy: restore each file from its earliest snapshot (pre-AI state),
	 * then mark all hunks as rejected. Falls back to per-hunk revert only when no
	 * snapshot exists (legacy data or files not touched through the snapshot path).
	 */
	async rejectAll(): Promise<void> {
		this.ensureInitialized();
		const files = this.store.getFilesWithPendingChanges();

		for (const fsPath of files) {
			const pendingHunks = this.store.getPendingHunksByFile(fsPath);
			if (pendingHunks.length === 0) continue;

			// Use baseline snapshot (chain[0]) — the true original state,
			// regardless of which ResponseGroups are still pending.
			// This correctly handles overlap auto-rejects that would otherwise
			// shift the "earliest pending ts" and target a wrong snapshot.
			const snapshot = this.snapshotStorage.getBaselineSnapshot(fsPath);

			if (snapshot) {
				console.log(`[DiffSystem] rejectAll: restoring ${path.basename(fsPath)} from baseline snapshot (messageTs=${snapshot.messageTs}, size=${snapshot.content.length})`);
				try {
					await this.restoreFileFromSnapshot(fsPath, snapshot.content);
					for (const hunk of pendingHunks) {
						this.store.updateHunkStatus(hunk.id, 'rejected');
					}
				} catch (error) {
					console.error(`[DiffSystem] rejectAll: baseline restore failed for ${path.basename(fsPath)}, falling back to per-hunk`, error);
					await this.hunkReverter.rejectAllForFile(fsPath);
				}
			} else {
				await this.hunkReverter.rejectAllForFile(fsPath);
			}

			this.renderer.clearForFile(fsPath);
			await this.deleteFileIfEmpty(fsPath);

			this.snapshotStorage.cleanupForFile(fsPath);
		}
	}

	/**
	 * Delete a file if it's empty after all hunks were rejected.
	 * This handles the case where a brand-new file was created entirely through addLines —
	 * rejecting all additions leaves an empty file that serves no purpose.
	 */
	private async deleteFileIfEmpty(fsPath: string): Promise<void> {
		try {
			const uri = vscode.Uri.file(fsPath);
			const stat = await vscode.workspace.fs.stat(uri);
			if (stat.size > 0) {
				const bytes = await vscode.workspace.fs.readFile(uri);
				const content = Buffer.from(bytes).toString('utf-8');
				if (content.trim().length > 0) return;
			}

			// Close any open tabs for this file before deletion
			for (const group of vscode.window.tabGroups.all) {
				for (const tab of group.tabs) {
					if (tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath.toLowerCase() === fsPath.toLowerCase()) {
						await vscode.window.tabGroups.close(tab);
					}
				}
			}

			await vscode.workspace.fs.delete(uri);
			console.log(`[DiffSystem] Deleted empty file after reject: ${path.basename(fsPath)}`);
		} catch (e) {
			console.debug(`[DiffSystem] deleteFileIfEmpty skipped for ${path.basename(fsPath)}:`, e);
		}
	}

	/**
	 * Delete a file that was newly created by the AI during a rolled-back message.
	 * Unlike deleteFileIfEmpty, this does NOT require the file to be empty — the
	 * correct rollback state of a created file is "does not exist", so we delete
	 * it unconditionally (closing any open tabs first, like deleteFileIfEmpty).
	 */
	private async deleteCreatedFile(fsPath: string): Promise<void> {
		try {
			const uri = vscode.Uri.file(fsPath);

			// Close any open tabs for this file before deletion
			for (const group of vscode.window.tabGroups.all) {
				for (const tab of group.tabs) {
					if (tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath.toLowerCase() === fsPath.toLowerCase()) {
						await vscode.window.tabGroups.close(tab);
					}
				}
			}

			await vscode.workspace.fs.delete(uri);
			console.log(`[DiffSystem] Deleted AI-created file on rollback: ${path.basename(fsPath)}`);
		} catch (e) {
			console.debug(`[DiffSystem] deleteCreatedFile skipped for ${path.basename(fsPath)}:`, e);
		}
	}


	// ==================== Rollback (Retry/Delete) ====================

	/**
	 * Compute a read-only preview of what rollbackFromMessage(messageTs) would revert.
	 * Returns one entry per affected file with its change kind and the number of
	 * added/removed lines that the revert would undo. Does NOT mutate any state.
	 *
	 * - 'created' files report kind='created' (UI shows "Deleted" since revert removes them).
	 * - addedLines = total lines the AI added (would be removed by revert).
	 * - removedLines = total original lines the AI removed (would be restored by revert).
	 */
	getRollbackPreview(messageTs: number): Array<{
		fsPath: string;
		kind: FileChangeKind;
		addedLines: number;
		removedLines: number;
	}> {
		this.ensureInitialized();

		const groups = this.store.getResponseGroupsFromMessageTs(messageTs, this.currentTaskId ?? undefined);
		if (groups.length === 0) return [];

		// Aggregate per file: kind precedence created > deleted > modified, and
		// sum added/removed line counts across all hunks of all reverted groups.
		const byPath = new Map<string, { fsPath: string; kind: FileChangeKind; addedLines: number; removedLines: number }>();

		for (const group of groups) {
			const fileChanges = this.store.getFileChangesByResponseGroup(group.id);
			for (const fc of fileChanges) {
				const key = fc.fsPath.toLowerCase();
				let entry = byPath.get(key);
				if (!entry) {
					entry = { fsPath: fc.fsPath, kind: fc.kind, addedLines: 0, removedLines: 0 };
					byPath.set(key, entry);
				} else if (fc.kind === 'created' || (fc.kind === 'deleted' && entry.kind === 'modified')) {
					// 'created' wins so the dialog shows the file will be removed entirely
					entry.kind = fc.kind;
				}

				// Count every hunk that a rollback would undo. This includes 'accepted'
				// hunks: rollbackFromMessage restores files from the pre-AI snapshot for
				// the whole response group, so accepting a hunk does NOT exclude it from
				// the revert. Only 'rejected' hunks are already gone and must be skipped.
				const hunks = this.store.getHunksByFileChange(fc.id)
					.filter(h => h.status !== 'rejected');
				for (const h of hunks) {
					entry.addedLines += h.addedLines.length;
					entry.removedLines += h.removedLines.length;
				}

			}
		}

		return [...byPath.values()];
	}

	/**
	 * Rollback all changes from a specific message timestamp onwards.

	 * Used by retryFromMessage / deleteFromMessage.
	 *
	 * v4 strategy (confirmed by Cursor experiment):
	 * 1. Find the earliest snapshot for the target messageTs
	 * 2. Restore file content from snapshot
	 * 3. Clear ALL pending hunks for affected files (from ALL tasks)
	 * 4. Delete invalidated ResponseGroups and snapshots
	 */
	async rollbackFromMessage(messageTs: number): Promise<string[]> {
		this.ensureInitialized();
		console.log(`[DiffSystem] ===== rollbackFromMessage START ===== messageTs=${messageTs}, taskId=${this.currentTaskId}`);

		// Find groups for current task only — never touch other tasks' data
		const groups = this.store.getResponseGroupsFromMessageTs(messageTs, this.currentTaskId ?? undefined);
		if (groups.length === 0) {
			console.log(`[DiffSystem] No ResponseGroups found for messageTs=${messageTs}, taskId=${this.currentTaskId}`);
			return [];
		}

		console.log(`[DiffSystem] Found ${groups.length} ResponseGroups to revert:`,
			groups.map(g => `{id=${g.id.slice(0, 8)}, ts=${g.chatMessageTs}, status=${g.status}, taskId=${g.taskId?.slice(0, 8)}}`));

		// Collect all affected files and find snapshots.
		// Also track files that were CREATED by the AI within the reverted groups:
		// the correct rollback state of a created file is "does not exist", so we
		// delete it instead of restoring it to an empty pre-AI snapshot.
		const affectedFiles = new Set<string>();
		const createdFiles = new Set<string>();   // fsPath (lowercase) of files newly created
		for (const group of groups) {
			const fileChanges = this.store.getFileChangesByResponseGroup(group.id);
			console.log(`[DiffSystem] Group ${group.id.slice(0, 8)} has ${fileChanges.length} file changes`);
			for (const fc of fileChanges) {
				affectedFiles.add(fc.fsPath);
				if (fc.kind === 'created') {
					createdFiles.add(fc.fsPath.toLowerCase());
				}
			}
		}
		console.log(`[DiffSystem] Affected files: ${[...affectedFiles].map(f => path.basename(f)).join(', ')}` +
			(createdFiles.size > 0 ? ` | created: ${createdFiles.size}` : ''));

		// === STEP 1: Restore files from snapshots (or delete AI-created files) ===
		// Track which files were restored via snapshot (vs fallback hunk reject)
		const restoredFromSnapshot = new Set<string>();
		// Track files that were deleted because they were AI-created — STEP 2 must
		// skip line-by-line revert for these (file no longer exists).
		const deletedCreatedFiles = new Set<string>();

		for (const fsPath of affectedFiles) {
			// AI-created file → delete it entirely instead of restoring empty content
			if (createdFiles.has(fsPath.toLowerCase())) {
				console.log(`[DiffSystem] ${path.basename(fsPath)} was created by AI in reverted groups → deleting`);
				await this.deleteCreatedFile(fsPath);
				deletedCreatedFiles.add(fsPath.toLowerCase());
				continue;
			}


			// getSnapshotForRollback now handles exact match, >= and < fallback internally
			const earliestGroupTs = groups.length > 0
				? Math.min(messageTs, ...groups.map(g => g.chatMessageTs))
				: messageTs;
			let snapshot = this.snapshotStorage.getSnapshotForRollback(fsPath, earliestGroupTs);
			if (!snapshot && earliestGroupTs !== messageTs) {
				snapshot = this.snapshotStorage.getSnapshotForRollback(fsPath, messageTs);
			}

			const snapshotCount = this.snapshotStorage.getSnapshotCount(fsPath);
			console.log(`[DiffSystem] ${path.basename(fsPath)}: snapshot=${snapshot ? 'YES' : 'NO'} (chain size: ${snapshotCount}, earliestGroupTs=${earliestGroupTs}, messageTs=${messageTs})`);

			if (snapshot) {
				console.log(`[DiffSystem] Restoring ${path.basename(fsPath)} from snapshot (messageTs: ${snapshot.messageTs}, size: ${snapshot.content.length})`);
				try {
					await this.restoreFileFromSnapshot(fsPath, snapshot.content);
					restoredFromSnapshot.add(fsPath);
				} catch (error) {
					console.error(`[DiffSystem] Failed to restore ${path.basename(fsPath)} from snapshot:`, error);
					// Fallback: reject hunks individually (v3 behavior)
					await this.fallbackRejectHunksForFile(fsPath, groups);
				}
			} else {
				console.warn(`[DiffSystem] No snapshot found for ${path.basename(fsPath)} (messageTs: ${messageTs}), falling back to hunk reject`);
				await this.fallbackRejectHunksForFile(fsPath, groups);
			}
		}

		// === STEP 2: Clear pending hunks ONLY from reverted groups ===
		// (hunks from other groups must remain untouched — they belong to earlier messages)
		const revertedGroupIds = new Set(groups.map(g => g.id));
		for (const fsPath of affectedFiles) {
			const remainingPending = this.store.getPendingHunksByFile(fsPath)
				.filter(h => revertedGroupIds.has(h.responseGroupId));  // Only hunks from reverted groups!
			if (remainingPending.length > 0) {
				if (deletedCreatedFiles.has(fsPath.toLowerCase())) {
					// File was deleted (AI-created) → no content to revert, just mark hunks rejected
					console.log(`[DiffSystem] Marking ${remainingPending.length} hunks as rejected (file deleted): ${path.basename(fsPath)}`);
					for (const hunk of remainingPending) {
						this.store.updateHunkStatus(hunk.id, 'rejected');
					}
				} else if (restoredFromSnapshot.has(fsPath)) {
					// File was fully restored from snapshot → just mark hunks as rejected (no edit needed)
					console.log(`[DiffSystem] Marking ${remainingPending.length} hunks as rejected (snapshot-restored): ${path.basename(fsPath)}`);
					for (const hunk of remainingPending) {
						this.store.updateHunkStatus(hunk.id, 'rejected');
					}
				} else {

					// File was NOT snapshot-restored → use hunkReverter to actually revert line-by-line
					console.log(`[DiffSystem] Rejecting ${remainingPending.length} hunks via reverter (no snapshot): ${path.basename(fsPath)}`);
					const sorted = [...remainingPending].sort((a, b) => b.currentStartLine - a.currentStartLine);
					for (const hunk of sorted) {
						try {
							await this.hunkReverter.reject(hunk.id);
						} catch (e) {
							console.warn(`[DiffSystem] Hunk reject failed in Step 2:`, hunk.id, e);
							try { this.store.updateHunkStatus(hunk.id, 'rejected'); } catch { /* ignore */ }
						}
					}
				}
			}
			// Only clear renderer for reverted hunks, not ALL hunks in file
			for (const hunk of remainingPending) {
				this.renderer.removeZonesForHunk(hunk.id);
			}
		}

		// === STEP 3: Mark ResponseGroups as rejected ===
		const revertedIds: string[] = [];
		for (const group of groups) {
			this.store.updateResponseGroupStatus(group.id, 'rejected');
			revertedIds.push(group.id);
		}

		// === STEP 4: Delete invalidated snapshots ===
		// Use earliest group ts (snapshots may be keyed to group ts, not the deleted message ts)
		const earliestTs = groups.length > 0
			? Math.min(messageTs, ...groups.map(g => g.chatMessageTs))
			: messageTs;
		for (const fsPath of affectedFiles) {
			this.snapshotStorage.deleteSnapshotsFromMessageTs(fsPath, earliestTs);
		}

		// Clear current ResponseGroup if it was reverted
		if (this.currentResponseGroupId && revertedIds.includes(this.currentResponseGroupId)) {
			this.currentResponseGroupId = null;
		}

		console.log(`[DiffSystem] ===== rollbackFromMessage END ===== reverted: ${revertedIds.length} groups, ${affectedFiles.size} files`);
		return revertedIds;
	}

	/**
	 * Restore a file's content from a snapshot.
	 * Uses editGuard to prevent false manual edit detection.
	 */
	private async restoreFileFromSnapshot(fsPath: string, content: string): Promise<void> {
		const uri = vscode.Uri.file(fsPath);
		await this.editGuard.withSystemEdit(async () => {
			const doc = await vscode.workspace.openTextDocument(uri);
			const currentSize = doc.getText().length;
			const edit = new vscode.WorkspaceEdit();
			const fullRange = new vscode.Range(
				doc.positionAt(0),
				doc.positionAt(currentSize),
			);
			edit.replace(uri, fullRange, content);
			const applied = await vscode.workspace.applyEdit(edit);
			if (applied) {
				await doc.save();
				console.log(`[DiffSystem] File restored from snapshot: ${path.basename(fsPath)} (${currentSize} → ${content.length} chars)`);
			} else {
				console.error(`[DiffSystem] Failed to apply snapshot edit for ${path.basename(fsPath)}`);
			}
		});
	}

	/**
	 * Fallback: reject hunks individually when no snapshot is available.
	 * Used for backward compatibility with v3 data.
	 */
	private async fallbackRejectHunksForFile(
		fsPath: string,
		groups: { id: string }[],
	): Promise<void> {
		for (const group of [...groups].reverse()) {
			try {
				const hunks = this.store.getHunksByResponseGroup(group.id)
					.filter(h => h.fsPath.toLowerCase() === fsPath.toLowerCase() && h.status === 'pending')
					.sort((a, b) => b.currentStartLine - a.currentStartLine);
				for (const hunk of hunks) {
					await this.hunkReverter.reject(hunk.id);
				}
			} catch (error) {
				console.error(`[DiffSystem] Fallback reject failed for group ${group.id}:`, error);
			}
		}
	}

	// ==================== Clear ====================

	async clearAll(): Promise<void> {
		this.ensureInitialized();
		this.renderer.clearAll();
		this.store.clearAll();
		this.currentResponseGroupId = null;
	}

	// ==================== Queries ====================

	hasPendingChanges(fsPath: string): boolean {
		this.ensureInitialized();
		return this.store.hasPendingChangesForFile(fsPath);
	}

	getPendingCount(): number {
		this.ensureInitialized();
		return this.store.getPendingCount();
	}

	// ==================== Edit guard for external callers ====================

	/**
	 * Acquire a system-edit token. While active, onDidChangeTextDocument
	 * ignores the file write so it's not treated as a manual edit.
	 * Returns a dispose function that must be called when the write is done.
	 */
	beginSystemEdit(): () => void {
		const token = this.editGuard.begin();
		return () => this.editGuard.end(token);
	}

	// ==================== Snapshot / Baseline ====================

	/**
	 * After a hunk is accepted, recompute the baseline snapshot (S0).
	 *
	 * Baseline = current file content with all remaining pending hunks
	 * virtually reversed. This way rejectAll restores to a state that
	 * keeps accepted changes but removes pending ones.
	 */
	private async updateBaselineAfterAccept(fsPath: string): Promise<void> {
		const baseline = this.snapshotStorage.getBaselineSnapshot(fsPath);
		if (!baseline) return;

		const remainingPending = this.store.getPendingHunksByFile(fsPath);
		if (remainingPending.length === 0) {
			// No more pending hunks — the file IS the baseline now.
			// checkSnapshotCleanup will delete everything anyway.
			return;
		}

		try {
			const doc = await vscode.workspace.openTextDocument(fsPath);
			const lines = doc.getText().split('\n');

			// Virtual reverse-apply: undo every remaining pending hunk (bottom-to-top)
			const sorted = [...remainingPending].sort(
				(a, b) => b.currentStartLine - a.currentStartLine,
			);

			for (const hunk of sorted) {
				const startIdx = hunk.currentStartLine - 1;
				const count = hunk.currentEndLine - hunk.currentStartLine;
				const cleanRemoved = hunk.removedLines.map((l) => l.replace(/\r$/, ''));

				if (hunk.type === 'deletion') {
					// Deleted lines are NOT in the file — re-insert them
					lines.splice(startIdx, 0, ...cleanRemoved);
				} else if (hunk.type === 'addition') {
					// Added lines ARE in the file — remove them
					if (count > 0) lines.splice(startIdx, count);
				} else if (hunk.type === 'replacement') {
					// Added lines in file → replace with removed (original) lines
					lines.splice(startIdx, count, ...cleanRemoved);
				}
			}

			this.snapshotStorage.updateBaselineContent(fsPath, lines.join('\n'));
			console.log(`[DiffSystem] Baseline updated after accept (${path.basename(fsPath)}, ${remainingPending.length} pending remain)`);
		} catch (error) {
			console.error(`[DiffSystem] Failed to update baseline after accept:`, error);
		}
	}

	/**
	 * Check if a file has zero pending hunks. If so, clean up all snapshots
	 * for that file — they're no longer needed for rollback.
	 */
	private checkSnapshotCleanup(fsPath: string): void {
		const pending = this.store.getPendingHunksByFile(fsPath);
		if (pending.length === 0) {
			this.snapshotStorage.cleanupForFile(fsPath);
		}
	}

	// ==================== Validation ====================

	/**
	 * Validate code syntax before applying changes using Tree-sitter.
	 *
	 * Reads `shuncode.validateSyntaxBeforeApply` and `shuncode.blockOnSyntaxErrors`
	 * from VS Code configuration.
	 *
	 * @param filePath — path to the file being modified
	 * @param originalContent — file content before changes
	 * @param newContent — file content after changes
	 * @returns error string if changes should be blocked, undefined if OK
	 */
	async validateSyntax(
		filePath: string,
		originalContent: string,
		newContent: string,
	): Promise<string | undefined> {
		const config = vscode.workspace.getConfiguration('shuncode');
		const validateEnabled = config.get<boolean>('validateSyntaxBeforeApply', true);

		if (!validateEnabled) {
			return undefined;
		}

		try {
			const result: ChangeValidationResult = await syntaxValidator.validateChange(
				filePath,
				originalContent,
				newContent,
			);

			if (result.addedErrors.length === 0) {
				return undefined; // No new errors introduced
			}

			const blockOnErrors = config.get<boolean>('blockOnSyntaxErrors', true);
			const errorDetails = syntaxValidator.formatErrorsForModel(result.addedErrors);

			if (blockOnErrors && !result.canApply) {
				return (
					`Syntax validation failed: ${result.addedErrors.length} new syntax error(s) detected.\n` +
					`${errorDetails}\n\n` +
					`The change was blocked because it introduces syntax errors. ` +
					`Fix the errors and try again.`
				);
			}

			// validateSyntaxBeforeApply is on but blockOnSyntaxErrors is off (or canApply is true):
			// Log warning but allow the change
			if (result.addedErrors.length > 0) {
				console.warn(
					`[DiffSystem] Syntax warning for ${path.basename(filePath)}: ` +
					`${result.addedErrors.length} new error(s) introduced (not blocking).\n${errorDetails}`
				);
			}

			return undefined;
		} catch (error) {
			// SyntaxValidator initialization/parse failure should not block edits
			console.warn('[DiffSystem] Syntax validation error (not blocking):', error);
			return undefined;
		}
	}

	/**
	 * Validate that a write_to_file change doesn't modify too much of the file.
	 * Returns error string if change is too large, undefined if OK.
	 *
	 * Only applies to write_to_file (full file rewrite). replace_in_file and
	 * apply_patch are inherently targeted.
	 *
	 * Controlled by `shuncode.blockLargeFileRewrites` setting (default: false).
	 * When disabled, large changes are logged as warnings but not blocked.
	 */
	validateChangeSize(
		originalContent: string,
		changedLineCount: number,
	): string | undefined {
		const config = vscode.workspace.getConfiguration('shuncode');
		const blockEnabled = config.get<boolean>('blockLargeFileRewrites', false);

		if (!blockEnabled) return undefined;

		const originalLineCount = originalContent.split('\n').length;
		if (originalLineCount < 20) return undefined;

		const threshold = config.get<number>('largeRewriteThreshold', 0.6);
		const changePercent = changedLineCount / originalLineCount;

		if (changePercent > threshold) {
			return (
				`Too many changes: ${Math.round(changePercent * 100)}% of file modified ` +
				`(${changedLineCount}/${originalLineCount} lines). ` +
				`Use replace_in_file with targeted SEARCH/REPLACE blocks instead of rewriting the entire file. ` +
				`Each change should modify only the specific lines that need to change.`
			);
		}

		return undefined;
	}

	// ==================== Helpers ====================

	private resolveHunkType(removedCount: number, addedCount: number): HunkType {
		if (removedCount > 0 && addedCount > 0) return 'replacement';
		if (removedCount > 0) return 'deletion';
		return 'addition';
	}

	// ==================== Pre-reject for new edits ====================

	/**
	 * Pre-reject all pending hunks for a file before applying a new batch of changes.
	 *
	 * When writeFileAndVisualizeDiff needs to apply multiple diff blocks to a file
	 * that already has pending hunks, the overlap-reject mechanism corrupts positions:
	 * rejecting an old hunk mid-application shifts lines, but subsequent blocks still
	 * use stale line numbers.
	 *
	 * This method restores the file to its pre-AI state (via snapshot or per-hunk revert),
	 * marks all existing hunks as rejected, and returns the restored content so the caller
	 * can compute a clean diff against it.
	 *
	 * @returns restored file content, or undefined if no pending hunks existed.
	 */
	async preRejectForNewEdit(fsPath: string): Promise<string | undefined> {
		this.ensureInitialized();

		const pendingHunks = this.store.getPendingHunksByFile(fsPath);
		if (pendingHunks.length === 0) return undefined;

		console.log(`[DiffSystem] preRejectForNewEdit: ${pendingHunks.length} pending hunks in ${path.basename(fsPath)}`);

		const earliestTs = Math.min(...pendingHunks.map(h => {
			const rg = this.store.getResponseGroup(h.responseGroupId);
			return rg?.chatMessageTs ?? Infinity;
		}));
		const snapshot = Number.isFinite(earliestTs)
			? this.snapshotStorage.getSnapshotForRollback(fsPath, earliestTs)
			: undefined;

		let restoredContent: string;

		if (snapshot) {
			console.log(`[DiffSystem] preRejectForNewEdit: restoring from snapshot (messageTs=${snapshot.messageTs})`);
			await this.restoreFileFromSnapshot(fsPath, snapshot.content);
			for (const hunk of pendingHunks) {
				this.store.updateHunkStatus(hunk.id, 'rejected');
			}
			restoredContent = snapshot.content;
		} else {
			console.log(`[DiffSystem] preRejectForNewEdit: no snapshot, falling back to per-hunk reject`);
			await this.hunkReverter.rejectAllForFile(fsPath);
			const doc = await vscode.workspace.openTextDocument(fsPath);
			restoredContent = doc.getText();
		}

		this.renderer.clearForFile(fsPath);
		return restoredContent;
	}

	// ==================== Batch rendering ====================

	/**
	 * Suspend inline diff rendering. While suspended, new hunks are queued
	 * and rendered all at once when resumeRendering() is called.
	 * Nestable — must be matched by an equal number of resumeRendering() calls.
	 */
	suspendRendering(): void {
		this.renderer.suspend();
	}

	async resumeRendering(): Promise<void> {
		await this.renderer.flush();
	}

	/**
	 * Begin a batch of file edits. While in batch mode:
	 * - HunkApplier defers doc.save() (single save at end instead of N)
	 * - Call endBatch() when done to flush the deferred save.
	 */
	beginBatch(): void {
		this.hunkApplier.beginBatch();
	}

	async endBatch(): Promise<void> {
		await this.hunkApplier.endBatch();
	}

	// ==================== Expose store for advanced consumers ====================

	getStore(): DiffStore {
		return this.store;
	}

	getCurrentResponseGroupId(): string | null {
		return this.currentResponseGroupId;
	}

	/**
	 * Write content to a file through the edit guard (prevents false manual-edit detection).
	 * Use when updating file content outside the normal addLines/replaceLines flow.
	 */
	async writeFileContent(fsPath: string, content: string): Promise<void> {
		await this.hunkApplier.writeFile(fsPath, content);
	}

	// ==================== Dispose ====================

	dispose(): void {
		this.renderer.dispose();
		this.keyboardNav.dispose();
		this.store.dispose();
		for (const d of this.disposables) d.dispose();
		this.disposables = [];
		this.initialized = false;
	}
}

// ==================== Singleton ====================

let diffSystemInstance: DiffSystem | null = null;

export function getDiffSystem(context?: vscode.ExtensionContext): DiffSystem {
	if (!diffSystemInstance && context) {
		diffSystemInstance = new DiffSystem(context);
	}
	if (!diffSystemInstance) {
		throw new Error('DiffSystem not initialized. Pass ExtensionContext on first call.');
	}
	return diffSystemInstance;
}

export async function initDiffSystem(
	context: vscode.ExtensionContext,
	clearOnStartup: boolean = false,
): Promise<DiffSystem> {
	const system = getDiffSystem(context);
	await system.initialize(clearOnStartup);
	return system;
}
