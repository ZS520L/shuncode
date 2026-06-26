/**
 * FileSnapshotStorage v2 — stores file snapshots for reliable rollback
 *
 * v1 (legacy): globalStorage/snapshots/{responseGroupId}/{fileChangeId}.original
 * v2 (new):    in-memory chain of snapshots per file, keyed by messageTs
 *
 * Each snapshot captures the FULL file content at the moment before the first
 * AI modification within a ResponseGroup. Used by rollbackFromMessage() to
 * restore files to their exact state.
 *
 * Disk persistence: globalStorage/snapshots/{responseGroupId}/{fsPathHash}.snapshot
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/** A single file snapshot for rollback */
export interface FileSnapshot {
  /** Unique ID */
  id: string;
  /** Absolute file path */
  fsPath: string;
  /** Full file content at snapshot time */
  content: string;
  /** Timestamp of creation */
  timestamp: number;
  /** ResponseGroup that triggered this snapshot */
  responseGroupId: string;
  /** Chat message timestamp — used for rollback targeting */
  messageTs: number;
}

export class FileSnapshotStorage {
  private snapshotsDir: string;

  /**
   * In-memory snapshot chain: fsPath (lowercase) → array of snapshots ordered by messageTs.
   * Latest snapshot is at the end.
   */
  private readonly chain = new Map<string, FileSnapshot[]>();

