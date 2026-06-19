/**
 * CheckpointStorage - JSON файлы для checkpoints и diffs
 *
 * Структура:
 * globalStorage/
 * └── checkpoints/
 *     └── {checkpointId}/
 *         ├── metadata.json    # CheckpointMetadata
 *         └── diffs/
 *             └── {fileUuid}.json  # FileDiff
 */

import * as fs from 'fs';
import * as path from 'path';
import { Checkpoint, FileDiff, CheckpointStatus, DiffChange } from './types';

/**
 * Метаданные checkpoint (без полных diffs)
 */
export interface CheckpointMetadata {
  checkpointId: string;
  workspaceId: string;
  description?: string;
  messageTs?: number; // Привязка к сообщению чата (timestamp)
  startTimestamp: number;
  endTimestamp?: number;
  status: CheckpointStatus;
  fileUuids: string[];
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

export class CheckpointStorage {
  private checkpointsDir: string;

  constructor(globalStoragePath: string) {
    this.checkpointsDir = path.join(globalStoragePath, 'checkpoints');
  }

  /**
   * Инициализировать storage (создать директории)
   */
  async initialize(): Promise<void> {
    if (!fs.existsSync(this.checkpointsDir)) {
      fs.mkdirSync(this.checkpointsDir, { recursive: true });
    }
  }

  // ==================== CHECKPOINTS ====================

  /**
   * Создать новый checkpoint
   * @param messageTs - timestamp сообщения чата для привязки (для Retry/Delete)
   */
  async createCheckpoint(workspaceId: string, description?: string, messageTs?: number): Promise<string> {
    const checkpointId = generateUuid();
    const checkpointDir = path.join(this.checkpointsDir, checkpointId);
    const diffsDir = path.join(checkpointDir, 'diffs');

    fs.mkdirSync(diffsDir, { recursive: true });

    const metadata: CheckpointMetadata = {
      checkpointId,
      workspaceId,
      description,
      messageTs,
      startTimestamp: Date.now(),
      status: 'pending',
      fileUuids: []
    };

    await this.saveMetadata(checkpointId, metadata);
    return checkpointId;
  }
  
  /**
   * Получить все checkpoints с messageTs >= указанного
   */
  getCheckpointsFromMessage(messageTs: number): CheckpointMetadata[] {
    const allCheckpoints = this.getAllCheckpoints();
    return allCheckpoints
      .filter(cp => cp.messageTs !== undefined && cp.messageTs >= messageTs)
      .sort((a, b) => (a.messageTs || 0) - (b.messageTs || 0));
  }
  
  /**
   * Получить все checkpoints
   */
  getAllCheckpoints(): CheckpointMetadata[] {
    if (!fs.existsSync(this.checkpointsDir)) {
      return [];
    }
    
    const checkpointDirs = fs.readdirSync(this.checkpointsDir);
    const result: CheckpointMetadata[] = [];
    
    for (const dir of checkpointDirs) {
      const metadata = this.getMetadata(dir);
      if (metadata) {
        result.push(metadata);
      }
    }
    
    return result;
  }

