/**
 * HunkApplier — applies diff hunks to files
 *
 * Responsibilities:
 * - Modify file content (splice lines)
 * - Create Hunk record in DiffStore
 * - Trigger PositionTracker recalculation for other hunks
 * - File-level operations (create/delete) for Phase 4
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import { DiffStore } from '../storage/DiffStore';
import { FileSnapshotStorage } from '../storage/FileSnapshotStorage';
import { PositionTracker } from './PositionTracker';
import { SystemEditGuard } from './SystemEditGuard';

export class HunkApplier {
  /**
   * When true, writeFile skips doc.save() — caller is responsible for
   * calling flushSave() after the batch. Avoids N disk writes for N hunks.
   */
  private _deferSave = false;
  private readonly _dirtyDocs = new Set<string>();

  constructor(
    private readonly store: DiffStore,
    private readonly snapshotStorage: FileSnapshotStorage,
    private readonly positionTracker: PositionTracker,
    private readonly editGuard: SystemEditGuard,
  ) {}

  beginBatch(): void {
    this._deferSave = true;
  }

  async endBatch(): Promise<void> {
    this._deferSave = false;
    const paths = [...this._dirtyDocs];
    this._dirtyDocs.clear();
    for (const fsPath of paths) {
      try {
        const doc = vscode.workspace.textDocuments.find(
          (d) => d.uri.fsPath.toLowerCase() === fsPath.toLowerCase(),
        );
        if (doc?.isDirty) {
          await doc.save();
        }
      } catch (e) {
        console.error('[HunkApplier] endBatch save failed for', fsPath, e);
      }
    }
  }

  /**
   * Replace lines in a file (Cursor-like).
   * originalLines are removed, newLines take their place.
   */
  async applyReplacement(
    fsPath: string,
    startLine: number,
    originalLines: string[],
    newLines: string[],
    responseGroupId: string,
  ): Promise<string> {
    const fileChangeId = this.store.createFileChange(responseGroupId, fsPath, 'modified');

    const content = await this.readFile(fsPath);
    const lines = content.split('\n');

    if (startLine < 1 || startLine > lines.length) {
      throw new Error(`Invalid start line: ${startLine}. File has ${lines.length} lines.`);
    }

    const startIdx = startLine - 1;

    // CRITICAL: Read ACTUAL file lines at target position — these are the TRUE original lines.
    // The caller's `originalLines` come from diff computation and may have wrong whitespace
    // (e.g., model sends content without indentation → diff sees both sides without indent).
    const actualRemovedLines = lines.slice(startIdx, startIdx + originalLines.length);

    // Log mismatch for diagnostics (helps trace red-zone-shows-wrong-content bugs)
    if (actualRemovedLines.length > 0 && originalLines.length > 0 &&
        actualRemovedLines[0] !== originalLines[0]) {
      console.warn(`[HunkApplier] removedLines MISMATCH at line ${startLine}:`,
        `\n  file:   ${JSON.stringify(actualRemovedLines[0].substring(0, 80))}`,
        `\n  caller: ${JSON.stringify(originalLines[0].substring(0, 80))}`);
    }

    const resultLines = [...lines];
    resultLines.splice(startIdx, originalLines.length, ...newLines);
    await this.writeFile(fsPath, resultLines.join('\n'));

    const hunkId = this.store.createHunk({
      fileChangeId,
      responseGroupId,
      fsPath,
      originalStartLine: startLine,
      originalEndLine: startLine + actualRemovedLines.length,
      currentStartLine: startLine,
      currentEndLine: startLine + newLines.length,
      removedLines: actualRemovedLines,  // Use ACTUAL file lines, not caller's diff lines
      addedLines: newLines,
      type: 'replacement',
    });

    const delta = newLines.length - actualRemovedLines.length;
    if (delta !== 0) {
      this.positionTracker.recalculate(
        fsPath,
        startLine,
        startLine + actualRemovedLines.length,
        delta,
        hunkId,
      );
    }

    return hunkId;
  }

  /**
   * Delete lines from a file.
   * Lines are removed immediately; View Zone shows them as ghost.
   */
  async applyDeletion(
    fsPath: string,
    startLine: number,
    count: number,
    responseGroupId: string,
  ): Promise<{ hunkId: string; deletedContent: string }> {
    const fileChangeId = this.store.createFileChange(responseGroupId, fsPath, 'modified');

    const content = await this.readFile(fsPath);
    const lines = content.split('\n');

    if (startLine < 1 || startLine > lines.length) {
      throw new Error(`Invalid start line: ${startLine}. File has ${lines.length} lines.`);
    }

    const startIdx = startLine - 1;
    const removedLines = lines.slice(startIdx, startIdx + count);
    const deletedContent = removedLines.join('\n');

    lines.splice(startIdx, count);
    await this.writeFile(fsPath, lines.join('\n'));

    const hunkId = this.store.createHunk({
      fileChangeId,
      responseGroupId,
      fsPath,
      originalStartLine: startLine,
      originalEndLine: startLine + count,
      currentStartLine: startLine,
      currentEndLine: startLine, // Lines removed → start = end
      removedLines,
      addedLines: [],
      type: 'deletion',
    });

    this.positionTracker.recalculate(fsPath, startLine, startLine + count, -count, hunkId);

    return { hunkId, deletedContent };
  }

  /**
   * Insert lines after a specific line.
   */
  async applyAddition(
    fsPath: string,
    afterLine: number,
    newLines: string[],
    responseGroupId: string,
  ): Promise<string> {
    const fileChangeId = this.store.createFileChange(responseGroupId, fsPath, 'modified');

    const content = await this.readFile(fsPath);
    const lines = content.split('\n');

    if (afterLine < 0 || afterLine > lines.length) {
      throw new Error(`Invalid afterLine: ${afterLine}. File has ${lines.length} lines.`);
    }

    lines.splice(afterLine, 0, ...newLines);
    await this.writeFile(fsPath, lines.join('\n'));

    const startLine = afterLine + 1;
    const hunkId = this.store.createHunk({
      fileChangeId,
      responseGroupId,
      fsPath,
      originalStartLine: startLine,
      originalEndLine: startLine,
      currentStartLine: startLine,
      currentEndLine: startLine + newLines.length,
      removedLines: [],
      addedLines: newLines,
      type: 'addition',
    });

    this.positionTracker.recalculate(fsPath, startLine, startLine, newLines.length, hunkId);
    return hunkId;
  }

  // ==================== File-level operations (Phase 4) ====================

  /**
   * Track a new file creation as pending.
   * File is already written to disk by the tool handler.
   */
  async applyFileCreation(
    fsPath: string,
    content: string,
    responseGroupId: string,
  ): Promise<string> {
    const fileChangeId = this.store.createFileChange(responseGroupId, fsPath, 'created');
    const lines = content.split('\n');

    const hunkId = this.store.createHunk({
      fileChangeId,
      responseGroupId,
      fsPath,
      originalStartLine: 1,
      originalEndLine: 1,
      currentStartLine: 1,
      currentEndLine: lines.length + 1,
      removedLines: [],
      addedLines: lines,
      type: 'addition',
    });

    return hunkId;
  }

  /**
   * Track a file deletion as pending (saves snapshot for Reject).
   */
  async applyFileDeletion(fsPath: string, responseGroupId: string): Promise<string> {
    const fileChangeId = this.store.createFileChange(responseGroupId, fsPath, 'deleted');

    const content = await this.readFile(fsPath);
    await this.snapshotStorage.saveSnapshot(responseGroupId, fileChangeId, content);
    this.store.setFileChangeSnapshotId(fileChangeId, `${responseGroupId}/${fileChangeId}`);

    await vscode.workspace.fs.delete(vscode.Uri.file(fsPath));

    const lines = content.split('\n');
    const hunkId = this.store.createHunk({
      fileChangeId,
      responseGroupId,
      fsPath,
      originalStartLine: 1,
      originalEndLine: lines.length + 1,
      currentStartLine: 1,
      currentEndLine: 1,
      removedLines: lines,
      addedLines: [],
      type: 'deletion',
    });

    return hunkId;
  }

  // ==================== File I/O ====================

  async readFile(fsPath: string): Promise<string> {
    try {
      // Fast path: if doc is already loaded in memory, skip openTextDocument I/O
      const cached = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath.toLowerCase() === fsPath.toLowerCase(),
      );
      const doc = cached ?? await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath));
      return doc.getText().replace(/\r\n/g, '\n');
    } catch {
      if (!fs.existsSync(fsPath)) throw new Error(`File not found: ${fsPath}`);
      return fs.readFileSync(fsPath, 'utf-8').replace(/\r\n/g, '\n');
    }
  }

  async writeFile(fsPath: string, content: string): Promise<void> {
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
        if (this._deferSave) {
          this._dirtyDocs.add(fsPath);
        } else {
          await openDoc.save();
        }
      } else {
        fs.writeFileSync(fsPath, content, 'utf-8');
      }
    });
  }
}
