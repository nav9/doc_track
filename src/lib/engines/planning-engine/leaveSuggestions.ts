/**
 * Leave maximisation suggestions for the year planner.
 *
 * Suggestions are intentionally anchored: nothing is proposed until the doctor
 * has entered a leave, and only working days near that leave are considered.
 * A candidate must connect the anchored break to a weekend, holiday or another
 * recorded leave block. Category selection is constrained by the active policy
 * balance and the category's monthly limit, so a suggestion never promises more
 * CL than the month allows.
 */
import type { ISODate } from '../../domain/common/types';
import type { Holiday } from '../../domain/calendar/holidays';
import type { LeaveStatus } from '../../domain/leave/types';
import { addDays, eachDate, isWeekend, monthKey } from '../../domain/common/dates';

export interface LeaveSuggestion {
  category: string;
  label: string;
  reason: string;
}

export interface LeaveSuggestionAnchor {
  startDate: ISODate;
  endDate: ISODate;
}

export interface LeaveSuggestionRule {
  code: string;
  available: number;
  maxDaysPerMonth: number | null;
  minDaysPerRequest: number | null;
}

export interface LeaveSuggestionInput {
  year: number;
  anchor: LeaveSuggestionAnchor | null;
  leaves: {
    startDate: ISODate;
    endDate: ISODate;
    category: string;
    status: LeaveStatus;
  }[];
  holidays: Holiday[];
  weekendDays: number[];
  rules: LeaveSuggestionRule[];
}

const SUGGESTION_ORDER = ['CCL', 'CL'];
const WINDOW_DAYS = 7;

export function buildLeaveSuggestions(input: LeaveSuggestionInput): Record<string, LeaveSuggestion> {
  if (!input.anchor) return {};

  const leaveDates = new Set<string>();
  const monthlyUsage = new Map<string, number>();
  for (const leave of input.leaves) {
    if (leave.status === 'cancelled' || leave.status === 'rejected') continue;
    for (const date of eachDate(leave.startDate, leave.endDate)) {
      leaveDates.add(date);
      const key = `${leave.category}:${monthKey(date)}`;
      monthlyUsage.set(key, (monthlyUsage.get(key) ?? 0) + 1);
    }
  }

  const holidayDates = new Set(input.holidays.map((holiday) => holiday.date));
  const anchorStart = input.anchor.startDate;
  const anchorEnd = input.anchor.endDate;
  const inAnchor = (date: ISODate) => date >= anchorStart && date <= anchorEnd;
  const off = (date: ISODate): boolean =>
    isWeekend(date, input.weekendDays) || holidayDates.has(date) || leaveDates.has(date);

  const remaining = new Map(
    input.rules.map((rule) => [rule.code, Math.max(0, rule.available)])
  );

  function chooseCategory(date: ISODate): LeaveSuggestionRule | null {
    for (const code of SUGGESTION_ORDER) {
      const rule = input.rules.find((item) => item.code === code);
      if (!rule || (remaining.get(code) ?? 0) <= 0) continue;
      if ((rule.minDaysPerRequest ?? 1) > 1) continue;
      if (rule.maxDaysPerMonth !== null) {
        const used = monthlyUsage.get(`${code}:${monthKey(date)}`) ?? 0;
        if (used >= rule.maxDaysPerMonth) continue;
      }
      return rule;
    }
    return null;
  }

  const yearStart = `${input.year}-01-01`;
  const yearEnd = `${input.year}-12-31`;
  const windowStart = addDays(anchorStart, -WINDOW_DAYS);
  const windowEnd = addDays(anchorEnd, WINDOW_DAYS);
  const start = windowStart < yearStart ? yearStart : windowStart;
  const end = windowEnd > yearEnd ? yearEnd : windowEnd;

  const suggestions: Record<string, LeaveSuggestion> = {};

  for (const date of eachDate(start, end)) {
    if (off(date)) continue;

    let before = 0;
    let beforeTouchesAnchor = false;
    let cursor = addDays(date, -1);
    while (before < 5 && off(cursor)) {
      if (inAnchor(cursor)) beforeTouchesAnchor = true;
      before += 1;
      cursor = addDays(cursor, -1);
    }

    let after = 0;
    let afterTouchesAnchor = false;
    cursor = addDays(date, 1);
    while (after < 5 && off(cursor)) {
      if (inAnchor(cursor)) afterTouchesAnchor = true;
      after += 1;
      cursor = addDays(cursor, 1);
    }

    // Only bridge days connected to the leave the doctor entered.
    if (!beforeTouchesAnchor && !afterTouchesAnchor) continue;
    if (before + after < 2) continue;

    const rule = chooseCategory(date);
    if (!rule) continue;

    const key = `${rule.code}:${monthKey(date)}`;
    monthlyUsage.set(key, (monthlyUsage.get(key) ?? 0) + 1);
    remaining.set(rule.code, Math.max(0, (remaining.get(rule.code) ?? 0) - 1));

    const reason =
      before > 0 && after > 0
        ? `Fills the gap between ${before} day${before === 1 ? '' : 's'} before and ${after} day${after === 1 ? '' : 's'} after.`
        : `Adds a day to the ${before + after}-day break next to this date.`;
    suggestions[date] = {
      category: rule.code,
      label: rule.code,
      reason
    };
  }

  return suggestions;
}
