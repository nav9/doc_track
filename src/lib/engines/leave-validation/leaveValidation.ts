/**
 * Leave feasibility evaluation.
 *
 * Pure: every input (policy versions, ledger, holidays, leave, duties) is passed
 * in. The result always answers with a verdict AND the reasons for it, so the UI
 * never has to invent an explanation.
 *
 * Verdicts:
 *   possible      — hard policy conditions are satisfied
 *   conditional   — an exception/approval beyond the normal workflow is needed
 *   not-possible  — a hard condition is violated
 *   indeterminate — required policy configuration is missing
 */
import type { CategoryBalance, LedgerTransaction } from '../../domain/ledger/types';
import type { ISODate } from '../../domain/common/types';
import { roundDays } from '../../domain/common/types';
import {
  addDays,
  addMonths,
  eachDate,
  formatDate,
  isWeekend,
  monthKey,
  monthsInRange,
  periodBounds,
  rangeLength,
  yearOf,
  monthOf
} from '../../domain/common/dates';
import type {
  LeaveCategoryRule,
  PolicyVersion
} from '../../domain/policy/types';
import {
  getCategoryRule,
  resolvePolicySegments,
  rhPeriodFor
} from '../policy-engine/policyEngine';
import type { PolicyScope } from '../policy-engine/policyEngine';
import type { Holiday } from '../../domain/calendar/holidays';
import {
  buildHolidayLookup,
  countWorkingDays,
  isGeneralHoliday
} from '../../domain/calendar/holidays';
import type { LeaveRequest, HalfDayPortion, LeaveStatus } from '../../domain/leave/types';
import { isActiveLeave } from '../../domain/leave/types';
import type { EmploymentRecord } from '../../domain/profile/profile';
import type { Duty, PdoRecord } from '../../domain/duty/types';
import type { AttendanceRecord } from '../../domain/attendance/types';
import { computeBalances, allocateCclCredits } from '../leave-accounting/ledgerEngine';
import { computeMonthAttendance } from '../attendance-engine/attendanceEngine';

export type ReasonSeverity = 'error' | 'warning' | 'condition' | 'info';

export interface EvaluationReason {
  code: string;
  severity: ReasonSeverity;
  message: string;
}

export type LeaveVerdict = 'possible' | 'conditional' | 'not-possible' | 'indeterminate';

export interface LeaveEvaluation {
  category: string;
  categoryFullForm: string;
  startDate: ISODate;
  endDate: ISODate;
  halfDay: HalfDayPortion | null;
  calendarDays: number;
  leaveDays: number;
  status: LeaveVerdict;
  reasons: EvaluationReason[];
  consequences: LeaveConsequences;
}

export interface AttendanceImpact {
  monthKey: string;
  projected: number;
  required: number;
  shortage: boolean;
  leaveDays: number;
}

export interface LeaveConsequences {
  availableBefore: number | null;
  availableAfter: number | null;
  approvalRequired: boolean;
  approvalNote: string;
  expiringCredits: { creditId: string; expiryDate: ISODate; amount: number }[];
  attendance: AttendanceImpact[];
  dutyConflicts: ISODate[];
  pdoDates: ISODate[];
  policyVersionIds: string[];
  notes: string[];
}

export interface LeaveValidationContext {
  today: ISODate;
  employment: EmploymentRecord | null;
  policyVersions: PolicyVersion[];
  policyScope?: PolicyScope;
  holidays: Holiday[];
  leaves: LeaveRequest[];
  ledger: LedgerTransaction[];
  duties: Duty[];
  pdos: PdoRecord[];
  attendanceRecords: AttendanceRecord[];
  /** Precomputed balances; recomputed when omitted. */
  balances?: Record<string, CategoryBalance> | null;
  excludeLeaveId?: string | null;
  /** Used when no employment/policy is available. */
  fallbackWeekendDays?: number[];
  fallbackNmcRequired?: number;
  /** Planner search skips NMC projection for speed; it is added for shortlists. */
  skipAttendanceImpact?: boolean;
}

export interface LeaveEvaluationRequest {
  category: string;
  startDate: ISODate;
  endDate: ISODate;
  halfDay?: HalfDayPortion | null;
}

