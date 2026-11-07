import type { DataSnapshot, SnapshotCounts } from './snapshot';

export type VersionReason = 'import' | 'manual' | 'rollback' | 'restore' | 'initial';

export interface DataVersion {
  id: string;
  createdAt: string;
  reason: VersionReason;
  label: string;
  summary: string;
  counts: SnapshotCounts;
  snapshot: DataSnapshot;
}

export type ExportKind = 'full' | 'leave' | 'policy' | 'roster' | 'holidays' | 'multiuser';

export interface ExportOptions {
  kind: ExportKind;
  rosterId?: string;
  year?: number;
  label?: string;
}

export interface ImportSummaryLine {
  label: string;
  detail: string;
  tone?: 'new' | 'duplicate' | 'conflict' | 'invalid';
}

export interface ImportConflict {
  collection: string;
  id: string;
  message: string;
}

export interface ImportPreview {
  kind: ExportKind;
  label: string;
  createdAt: string;
  counts: SnapshotCounts;
  lines: ImportSummaryLine[];
  conflicts: ImportConflict[];
  invalidCount: number;
  snapshot: DataSnapshot;
  rawChunks: number;
}

export interface ApplyImportResult {
  versionId: string | null;
  added: number;
  updated: number;
  skipped: number;
  conflicts: ImportConflict[];
}
