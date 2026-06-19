/**
 * DiffStore — single source of truth for all diff data (v3)
 *
 * Replaces the triple storage (StateStorage + CheckpointStorage + PendingChangesStorage).
 * All metadata stored in workspaceState (auto-persisted by VS Code).
 * EventEmitter notifies UI of changes.
 */

import * as vscode from 'vscode';
import {
  ResponseGroup, ResponseGroupStatus,
  FileChangeRecord, FileChangeKind,
  Hunk, HunkStatus,
  CreateHunkParams, UpdateHunkParams, DiffStoreEvent
} from './types';

function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class DiffStore implements vscode.Disposable {
  private static readonly RG_KEY = 'shuncode.diff.v3.responseGroups';
  private static readonly FC_KEY = 'shuncode.diff.v3.fileChanges';
  private static readonly HUNKS_KEY = 'shuncode.diff.v3.hunks';

  private readonly _onDidChange = new vscode.EventEmitter<DiffStoreEvent>();
  readonly onDidChange = this._onDidChange.event;

  // In-memory caches — avoid repeated JSON.parse from workspaceState on every read.
  // Writes mutate the cache immediately and schedule a single persist via queueMicrotask.
  private _rgCache: ResponseGroup[] | null = null;
  private _fcCache: FileChangeRecord[] | null = null;
  private _hunksCache: Hunk[] | null = null;
  private readonly _dirtyKeys = new Set<string>();
  private _persistScheduled = false;

  constructor(private readonly workspaceState: vscode.Memento) {}

  private schedulePersist(): void {
    if (this._persistScheduled) return;
    this._persistScheduled = true;
    queueMicrotask(() => {
      this._persistScheduled = false;
      for (const key of this._dirtyKeys) {
        if (key === DiffStore.RG_KEY && this._rgCache) {
          this.workspaceState.update(key, this._rgCache);
        } else if (key === DiffStore.FC_KEY && this._fcCache) {
          this.workspaceState.update(key, this._fcCache);
        } else if (key === DiffStore.HUNKS_KEY && this._hunksCache) {
          this.workspaceState.update(key, this._hunksCache);
        }
      }
      this._dirtyKeys.clear();
    });
  }

  // ==================== ResponseGroups ====================

  private getRGs(): ResponseGroup[] {
    if (!this._rgCache) {
      this._rgCache = this.workspaceState.get<ResponseGroup[]>(DiffStore.RG_KEY, []);
    }
    return this._rgCache;
  }

  createResponseGroup(chatMessageTs: number, description?: string, taskId?: string): string {
    const id = generateUuid();
    const group: ResponseGroup = {
      id,
      taskId,
      chatMessageTs,
      description,
      status: 'active',
      createdAt: Date.now(),
    };
    const all = this.getRGs();
    all.push(group);
    this._dirtyKeys.add(DiffStore.RG_KEY);
    this.schedulePersist();
    return id;
  }

  getResponseGroup(id: string): ResponseGroup | undefined {
    return this.getRGs().find((g) => g.id === id);
  }

  /**
   * Find ResponseGroups relevant to a rollback from messageTs.
   *
   * Strategy:
   * 1. First try: RGs with chatMessageTs >= messageTs (changes created at/after the message)
   * 2. If none found: include active RGs with chatMessageTs < messageTs
   *    (single RG per task that started before the deleted message but has pending changes)
   *
   * This covers the common case where one RG spans the entire task:
   *   startTask(ts=100) → RG(ts=100) → feedback(ts=200) → delete(ts=200)
   *   Without fallback, filter `>= 200` misses RG at ts=100.
   */
  getResponseGroupsFromMessageTs(messageTs: number, taskId?: string): ResponseGroup[] {
    const all = this.getRGs();
    const matchesTask = (g: ResponseGroup) => !taskId || g.taskId === taskId;

    // Primary: RGs started at or after the target message
    const primary = all
      .filter((g) => g.chatMessageTs >= messageTs && matchesTask(g))
      .sort((a, b) => a.chatMessageTs - b.chatMessageTs);

    if (primary.length > 0) return primary;

    // Fallback: active RGs for this task that started before the message
    // (they may contain changes from message processing that happened later)
    const fallback = all
      .filter((g) => g.status === 'active' && matchesTask(g) && g.chatMessageTs < messageTs)
      .sort((a, b) => a.chatMessageTs - b.chatMessageTs);

    if (fallback.length > 0) {
      console.log(`[DiffStore] getResponseGroupsFromMessageTs: primary miss (ts=${messageTs}), using ${fallback.length} active fallback RGs`);
    }

    return fallback;
  }

  updateResponseGroupStatus(id: string, status: ResponseGroupStatus): void {
    const all = this.getRGs();
    const idx = all.findIndex((g) => g.id === id);
    if (idx !== -1) {
      all[idx].status = status;
      if (status !== 'active') all[idx].resolvedAt = Date.now();
      this._dirtyKeys.add(DiffStore.RG_KEY);
      this.schedulePersist();
      this._onDidChange.fire({ type: 'responseGroupChanged', responseGroupId: id });
    }
  }

  // ==================== FileChanges ====================

  private getFCs(): FileChangeRecord[] {
    if (!this._fcCache) {
      this._fcCache = this.workspaceState.get<FileChangeRecord[]>(DiffStore.FC_KEY, []);
    }
    return this._fcCache;
  }

  createFileChange(responseGroupId: string, fsPath: string, kind: FileChangeKind): string {
    const existing = this.getFileChangeByFile(responseGroupId, fsPath);
    if (existing) return existing.id;

    const id = generateUuid();
    const fc: FileChangeRecord = { id, responseGroupId, fsPath, kind, status: 'pending' };
    const all = this.getFCs();
    all.push(fc);
    this._dirtyKeys.add(DiffStore.FC_KEY);
    this.schedulePersist();
    return id;
  }

  getFileChange(id: string): FileChangeRecord | undefined {
    return this.getFCs().find((fc) => fc.id === id);
  }

  getFileChangeByFile(responseGroupId: string, fsPath: string): FileChangeRecord | undefined {
    const norm = fsPath.toLowerCase();
    return this.getFCs().find(
      (fc) => fc.responseGroupId === responseGroupId && fc.fsPath.toLowerCase() === norm,
    );
  }

  getFileChangesByResponseGroup(responseGroupId: string): FileChangeRecord[] {
    return this.getFCs().filter((fc) => fc.responseGroupId === responseGroupId);
  }

  updateFileChangeStatus(id: string, status: HunkStatus): void {
    const all = this.getFCs();
    const idx = all.findIndex((fc) => fc.id === id);
    if (idx !== -1) {
      all[idx].status = status;
      this._dirtyKeys.add(DiffStore.FC_KEY);
      this.schedulePersist();
    }
  }

  setFileChangeSnapshotId(id: string, snapshotId: string): void {
    const all = this.getFCs();
    const idx = all.findIndex((fc) => fc.id === id);
    if (idx !== -1) {
      all[idx].originalSnapshotId = snapshotId;
      this._dirtyKeys.add(DiffStore.FC_KEY);
      this.schedulePersist();
    }
  }

  // ==================== Hunks ====================

  private getHunksAll(): Hunk[] {
    if (!this._hunksCache) {
      this._hunksCache = this.workspaceState.get<Hunk[]>(DiffStore.HUNKS_KEY, []);
    }
    return this._hunksCache;
  }

  createHunk(params: CreateHunkParams): string {
    const id = generateUuid();
    const hunk: Hunk = { ...params, id, status: 'pending', createdAt: Date.now() };
    const all = this.getHunksAll();
    all.push(hunk);
    this._dirtyKeys.add(DiffStore.HUNKS_KEY);
    this.schedulePersist();

    // If the ResponseGroup was marked as rejected/partial (e.g. by overlap auto-reject
    // clearing all previous hunks), reset it to 'active' since we now have a new pending hunk.
    const rg = this.getResponseGroup(params.responseGroupId);
    if (rg && rg.status !== 'active') {
      console.log(`[DiffStore] Resetting RG ${params.responseGroupId.slice(0,8)} status from '${rg.status}' to 'active' (new hunk added)`);
      this.updateResponseGroupStatus(params.responseGroupId, 'active');
    }

    this._onDidChange.fire({ type: 'hunkAdded', hunk });
    return id;
  }

  getHunk(id: string): Hunk | undefined {
    return this.getHunksAll().find((h) => h.id === id);
  }

  getHunksByFile(fsPath: string): Hunk[] {
    const norm = fsPath.toLowerCase();
    return this.getHunksAll().filter((h) => h.fsPath.toLowerCase() === norm);
  }

  getPendingHunksByFile(fsPath: string): Hunk[] {
    return this.getHunksByFile(fsPath).filter((h) => h.status === 'pending');
  }

  getHunksByResponseGroup(responseGroupId: string): Hunk[] {
    return this.getHunksAll().filter((h) => h.responseGroupId === responseGroupId);
  }

  getHunksByFileChange(fileChangeId: string): Hunk[] {
    return this.getHunksAll().filter((h) => h.fileChangeId === fileChangeId);
  }

  getPendingHunksByFileChange(fileChangeId: string): Hunk[] {
    return this.getHunksByFileChange(fileChangeId).filter((h) => h.status === 'pending');
  }

  getPendingHunks(): Hunk[] {
    return this.getHunksAll().filter((h) => h.status === 'pending');
  }

  updateHunkStatus(id: string, status: HunkStatus): void {
    const all = this.getHunksAll();
    const idx = all.findIndex((h) => h.id === id);
    if (idx !== -1) {
      const hunk = all[idx];
      hunk.status = status;
      if (status !== 'pending') hunk.resolvedAt = Date.now();
      this._dirtyKeys.add(DiffStore.HUNKS_KEY);
      this.schedulePersist();
      if (status !== 'pending') {
        this._onDidChange.fire({ type: 'hunkRemoved', hunkId: id, fsPath: hunk.fsPath });
      }
    }
  }

  updateHunkPosition(id: string, startLine: number, endLine: number): void {
    const all = this.getHunksAll();
    const idx = all.findIndex((h) => h.id === id);
    if (idx !== -1) {
      all[idx].currentStartLine = startLine;
      all[idx].currentEndLine = endLine;
      this._dirtyKeys.add(DiffStore.HUNKS_KEY);
      this.schedulePersist();
      this._onDidChange.fire({
        type: 'hunkPositionChanged',
        hunkId: id,
        fsPath: all[idx].fsPath,
      });
    }
  }

  /**
   * Update an existing hunk's content and positions (merge scenario).
   * Used when a new edit overlaps with a pending hunk — instead of creating
   * a new hunk, the existing one is updated with merged data.
   */
  updateHunk(id: string, params: UpdateHunkParams): void {
    const all = this.getHunksAll();
    const idx = all.findIndex((h) => h.id === id);
    if (idx === -1) {
      console.warn('[DiffStore] updateHunk: hunk not found:', id);
      return;
    }

    const hunk = all[idx];
    hunk.currentStartLine = params.currentStartLine;
    hunk.currentEndLine = params.currentEndLine;
    hunk.removedLines = params.removedLines;
    hunk.addedLines = params.addedLines;
    hunk.type = params.type;

    this._dirtyKeys.add(DiffStore.HUNKS_KEY);
    this.schedulePersist();
    this._onDidChange.fire({ type: 'hunkUpdated', hunk: { ...hunk } });
  }

  // ==================== Bulk ====================

  clearAll(): void {
    this._rgCache = [];
    this._fcCache = [];
    this._hunksCache = [];
    this.workspaceState.update(DiffStore.RG_KEY, []);
    this.workspaceState.update(DiffStore.FC_KEY, []);
    this.workspaceState.update(DiffStore.HUNKS_KEY, []);
    this._dirtyKeys.clear();
    this._onDidChange.fire({ type: 'cleared' });
  }

  /**
   * Remove stale ResponseGroups that have no pending hunks.
   * These accumulate across sessions and pollute rollback queries.
   */
  cleanupOrphanedResponseGroups(): void {
    const all = this.getRGs();
    const pendingHunks = this.getPendingHunks();
    const rgsWithPending = new Set(pendingHunks.map(h => h.responseGroupId));

    const toKeep = all.filter(g => rgsWithPending.has(g.id));
    const removed = all.length - toKeep.length;

    if (removed > 0) {
      this._rgCache = toKeep;
      this._dirtyKeys.add(DiffStore.RG_KEY);
      this.schedulePersist();
      console.log(`[DiffStore] Cleaned up ${removed} orphaned ResponseGroups (kept ${toKeep.length} with pending hunks)`);
    }
  }

  // ==================== Queries ====================

  getPendingCount(): number {
    return this.getPendingHunks().length;
  }

  hasPendingChangesForFile(fsPath: string): boolean {
    return this.getPendingHunksByFile(fsPath).length > 0;
  }

  getFilesWithPendingChanges(): string[] {
    const files = new Set<string>();
    for (const h of this.getPendingHunks()) files.add(h.fsPath);
    return Array.from(files);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