function severityRank(severity: ReasonSeverity): number {
  switch (severity) {
    case 'error':
      return 0;
    case 'condition':
      return 1;
    case 'warning':
      return 2;
    default:
      return 3;
  }
}

export function verdictFromReasons(reasons: EvaluationReason[], indeterminate: boolean): LeaveVerdict {
  if (reasons.some((reason) => reason.severity === 'error')) return 'not-possible';
  if (reasons.some((reason) => reason.severity === 'condition')) return 'conditional';
  if (indeterminate) return 'indeterminate';
  return 'possible';
}

function categoryRemaining(
  category: string,
  rule: LeaveCategoryRule,
  balance: CategoryBalance | null
): number | null {
  if (category === 'LOP') return Number.POSITIVE_INFINITY;
  if (!balance) return null;
  if (!rule.expiry && rule.entitlement.usageCap !== null && rule.entitlement.creditTiming === 'none') {
    return roundDays(Math.max(0, rule.entitlement.usageCap - balance.used));
  }
  return balance.available;
}

function sharesPortion(
  existing: Pick<LeaveRequest, 'startDate' | 'endDate' | 'halfDay'>,
  start: ISODate,
  end: ISODate,
  halfDay: HalfDayPortion | null
): boolean {
  if (existing.endDate < start || end < existing.startDate) return false;
  for (const date of eachDate(start, end)) {
    if (date < existing.startDate || date > existing.endDate) continue;
    const existingPortion = date === existing.startDate ? existing.halfDay ?? 'full' : 'full';
    const nextPortion = date === start && start === end ? halfDay ?? 'full' : 'full';
    if (existingPortion === 'full' || nextPortion === 'full') return true;
    if (existingPortion === nextPortion) return true;
  }
  return false;
}

function policyForRange(context: LeaveValidationContext, start: ISODate, end: ISODate) {
  return resolvePolicySegments(context.policyVersions, start, end, context.policyScope ?? {});
}

function policyScopeFromEmployment(employment: EmploymentRecord | null): PolicyScope {
  if (!employment) return {};
  return {
    organisationId: employment.organisationId,
    department: employment.department,
    employmentType: employment.employmentType
  };
}

function baseContext(context: LeaveValidationContext): LeaveValidationContext {
  if (context.policyScope) return context;
  return { ...context, policyScope: policyScopeFromEmployment(context.employment) };
}

