/**
 * NMC attendance.
 *
 * A punch is only "confirmed" when the doctor (or an import) recorded it.
 * Everything else is "assumed" from the working calendar, and is labelled as
 * such everywhere — an assumption is never presented as verified attendance.
 */
import type { ISODate } from '../../domain/common/types';
import {
  addDays,
  dayOfMonth,
  dayOfWeek,
  daysInMonth,
  isWeekend,
  monthKeyOf,
  todayLocal
} from '../../domain/common/dates';
import type { AttendanceDay, AttendanceRecord, MonthAttendance } from '../../domain/attendance/types';
import type { Holiday } from '../../domain/calendar/holidays';
import { buildHolidayLookup, isGeneralHoliday, isRestrictedHoliday } from '../../domain/calendar/holidays';
import type { LeaveRequest } from '../../domain/leave/types';
import { isActiveLeave } from '../../domain/leave/types';

export interface AttendanceContext {
  year: number;
  month: number;
  weekendDays: number[];
  holidays: Holiday[];
  leaves: LeaveRequest[];
  records: AttendanceRecord[];
  required: number;
  today?: ISODate;
  /** Extra planned leave being simulated by the planner. */
  extraLeave?: Pick<LeaveRequest, 'category' | 'startDate' | 'endDate' | 'halfDay'> | null;
}

function leaveForDate(
  date: ISODate,
  leaves: LeaveRequest[],
  extraLeave?: AttendanceContext['extraLeave']
): LeaveRequest | Pick<LeaveRequest, 'category' | 'startDate' | 'endDate' | 'halfDay'> | null {
  const all: (LeaveRequest | Pick<LeaveRequest, 'category' | 'startDate' | 'endDate' | 'halfDay'>)[] = [
    ...leaves.filter((leave) => isActiveLeave(leave) && leave.category !== 'GH'),
    ...(extraLeave ? [extraLeave] : [])
  ];
  return all.find((leave) => date >= leave.startDate && date <= leave.endDate) ?? null;
}

export interface MonthAttendanceResult extends MonthAttendance {
  /** Total if every remaining working day were punched. */
  projectedTotal: number;
  projectedShortage: boolean;
  confirmedDays: ISODate[];
  assumedDays: ISODate[];
  absentDays: ISODate[];
}

export function computeMonthAttendance(context: AttendanceContext): MonthAttendanceResult {
  const today = context.today ?? todayLocal();
  const lookup = buildHolidayLookup(context.holidays, context.weekendDays);
  const total = daysInMonth(context.year, context.month);
  const recordsByDate = new Map(context.records.map((record) => [record.date, record]));

  const days: AttendanceDay[] = [];
  const confirmedDays: ISODate[] = [];
  const assumedDays: ISODate[] = [];
  const absentDays: ISODate[] = [];
  let confirmed = 0;
  let assumed = 0;
  let excludedSundays = 0;
  let excludedHolidays = 0;
  let leaveDays = 0;
  let projectedTotal = 0;

  for (let day = 1; day <= total; day += 1) {
    const date = `${context.year}-${String(context.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const record = recordsByDate.get(date);
    const leave = leaveForDate(date, context.leaves, context.extraLeave);
    const weekend = isWeekend(date, context.weekendDays);
    const sunday = dayOfWeek(date) === 0;
    const gh = isGeneralHoliday(date, lookup);
    const rh = isRestrictedHoliday(date, lookup);

    if (record?.state === 'confirmed') {
      confirmed += 1;
      projectedTotal += 1;
      confirmedDays.push(date);
      days.push({ date, status: 'confirmed', counts: 1, note: record.note, leaveCategory: null });
      continue;
    }

    if (record?.state === 'absent') {
      absentDays.push(date);
      days.push({
        date,
        status: 'absent',
        counts: 0,
        note: record.note || 'Marked as not punched',
        leaveCategory: leave?.category ?? null
      });
      continue;
    }

    if (leave) {
      leaveDays += 1;
      days.push({
        date,
        status: 'leave',
        counts: 0,
        note: `${leave.category} leave`,
        leaveCategory: leave.category
      });
      continue;
    }

    if (sunday) {
      excludedSundays += 1;
      days.push({ date, status: 'sunday', counts: 0, note: 'Sunday', leaveCategory: null });
      continue;
    }

    if (gh || (rh && weekend)) {
      excludedHolidays += 1;
      days.push({
        date,
        status: 'holiday',
        counts: 0,
        note: gh ? 'General holiday' : 'Restricted holiday',
        leaveCategory: null
      });
      continue;
    }

    // A normal working day. Past and current days are assumed punched; future
    // days stay explicitly "future" so a projection is never mistaken for fact.
    if (date > today) {
      projectedTotal += 1;
      days.push({
        date,
        status: 'future',
        counts: 0,
        note: 'Upcoming working day — projected, not yet assumed',
        leaveCategory: null
      });
      continue;
    }

    assumed += 1;
    projectedTotal += 1;
    assumedDays.push(date);
    days.push({
      date,
      status: 'assumed',
      counts: 1,
      note: rh ? 'Assumed punch (restricted holiday is a working day)' : 'Assumed punch',
      leaveCategory: null
    });
  }

  const counted = confirmed + assumed;
  const missing = Math.max(0, context.required - counted);
  const projectionNote =
    missing > 0
      ? `Add ${missing} punch${missing === 1 ? '' : 'es'} to reach the monthly requirement of ${context.required}.`
      : `The monthly requirement of ${context.required} punches is met.`;

  return {
    year: context.year,
    month: context.month,
    required: context.required,
    confirmed,
    assumed,
    total: counted,
    missing,
    shortage: counted < context.required,
    excludedSundays,
    excludedHolidays,
    leaveDays,
    days,
    projectionNote,
    projectedTotal,
    projectedShortage: projectedTotal < context.required,
    confirmedDays,
    assumedDays,
    absentDays
  };
}

export interface MonthProjection {
  monthKey: string;
  projected: number;
  required: number;
  shortage: boolean;
  leaveDays: number;
}

/** Projects several months after applying planned leave. */
export function projectAttendanceMonths(
  months: { year: number; month: number }[],
  context: Omit<AttendanceContext, 'year' | 'month'>
): MonthProjection[] {
  return months.map(({ year, month }) => {
    const result = computeMonthAttendance({ ...context, year, month });
    return {
      monthKey: monthKeyOf(year, month),
      projected: result.projectedTotal,
      required: result.required,
      shortage: result.projectedShortage,
      leaveDays: result.leaveDays
    };
  });
}

/** Compact calendar marker for the last day of a month, used by lists. */
export function attendanceMarker(count: number, required: number): string {
  return `${count}/${required}`;
}

export function isPunchDate(date: ISODate, records: AttendanceRecord[]): boolean {
  return records.some((record) => record.date === date && record.state === 'confirmed');
}

export function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export function monthDates(year: number, month: number): ISODate[] {
  const count = daysInMonth(year, month);
  return Array.from({ length: count }, (_, index) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`;
    return date;
  }).map((_date, index) => addDays(`${year}-${String(month).padStart(2, '0')}-01`, index));
}

export function isWorkingDayForAttendance(
  date: ISODate,
  weekendDays: number[],
  holidays: Holiday[]
): boolean {
  const lookup = buildHolidayLookup(holidays, weekendDays);
  return !isWeekend(date, weekendDays) && !isGeneralHoliday(date, lookup);
}

export function attendanceDayLabel(day: AttendanceDay): string {
  return `${dayOfMonth(day.date)} — ${day.status}`;
}
