/**
 * Dashboard recommendations.
 *
 * Every recommendation is derived from actual ledger, duty or attendance data
 * and carries a plain-English reason. No AI and no fabricated events.
 */
import type { ISODate } from '../../domain/common/types';
import {
  addDays,
  addMonths,
  dayOfWeek,
  daysInMonth,
  formatDate,
  monthKeyOf,
  rangeLength,
  todayLocal
} from '../../domain/common/dates';
import type { CategoryBalance, LedgerTransaction } from '../../domain/ledger/types';
import { creditLots, isCreditValidOn } from '../leave-accounting/ledgerEngine';
import type { PolicyVersion } from '../../domain/policy/types';
import { getCategoryRule } from '../policy-engine/policyEngine';
import type { Duty, PdoRecord } from '../../domain/duty/types';
import type { LeaveRequest } from '../../domain/leave/types';
import { isActiveLeave } from '../../domain/leave/types';
import type { Holiday } from '../../domain/calendar/holidays';
import { buildHolidayLookup } from '../../domain/calendar/holidays';
import type { MonthAttendanceResult } from '../attendance-engine/attendanceEngine';
import type { CalendarEvent } from '../../domain/calendar/holidays';
import { backupDue } from '../../domain/settings/types';
import type { AppSettings } from '../../domain/settings/types';

export type RecommendationAction =
  | {
      type: 'planner';
      category?: string;
      startDate?: ISODate;
      endDate?: ISODate;
      focus?: 'ccl' | 'long-break' | 'cl' | 'el';
    }
  | { type: 'attendance'; monthKey: string }
  | { type: 'duty' }
  | { type: 'backup' }
  | { type: 'rules' };

export type RecommendationSeverity = 'opportunity' | 'warning' | 'info';

export interface Recommendation {
  id: string;
  kind:
    | 'ccl-expiring'
    | 'cl-unused'
    | 'long-break'
    | 'nmc-shortage'
    | 'event-conflict'
    | 'backup'
    | 'el-window'
    | 'duty-missing-pdo';
  severity: RecommendationSeverity;
  title: string;
  explanation: string;
  action: RecommendationAction;
}

export interface RecommendationInput {
  today?: ISODate;
  balances: Record<string, CategoryBalance>;
  ledger: LedgerTransaction[];
  leaves: LeaveRequest[];
  duties: Duty[];
  pdos: PdoRecord[];
  holidays: Holiday[];
  events: CalendarEvent[];
  attendance: MonthAttendanceResult | null;
  policy: PolicyVersion | null;
  settings: AppSettings;
}

function isAvailableDate(date: ISODate, leaves: LeaveRequest[], duties: Duty[]): boolean {
  const onLeave = leaves.some(
    (leave) => isActiveLeave(leave) && date >= leave.startDate && date <= leave.endDate
  );
  const onDuty = duties.some((duty) => duty.status !== 'cancelled' && duty.date === date);
  return !onLeave && !onDuty;
}

/** Finds weekday dates next to a weekend that are free, used for CCL/CL ideas. */
function nearbyFreeDates(
  from: ISODate,
  limit: number,
  leaves: LeaveRequest[],
  duties: Duty[],
  count = 3
): ISODate[] {
  const result: ISODate[] = [];
  let cursor = from;
  for (let index = 0; index < limit && result.length < count; index += 1) {
    const weekday = dayOfWeek(cursor);
    if (weekday !== 0 && weekday !== 6 && isAvailableDate(cursor, leaves, duties)) {
      result.push(cursor);
    }
    cursor = addDays(cursor, 1);
  }
  return result;
}