export function evaluateLeaveRequest(
  request: LeaveEvaluationRequest,
  rawContext: LeaveValidationContext
): LeaveEvaluation {
  const context = baseContext(rawContext);
  const reasons: EvaluationReason[] = [];
  const notes: string[] = [];
  let indeterminate = false;

  const startDate = request.startDate;
  const endDate = request.endDate;
  const halfDay = request.halfDay ?? null;
  const category = request.category;

  const segments = policyForRange(context, startDate, endDate);
  const versions = segments
    .map((segment) => segment.version)
    .filter((version): version is PolicyVersion => Boolean(version));
  const uniqueVersions = [...new Map(versions.map((version) => [version.id, version])).values()];
  const missingCoverage = segments.some((segment) => !segment.version);
  const primaryVersion = uniqueVersions[0] ?? null;
  const rule = uniqueVersions
    .map((version) => getCategoryRule(version, category))
    .find((candidate): candidate is LeaveCategoryRule => Boolean(candidate)) ??
    getCategoryRule(primaryVersion, category);

  const weekendDays =
    primaryVersion?.work.weekendDays ?? context.fallbackWeekendDays ?? [0, 6];
  const nmcRequired =
    primaryVersion?.work.nmcRequiredPunchesPerMonth ?? context.fallbackNmcRequired ?? 21;
  const lookup = buildHolidayLookup(context.holidays, weekendDays);

  const emptyConsequences: LeaveConsequences = {
    availableBefore: null,
    availableAfter: null,
    approvalRequired: false,
    approvalNote: '',
    expiringCredits: [],
    attendance: [],
    dutyConflicts: [],
    pdoDates: [],
    policyVersionIds: uniqueVersions.map((version) => version.id),
    notes
  };

  // --- Structural checks -----------------------------------------------------
  const calendarDays = endDate >= startDate ? rangeLength(startDate, endDate) : 0;
  if (endDate < startDate) {
    reasons.push({
      code: 'RANGE_INVALID',
      severity: 'error',
      message: 'The end date cannot be before the start date.'
    });
  }
  if (calendarDays > 366) {
    reasons.push({
      code: 'RANGE_TOO_LONG',
      severity: 'error',
      message: 'A single leave request cannot exceed 366 days.'
    });
  }
  if (halfDay && startDate !== endDate) {
    reasons.push({
      code: 'HALF_DAY_MULTI_DAY',
      severity: 'error',
      message: 'A half day can only be applied to a single date.'
    });
  }
  if (missingCoverage) {
    indeterminate = true;
    reasons.push({
      code: 'POLICY_MISSING',
      severity: 'warning',
      message:
        'No published policy covers part of this range, so those dates cannot be evaluated.'
    });
  }
  if (uniqueVersions.length > 1) {
    reasons.push({
      code: 'POLICY_CROSSES_VERSIONS',
      severity: 'info',
      message: `This range crosses a policy change. ${segments
        .map(
          (segment) =>
            `${segment.start} to ${segment.end}: ${segment.version ? `v${segment.version.version}` : 'no policy'}`
        )
        .join('; ')}.`
    });
  }

  // --- Employment ------------------------------------------------------------
  const employment = context.employment;
  if (!employment) {
    reasons.push({
      code: 'EMPLOYMENT_MISSING',
      severity: 'error',
      message: 'Add an employment record before planning leave.'
    });
  } else {
    if (startDate < employment.startDate) {
      reasons.push({
        code: 'BEFORE_EMPLOYMENT',
        severity: 'error',
        message: `Leave cannot start before the employment start date (${formatDate(
          employment.startDate
        )}).`
      });
    }
    if (employment.endDate && endDate > employment.endDate) {
      reasons.push({
        code: 'AFTER_EMPLOYMENT',
        severity: 'error',
        message: `Leave cannot continue after the employment end date (${formatDate(
          employment.endDate
        )}).`
      });
    }
  }

  if (!rule) {
    indeterminate = true;
    return {
      category,
      categoryFullForm: category,
      startDate,
      endDate,
      halfDay,
      calendarDays,
      leaveDays: 0,
      status: 'indeterminate',
      reasons: [
        ...reasons,
        {
          code: 'CATEGORY_MISSING',
          severity: 'warning',
          message: `The active policy does not define ${category}, so this request cannot be evaluated.`
        }
      ],
      consequences: emptyConsequences
    };
  }

  if (!rule.enabled) {
    reasons.push({
      code: 'CATEGORY_DISABLED',
      severity: 'error',
      message: `${rule.fullForm} (${rule.code}) is disabled by the active policy.`
    });
  }
  if (rule.approval.required) emptyConsequences.approvalRequired = true;
  emptyConsequences.approvalNote = rule.approval.notes;

  // --- Duration and counting ------------------------------------------------
  let leaveDays = calendarDays;
  if (rule.counting === 'working-days') {
    leaveDays = countWorkingDays(startDate, endDate, lookup);
    if (leaveDays < calendarDays) {
      notes.push(
        `${calendarDays - leaveDays} weekend or holiday day${
          calendarDays - leaveDays === 1 ? ' is' : 's are'
        } not consumed by ${rule.code}.`
      );
    }
  }
  if (halfDay) {
    leaveDays = rule.halfDay.allowed ? 0.5 : leaveDays;
    if (!rule.halfDay.allowed) {
      reasons.push({
        code: 'HALF_DAY_NOT_ALLOWED',
        severity: 'error',
        message: `${rule.code} cannot be taken as a half day.`
      });
    }
  }
  if (rule.counting === 'working-days' && leaveDays === 0 && calendarDays > 0) {
    reasons.push({
      code: 'NO_WORKING_DAYS',
      severity: 'info',
      message: 'This range contains no working days, so no leave is consumed.'
    });
  }

  // --- GH is a holiday, not a balance --------------------------------------
  if (rule.code === 'GH') {
    reasons.push({
      code: 'GH_NOT_A_BALANCE',
      severity: 'error',
      message:
        'GH is defined by the published holiday list and is not taken as a leave balance. Add or import the holiday instead.'
    });
  }

  // --- Existing leave conflicts --------------------------------------------
  const others = context.leaves.filter(
    (leave) =>
      isActiveLeave(leave) &&
      leave.id !== (context.excludeLeaveId ?? null) &&
      leave.category !== 'GH'
  );
  const conflicts = others.filter((leave) =>
    sharesPortion(leave, startDate, endDate, halfDay)
  );
  for (const conflict of conflicts) {
    reasons.push({
      code: 'LEAVE_OVERLAP',
      severity: 'error',
      message: `Overlaps ${conflict.category} already recorded for ${formatDate(
        conflict.startDate
      )}${conflict.endDate !== conflict.startDate ? ` to ${formatDate(conflict.endDate)}` : ''}.`
    });
  }

  // --- Balances -------------------------------------------------------------
  const balances =
    context.balances ??
    computeBalances(context.ledger, {
      today: context.today,
      policy: primaryVersion,
      employmentStart: employment?.startDate ?? null,
      academicYearStartMonth: primaryVersion?.work.academicYearStartMonth
    });
  const balance = balances[category] ?? null;
  const remaining = categoryRemaining(category, rule, balance);
  emptyConsequences.availableBefore = remaining;

  const isLop = rule.code === 'LOP';
  if (rule.code !== 'GH' && !isLop) {
    if (rule.minDaysPerRequest !== null && leaveDays > 0 && leaveDays < rule.minDaysPerRequest) {
      const exception = rule.belowMinimumException;
      const canUseException =
        exception?.allowed === true &&
        remaining !== null &&
        remaining < rule.minDaysPerRequest;
      if (canUseException) {
        reasons.push({
          code: 'BELOW_MINIMUM_EXCEPTION',
          severity: 'condition',
          message: `Only ${roundDays(remaining ?? 0)} ${rule.code} day${
            remaining === 1 ? '' : 's'
          } remain, which is below the ${rule.minDaysPerRequest}-day minimum. A written request${
            exception.requiresApproval ? ' and management approval' : ''
          } is required, and this usage is not carried forward.`
        });
      } else {
        reasons.push({
          code: 'BELOW_MINIMUM',
          severity: 'error',
          message: `${rule.code} requires at least ${rule.minDaysPerRequest} days per request.`
        });
      }
    }

    if (rule.maxContinuousDays !== null && calendarDays > rule.maxContinuousDays) {
      reasons.push({
        code: 'MAX_CONTINUOUS',
        severity: 'error',
        message: `This request is ${calendarDays} calendar days, which exceeds the maximum continuous ${rule.code} stretch of ${rule.maxContinuousDays} days.`
      });
    }

    const adjacent = others
      .filter((leave) => leave.category === rule.code)
      .filter(
        (leave) =>
          addDays(leave.endDate, 1) === startDate || addDays(endDate, 1) === leave.startDate
      );
    for (const neighbour of adjacent) {
      const spanStart = neighbour.startDate < startDate ? neighbour.startDate : startDate;
      const spanEnd = neighbour.endDate > endDate ? neighbour.endDate : endDate;
      const span = rangeLength(spanStart, spanEnd);
      if (rule.maxContinuousDays !== null && span > rule.maxContinuousDays) {
        reasons.push({
          code: 'MERGE_EXCEEDS_MAX',
          severity: 'error',
          message: `Merging with the adjacent ${rule.code} request would create a ${span}-day episode, above the ${rule.maxContinuousDays}-day maximum.`
        });
      } else {
        reasons.push({
          code: 'MERGE_INFORMATION',
          severity: 'info',
          message: `This request is adjacent to an existing ${rule.code} episode and will be treated as one continuous episode of ${span} days.`
        });
      }
    }

    if (rule.maxDaysPerMonth !== null) {
      const monthly = new Map<string, number>();
      for (const date of eachDate(startDate, endDate)) {
        if (rule.counting === 'working-days' && (isWeekend(date, weekendDays) || isGeneralHoliday(date, lookup))) {
          continue;
        }
        const key = monthKey(date);
        monthly.set(key, roundDays((monthly.get(key) ?? 0) + 1));
      }
      if (halfDay && monthly.size === 1) {
        const key = [...monthly.keys()][0];
        monthly.set(key, 0.5);
      }
      for (const [key, days] of monthly) {
        let existing = 0;
        for (const leave of others) {
          if (leave.category !== rule.code) continue;
          for (const date of eachDate(leave.startDate, leave.endDate)) {
            if (monthKey(date) !== key) continue;
            if (rule.counting === 'working-days' && (isWeekend(date, weekendDays) || isGeneralHoliday(date, lookup))) {
              continue;
            }
            existing += date === leave.startDate && leave.halfDay ? 0.5 : 1;
          }
        }
        if (roundDays(existing + days) > rule.maxDaysPerMonth) {
          reasons.push({
            code: 'MONTHLY_LIMIT',
            severity: 'error',
            message: `This would use ${roundDays(existing + days)} ${rule.code} days in ${
              key
            }, above the limit of ${rule.maxDaysPerMonth} per month.`
          });
        }
      }
    }

    if (rule.cooldown) {
      const previousEpisodes = others
        .filter((leave) => leave.category === rule.code)
        .filter((leave) => leave.endDate < startDate)
        .sort((a, b) => (a.endDate < b.endDate ? 1 : -1));
      const previous = previousEpisodes[0];
      if (previous) {
        const canStart = addDays(addMonths(previous.endDate, rule.cooldown.months), 1);
        const adjacentToPrevious = addDays(previous.endDate, 1) === startDate;
        if (!adjacentToPrevious && startDate < canStart) {
          reasons.push({
            code: 'COOLDOWN',
            severity: 'error',
            message: `${rule.code} can start again on ${formatDate(
              canStart
            )} — three calendar months after the previous episode ended on ${formatDate(
              previous.endDate
            )}.`
          });
        }
      }
    }

    if (rule.eligibility && employment) {
      const eligibleFrom = addMonths(employment.startDate, rule.eligibility.minServiceMonths);
      if (startDate < eligibleFrom) {
        reasons.push({
          code: 'ELIGIBILITY_SERVICE',
          severity: 'error',
          message: `${rule.code} requires ${rule.eligibility.minServiceMonths} months of service. Eligibility begins on ${formatDate(
            eligibleFrom
          )}.`
        });
      }
    }

    if (rule.entitlement.usageCap !== null && !rule.expiry) {
      const period = periodBounds(rule.entitlement.period, startDate, {
        employmentStart: employment?.startDate ?? null,
        academicYearStartMonth: primaryVersion?.work.academicYearStartMonth
      });
      let usedInPeriod = 0;
      for (const leave of others) {
        if (leave.category !== rule.code) continue;
        if (leave.endDate < period.start || leave.startDate > period.end) continue;
        usedInPeriod += leave.leaveDays;
      }
      if (roundDays(usedInPeriod + leaveDays) > rule.entitlement.usageCap) {
        reasons.push({
          code: 'ANNUAL_CAP',
          severity: 'error',
          message: `${rule.code} is limited to ${rule.entitlement.usageCap} days per ${
            period.label
          }. ${roundDays(usedInPeriod)} day${
            usedInPeriod === 1 ? ' is' : 's are'
          } already recorded, so this request exceeds the limit.`
        });
      }
    }

    if (category === 'CCL') {
      const validity = allocateCclCredits(context.ledger, leaveDays, endDate);
      if (validity.shortfall > 0) {
        reasons.push({
          code: 'CCL_INSUFFICIENT_VALID',
          severity: 'error',
          message: `Only ${validity.available} CCL day${
            validity.available === 1 ? '' : 's'
          } remain valid through ${formatDate(endDate)}. CCL credits expire three calendar months after the date earned.`
        });
      } else if (validity.allocations.length > 0) {
        const credits = validity.allocations.map((allocation) => {
          const transaction = context.ledger.find((entry) => entry.id === allocation.creditId);
          return {
            creditId: allocation.creditId,
            amount: allocation.amount,
            expiryDate: transaction?.expiryDate ?? endDate
          };
        });
        emptyConsequences.expiringCredits = credits;
        const earliest = credits
          .map((credit) => credit.expiryDate)
          .sort((a, b) => a.localeCompare(b))[0];
        if (earliest) {
          reasons.push({
            code: 'CCL_ALLOCATED',
            severity: 'info',
            message: `This will consume ${leaveDays} CCL day${
              leaveDays === 1 ? '' : 's'
            }, earliest-expiring credit first; the earliest used credit expires on ${formatDate(
              earliest
            )}.`
          });
        }
      }
    } else if (category !== 'RH' && remaining !== null && Number.isFinite(remaining)) {
      if (roundDays(remaining) < leaveDays) {
        reasons.push({
          code: 'INSUFFICIENT_BALANCE',
          severity: 'error',
          message: `${roundDays(remaining)} ${rule.code} day${
            roundDays(remaining) === 1 ? '' : 's'
          } available, but ${leaveDays} required. The excess would have to be LOP or another category.`
        });
      } else {
        reasons.push({
          code: 'BALANCE_OK',
          severity: 'info',
          message: `${roundDays(remaining)} ${rule.code} day${
            roundDays(remaining) === 1 ? '' : 's'
          } available; ${leaveDays} would remain after this request.`
        });
      }
    }

    if (rule.negativeBalanceAllowed && remaining !== null && remaining < leaveDays) {
      reasons.push({
        code: 'LOP_ALLOWED',
        severity: 'warning',
        message: 'The shortfall is recorded as loss of pay.'
      });
    }
  }

  // --- RH six-month period --------------------------------------------------
  if (category === 'RH') {
    if (!employment?.startDate) {
      indeterminate = true;
      reasons.push({
        code: 'RH_NO_JOINING_DATE',
        severity: 'warning',
        message: 'RH entitlement depends on the joining date, which is not configured.'
      });
    } else {
      const period = rhPeriodFor(employment.startDate, startDate);
      if (!period) {
        indeterminate = true;
        reasons.push({
          code: 'RH_PERIOD_UNKNOWN',
          severity: 'warning',
          message: 'The six-month RH period for this date could not be determined.'
        });
      } else {
        const usedInPeriod = others.filter(
          (leave) =>
            leave.category === 'RH' && leave.startDate >= period.start && leave.startDate <= period.end
        ).length;
        const entitlement = rule.entitlement.amount ?? 1;
        if (usedInPeriod + 1 > entitlement) {
          reasons.push({
            code: 'RH_PERIOD_USED',
            severity: 'error',
            message: `${usedInPeriod} RH already recorded in this six-month period (${formatDate(
              period.start
            )} to ${formatDate(period.end)}). Only ${entitlement} is available per period.`
          });
        } else {
          emptyConsequences.availableBefore = Math.max(0, entitlement - usedInPeriod);
          emptyConsequences.availableAfter = Math.max(
            0,
            entitlement - usedInPeriod - 1
          );
          reasons.push({
            code: 'RH_PERIOD_AVAILABLE',
            severity: 'info',
            message: `RH is available in the period ${formatDate(period.start)} to ${formatDate(
              period.end
            )}.`
          });
        }
      }
    }
    if (!isGeneralHoliday(startDate, lookup)) {
      notes.push('RH dates normally follow the published restricted-holiday list.');
    }
  }

  // --- Approval and retrospective status -----------------------------------
  if (rule.approval.required) {
    reasons.push({
      code: 'APPROVAL_REQUIRED',
      severity: 'info',
      message:
        rule.approval.notes ||
        'Management approval is required; policy eligibility does not guarantee approval.'
    });
  }
  if (startDate < context.today && category !== 'LOP') {
    if (rule.retrospectiveAllowed) {
      reasons.push({
        code: 'RETROSPECTIVE_ALLOWED',
        severity: 'warning',
        message: 'This leave is back-dated. The policy allows retrospective leave subject to approval.'
      });
    } else {
      reasons.push({
        code: 'RETROSPECTIVE_NOT_ALLOWED',
        severity: 'warning',
        message: `${rule.code} is not normally recorded retrospectively; management approval is required.`
      });
    }
  }

  // --- Duty and PDO interactions -------------------------------------------
  const dutyConflicts = context.duties
    .filter(
      (duty) =>
        duty.status !== 'cancelled' && duty.date >= startDate && duty.date <= endDate
    )
    .map((duty) => duty.date);
  if (dutyConflicts.length > 0) {
    reasons.push({
      code: 'DUTY_CONFLICT',
      severity: 'warning',
      message: `A duty is recorded on ${dutyConflicts
        .map((date) => formatDate(date))
        .join(', ')}. Arrange a swap or choose different dates.`
    });
  }
  const pdoDates = context.pdos
    .filter(
      (pdo) =>
        pdo.status === 'scheduled' && pdo.date >= startDate && pdo.date <= endDate
    )
    .map((pdo) => pdo.date);
  if (pdoDates.length > 0) {
    reasons.push({
      code: 'PDO_IN_RANGE',
      severity: 'info',
      message: `Post-duty off is already scheduled on ${pdoDates
        .map((date) => formatDate(date))
        .join(', ')}; you may not need leave on those days.`
    });
  }

  // --- NMC attendance impact ------------------------------------------------
  const attendance: AttendanceImpact[] = [];
  for (const key of context.skipAttendanceImpact ? [] : monthsInRange(startDate, endDate)) {
    const [year, month] = key.split('-').map(Number);
    const report = computeMonthAttendance({
      year,
      month,
      weekendDays,
      holidays: context.holidays,
      leaves: context.leaves,
      records: context.attendanceRecords,
      required: nmcRequired,
      today: context.today,
      extraLeave: {
        category,
        startDate,
        endDate,
        halfDay
      }
    });
    attendance.push({
      monthKey: key,
      projected: report.projectedTotal,
      required: report.required,
      shortage: report.projectedShortage,
      leaveDays: report.leaveDays
    });
    if (report.projectedShortage) {
      reasons.push({
        code: 'NMC_PROJECTED_SHORTAGE',
        severity: 'warning',
        message: `Planned leave would leave ${key} with about ${report.projectedTotal} NMC punches against a requirement of ${report.required}. A Sunday punch or a shorter break may be needed.`
      });
    }
  }

  // --- Result ---------------------------------------------------------------
  if (category !== 'RH') {
    emptyConsequences.availableAfter =
      remaining !== null && Number.isFinite(remaining)
        ? roundDays(remaining - leaveDays)
        : null;
  }
  emptyConsequences.attendance = attendance;
  emptyConsequences.dutyConflicts = dutyConflicts;
  emptyConsequences.pdoDates = pdoDates;

  reasons.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  return {
    category,
    categoryFullForm: rule.fullForm,
    startDate,
    endDate,
    halfDay,
    calendarDays,
    leaveDays: roundDays(leaveDays),
    status: verdictFromReasons(reasons, indeterminate),
    reasons,
    consequences: emptyConsequences
  };
}

export function evaluationSummary(evaluation: LeaveEvaluation): string {
  switch (evaluation.status) {
    case 'possible':
      return 'Possible';
    case 'conditional':
      return 'Conditionally possible';
    case 'not-possible':
      return 'Not possible';
    case 'indeterminate':
      return 'Cannot be determined';
  }
}

export function evaluationTone(status: LeaveVerdict): 'success' | 'warning' | 'danger' | 'muted' {
  switch (status) {
    case 'possible':
      return 'success';
    case 'conditional':
      return 'warning';
    case 'not-possible':
      return 'danger';
    case 'indeterminate':
      return 'muted';
  }
}

/** Leave records that should count as existing usage for a given status. */
export function statusConsumesBalance(status: LeaveStatus): boolean {
  return status !== 'cancelled' && status !== 'rejected';
}

export function isWithinMonth(date: ISODate, year: number, month: number): boolean {
  return yearOf(date) === year && monthOf(date) === month;
}
