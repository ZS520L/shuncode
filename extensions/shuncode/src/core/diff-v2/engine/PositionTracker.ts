/**
 * PositionTracker v3 — unified position recalculation
 *
 * Single `recalculate()` method replaces the old
 * recalculateAfterInsert / recalculateAfterDeletion / recalculateAfterRevert.
 * Works directly with DiffStore.
 */

import { DiffStore } from '../storage/DiffStore';
import { Hunk, HunkPositionUpdate } from '../storage/types';

export class PositionTracker {
  constructor(private store: DiffStore) {}

  /**
   * Recalculate positions of all pending hunks in a file after an edit.
   *
   * @param fsPath       - File that was edited
   * @param editStartLine - First line affected (1-indexed)
   * @param editEndLine   - Last line affected (1-indexed, exclusive)
   * @param delta         - Lines added (positive) or removed (negative)
   * @param excludeHunkId - Hunk that caused the edit (skip it)
   * @returns Array of position updates (for UI to react)
   */
  recalculate(
    fsPath: string,
    editStartLine: number,
    editEndLine: number,
    delta: number,
    excludeHunkId?: string,
  ): HunkPositionUpdate[] {
    if (delta === 0) return [];

    const updates: HunkPositionUpdate[] = [];
    const pendingHunks = this.store.getPendingHunksByFile(fsPath);

    for (const hunk of pendingHunks) {
      if (excludeHunkId && hunk.id === excludeHunkId) continue;

      if (hunk.currentStartLine > editEndLine) {
        // Hunk is entirely BELOW the edit → shift both start and end
        const newStart = Math.max(1, hunk.currentStartLine + delta);
        const newEnd = Math.max(newStart, hunk.currentEndLine + delta);
        this.store.updateHunkPosition(hunk.id, newStart, newEnd);
        updates.push({ hunkId: hunk.id, newStartLine: newStart, newEndLine: newEnd });
      } else if (
        hunk.currentStartLine <= editEndLine &&
        hunk.currentEndLine > editStartLine
      ) {
        // Edit overlaps this hunk → update endLine only
        const newEnd = Math.max(hunk.currentStartLine, hunk.currentEndLine + delta);
        this.store.updateHunkPosition(hunk.id, hunk.currentStartLine, newEnd);
        updates.push({
          hunkId: hunk.id,
          newStartLine: hunk.currentStartLine,
          newEndLine: newEnd,
        });
      }
      // If hunk is entirely ABOVE the edit → no change needed
    }

    return updates;
  }

  /**
   * Get all pending hunks for a file, sorted by currentStartLine ascending.
   */
  getPendingPositionsForFile(fsPath: string): Hunk[] {
    return this.store
      .getPendingHunksByFile(fsPath)
      .sort((a, b) => a.currentStartLine - b.currentStartLine);
  }

  hasPendingChanges(fsPath: string): boolean {
    return this.store.hasPendingChangesForFile(fsPath);
  }

  getPendingCount(): number {
    return this.store.getPendingCount();
  }

  /**
   * Validate that all pending hunk positions are within file bounds.
   */
  validatePositions(
    fsPath: string,
    lineCount: number,
  ): Array<{ hunkId: string; error: string }> {
    const errors: Array<{ hunkId: string; error: string }> = [];
    const hunks = this.getPendingPositionsForFile(fsPath);

    for (const hunk of hunks) {
      if (hunk.currentStartLine < 1) {
        errors.push({ hunkId: hunk.id, error: `startLine ${hunk.currentStartLine} < 1` });
      } else if (hunk.currentStartLine > lineCount + 1) {
        errors.push({
          hunkId: hunk.id,
          error: `startLine ${hunk.currentStartLine} > file length ${lineCount}`,
        });
      } else if (hunk.currentEndLine < hunk.currentStartLine) {
        errors.push({
          hunkId: hunk.id,
          error: `endLine ${hunk.currentEndLine} < startLine ${hunk.currentStartLine}`,
        });
      }
    }
    return errors;
  }
}
