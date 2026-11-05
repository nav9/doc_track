/**
 * Calendar arithmetic for date-only values.
 *
 * Everything operates on `YYYY-MM-DD` strings using UTC internally, never local
 * time, so a date can never shift by a day because of a timezone or DST change.
 * Calendar-month arithmetic clamps to the last valid day of the destination
 * month (31 Jan + 1 month = 28/29 Feb). That convention is configurable in the
 * policy model; see POLICY_ASSUMPTIONS PA-002.
 */
import type { ISODate, ISODateTime } from './types';
import { isISODate } from './types';

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
] as const;

export const SHORT_MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
] as const;

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
] as const;

export const SHORT_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const MS_PER_DAY = 86_400_000;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** Parses a date-only string into a UTC Date at midnight. */
export function parseISODate(value: ISODate): Date {
  if (!isISODate(value)) throw new Error(`Invalid ISO date: ${value}`);
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Formats a UTC Date as a date-only string. */
export function toISODate(value: Date): ISODate {
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

/** Today according to the device's local calendar. */
export function todayLocal(now: Date = new Date()): ISODate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Local wall-clock time as `HH:MM`. */
export function localTime(now: Date = new Date()): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Month index 1-12. */
export function monthOf(value: ISODate): number {
  return Number(value.slice(5, 7));
}

export function yearOf(value: ISODate): number {
  return Number(value.slice(0, 4));
}

export function dayOfMonth(value: ISODate): number {
  return Number(value.slice(8, 10));
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(value: ISODate): number {
  return parseISODate(value).getUTCDay();
}

export function isWeekend(value: ISODate, weekendDays: number[]): boolean {
  return weekendDays.includes(dayOfWeek(value));
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

export function isBefore(a: ISODate, b: ISODate): boolean {
  return a < b;
}

export function isAfter(a: ISODate, b: ISODate): boolean {
  return a > b;
}

export function isSameOrBefore(a: ISODate, b: ISODate): boolean {
  return a <= b;
}

export function isSameOrAfter(a: ISODate, b: ISODate): boolean {
  return a >= b;
}

export function isBetween(value: ISODate, start: ISODate, end: ISODate): boolean {
  return value >= start && value <= end;
}

export function addDays(value: ISODate, days: number): ISODate {
  const date = parseISODate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toISODate(date);
}

/** Whole calendar days from `start` to `end` (end − start). */
export function diffDays(start: ISODate, end: ISODate): number {
  return Math.round((parseISODate(end).getTime() - parseISODate(start).getTime()) / MS_PER_DAY);
}

/** Inclusive day count of a range. */
export function rangeLength(start: ISODate, end: ISODate): number {
  return diffDays(start, end) + 1;
}

/**
 * Adds calendar months, clamping the day to the destination month's length.
 * 2026-01-31 + 1 → 2026-02-28; 2024-01-31 + 1 → 2024-02-29.
 */
export function addMonths(value: ISODate, months: number): ISODate {
  const year = yearOf(value);
  const month = monthOf(value);
  const day = dayOfMonth(value);
  const total = (year * 12 + (month - 1)) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = (total % 12 + 12) % 12 + 1;
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${targetYear}-${pad(targetMonth)}-${pad(clampedDay)}`;
}

export function addYears(value: ISODate, years: number): ISODate {
  return addMonths(value, years * 12);
}

export function startOfMonth(value: ISODate): ISODate {
  return `${yearOf(value)}-${pad(monthOf(value))}-01`;
}

export function endOfMonth(value: ISODate): ISODate {
  return `${yearOf(value)}-${pad(monthOf(value))}-${pad(daysInMonth(yearOf(value), monthOf(value)))}`;
}

export function monthKey(value: ISODate): string {
  return value.slice(0, 7);
}

export function monthKeyOf(year: number, month: number): string {
  return `${year}-${pad(month)}`;
}

export function monthsBetween(start: ISODate, end: ISODate): number {
  const startYear = yearOf(start);
  const startMonth = monthOf(start);
  const startDay = dayOfMonth(start);
  const endYear = yearOf(end);
  const endMonth = monthOf(end);
  const endDay = dayOfMonth(end);
  let months = (endYear - startYear) * 12 + (endMonth - startMonth);
  if (endDay < startDay) months -= 1;
  return months;
}

/** Inclusive list of dates in a range. Guards against accidental huge ranges. */
export function eachDate(start: ISODate, end: ISODate, max = 4000): ISODate[] {
  if (end < start) return [];
  const total = diffDays(start, end) + 1;
  if (total > max) throw new Error(`Range too large: ${total} days`);
  const result: ISODate[] = [];
  let cursor = start;
  for (let index = 0; index < total; index += 1) {
    result.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return result;
}

export function* iterateDates(start: ISODate, end: ISODate): Generator<ISODate> {
  let cursor = start;
  while (cursor <= end) {
    yield cursor;
    cursor = addDays(cursor, 1);
  }
}

export function rangesOverlap(
  aStart: ISODate,
  aEnd: ISODate,
  bStart: ISODate,
  bEnd: ISODate
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Months that a range touches, as `{year, month}` keys, inclusive. */
export function monthsInRange(start: ISODate, end: ISODate): string[] {
  const result: string[] = [];
  let cursor = startOfMonth(start);
  const last = startOfMonth(end);
  while (cursor <= last) {
    result.push(monthKey(cursor));
    cursor = addMonths(cursor, 1);
  }
  return result;
}

export type DateFormat =
  | 'dd MMM yyyy'
  | 'dd/MM/yyyy'
  | 'MM/dd/yyyy'
  | 'yyyy-MM-dd'
  | 'EEE, dd MMM yyyy'
  | 'dd MMM yyyy (EEE)'
  | 'dd-MM-yyyy';

export const DATE_FORMATS: DateFormat[] = [
  'dd MMM yyyy',
  'dd/MM/yyyy',
  'MM/dd/yyyy',
  'yyyy-MM-dd',
  'EEE, dd MMM yyyy',
  'dd MMM yyyy (EEE)',
  'dd-MM-yyyy'
];

const FORMAT_TOKENS = ['yyyy', 'dd', 'MMM', 'EEE', 'MM', 'd'] as const;

/**
 * Deterministic, locale-independent date formatting driven by the user's
 * chosen format setting. Avoids `Intl` so output never changes with the OS
 * locale and stays consistent in exported documents.
 */
export function formatDate(value: ISODate, format: DateFormat = 'dd MMM yyyy'): string {
  if (!isISODate(value)) return value;
  const year = yearOf(value);
  const month = monthOf(value);
  const day = dayOfMonth(value);
  const values: Record<(typeof FORMAT_TOKENS)[number], string> = {
    yyyy: String(year),
    dd: pad(day),
    d: String(day),
    MM: pad(month),
    MMM: SHORT_MONTH_NAMES[month - 1],
    EEE: SHORT_DAY_NAMES[dayOfWeek(value)]
  };

  let result: string = format;
  for (const token of FORMAT_TOKENS) {
    result = result.split(token).join(values[token]);
  }
  return result;
}

export function formatLongDate(value: ISODate): string {
  if (!isISODate(value)) return value;
  return `${DAY_NAMES[dayOfWeek(value)]}, ${dayOfMonth(value)} ${
    MONTH_NAMES[monthOf(value) - 1]
  } ${yearOf(value)}`;
}

export function formatMonthYear(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function formatMonthKey(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return formatMonthYear(year, month);
}

/** Formats an instant as `dd MMM yyyy, HH:MM` in local time. */
export function formatDateTime(value: ISODateTime): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const datePart = `${pad(date.getDate())} ${SHORT_MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
  return `${datePart}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toTimeLabel(time: string, format: '12h' | '24h' = '24h'): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return time;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (format === '24h') return `${pad(hours)}:${pad(minutes)}`;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${pad(minutes)} ${suffix}`;
}

/** Adds minutes to a `HH:MM` time, wrapping at midnight. */
export function addMinutesToTime(time: string, minutes: number): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return time;
  const total = (Number(match[1]) * 60 + Number(match[2]) + minutes) % (24 * 60);
  const wrapped = total < 0 ? total + 24 * 60 : total;
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

/** Duration in hours between two `HH:MM` times, rolling past midnight. */
export function durationHours(start: string, end: string): number {
  const parse = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})/.exec(value);
    return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
  };
  const diff = parse(end) - parse(start);
  return (diff <= 0 ? diff + 24 * 60 : diff) / 60;
}

export type PeriodKind = 'calendar-year' | 'academic-year' | 'employment-year';

export interface Period {
  start: ISODate;
  end: ISODate;
  label: string;
  /** True when the period could not be determined (missing joining date). */
  indeterminate?: boolean;
}

export function periodBounds(
  kind: PeriodKind,
  date: ISODate,
  options: { academicYearStartMonth?: number; employmentStart?: ISODate | null } = {}
): Period {
  if (kind === 'calendar-year') {
    const year = yearOf(date);
    return { start: `${year}-01-01`, end: `${year}-12-31`, label: String(year) };
  }

  if (kind === 'academic-year') {
    const startMonth = options.academicYearStartMonth ?? 8;
    const thisYear = yearOf(date);
    const startsThisYear = monthOf(date) >= startMonth;
    const startYear = startsThisYear ? thisYear : thisYear - 1;
    const start = `${startYear}-${pad(startMonth)}-01`;
    const end = addDays(addMonths(start, 12), -1);
    return { start, end, label: `${startYear}–${String(startYear + 1).slice(2)}` };
  }

  const employmentStart = options.employmentStart;
  if (!employmentStart) {
    return {
      start: date,
      end: date,
      label: 'Unknown employment period',
      indeterminate: true
    };
  }

  let start = employmentStart;
  // Walk forward one year at a time until the period containing `date` is found.
  // Bounded so a corrupt joining date cannot loop forever.
  for (let index = 0; index < 80; index += 1) {
    const next = addMonths(start, 12);
    if (date < next) break;
    start = next;
  }
  const end = addDays(addMonths(start, 12), -1);
  return { start, end, label: `${start} → ${end}` };
}

/** Number of complete months of service between two dates. */
export function completedMonths(start: ISODate, at: ISODate): number {
  return Math.max(0, monthsBetween(start, at));
}

export function clampDate(value: ISODate, min: ISODate, max: ISODate): ISODate {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Weeks of a month grid starting on `weekStartsOn` (0 = Sunday, 1 = Monday). */
export function monthGrid(year: number, month: number, weekStartsOn: 0 | 1): ISODate[][] {
  const first = `${year}-${pad(month)}-01`;
  const firstWeekday = dayOfWeek(first);
  const offset = (firstWeekday - weekStartsOn + 7) % 7;
  let cursor = addDays(first, -offset);
  const weeks: ISODate[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const days: ISODate[] = [];
    for (let day = 0; day < 7; day += 1) {
      days.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(days);
    if (monthOf(cursor) !== month && week >= 3) break;
  }
  return weeks;
}
