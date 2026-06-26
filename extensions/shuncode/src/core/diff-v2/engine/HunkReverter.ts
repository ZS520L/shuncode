/**
 * HunkReverter — handles Accept / Reject of diff hunks
 *
 * Accept = keep the current file state, mark hunk as accepted
 * Reject = restore original content, recalculate other hunk positions
 *
 * Supports bulk operations at file-level and response-group-level.
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import { DiffStore } from '../storage/DiffStore';
import { FileSnapshotStorage } from '../storage/FileSnapshotStorage';
import { PositionTracker } from './PositionTracker';
import { SystemEditGuard } from './SystemEditGuard';

export class HunkReverter {
  constructor(
    private readonly store: DiffStore,
    private readonly snapshotStorage: FileSnapshotStorage,
    private readonly positionTracker: PositionTracker,
    private readonly editGuard: SystemEditGuard,
  ) {}

  // ==================== Single Hunk ====================

  async accept(hunkId: string): Promise<void> {
    const hunk = this.store.getHunk(hunkId);
    if (!hunk) throw new Error(`[HunkReverter] Hunk not found: ${hunkId}`);
    if (hunk.status !== 'pending') {
      throw new Error(`[HunkReverter] Hunk ${hunkId} is already ${hunk.status}`);
    }

    // Accept = no file change. File already has addedLines.
    this.store.updateHunkStatus(hunkId, 'accepted');
    this.updateParentStatuses(hunk.fileChangeId, hunk.responseGroupId);
  }

  async reject(hunkId: string): Promise<void> {
    const hunk = this.store.getHunk(hunkId);
    if (!hunk) throw new Error(`[HunkReverter] Hunk not found: ${hunkId}`);
    if (hunk.status !== 'pending') {
      throw new Error(`[HunkReverter] Hunk ${hunkId} is already ${hunk.status}`);
    }

    const uri = vscode.Uri.file(hunk.fsPath);

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      console.warn(`[HunkReverter] File no longer exists, marking hunk as rejected: ${hunkId.slice(0, 8)} ${hunk.fsPath}`);
      this.store.updateHunkStatus(hunkId, 'rejected');
      this.updateParentStatuses(hunk.fileChangeId, hunk.responseGroupId);
      return;
    }

    // Pre-reject verification: check that file content at hunk position
    // matches what we expect (addedLines for addition/replacement, gap for deletion).
    // If mismatch — positions drifted, per-hunk edit would corrupt the file.
    // Fall back to snapshot restore for the entire file.
    if (hunk.type !== 'deletion') {
      const mismatch = this.verifyHunkContent(doc, hunk);
      if (mismatch) {
        console.warn(`[HunkReverter] Content mismatch for ${hunkId.slice(0, 8)}: ${mismatch}`);
        const restored = await this.fallbackSnapshotRestore(hunk.fsPath);
        if (restored) {
          const allPending = this.store.getPendingHunksByFile(hunk.fsPath);
          for (const h of allPending) {
            this.store.updateHunkStatus(h.id, 'rejected');
            this.updateParentStatuses(h.fileChangeId, h.responseGroupId);
          }
          return;
        }
        console.warn(`[HunkReverter] No snapshot available, proceeding with best-effort reject`);
      }
    }

    // ALWAYS use \n for WorkspaceEdit — VS Code's document model normalizes to doc's EOL on save.
    // Using \r\n causes double-CRLF on Windows (the \r becomes part of line content).
    const editEol = '\n';

    // Strip trailing \r from stored lines (they may come from CRLF files)
    const cleanLines = hunk.removedLines.map((l) => l.replace(/\r$/, ''));

    console.log(`[HunkReverter] reject ${hunkId.slice(0, 8)} type=${hunk.type}`,
      `range=[${hunk.currentStartLine},${hunk.currentEndLine})`,
      `removedLines=${JSON.stringify(cleanLines.map(l => l.substring(0, 40)))}`);

    if (hunk.type === 'deletion') {
      const insertPos = new vscode.Position(hunk.currentStartLine - 1, 0);
      const textToInsert = cleanLines.join(editEol) + editEol;

      await this.applyEdit(uri, new vscode.Range(insertPos, insertPos), textToInsert);

      this.positionTracker.recalculate(
        hunk.fsPath,
        hunk.currentStartLine,
        hunk.currentStartLine,
        hunk.removedLines.length,
        hunkId,
      );
    } else if (hunk.type === 'addition') {
      const count = hunk.currentEndLine - hunk.currentStartLine;

      if (count > 0) {
        const startPos = new vscode.Position(hunk.currentStartLine - 1, 0);
        const endPos = new vscode.Position(hunk.currentStartLine - 1 + count, 0);
        const deleteRange = new vscode.Range(startPos, endPos);

        await this.applyEdit(uri, deleteRange, '');

        this.positionTracker.recalculate(
          hunk.fsPath,
          hunk.currentStartLine,
          hunk.currentEndLine,
          -count,
          hunkId,
        );
      }
    } else if (hunk.type === 'replacement') {
      const actualAddedCount = hunk.currentEndLine - hunk.currentStartLine;
      const startPos = new vscode.Position(hunk.currentStartLine - 1, 0);

      let endPos: vscode.Position;
      if (hunk.currentStartLine - 1 + actualAddedCount >= doc.lineCount) {
        endPos = doc.lineAt(doc.lineCount - 1).rangeIncludingLineBreak.end;
      } else {
        endPos = new vscode.Position(hunk.currentStartLine - 1 + actualAddedCount, 0);
      }

      const replaceRange = new vscode.Range(startPos, endPos);
      const replacement = cleanLines.join(editEol) + editEol;

      console.log(`[HunkReverter] replacement range: (${startPos.line},${startPos.character})-(${endPos.line},${endPos.character})`,
        `text=${JSON.stringify(replacement.substring(0, 60))}`);

      await this.applyEdit(uri, replaceRange, replacement);

      const delta = hunk.removedLines.length - actualAddedCount;
      if (delta !== 0) {
        this.positionTracker.recalculate(
          hunk.fsPath,
          hunk.currentStartLine,
          hunk.currentEndLine,
          delta,
          hunkId,
        );
      }
    }

    this.store.updateHunkStatus(hunkId, 'rejected');
    this.updateParentStatuses(hunk.fileChangeId, hunk.responseGroupId);
  }

  /**
   * Verify that the file content at the hunk's position matches the hunk's addedLines.
   * Returns a mismatch description string, or null if content matches.
   */
  private verifyHunkContent(doc: vscode.TextDocument, hunk: { currentStartLine: number; currentEndLine: number; addedLines: string[]; type: string }): string | null {
    const count = hunk.currentEndLine - hunk.currentStartLine;
    if (count <= 0) return null;

    const startIdx = hunk.currentStartLine - 1;
    if (startIdx >= doc.lineCount) {
      return `hunk starts at line ${hunk.currentStartLine} but file has only ${doc.lineCount} lines`;
    }

    const fileLines: string[] = [];
    for (let i = startIdx; i < startIdx + count && i < doc.lineCount; i++) {
      fileLines.push(doc.lineAt(i).text);
    }

    if (fileLines.length !== hunk.addedLines.length) {
      return `line count mismatch: file has ${fileLines.length}, hunk expects ${hunk.addedLines.length}`;
    }

    const normalizeLine = (l: string) => l.replace(/\r$/, '');
    const firstMismatchIdx = fileLines.findIndex(
      (line, i) => normalizeLine(line) !== normalizeLine(hunk.addedLines[i]),
    );

    if (firstMismatchIdx === -1) return null;

    return `line ${hunk.currentStartLine + firstMismatchIdx} differs: ` +
      `file="${normalizeLine(fileLines[firstMismatchIdx]).substring(0, 50)}" ` +
      `hunk="${normalizeLine(hunk.addedLines[firstMismatchIdx]).substring(0, 50)}"`;
  }

  /**
   * Last-resort fallback: restore file from the baseline snapshot (chain[0]).
   * Returns true if restored successfully.
   */
  private async fallbackSnapshotRestore(fsPath: string): Promise<boolean> {
    const snapshot = this.snapshotStorage.getBaselineSnapshot(fsPath);

    if (!snapshot) {
      console.warn(`[HunkReverter] No baseline snapshot for fallback restore of ${fsPath}`);
      return false;
    }

    console.log(`[HunkReverter] Falling back to baseline snapshot restore for ${fsPath} (messageTs=${snapshot.messageTs})`);
    const uri = vscode.Uri.file(fsPath);

    await this.editGuard.withSystemEdit(async () => {
      const doc = await vscode.workspace.openTextDocument(uri);
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
      edit.replace(uri, fullRange, snapshot.content);
      const applied = await vscode.workspace.applyEdit(edit);
      if (applied) {
        await doc.save();
      }
    });

    return true;
  }

  /**
   * Apply a precise edit to the document model using workspace.applyEdit.
   * Preserves line endings, updates document model synchronously.
   */
  private async applyEdit(uri: vscode.Uri, range: vscode.Range, newText: string): Promise<void> {
    await this.editGuard.withSystemEdit(async () => {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, range, newText);
      const applied = await vscode.workspace.applyEdit(edit);

      if (!applied) {
        console.error(`[HunkReverter] applyEdit FAILED for ${uri.fsPath}`);
        return;
      }

      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath.toLowerCase() === uri.fsPath.toLowerCase(),
      );
      if (doc) await doc.save();
    });
  }

  // ==================== File-level bulk ====================

  async acceptAllForFile(fsPath: string): Promise<number> {
    const hunks = this.store
      .getPendingHunksByFile(fsPath)
      .sort((a, b) => b.currentStartLine - a.currentStartLine);

    let count = 0;
    for (const hunk of hunks) {
      try {
        await this.accept(hunk.id);
        count++;
      } catch (e) {
        console.error(`[HunkReverter] Failed to accept ${hunk.id}:`, e);
      }
    }
    return count;
  }

  async rejectAllForFile(fsPath: string): Promise<number> {
    const hunks = this.store
      .getPendingHunksByFile(fsPath)
      .sort((a, b) => b.currentStartLine - a.currentStartLine);

    let count = 0;
    for (const hunk of hunks) {
      try {
        await this.reject(hunk.id);
        count++;
      } catch (e) {
        console.error(`[HunkReverter] Failed to reject ${hunk.id}:`, e);
      }
    }
    return count;
  }

  // ==================== Response-group-level bulk ====================

  async acceptAllForResponseGroup(responseGroupId: string): Promise<number> {
    const hunks = this.store
      .getHunksByResponseGroup(responseGroupId)
      .filter((h) => h.status === 'pending')
      .sort((a, b) => b.currentStartLine - a.currentStartLine);

    let count = 0;
    for (const hunk of hunks) {
      try {
        await this.accept(hunk.id);
        count++;
      } catch (e) {
        console.error(`[HunkReverter] Failed to accept ${hunk.id}:`, e);
      }
    }
    return count;
  }

  async rejectAllForResponseGroup(responseGroupId: string): Promise<number> {
    const hunks = this.store
      .getHunksByResponseGroup(responseGroupId)
      .filter((h) => h.status === 'pending')
      .sort((a, b) => b.currentStartLine - a.currentStartLine);

    let count = 0;
    for (const hunk of hunks) {
      try {
        await this.reject(hunk.id);
        count++;
      } catch (e) {
        console.error(`[HunkReverter] Failed to reject ${hunk.id}:`, e);
      }
    }
    return count;
  }

  // ==================== File-level operations (Phase 4) ====================

  async rejectFileCreation(fileChangeId: string): Promise<void> {
    const fc = this.store.getFileChange(fileChangeId);
    if (!fc || fc.kind !== 'created') return;

    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(fc.fsPath));
    } catch (e) {
      console.warn('[HunkReverter] Failed to delete created file:', fc.fsPath, e);
    }

    const hunks = this.store.getPendingHunksByFileChange(fileChangeId);
    for (const h of hunks) this.store.updateHunkStatus(h.id, 'rejected');
    this.store.updateFileChangeStatus(fileChangeId, 'rejected');
  }

  async rejectFileDeletion(fileChangeId: string): Promise<void> {
    const fc = this.store.getFileChange(fileChangeId);
    if (!fc || fc.kind !== 'deleted') return;

    if (fc.originalSnapshotId) {
      const parts = fc.originalSnapshotId.split('/');
      if (parts.length === 2) {
        const content = this.snapshotStorage.getSnapshot(parts[0], parts[1]);
        if (content) {
          await vscode.workspace.fs.writeFile(vscode.Uri.file(fc.fsPath), Buffer.from(content));
        }
      }
    }

    const hunks = this.store.getPendingHunksByFileChange(fileChangeId);
    for (const h of hunks) this.store.updateHunkStatus(h.id, 'rejected');
    this.store.updateFileChangeStatus(fileChangeId, 'rejected');
  }

  // ==================== Status helpers ====================

  private updateParentStatuses(fileChangeId: string, responseGroupId: string): void {
    // Update FileChange status
    const fcPending = this.store.getPendingHunksByFileChange(fileChangeId);
    if (fcPending.length === 0) {
      const allFC = this.store.getHunksByFileChange(fileChangeId);
      const allAccepted = allFC.every((h) => h.status === 'accepted');
      const allRejected = allFC.every((h) => h.status === 'rejected');
      if (allAccepted) this.store.updateFileChangeStatus(fileChangeId, 'accepted');
      else if (allRejected) this.store.updateFileChangeStatus(fileChangeId, 'rejected');
    }

    // Update ResponseGroup status
    const rgPending = this.store
      .getHunksByResponseGroup(responseGroupId)
      .filter((h) => h.status === 'pending');
    if (rgPending.length === 0) {
      const allRG = this.store.getHunksByResponseGroup(responseGroupId);
      const allAccepted = allRG.every((h) => h.status === 'accepted');
      const allRejected = allRG.every((h) => h.status === 'rejected');
      if (allAccepted) this.store.updateResponseGroupStatus(responseGroupId, 'accepted');
      else if (allRejected) this.store.updateResponseGroupStatus(responseGroupId, 'rejected');
      else this.store.updateResponseGroupStatus(responseGroupId, 'partial');
    }
  }

  // ==================== File I/O (for file-level operations) ====================

  private async writeFile(fsPath: string, content: string): Promise<void> {
    const uri = vscode.Uri.file(fsPath);
    await this.editGuard.withSystemEdit(async () => {
      const openDoc = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.fsPath.toLowerCase() === uri.fsPath.toLowerCase(),
      );
      if (openDoc) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          openDoc.positionAt(0),
          openDoc.positionAt(openDoc.getText().length),
        );
        edit.replace(uri, fullRange, content);
        await vscode.workspace.applyEdit(edit);
        await openDoc.save();
      } else {
        fs.writeFileSync(fsPath, content, 'utf-8');
      }
    });
  }
}
