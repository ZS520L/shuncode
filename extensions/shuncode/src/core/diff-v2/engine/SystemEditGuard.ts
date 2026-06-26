/**
 * SystemEditGuard — thread-safe tracking of system-initiated edits
 *
 * Replaces the old boolean `_isSystemEdit` flag which was prone to race conditions.
 * Uses a Set of unique tokens so concurrent system edits don't interfere.
 */

export class SystemEditGuard {
  private activeEdits = new Set<string>();

  /**
   * Wraps an async operation as a system edit.
   * While the function is running, `isSystemEdit()` returns true.
   */
  async withSystemEdit<T>(fn: () => Promise<T>): Promise<T> {
    const token = `edit_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.activeEdits.add(token);
    try {
      return await fn();
    } finally {
      this.activeEdits.delete(token);
    }
  }

  /**
   * Manually begin a system edit. Returns a unique token.
   * Call `end(token)` when the edit is complete.
   */
  begin(): string {
    const token = `edit_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.activeEdits.add(token);
    return token;
  }

  /**
   * End a previously started system edit by token.
   */
  end(token: string): void {
    this.activeEdits.delete(token);
  }

  /**
   * Returns true if any system edit is currently in progress.
   * Safe to call from synchronous event handlers (e.g. onDidChangeTextDocument).
   */
  isSystemEdit(): boolean {
    return this.activeEdits.size > 0;
  }
}