  constructor(globalStoragePath: string) {
    this.snapshotsDir = path.join(globalStoragePath, 'snapshots');
  }

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.snapshotsDir)) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
    }

    // Reload v2 snapshots from disk into in-memory chain
    this.loadFromDisk();
  }

  /**
   * Load persisted v2 snapshots from disk into the in-memory chain.
   * Scans globalStorage/snapshots/{responseGroupId}/{hash}.snapshot files.
   * Metadata (fsPath, messageTs) is embedded in the file header as JSON.
   */
  private loadFromDisk(): void {
    if (!fs.existsSync(this.snapshotsDir)) return;

    let loaded = 0;
    try {
      const rgDirs = fs.readdirSync(this.snapshotsDir, { withFileTypes: true });
      for (const rgDir of rgDirs) {
        if (!rgDir.isDirectory()) continue;
        const rgPath = path.join(this.snapshotsDir, rgDir.name);
        const files = fs.readdirSync(rgPath);
        for (const file of files) {
          if (!file.endsWith('.snapshot')) continue;
          try {
            const filePath = path.join(rgPath, file);
            const raw = fs.readFileSync(filePath, 'utf-8');

            // Try to parse header (first line is JSON metadata)
            const nlIndex = raw.indexOf('\n');
            if (nlIndex === -1) continue;

            const headerStr = raw.substring(0, nlIndex);
            const content = raw.substring(nlIndex + 1);

            let header: { fsPath: string; messageTs: number; id: string; timestamp: number } | undefined;
            try {
              header = JSON.parse(headerStr);
            } catch {
              // Legacy format (no header) — skip, can't reconstruct metadata
              continue;
            }
            if (!header || !header.fsPath || !header.messageTs) continue;

            const snapshot: FileSnapshot = {
              id: header.id || this.generateId(),
              fsPath: header.fsPath,
              content,
              timestamp: header.timestamp || Date.now(),
              responseGroupId: rgDir.name,
              messageTs: header.messageTs,
            };

            const key = this.normalizeKey(snapshot.fsPath);
            let snapshots = this.chain.get(key);
            if (!snapshots) {
              snapshots = [];
              this.chain.set(key, snapshots);
            }
            // Avoid duplicates
            if (!snapshots.some(s => s.responseGroupId === snapshot.responseGroupId)) {
              snapshots.push(snapshot);
              loaded++;
            }
          } catch {
            // Skip corrupt files
          }
        }
      }
    } catch (e) {
      console.error('[FileSnapshotStorage] Failed to load snapshots from disk:', e);
    }

    if (loaded > 0) {
      console.log(`[FileSnapshotStorage] Loaded ${loaded} snapshots from disk`);
    }
  }

  // ==================== v2 API: chain-based snapshots ====================

  /**
   * Save a snapshot BEFORE the first AI modification to a file within a ResponseGroup.
   * Idempotent: if a snapshot already exists for this (fsPath, responseGroupId), returns existing.
   *
   * @returns snapshot ID
   */
  saveBeforeAI(fsPath: string, responseGroupId: string, messageTs: number, content: string): string {
    const key = this.normalizeKey(fsPath);
    let snapshots = this.chain.get(key);
    if (!snapshots) {
      snapshots = [];
      this.chain.set(key, snapshots);
    }

    // Idempotent: already have snapshot for this responseGroup
    const existing = snapshots.find(s => s.responseGroupId === responseGroupId);
    if (existing) {
      return existing.id;
    }

    const id = this.generateId();
    const snapshot: FileSnapshot = {
      id,
      fsPath,
      content,
      timestamp: Date.now(),
      responseGroupId,
      messageTs,
    };

    snapshots.push(snapshot);

    // Persist to disk
    this.persistToDisk(snapshot);

    console.log(`[FileSnapshotStorage] Saved snapshot ${id} for ${path.basename(fsPath)} (messageTs: ${messageTs}, rgId: ${responseGroupId})`);
    return id;
  }

  /**
   * Get the snapshot to use for rollback to a specific messageTs.
   *
   * Strategy (robust):
   * 1. Exact match: snapshot.messageTs === messageTs
   * 2. First snapshot with messageTs >= target (checkpoint started at/after the message)
   * 3. Latest snapshot with messageTs <= target (checkpoint started before the message —
   *    common when user deletes an AI response whose ts > checkpoint ts)
   */
  getSnapshotForRollback(fsPath: string, messageTs: number): FileSnapshot | undefined {
    const key = fsPath.toLowerCase().replace(/\\/g, '/');
    const snapshots = this.chain.get(key);
    if (!snapshots || snapshots.length === 0) {
      // Try alternate key (raw lowercase, no slash normalization) for backward compat
      const altKey = fsPath.toLowerCase();
      const altSnapshots = this.chain.get(altKey);
      if (!altSnapshots || altSnapshots.length === 0) {
        console.log(`[FileSnapshotStorage] getSnapshotForRollback: no snapshots for ${path.basename(fsPath)} (keys in chain: ${this.chain.size})`);
        return undefined;
      }
      return this.findBestSnapshot(altSnapshots, messageTs, fsPath);
    }
    return this.findBestSnapshot(snapshots, messageTs, fsPath);
  }

  private findBestSnapshot(snapshots: FileSnapshot[], messageTs: number, fsPath: string): FileSnapshot | undefined {
    // 1. Exact match
    const exact = snapshots.find(s => s.messageTs === messageTs);
    if (exact) {
      console.log(`[FileSnapshotStorage] Found exact snapshot for ${path.basename(fsPath)} (messageTs=${messageTs})`);
      return exact;
    }

    // 2. First snapshot at or after target
    const atOrAfter = snapshots.find(s => s.messageTs >= messageTs);
    if (atOrAfter) {
      console.log(`[FileSnapshotStorage] Found snapshot >= target for ${path.basename(fsPath)} (snap.ts=${atOrAfter.messageTs}, target=${messageTs})`);
      return atOrAfter;
    }

    // 3. Latest snapshot before target (fallback for delete-on-AI-response scenario)
    const beforeTarget = snapshots.filter(s => s.messageTs < messageTs);
    if (beforeTarget.length > 0) {
      const latest = beforeTarget[beforeTarget.length - 1];
      console.log(`[FileSnapshotStorage] Found closest snapshot < target for ${path.basename(fsPath)} (snap.ts=${latest.messageTs}, target=${messageTs})`);
      return latest;
    }

    console.log(`[FileSnapshotStorage] No snapshot found for ${path.basename(fsPath)} (target=${messageTs}, chain size=${snapshots.length})`);
    return undefined;
  }

  /**
   * Get all snapshots for a file with messageTs >= given ts.
   * Used by rollbackFromMessage to know which snapshots to delete after restore.
   */
  getSnapshotsFromMessageTs(fsPath: string, messageTs: number): FileSnapshot[] {
    const key = this.normalizeKey(fsPath);
    const snapshots = this.chain.get(key);
    if (!snapshots) return [];
    return snapshots.filter(s => s.messageTs >= messageTs);
  }

  /**
   * Check if a snapshot already exists for this file within the given ResponseGroup.
   */
  hasSnapshotForResponseGroup(fsPath: string, responseGroupId: string): boolean {
    const key = this.normalizeKey(fsPath);
    const snapshots = this.chain.get(key);
    if (!snapshots) return false;
    return snapshots.some(s => s.responseGroupId === responseGroupId);
  }

  /**
   * Delete all snapshots for a file with messageTs >= given ts.
   * Called after rollback to clean up invalidated snapshots.
   */
  deleteSnapshotsFromMessageTs(fsPath: string, messageTs: number): void {
    const key = this.normalizeKey(fsPath);
    const snapshots = this.chain.get(key);
    if (!snapshots) return;

    const toDelete = snapshots.filter(s => s.messageTs >= messageTs);
    const toKeep = snapshots.filter(s => s.messageTs < messageTs);

    // Clean up disk
    for (const snap of toDelete) {
      this.deleteFromDisk(snap.responseGroupId, snap.fsPath);
    }

    if (toKeep.length === 0) {
      this.chain.delete(key);
    } else {
      this.chain.set(key, toKeep);
    }

    if (toDelete.length > 0) {
      console.log(`[FileSnapshotStorage] Deleted ${toDelete.length} snapshots for ${path.basename(fsPath)} (messageTs >= ${messageTs})`);
    }
  }

  /**
   * Delete ALL snapshots for a file.
   * Called when 0 pending hunks remain (all accepted/rejected).
   */
  cleanupForFile(fsPath: string): void {
    const key = this.normalizeKey(fsPath);
    const snapshots = this.chain.get(key);
    if (!snapshots) return;

    for (const snap of snapshots) {
      this.deleteFromDisk(snap.responseGroupId, snap.fsPath);
    }

    this.chain.delete(key);
    console.log(`[FileSnapshotStorage] Cleaned up all snapshots for ${path.basename(fsPath)}`);
  }

  /**
   * Get the baseline snapshot (chain[0]) — the earliest snapshot for a file.
   * This represents the file state before any AI modifications in the current session.
   * Used by rejectAll to restore the true original state.
   */
  getBaselineSnapshot(fsPath: string): FileSnapshot | undefined {
    const key = this.normalizeKey(fsPath);
    const snapshots = this.chain.get(key);
    if (!snapshots || snapshots.length === 0) return undefined;
    return snapshots[0];
  }

  /**
   * Update the baseline snapshot content (chain[0]).
   * Called after user accepts a hunk — the baseline shifts to include accepted changes.
   */
  updateBaselineContent(fsPath: string, newContent: string): void {
    const key = this.normalizeKey(fsPath);
    const snapshots = this.chain.get(key);
    if (!snapshots || snapshots.length === 0) return;

    snapshots[0].content = newContent;
    snapshots[0].timestamp = Date.now();
    this.persistToDisk(snapshots[0]);

    console.log(`[FileSnapshotStorage] Updated baseline for ${path.basename(fsPath)} (${newContent.length} chars)`);
  }

  /**
   * Get count of snapshots for a file (for diagnostics).
   */
  getSnapshotCount(fsPath: string): number {
    const key = this.normalizeKey(fsPath);
    return this.chain.get(key)?.length ?? 0;
  }

  /** Normalize path key: lowercase + forward slashes (Windows compat) */
  private normalizeKey(fsPath: string): string {
    return fsPath.toLowerCase().replace(/\\/g, '/');
  }

  // ==================== v1 API (legacy, still used by HunkApplier/HunkReverter) ====================

  async saveSnapshot(responseGroupId: string, fileChangeId: string, content: string): Promise<string> {
    const dir = path.join(this.snapshotsDir, responseGroupId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const snapshotPath = path.join(dir, `${fileChangeId}.original`);
    fs.writeFileSync(snapshotPath, content, 'utf-8');
    return `${responseGroupId}/${fileChangeId}`;
  }

  getSnapshot(responseGroupId: string, fileChangeId: string): string | undefined {
    const snapshotPath = path.join(this.snapshotsDir, responseGroupId, `${fileChangeId}.original`);
    if (!fs.existsSync(snapshotPath)) return undefined;
    try {
      return fs.readFileSync(snapshotPath, 'utf-8');
    } catch {
      return undefined;
    }
  }

  async deleteSnapshot(responseGroupId: string, fileChangeId: string): Promise<void> {
    const snapshotPath = path.join(this.snapshotsDir, responseGroupId, `${fileChangeId}.original`);
    if (fs.existsSync(snapshotPath)) {
      fs.unlinkSync(snapshotPath);
    }
  }

  async deleteSnapshotsForResponseGroup(responseGroupId: string): Promise<void> {
    const dir = path.join(this.snapshotsDir, responseGroupId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  async cleanup(olderThanDays: number = 7): Promise<number> {
    if (!fs.existsSync(this.snapshotsDir)) return 0;
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    let deleted = 0;

    const entries = fs.readdirSync(this.snapshotsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirPath = path.join(this.snapshotsDir, entry.name);
        const stat = fs.statSync(dirPath);
        if (stat.mtimeMs < cutoff) {
          fs.rmSync(dirPath, { recursive: true, force: true });
          deleted++;
        }
      }
    }
    return deleted;
  }

  // ==================== Internal helpers ====================

  private generateId(): string {
    return 'snap-' + crypto.randomBytes(8).toString('hex');
  }

  private fsPathHash(fsPath: string): string {
    return crypto.createHash('md5').update(fsPath.toLowerCase()).digest('hex').slice(0, 16);
  }

  private persistToDisk(snapshot: FileSnapshot): void {
    try {
      const dir = path.join(this.snapshotsDir, snapshot.responseGroupId);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const filePath = path.join(dir, `${this.fsPathHash(snapshot.fsPath)}.snapshot`);
      // Write header (JSON metadata) + newline + content
      // loadFromDisk reads header to reconstruct FileSnapshot
      const header = JSON.stringify({
        id: snapshot.id,
        fsPath: snapshot.fsPath,
        messageTs: snapshot.messageTs,
        timestamp: snapshot.timestamp,
      });
      fs.writeFileSync(filePath, header + '\n' + snapshot.content, 'utf-8');
    } catch (e) {
      console.error('[FileSnapshotStorage] Failed to persist snapshot to disk:', e);
    }
  }

  private deleteFromDisk(responseGroupId: string, fsPath: string): void {
    try {
      const filePath = path.join(this.snapshotsDir, responseGroupId, `${this.fsPathHash(fsPath)}.snapshot`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
