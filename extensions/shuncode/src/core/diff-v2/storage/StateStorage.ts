/**
 * StateStorage - обёртка над vscode.Memento
 *
 * Хранит (всё в workspaceState для изоляции между проектами):
 * - Pending changes
 * - File UUIDs
 * - Active checkpoints
 *
 * VS Code сам управляет SQLite (state.vscdb) под капотом
 */

import * as vscode from 'vscode';
import { PendingStatus } from './types';

/**
 * Ссылка на pending change (хранится в Memento)
 */
export interface PendingChangeRef {
  id: string;
  checkpointId: string;
  fileUuid: string;
  fsPath: string;
  diffChangeIndex: number;
  status: PendingStatus;
  createdAt: number;
  resolvedAt?: number;
}

/**
 * Generates UUID v4
 */
function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export class StateStorage {
  private static readonly PENDING_CHANGES_KEY = 'shuncode.pendingChanges';
  private static readonly FILE_UUIDS_KEY = 'shuncode.fileUuids';
  private static readonly ACTIVE_CHECKPOINTS_KEY = 'shuncode.activeCheckpoints';
  private static readonly PENDING_FILE_CREATES_KEY = 'shuncode.pendingFileCreates';
  private static readonly PENDING_FILE_DELETES_KEY = 'shuncode.pendingFileDeletes';

  constructor(
    private workspaceState: vscode.Memento,
    private globalState: vscode.Memento
  ) {}

  // ==================== PENDING CHANGES ====================

  /**
   * Получить все pending changes
   */
  getPendingChanges(): Record<string, PendingChangeRef> {
    return this.workspaceState.get<Record<string, PendingChangeRef>>(
      StateStorage.PENDING_CHANGES_KEY,
      {}
    );
  }

  /**
   * Получить pending change по ID
   */
  getPendingChange(id: string): PendingChangeRef | undefined {
    const all = this.getPendingChanges();
    return all[id];
  }

  /**
   * Получить pending changes для файла
   */
  getPendingChangesForFile(fileUuid: string): PendingChangeRef[] {
    const all = this.getPendingChanges();
    return Object.values(all)
      .filter(p => p.fileUuid === fileUuid && p.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Получить pending changes для checkpoint
   */
  getPendingChangesForCheckpoint(checkpointId: string): PendingChangeRef[] {
    const all = this.getPendingChanges();
    return Object.values(all)
      .filter(p => p.checkpointId === checkpointId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Получить все pending (не resolved) changes
   */
  getAllPending(): PendingChangeRef[] {
    const all = this.getPendingChanges();
    return Object.values(all)
      .filter(p => p.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Создать pending change
   */
  async createPendingChange(
    checkpointId: string,
    fileUuid: string,
    fsPath: string,
    diffChangeIndex: number
  ): Promise<string> {
    const id = generateUuid();
    const ref: PendingChangeRef = {
      id,
      checkpointId,
      fileUuid,
      fsPath,
      diffChangeIndex,
      status: 'pending',
      createdAt: Date.now()
    };

    const all = this.getPendingChanges();
    all[id] = ref;
    await this.workspaceState.update(StateStorage.PENDING_CHANGES_KEY, all);

    return id;
  }

  /**
   * Обновить статус pending change
   */
  async updatePendingChangeStatus(id: string, status: PendingStatus): Promise<void> {
    const all = this.getPendingChanges();
    if (all[id]) {
      all[id].status = status;
      if (status !== 'pending') {
        all[id].resolvedAt = Date.now();
      }
      await this.workspaceState.update(StateStorage.PENDING_CHANGES_KEY, all);
    }
  }

  /**
   * Удалить pending change
   */
  async removePendingChange(id: string): Promise<void> {
    const all = this.getPendingChanges();
    delete all[id];
    await this.workspaceState.update(StateStorage.PENDING_CHANGES_KEY, all);
  }

  // ==================== FILE-LEVEL OPS (create/delete as pending) ====================

  getPendingFileCreates(): Record<string, string> {
    return this.workspaceState.get<Record<string, string>>(
      StateStorage.PENDING_FILE_CREATES_KEY,
      {}
    );
  }

  getPendingFileDeletes(): Record<string, string> {
    return this.workspaceState.get<Record<string, string>>(
      StateStorage.PENDING_FILE_DELETES_KEY,
      {}
    );
  }

  async markPendingFileCreate(pendingId: string, fsPath: string): Promise<void> {
    const all = this.getPendingFileCreates();
    all[pendingId] = fsPath;
    await this.workspaceState.update(StateStorage.PENDING_FILE_CREATES_KEY, all);
  }

  async markPendingFileDelete(pendingId: string, fsPath: string): Promise<void> {
    const all = this.getPendingFileDeletes();
    all[pendingId] = fsPath;
    await this.workspaceState.update(StateStorage.PENDING_FILE_DELETES_KEY, all);
  }

  async clearPendingFileCreate(pendingId: string): Promise<void> {
    const all = this.getPendingFileCreates();
    if (all[pendingId]) {
      delete all[pendingId];
      await this.workspaceState.update(StateStorage.PENDING_FILE_CREATES_KEY, all);
    }
  }

  async clearPendingFileDelete(pendingId: string): Promise<void> {
    const all = this.getPendingFileDeletes();
    if (all[pendingId]) {
      delete all[pendingId];
      await this.workspaceState.update(StateStorage.PENDING_FILE_DELETES_KEY, all);
    }
  }

  /**
   * Очистить все pending changes
   */
  async clearAllPendingChanges(): Promise<void> {
    await this.workspaceState.update(StateStorage.PENDING_CHANGES_KEY, {});
  }

  // ==================== FILE UUIDS ====================

  /**
   * Получить UUID для файла (workspace-scoped)
   */
  getFileUuid(fsPath: string): string | undefined {
    const uuids = this.workspaceState.get<Record<string, string>>(
      StateStorage.FILE_UUIDS_KEY,
      {}
    );
    return uuids[fsPath];
  }

  /**
   * Получить fsPath для UUID (workspace-scoped)
   */
  getFsPath(uuid: string): string | undefined {
    const uuids = this.workspaceState.get<Record<string, string>>(
      StateStorage.FILE_UUIDS_KEY,
      {}
    );
    for (const [path, id] of Object.entries(uuids)) {
      if (id === uuid) {
        return path;
      }
    }
    return undefined;
  }

  /**
   * Получить или создать UUID для файла (workspace-scoped)
   */
  async getOrCreateFileUuid(fsPath: string): Promise<string> {
    const existing = this.getFileUuid(fsPath);
    if (existing) {
      return existing;
    }

    const uuid = generateUuid();
    const uuids = this.workspaceState.get<Record<string, string>>(
      StateStorage.FILE_UUIDS_KEY,
      {}
    );
    uuids[fsPath] = uuid;
    await this.workspaceState.update(StateStorage.FILE_UUIDS_KEY, uuids);

    return uuid;
  }

  /**
   * Обновить путь файла (при переименовании) (workspace-scoped)
   */
  async updateFilePath(oldPath: string, newPath: string): Promise<void> {
    const uuids = this.workspaceState.get<Record<string, string>>(
      StateStorage.FILE_UUIDS_KEY,
      {}
    );
    const uuid = uuids[oldPath];
    if (uuid) {
      delete uuids[oldPath];
      uuids[newPath] = uuid;
      await this.workspaceState.update(StateStorage.FILE_UUIDS_KEY, uuids);
    }
  }

  // ==================== ACTIVE CHECKPOINTS ====================

  /**
   * Получить активные checkpoints
   */
  getActiveCheckpoints(): string[] {
    return this.workspaceState.get<string[]>(
      StateStorage.ACTIVE_CHECKPOINTS_KEY,
      []
    );
  }

  /**
   * Добавить активный checkpoint
   */
  async addActiveCheckpoint(checkpointId: string): Promise<void> {
    const active = this.getActiveCheckpoints();
    if (!active.includes(checkpointId)) {
      active.push(checkpointId);
      await this.workspaceState.update(StateStorage.ACTIVE_CHECKPOINTS_KEY, active);
    }
  }

  /**
   * Удалить активный checkpoint
   */
  async removeActiveCheckpoint(checkpointId: string): Promise<void> {
    const active = this.getActiveCheckpoints();
    const index = active.indexOf(checkpointId);
    if (index >= 0) {
      active.splice(index, 1);
      await this.workspaceState.update(StateStorage.ACTIVE_CHECKPOINTS_KEY, active);
    }
  }

  /**
   * Очистить все активные checkpoints
   */
  async clearActiveCheckpoints(): Promise<void> {
    await this.workspaceState.update(StateStorage.ACTIVE_CHECKPOINTS_KEY, []);
  }

  // ==================== STATS ====================

  /**
   * Получить статистику (workspace-scoped)
   */
  getStats(): { pendingCount: number; fileCount: number; activeCheckpoints: number } {
    const pending = this.getAllPending();
    const uuids = this.workspaceState.get<Record<string, string>>(StateStorage.FILE_UUIDS_KEY, {});
    const active = this.getActiveCheckpoints();

    return {
      pendingCount: pending.length,
      fileCount: Object.keys(uuids).length,
      activeCheckpoints: active.length
    };
  }
}
