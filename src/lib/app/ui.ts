import type { PolicyVersion } from '../domain/policy/types';
import type { LeaveStatus } from '../domain/leave/types';
import { formatDate } from '../domain/common/dates';
import type { DateFormat } from '../domain/common/dates';

export interface DayMark {
  label: string;
  tone: string;
  kind?: 'leave' | 'leave-pending';
}

const CATEGORY_TONES: Record<string, string> = {
  CL: 'cl',
  EL: 'el',
  CCL: 'ccl',
  RH: 'rh',
  SPCL: 'spcl',
  GH: 'gh',
  LOP: 'lop',
  ML: 'lop',
  PL: 'spcl'
};

export function toneForCategory(category: string): string {
  return CATEGORY_TONES[category.toUpperCase()] ?? 'duty';
}

export function categoryChipClass(category: string): string {
  return `chip cat-${toneForCategory(category)}`;
}

export function categoryName(policy: PolicyVersion | null, code: string): string {
  return policy?.categories.find((category) => category.code === code)?.fullForm ?? code;
}

export function daysText(days: number): string {
  const rounded = Math.round(days * 100) / 100;
  return `${rounded} day${rounded === 1 ? '' : 's'}`;
}

export function rangeText(start: string, end: string, format: DateFormat = 'dd MMM yyyy'): string {
  return start === end ? formatDate(start, format) : `${formatDate(start, format)} – ${formatDate(end, format)}`;
}

export function statusTone(status: LeaveStatus): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  switch (status) {
    case 'approved':
      return 'success';
    case 'pending':
    case 'planned':
      return 'warning';
    case 'rejected':
      return 'danger';
    case 'cancelled':
      return 'neutral';
  }
}

export function addMark(
  marks: Record<string, DayMark[]>,
  date: string,
  label: string,
  tone: string,
  kind?: DayMark['kind']
): void {
  const list = marks[date] ?? [];
  if (list.some((mark) => mark.label === label && mark.tone === tone)) return;
  list.push({ label, tone, kind });
  marks[date] = list;
}

export function numberFrom(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function optionalNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function percent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

export function bytesText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/-/g, ' ');
}
