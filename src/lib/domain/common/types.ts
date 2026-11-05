/**
 * Shared domain primitives.
 *
 * Calendar dates are stored as `YYYY-MM-DD` strings (date-only, timezone-free).
 * Real instants (punch-ins, audit timestamps) are stored as ISO-8601 strings.
 * Mixing the two is a common source of off-by-one leave errors, so the types
 * are kept separate and date arithmetic lives in `dates.ts`.
 */

/** A calendar date with no time or timezone component: `YYYY-MM-DD`. */
export type ISODate = string;

/** An actual instant, e.g. `2026-11-05T09:12:00.000Z`. */
export type ISODateTime = string;

export type ID = string;

export interface AuditFields {
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type Severity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  code: string;
  severity: Severity;
  message: string;
  field?: string;
}

export type ApprovalState =
  | 'not-required'
  | 'pending'
  | 'approved'
  | 'rejected';

export interface ApprovalInfo {
  required: boolean;
  state: ApprovalState;
  note: string;
}

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isISODateTime(value: unknown): value is ISODateTime {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function roundDays(value: number): number {
  return Math.round(value * 100) / 100;
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