export function buildRecommendations(input: RecommendationInput): Recommendation[] {
  const today = input.today ?? todayLocal();
  const recommendations: Recommendation[] = [];
  const weekendDays = input.policy?.work.weekendDays ?? [0, 6];
  const lookup = buildHolidayLookup(input.holidays, weekendDays);

  // --- CCL credits expiring soon -------------------------------------------
  const cclLots = creditLots(input.ledger, 'CCL')
    .filter((lot) => lot.remaining > 0 && lot.expiryDate !== null && isCreditValidOn(lot, today))
    .sort((a, b) => (a.expiryDate ?? '').localeCompare(b.expiryDate ?? ''));
  if (cclLots.length > 0) {
    const earliest = cclLots[0];
    const expiry = earliest.expiryDate as ISODate;
    const freeDates = nearbyFreeDates(today, 45, input.leaves, input.duties);
    const daysUntil = rangeLength(today, expiry);
    if (daysUntil <= 45) {
      recommendations.push({
        id: `ccl-expiry-${earliest.id}`,
        kind: 'ccl-expiring',
        severity: 'warning',
        title: `${cclLots.length} CCL credit${cclLots.length === 1 ? '' : 's'} expiring`,
        explanation: `${earliest.remaining} CCL day${
          earliest.remaining === 1 ? '' : 's'
        } earned on ${formatDate(earliest.effectiveDate)} expire${
          earliest.remaining === 1 ? 's' : ''
        } on ${formatDate(expiry)} (${daysUntil} days from today).${
          freeDates.length
            ? ` Possible dates that are currently free: ${freeDates.map((date) => formatDate(date)).join(', ')}.`
            : ''
        }`,
        action: {
          type: 'planner',
          category: 'CCL',
          startDate: today,
          endDate: expiry,
          focus: 'ccl'
        }
      });
    }
  }

  // --- CL that would otherwise lapse --------------------------------------
  const clBalance = input.balances.CL;
  const clRule = getCategoryRule(input.policy, 'CL');
  if (clBalance && clBalance.available > 0) {
    const year = Number(today.slice(0, 4));
    const yearEnd = `${year}-12-31`;
    const monthsLeft = Math.max(
      0,
      (Number(yearEnd.slice(0, 4)) - Number(today.slice(0, 4))) * 12 +
        Number(yearEnd.slice(5, 7)) -
        Number(today.slice(5, 7))
    );
    const monthlyLimit = clRule?.maxDaysPerMonth ?? 3;
    if (monthsLeft <= 4) {
      const dates = nearbyFreeDates(today, 40, input.leaves, input.duties, 4);
      recommendations.push({
        id: 'cl-unused',
        kind: 'cl-unused',
        severity: monthsLeft <= 2 ? 'warning' : 'opportunity',
        title: 'Use CL before it lapses',
        explanation: `${clBalance.available} CL day${
          clBalance.available === 1 ? ' remains' : 's remain'
        } for ${year}. CL cannot be encashed or carried forward, and at most ${monthlyLimit} CL days can be used per calendar month.${
          dates.length ? ` Free weekdays soon: ${dates.map((date) => formatDate(date)).join(', ')}.` : ''
        }`,
        action: {
          type: 'planner',
          category: 'CL',
          startDate: today,
          endDate: yearEnd,
          focus: 'cl'
        }
      });
    }
  }

  // --- Upcoming PDO that can become a long break ---------------------------
  const upcomingPdo = input.pdos
    .filter(
      (pdo) =>
        (pdo.status === 'scheduled' || pdo.status === 'converted-holiday') &&
        pdo.date >= today &&
        pdo.date <= addDays(today, 60)
    )
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  if (upcomingPdo) {
    const pdoDate = upcomingPdo.date;
    let end = pdoDate;
    const next = addDays(pdoDate, 1);
    if (lookup.dates.has(next) || weekendDays.includes(dayOfWeek(next))) end = next;
    const nextAfter = addDays(end, 1);
    if (lookup.dates.has(nextAfter) || weekendDays.includes(dayOfWeek(nextAfter))) end = nextAfter;
    const breakDays = rangeLength(pdoDate, end);
    const followingFree = nearbyFreeDates(addDays(end, 1), 14, input.leaves, input.duties, 1)[0];
    const suggestionDates = followingFree ? ` Add one CL or CCL day on ${formatDate(followingFree)} to extend it.` : '';
    recommendations.push({
      id: `pdo-break-${upcomingPdo.id}`,
      kind: 'long-break',
      severity: 'opportunity',
      title: `A ${breakDays}-day break from a PDO`,
      explanation: `Post-duty off on ${formatDate(
        pdoDate
      )}${end !== pdoDate ? ` runs into ${formatDate(end)}` : ''}, giving ${breakDays} day${
        breakDays === 1 ? '' : 's'
      } off without using leave.${suggestionDates}`,
      action: {
        type: 'planner',
        category: 'CL',
        startDate: pdoDate,
        endDate: addDays(end, 14),
        focus: 'long-break'
      }
    });
  }

  // --- NMC attendance shortage --------------------------------------------
  if (input.attendance) {
    const report = input.attendance;
    if (report.shortage) {
      recommendations.push({
        id: `nmc-${monthKeyOf(report.year, report.month)}`,
        kind: 'nmc-shortage',
        severity: 'warning',
        title: 'NMC punches below 21',
        explanation: `${report.year}-${String(report.month).padStart(2, '0')} has ${report.confirmed} confirmed and ${report.assumed} assumed punches, totalling ${report.total}. ${report.missing} more punch${
          report.missing === 1 ? '' : 'es'
        } are needed. A Sunday punch is allowed to make up a shortage.`,
        action: { type: 'attendance', monthKey: monthKeyOf(report.year, report.month) }
      });
    }
  }

  // --- Academic event clashing with planned leave -------------------------
  const upcomingEvents = input.events
    .filter((event) => event.date >= today && event.date <= addDays(today, 60))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const event of upcomingEvents) {
    const clash = input.leaves.find(
      (leave) => isActiveLeave(leave) && event.date >= leave.startDate && event.date <= leave.endDate
    );
    if (clash) {
      recommendations.push({
        id: `event-conflict-${event.id}`,
        kind: 'event-conflict',
        severity: 'warning',
        title: `“${event.title}” overlaps ${clash.category}`,
        explanation: `${event.title} is scheduled on ${formatDate(
          event.date
        )}, inside the ${clash.category} leave from ${formatDate(clash.startDate)} to ${formatDate(
          clash.endDate
        )}. Confirm with the department or adjust the plan.`,
        action: {
          type: 'planner',
          category: clash.category,
          startDate: clash.startDate,
          endDate: clash.endDate
        }
      });
    }
  }

  // --- EL window -----------------------------------------------------------
  const elRule = getCategoryRule(input.policy, 'EL');
  if (elRule?.enabled && input.balances.EL && input.balances.EL.available > 0) {
    const lastEl = input.leaves
      .filter((leave) => isActiveLeave(leave) && leave.category === 'EL')
      .sort((a, b) => (a.endDate < b.endDate ? 1 : -1))[0];
    const cooldownMonths = elRule.cooldown?.months ?? 3;
    const nextWindow = lastEl
      ? addDays(addMonths(lastEl.endDate, cooldownMonths), 1)
      : today;
    const minService = elRule.eligibility?.minServiceMonths ?? 0;
    const minDays = elRule.minDaysPerRequest ?? 4;
    if (nextWindow <= addDays(today, 120)) {
      recommendations.push({
        id: 'el-window',
        kind: 'el-window',
        severity: 'info',
        title: 'EL episode available',
        explanation: `${input.balances.EL.available} EL day${
          input.balances.EL.available === 1 ? '' : 's'
        } can be used. EL needs at least ${minDays} days per episode and ${
          lastEl ? `the next window opens on ${formatDate(nextWindow)}` : 'the first episode can start now'
        }. ${
          minService > 0
            ? `Eligibility requires ${minService} months of service. `
            : ''
        }An EL episode can run up to ${elRule.maxContinuousDays ?? 8} calendar days, once every ${cooldownMonths} calendar months.`,
        action: { type: 'planner', category: 'EL', focus: 'el', startDate: nextWindow }
      });
    }
  }

  // --- Backup reminder -----------------------------------------------------
  if (backupDue(input.settings, today)) {
    recommendations.push({
      id: 'backup-due',
      kind: 'backup',
      severity: 'warning',
      title: 'Back up your data',
      explanation: input.settings.lastBackupAt
        ? `The last backup was on ${formatDate(input.settings.lastBackupAt.slice(0, 10))}. Browser storage can be cleared by the browser or the operating system, so keep an export outside the browser.`
        : 'No backup has been recorded yet. Browser storage can be cleared by the browser or the operating system, so export your data and keep the file somewhere safe.',
      action: { type: 'backup' }
    });
  }

  // --- Duties without a PDO record ---------------------------------------
  const missingPdo = input.duties.find(
    (duty) =>
      duty.status === 'completed' &&
      !input.pdos.some((pdo) => pdo.dutyId === duty.id)
  );
  if (missingPdo) {
    recommendations.push({
      id: `duty-pdo-${missingPdo.id}`,
      kind: 'duty-missing-pdo',
      severity: 'warning',
      title: 'Completed duty has no PDO record',
      explanation: `The duty on ${formatDate(
        missingPdo.date
      )} is marked completed but has no post-duty off. Re-save the duty so the policy consequences are applied.`,
      action: { type: 'duty' }
    });
  }

  return recommendations;
}

/** Returns the calendar days of a month for the attendance page. */
export function monthDayCount(year: number, month: number): number {
  return daysInMonth(year, month);
}
