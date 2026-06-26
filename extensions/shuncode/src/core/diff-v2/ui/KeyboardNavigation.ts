/**
 * KeyboardNavigation — keyboard shortcuts for navigating and acting on pending hunks
 *
 * Supports CROSS-FILE navigation: when no more hunks in the current file,
 * opens the next/previous file with pending hunks and jumps to the first/last hunk.
 *
 * Shortcuts:
 *   shuncode.diff.nextHunk      — Navigate to next pending hunk (cross-file)
 *   shuncode.diff.prevHunk      — Navigate to previous pending hunk (cross-file)
 *   shuncode.diff.acceptCurrent — Accept hunk at cursor
 *   shuncode.diff.rejectCurrent — Reject hunk at cursor
 */

import * as vscode from 'vscode';
import { DiffStore } from '../storage/DiffStore';
import { Hunk } from '../storage/types';

export class KeyboardNavigation implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];

  constructor(private store: DiffStore) {}

  registerCommands(): void {
    this.disposables.push(
      vscode.commands.registerCommand('shuncode.diff.nextHunk', () => this.nextHunk()),
      vscode.commands.registerCommand('shuncode.diff.prevHunk', () => this.prevHunk()),
      vscode.commands.registerCommand('shuncode.diff.acceptCurrent', () => this.acceptCurrent()),
      vscode.commands.registerCommand('shuncode.diff.rejectCurrent', () => this.rejectCurrent()),
    );
  }

  /**
   * Get all files with pending hunks, sorted alphabetically for stable ordering.
   */
  private getFilesWithPendingHunks(): string[] {
    return this.store.getFilesWithPendingChanges().sort();
  }

  private getOrderedHunksForFile(fsPath: string): Hunk[] {
    return this.store
      .getPendingHunksByFile(fsPath)
      .sort((a, b) => a.currentStartLine - b.currentStartLine);
  }

  private getOrderedHunks(): Hunk[] {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return [];
    return this.getOrderedHunksForFile(editor.document.uri.fsPath);
  }

  /**
   * Open a file and reveal a specific hunk in it.
   */
  private async revealHunkInFile(hunk: Hunk): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(hunk.fsPath);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const pos = new vscode.Position(hunk.currentStartLine - 1, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  private revealHunk(hunk: Hunk): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const pos = new vscode.Position(hunk.currentStartLine - 1, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  async nextHunk(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const currentFsPath = editor?.document.uri.fsPath;
    const allFiles = this.getFilesWithPendingHunks();

    if (allFiles.length === 0) return;

    // Try current file first
    if (currentFsPath) {
      const hunks = this.getOrderedHunksForFile(currentFsPath);
      if (hunks.length > 0) {
        const curLine = editor!.selection.active.line + 1;
        const next = hunks.find((h) => h.currentStartLine > curLine);
        if (next) {
          this.revealHunk(next);
          return;
        }
      }
    }

    // No more hunks in current file → go to next file
    const currentIdx = currentFsPath
      ? allFiles.findIndex((f) => f.toLowerCase() === currentFsPath.toLowerCase())
      : -1;
    const nextFileIdx = (currentIdx + 1) % allFiles.length;
    const nextFileHunks = this.getOrderedHunksForFile(allFiles[nextFileIdx]);
    if (nextFileHunks.length > 0) {
      await this.revealHunkInFile(nextFileHunks[0]);
    }
  }

  async prevHunk(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const currentFsPath = editor?.document.uri.fsPath;
    const allFiles = this.getFilesWithPendingHunks();

    if (allFiles.length === 0) return;

    // Try current file first
    if (currentFsPath) {
      const hunks = this.getOrderedHunksForFile(currentFsPath);
      if (hunks.length > 0) {
        const curLine = editor!.selection.active.line + 1;
        let prev: Hunk | undefined;
        for (let i = hunks.length - 1; i >= 0; i--) {
          if (hunks[i].currentStartLine < curLine) {
            prev = hunks[i];
            break;
          }
        }
        if (prev) {
          this.revealHunk(prev);
          return;
        }
      }
    }

    // No more hunks in current file → go to previous file
    const currentIdx = currentFsPath
      ? allFiles.findIndex((f) => f.toLowerCase() === currentFsPath.toLowerCase())
      : allFiles.length;
    const prevFileIdx = (currentIdx - 1 + allFiles.length) % allFiles.length;
    const prevFileHunks = this.getOrderedHunksForFile(allFiles[prevFileIdx]);
    if (prevFileHunks.length > 0) {
      await this.revealHunkInFile(prevFileHunks[prevFileHunks.length - 1]);
    }
  }

  private getCurrentHunk(): Hunk | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const hunks = this.getOrderedHunks();
    if (hunks.length === 0) return;

    const curLine = editor.selection.active.line + 1;

    // Hunk containing cursor
    const containing = hunks.find(
      (h) => curLine >= h.currentStartLine && curLine < h.currentEndLine,
    );
    if (containing) return containing;

    // Nearest hunk
    return hunks.reduce((closest, h) => {
      const dist = Math.abs(h.currentStartLine - curLine);
      const closestDist = closest
        ? Math.abs(closest.currentStartLine - curLine)
        : Infinity;
      return dist < closestDist ? h : closest;
    }, undefined as Hunk | undefined);
  }

  async acceptCurrent(): Promise<void> {
    const hunk = this.getCurrentHunk();
    if (hunk) await vscode.commands.executeCommand('shuncode.diff.accept', hunk.id);
  }

  async rejectCurrent(): Promise<void> {
    const hunk = this.getCurrentHunk();
    if (hunk) await vscode.commands.executeCommand('shuncode.diff.reject', hunk.id);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
