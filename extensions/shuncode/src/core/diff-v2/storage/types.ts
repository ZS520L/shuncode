/**
 * Storage Types - Cursor-like diff system
 *
 * Форматы данных совместимы с Cursor для возможной миграции
 */

// === ФАЙЛЫ ===

/**
 * Запись о файле в реестре
 * UUID позволяет отслеживать файл даже при переименовании
 */
export interface FileRecord {
  uuid: string;
  fsPath: string;
  workspaceId: string;
  createdAt: number;
  lastModifiedAt: number;
}

// === DIFF (формат Cursor) ===

/**
 * Тип операции изменения
 * - 'addition': строки добавлены в файл, отображаются зелёным
 * - 'deletion': строки помечены для удаления, отображаются красным (ещё в файле!)
 * - 'replacement': замена = удаление старого + добавление нового
 */
export type DiffChangeType = 'addition' | 'deletion' | 'replacement';

/**
 * Одно изменение в файле
 * Все номера строк 1-indexed (как в редакторе)
 * End номера exclusive (не включают последнюю строку)
 */
export interface DiffChange {
  /** Тип операции */
  type: DiffChangeType;
  /** Начало в оригинальном файле (1-indexed) */
  originalStartLineNumberOneIndexed: number;
  /** Конец в оригинальном файле (exclusive, 1-indexed) */
  originalEndLineNumberExclusiveOneIndexed: number;
  /** Начало в изменённом файле (1-indexed) */
  modifiedStartLineNumberOneIndexed: number;
  /** Конец в изменённом файле (exclusive, 1-indexed) */
  modifiedEndLineNumberExclusiveOneIndexed: number;
  /** Добавленные строки (для зелёной подсветки) */
  addedLines: string[];
  /** Удалённые/помеченные строки (для красной подсветки и отката) */
  removedLines: string[];
}

/**
 * Тип изменения файла
 */
export type FileDiffKind = 'KIND_ADDED' | 'KIND_REMOVED' | 'KIND_MODIFIED';

/**
 * Все изменения в одном файле
 */
export interface FileDiff {
  fileUuid: string;
  fsPath: string;
  diffChanges: DiffChange[];
  kind: FileDiffKind;
  fileSizeBytes: number;
  numLines: number;
}

// === CHECKPOINTS ===

/**
 * Статус checkpoint
 */
export type CheckpointStatus = 'pending' | 'accepted' | 'rejected' | 'partial';

/**
 * Checkpoint - группа изменений от одного запроса агента
 */
export interface Checkpoint {
  /** UUID запроса агента */
  requestId: string;
  /** ID workspace */
  workspaceId: string;
  /** Изменённые файлы */
  files: FileDiff[];
  /** Время начала */
  startTimestamp: number;
  /** Время завершения */
  endTimestamp?: number;
  /** Статус */
  status: CheckpointStatus;
  /** Описание (что делал агент) */
  description?: string;
}

// === PENDING CHANGES ===

/**
 * Статус отдельного изменения
 */
export type PendingStatus = 'pending' | 'accepted' | 'rejected';

/**
 * Отдельное pending изменение для UI (кнопки Accept/Reject)
 */
export interface PendingChange {
  /** Уникальный ID */
  id: string;
  /** Ссылка на checkpoint */
  checkpointId: string;
  /** UUID файла */
  fileUuid: string;
  /** Индекс в diffChanges */
  diffChangeIndex: number;
  /** Статус */
  status: PendingStatus;
  /** Время создания */
  createdAt: number;
  /** Время разрешения (accept/reject) */
  resolvedAt?: number;
}

// === HISTORY ===

/**
 * Источник изменения в истории
 */
export type HistorySource =
  | 'AI_CREATE'
  | 'AI_MODIFY'
  | 'AI_ACCEPT'
  | 'AI_REJECT'
  | 'USER_EDIT';

/**
 * Запись в истории файла
 */
export interface HistoryEntry {
  id: string;
  fileUuid: string;
  source: HistorySource;
  timestamp: number;
  checkpointId?: string;
  /** SHA256 хеш контента */
  contentHash: string;
}

// === DATABASE OPERATIONS ===

/**
 * Опции для создания pending change
 */
export interface CreatePendingChangeOptions {
  checkpointId: string;
  fileUuid: string;
  diffChangeIndex: number;
}

/**
 * Опции для обновления pending change
 */
export interface UpdatePendingChangeOptions {
  status?: PendingStatus;
  resolvedAt?: number;
}

/**
 * Опции для обновления checkpoint
 */
export interface UpdateCheckpointOptions {
  endTimestamp?: number;
  status?: CheckpointStatus;
  description?: string;
}

/**
 * Информация о workspace
 */
export interface WorkspaceInfo {
  id: string;
  path: string;
  name: string;
}

// ============================================================
// V3 TYPES — Cursor-like diff system architecture
// ============================================================

export type ResponseGroupStatus = 'active' | 'accepted' | 'rejected' | 'partial';
export type FileChangeKind = 'created' | 'modified' | 'deleted' | 'renamed';
export type HunkStatus = 'pending' | 'accepted' | 'rejected';
export type HunkType = 'addition' | 'deletion' | 'replacement';

/** Group of changes from one AI response */
export interface ResponseGroup {
  id: string;
  taskId?: string;           // v4: привязка к задаче для scoped rollback
  chatMessageTs: number;
  description?: string;
  status: ResponseGroupStatus;
  createdAt: number;
  resolvedAt?: number;
}

/** File-level change record */
export interface FileChangeRecord {
  id: string;
  responseGroupId: string;
  fsPath: string;
  kind: FileChangeKind;
  originalSnapshotId?: string;
  status: HunkStatus;
}

/** Single diff hunk within a file */
export interface Hunk {
  id: string;
  fileChangeId: string;
  responseGroupId: string;
  fsPath: string;
  status: HunkStatus;
  originalStartLine: number;
  originalEndLine: number;
  currentStartLine: number;
  currentEndLine: number;
  removedLines: string[];
  addedLines: string[];
  type: HunkType;
  createdAt: number;
  resolvedAt?: number;
}

/** Position update returned by PositionTracker */
export interface HunkPositionUpdate {
  hunkId: string;
  newStartLine: number;
  newEndLine: number;
}

/** Parameters for creating a new hunk */
export interface CreateHunkParams {
  fileChangeId: string;
  responseGroupId: string;
  fsPath: string;
  originalStartLine: number;
  originalEndLine: number;
  currentStartLine: number;
  currentEndLine: number;
  removedLines: string[];
  addedLines: string[];
  type: HunkType;
}

/** Parameters for updating an existing hunk (merge scenario) */
export interface UpdateHunkParams {
  currentStartLine: number;
  currentEndLine: number;
  removedLines: string[];
  addedLines: string[];
  type: HunkType;
}

/** Event emitted by DiffStore on changes */
export type DiffStoreEvent =
  | { type: 'hunkAdded'; hunk: Hunk }
  | { type: 'hunkUpdated'; hunk: Hunk }
  | { type: 'hunkRemoved'; hunkId: string; fsPath: string }
  | { type: 'hunkPositionChanged'; hunkId: string; fsPath: string }
  | { type: 'cleared' }
  | { type: 'responseGroupChanged'; responseGroupId: string };