  /**
   * Получить metadata checkpoint
   */
  getMetadata(checkpointId: string): CheckpointMetadata | undefined {
    const metadataPath = path.join(this.checkpointsDir, checkpointId, 'metadata.json');

    if (!fs.existsSync(metadataPath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(metadataPath, 'utf-8');
      return JSON.parse(content) as CheckpointMetadata;
    } catch {
      console.error(`[CheckpointStorage] Failed to read metadata: ${metadataPath}`);
      return undefined;
    }
  }

  /**
   * Сохранить metadata
   */
  async saveMetadata(checkpointId: string, metadata: CheckpointMetadata): Promise<void> {
    const metadataPath = path.join(this.checkpointsDir, checkpointId, 'metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  /**
   * Обновить статус checkpoint
   */
  async updateCheckpointStatus(checkpointId: string, status: CheckpointStatus): Promise<void> {
    const metadata = this.getMetadata(checkpointId);
    if (metadata) {
      metadata.status = status;
      if (status !== 'pending') {
        metadata.endTimestamp = Date.now();
      }
      await this.saveMetadata(checkpointId, metadata);
    }
  }

  /**
   * Получить полный checkpoint с diffs
   */
  getCheckpoint(checkpointId: string): Checkpoint | undefined {
    const metadata = this.getMetadata(checkpointId);
    if (!metadata) {
      return undefined;
    }

    const files: FileDiff[] = [];
    for (const fileUuid of metadata.fileUuids) {
      const diff = this.getDiff(checkpointId, fileUuid);
      if (diff) {
        files.push(diff);
      }
    }

    return {
      requestId: metadata.checkpointId,
      workspaceId: metadata.workspaceId,
      files,
      startTimestamp: metadata.startTimestamp,
      endTimestamp: metadata.endTimestamp,
      status: metadata.status,
      description: metadata.description
    };
  }

  /**
   * Получить все pending checkpoints
   */
  getPendingCheckpoints(): CheckpointMetadata[] {
    if (!fs.existsSync(this.checkpointsDir)) {
      return [];
    }

    const results: CheckpointMetadata[] = [];
    const entries = fs.readdirSync(this.checkpointsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const metadata = this.getMetadata(entry.name);
        if (metadata && metadata.status === 'pending') {
          results.push(metadata);
        }
      }
    }

    return results.sort((a, b) => b.startTimestamp - a.startTimestamp);
  }

  /**
   * Удалить checkpoint
   */
  async deleteCheckpoint(checkpointId: string): Promise<void> {
    const checkpointDir = path.join(this.checkpointsDir, checkpointId);

    if (fs.existsSync(checkpointDir)) {
      fs.rmSync(checkpointDir, { recursive: true, force: true });
    }
  }

  // ==================== DIFFS ====================

  /**
   * Получить diff для файла
   */
  getDiff(checkpointId: string, fileUuid: string): FileDiff | undefined {
    const diffPath = path.join(this.checkpointsDir, checkpointId, 'diffs', `${fileUuid}.json`);

    if (!fs.existsSync(diffPath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(diffPath, 'utf-8');
      return JSON.parse(content) as FileDiff;
    } catch {
      console.error(`[CheckpointStorage] Failed to read diff: ${diffPath}`);
      return undefined;
    }
  }

  /**
   * Сохранить diff для файла
   */
  async saveDiff(checkpointId: string, diff: FileDiff): Promise<void> {
    const diffsDir = path.join(this.checkpointsDir, checkpointId, 'diffs');
    const diffPath = path.join(diffsDir, `${diff.fileUuid}.json`);

    if (!fs.existsSync(diffsDir)) {
      fs.mkdirSync(diffsDir, { recursive: true });
    }

    fs.writeFileSync(diffPath, JSON.stringify(diff, null, 2), 'utf-8');

    // Обновить список файлов в metadata
    const metadata = this.getMetadata(checkpointId);
    if (metadata && !metadata.fileUuids.includes(diff.fileUuid)) {
      metadata.fileUuids.push(diff.fileUuid);
      await this.saveMetadata(checkpointId, metadata);
    }
  }

  /**
   * Добавить change к существующему diff
   */
  async addChange(
    checkpointId: string,
    fileUuid: string,
    fsPath: string,
    change: DiffChange
  ): Promise<number> {
    let diff = this.getDiff(checkpointId, fileUuid);

    if (!diff) {
      // Создаём новый diff для файла
      diff = {
        fileUuid,
        fsPath,
        diffChanges: [],
        kind: change.removedLines.length > 0 ? 'KIND_MODIFIED' : 'KIND_ADDED',
        fileSizeBytes: 0,
        numLines: 0
      };
    }

    const index = diff.diffChanges.length;
    diff.diffChanges.push(change);

    // Определяем kind
    if (diff.diffChanges.every(c => c.removedLines.length === 0 && c.addedLines.length > 0)) {
      diff.kind = 'KIND_ADDED';
    } else if (diff.diffChanges.every(c => c.addedLines.length === 0 && c.removedLines.length > 0)) {
      diff.kind = 'KIND_REMOVED';
    } else {
      diff.kind = 'KIND_MODIFIED';
    }

    await this.saveDiff(checkpointId, diff);
    return index;
  }

  /**
   * Обновить позиции в diff (после пересчёта)
   */
  async updateDiffPositions(
    checkpointId: string,
    fileUuid: string,
    diffChangeIndex: number,
    newStartLine: number,
    newEndLine: number
  ): Promise<void> {
    const diff = this.getDiff(checkpointId, fileUuid);
    if (diff && diff.diffChanges[diffChangeIndex]) {
      diff.diffChanges[diffChangeIndex].modifiedStartLineNumberOneIndexed = newStartLine;
      diff.diffChanges[diffChangeIndex].modifiedEndLineNumberExclusiveOneIndexed = newEndLine;
      await this.saveDiff(checkpointId, diff);
    }
  }

  /**
   * Получить конкретный change
   */
  getChange(checkpointId: string, fileUuid: string, diffChangeIndex: number): DiffChange | undefined {
    const diff = this.getDiff(checkpointId, fileUuid);
    return diff?.diffChanges[diffChangeIndex];
  }

  // ==================== CLEANUP ====================

  /**
   * Удалить старые checkpoints
   */
  async cleanup(olderThanDays: number = 7): Promise<number> {
    const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    let deleted = 0;

    if (!fs.existsSync(this.checkpointsDir)) {
      return 0;
    }

    const entries = fs.readdirSync(this.checkpointsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const metadata = this.getMetadata(entry.name);
        if (metadata && metadata.status !== 'pending' && metadata.startTimestamp < cutoff) {
          await this.deleteCheckpoint(entry.name);
          deleted++;
        }
      }
    }

    return deleted;
  }

  // ==================== STATS ====================

  /**
   * Получить статистику
   */
  getStats(): { checkpoints: number; pendingCheckpoints: number } {
    if (!fs.existsSync(this.checkpointsDir)) {
      return { checkpoints: 0, pendingCheckpoints: 0 };
    }

    let total = 0;
    let pending = 0;

    const entries = fs.readdirSync(this.checkpointsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        total++;
        const metadata = this.getMetadata(entry.name);
        if (metadata?.status === 'pending') {
          pending++;
        }
      }
    }

    return { checkpoints: total, pendingCheckpoints: pending };
  }
}
