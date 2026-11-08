import type { AuditFields, ISODate } from '../common/types';
import { isISODate } from '../common/types';
import { eachDate, isWeekend as isWeekendDate, monthKey, yearOf } from '../common/dates';

export type HolidayKind = 'GH' | 'RH';

export interface Holiday extends AuditFields {
  id: string;
  year: number;
  date: ISODate;
  name: string;
  kind: HolidayKind;
  source: 'manual' | 'imported' | 'sample';
  notes: string;
}

export interface CalendarEvent extends AuditFields {
  id: string;
  profileId: string;
  title: string;
  date: ISODate;
  endDate: ISODate | null;
  type: 'academic' | 'exam' | 'invigilation' | 'meeting' | 'conference' | 'personal' | 'other';
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  notes: string;
  /** Doctors this HR event is assigned to, by employee ID or name. */
  assignedTo?: string[];
}

export interface EventName extends AuditFields {
  id: string;
  name: string;
  useCount: number;
}

export interface HolidayLookup {
  dates: Set<ISODate>;
  byDate: Map<ISODate, Holiday[]>;
  weekendDays: number[];
}

/**
 * Builds an efficient holiday lookup. Holidays remain a flat, editable list;
 * the lookup is a derived index and is never persisted.
 */
export function buildHolidayLookup(holidays: Holiday[], weekendDays: number[]): HolidayLookup {
  const byDate = new Map<ISODate, Holiday[]>();
  for (const holiday of holidays) {
    const list = byDate.get(holiday.date) ?? [];
    list.push(holiday);
    byDate.set(holiday.date, list);
  }
  return { dates: new Set(byDate.keys()), byDate, weekendDays };
}

export function isWeekend(date: ISODate, weekendDays: number[]): boolean {
  return isWeekendDate(date, weekendDays);
}

export function isGeneralHoliday(date: ISODate, lookup: HolidayLookup): boolean {
  return (lookup.byDate.get(date) ?? []).some((holiday) => holiday.kind === 'GH');
}

export function isRestrictedHoliday(date: ISODate, lookup: HolidayLookup): boolean {
  return (lookup.byDate.get(date) ?? []).some((holiday) => holiday.kind === 'RH');
}

export function isHoliday(date: ISODate, lookup: HolidayLookup): boolean {
  return lookup.dates.has(date);
}

/** Saturdays, Sundays and general holidays qualify a completed duty for CCL. */
export function isQualifyingDutyDay(date: ISODate, lookup: HolidayLookup): boolean {
  return isWeekend(date, lookup.weekendDays) || isGeneralHoliday(date, lookup);
}

/**
 * Non-working day for leave accounting: weekend or any listed holiday.
 * Restricted holidays are working days for other staff but a doctor who avails
 * RH is on leave that day, so the caller decides how RH is treated.
 */
export function isNonWorkingDay(
  date: ISODate,
  lookup: HolidayLookup,
  options: { includeRestricted?: boolean } = {}
): boolean {
  if (isWeekend(date, lookup.weekendDays)) return true;
  if (isGeneralHoliday(date, lookup)) return true;
  if (options.includeRestricted && isRestrictedHoliday(date, lookup)) return true;
  return false;
}

export function countWorkingDays(
  start: ISODate,
  end: ISODate,
  lookup: HolidayLookup,
  options: { includeRestricted?: boolean } = {}
): number {
  let count = 0;
  for (const date of eachDate(start, end)) {
    if (!isNonWorkingDay(date, lookup, options)) count += 1;
  }
  return count;
}

export function workingDaysInRange(
  start: ISODate,
  end: ISODate,
  lookup: HolidayLookup,
  options: { includeRestricted?: boolean } = {}
): ISODate[] {
  return eachDate(start, end).filter((date) => !isNonWorkingDay(date, lookup, options));
}

export function holidaysInRange(
  start: ISODate,
  end: ISODate,
  holidays: Holiday[]
): Holiday[] {
  return holidays
    .filter((holiday) => holiday.date >= start && holiday.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface HolidayMonthGroup {
  year: number;
  month: string;
  items: Holiday[];
}

export function groupHolidaysByMonth(holidays: Holiday[]): HolidayMonthGroup[] {
  const groups = new Map<string, Holiday[]>();
  for (const holiday of holidays) {
    const key = monthKey(holiday.date);
    groups.set(key, [...(groups.get(key) ?? []), holiday]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, items]) => ({
      year: yearOf(`${month}-01`),
      month,
      items: items.slice().sort((a, b) => a.date.localeCompare(b.date))
    }));
}

export function validateHoliday(holiday: Pick<Holiday, 'date' | 'name' | 'kind'>): string | null {
  if (!isISODate(holiday.date)) return 'Enter a valid holiday date.';
  if (!holiday.name.trim()) return 'Enter a holiday name.';
  if (holiday.kind !== 'GH' && holiday.kind !== 'RH') return 'Choose General or Restricted holiday.';
  return null;
}
