/**
 * Planning engine.
 *
 * Pipeline (kept strictly in this order):
 *   1. candidate date generation
 *   2. hard-rule validation (reusing the leave validation engine)
 *   3. consequence calculation
 *   4. ranking
 *   5. explanation (the validation reasons, kept verbatim)
 *
 * Invalid candidates are never ranked as alternatives. Ranking only orders
 * candidates that already passed hard validation.
 */
import type { ISODate } from '../../domain/common/types';
import {
  addDays,
  eachDate,
  formatDate,
  isSameOrBefore,
  monthKey,
  rangeLength
} from '../../domain/common/dates';
import type { Holiday } from '../../domain/calendar/holidays';
import { buildHolidayLookup, isNonWorkingDay } from '../../domain/calendar/holidays';
import { isActiveLeave, type LeaveRequest } from '../../domain/leave/types';
import type { CategoryBalance } from '../../domain/ledger/types';
import { getCategoryRule, resolvePolicySegments } from '../policy-engine/policyEngine';
import { computeBalances } from '../leave-accounting/ledgerEngine';
import type {
  EvaluationReason,
  LeaveEvaluation,
  LeaveValidationContext,
  LeaveVerdict
} from '../leave-validation/leaveValidation';
import { evaluateLeaveRequest } from '../leave-validation/leaveValidation';
import { computeMonthAttendance } from '../attendance-engine/attendanceEngine';

export interface ExactRangeQuery {
  startDate: ISODate;
  endDate: ISODate;
  categories: string[];
}

export interface SearchQuery {
  startDate: ISODate;
  endDate: ISODate;
  categories: string[];
  minBreakDays?: number;
  maxLeaveDays?: number;
  preferredStart?: ISODate | null;
  preferredEnd?: ISODate | null;
  /** Cap on validated candidates; protects low-end phones. */
  maxCandidates?: number;
}

export interface RankingWeights {
  breakLength: number;
  fewerLeaveDays: number;
  expiringCredits: number;
  attendance: number;
  preference: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  breakLength: 35,
  fewerLeaveDays: 20,
  expiringCredits: 15,
  attendance: 15,
  preference: 15
};

export interface PlanCandidate {
  id: string;
  category: string;
  startDate: ISODate;
  endDate: ISODate;
  calendarDays: number;
  leaveDays: number;
  breakDays: number;
  status: LeaveVerdict;
  score: number;
  reasons: EvaluationReason[];
  evaluation: LeaveEvaluation;
  expiringCreditCount: number;
}

function weekendDaysFrom(context: LeaveValidationContext): number[] {
  const segments = resolvePolicySegments(
    context.policyVersions,
    context.today,
    context.today,
    context.policyScope ?? {}
  );
  return segments[0]?.version?.work.weekendDays ?? context.fallbackWeekendDays ?? [0, 6];
}

function balancesFor(context: LeaveValidationContext): Record<string, CategoryBalance> {
  if (context.balances) return context.balances;
  const segments = resolvePolicySegments(
    context.policyVersions,
    context.today,
    context.today,
    context.policyScope ?? {}
  );
  const policy = segments[0]?.version ?? null;
  return computeBalances(context.ledger, {
    today: context.today,
    policy,
    employmentStart: context.employment?.startDate ?? null,
    academicYearStartMonth: policy?.work.academicYearStartMonth
  });
}

/**
 * Extends a leave range across adjacent weekends, holidays and recorded leave.
 * Recorded leave is already time away from work, so a new proposal that touches
 * it can turn two shorter breaks into one longer one.
 */
export function continuousBreak(
  start: ISODate,
  end: ISODate,
  holidays: Holiday[],
  weekendDays: number[],
  fixedLeaves: Pick<LeaveRequest, 'startDate' | 'endDate' | 'status'>[] = []
): { breakStart: ISODate; breakEnd: ISODate; breakDays: number } {
  const lookup = buildHolidayLookup(holidays, weekendDays);
  const activeFixedLeaves = fixedLeaves.filter(isActiveLeave);
  const isBreakDay = (date: ISODate): boolean =>
    isNonWorkingDay(date, lookup) ||
    activeFixedLeaves.some((leave) => date >= leave.startDate && date <= leave.endDate);
  let breakStart = start;
  let breakEnd = end;
  while (isBreakDay(addDays(breakStart, -1)) && rangeLength(addDays(breakStart, -1), breakEnd) < 60) {
    breakStart = addDays(breakStart, -1);
  }
  while (isBreakDay(addDays(breakEnd, 1)) && rangeLength(breakStart, addDays(breakEnd, 1)) < 60) {
    breakEnd = addDays(breakEnd, 1);
  }
  return { breakStart, breakEnd, breakDays: rangeLength(breakStart, breakEnd) };
}

export function checkExactRange(
  query: ExactRangeQuery,
  context: LeaveValidationContext
): LeaveEvaluation[] {
  const balances = balancesFor(context);
  return query.categories.map((category) =>
    evaluateLeaveRequest(
      {
        category,
        startDate: query.startDate,
        endDate: query.endDate,
        halfDay: null
      },
      { ...context, balances }
    )
  );
}

function scoreCandidate(
  candidate: PlanCandidate,
  weights: RankingWeights,
  query: SearchQuery
): number {
  const breakScore = Math.min(candidate.breakDays / 10, 1);
  const leaveEfficiency =
    candidate.leaveDays > 0 ? Math.min(candidate.breakDays / (candidate.leaveDays * 2), 1) : 0;
  const fewerLeave = 1 - Math.min(candidate.leaveDays / 8, 1);
  const expiring = candidate.expiringCreditCount > 0 ? 1 : 0;
  const attendanceOk = candidate.evaluation.consequences.attendance.every(
    (impact) => !impact.shortage
  )
    ? 1
    : 0;
  const preference =
    query.preferredStart && candidate.startDate === query.preferredStart
      ? 1
      : query.preferredStart &&
          candidate.startDate >= query.preferredStart &&
          (!query.preferredEnd || candidate.endDate <= query.preferredEnd)
        ? 0.7
        : 0.35;

  const totalWeight =
    weights.breakLength +
    weights.fewerLeaveDays +
    weights.expiringCredits +
    weights.attendance +
    weights.preference;

  const weighted =
    breakScore * weights.breakLength +
    ((leaveEfficiency + fewerLeave) / 2) * weights.fewerLeaveDays +
    expiring * weights.expiringCredits +
    attendanceOk * weights.attendance +
    preference * weights.preference;

  return Math.round((weighted / Math.max(1, totalWeight)) * 100);
}

/**
 * Searches a window for valid leave intervals. Each start date and duration is
 * validated through the same hard-rule engine used for an exact request.
 */
export function searchCandidates(
  query: SearchQuery,
  rawContext: LeaveValidationContext,
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS
): PlanCandidate[] {
  if (query.endDate < query.startDate) return [];
  if (rangeLength(query.startDate, query.endDate) > 92) {
    throw new Error('Choose a search window of 92 days or less.');
  }

  const balances = balancesFor(rawContext);
  const context: LeaveValidationContext = { ...rawContext, balances };
  const weekendDays = weekendDaysFrom(context);
  const lookup = buildHolidayLookup(context.holidays, weekendDays);
  const segments = resolvePolicySegments(
    context.policyVersions,
    query.startDate,
    query.endDate,
    context.policyScope ?? {}
  );
  const policy = segments.find((segment) => segment.version)?.version ?? null;

  const results: PlanCandidate[] = [];
  const seen = new Set<string>();
  const fixedLeaves = context.leaves.filter(isActiveLeave);
  const maxCandidates = query.maxCandidates ?? 250;

  for (const category of query.categories) {
    const rule = getCategoryRule(policy, category);
    if (!rule || !rule.enabled || rule.code === 'GH') continue;

    const hardMax = rule.maxContinuousDays ?? 7;
    const maxLen = Math.max(1, Math.min(hardMax, query.maxLeaveDays ?? hardMax, 14));
    const minLen = Math.max(1, rule.minDaysPerRequest ?? 1);
    const effectiveMin = Math.min(minLen, maxLen);

    for (
      let startCursor = query.startDate;
      isSameOrBefore(startCursor, query.endDate);
      startCursor = addDays(startCursor, 1)
    ) {
      for (let length = effectiveMin; length <= maxLen; length += 1) {
        const endCursor = addDays(startCursor, length - 1);
        if (endCursor > query.endDate) break;
        const key = `${category}:${startCursor}:${endCursor}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const evaluation = evaluateLeaveRequest(
          { category, startDate: startCursor, endDate: endCursor, halfDay: null },
          { ...context, skipAttendanceImpact: true }
        );
        if (evaluation.status !== 'possible' && evaluation.status !== 'conditional') {
          continue;
        }

        const brk = continuousBreak(
          startCursor,
          endCursor,
          context.holidays,
          weekendDays,
          fixedLeaves
        );
        if (query.minBreakDays && brk.breakDays < query.minBreakDays) continue;

        const candidate: PlanCandidate = {
          id: key,
          category,
          startDate: startCursor,
          endDate: endCursor,
          calendarDays: evaluation.calendarDays,
          leaveDays: evaluation.leaveDays,
          breakDays: brk.breakDays,
          status: evaluation.status,
          score: 0,
          reasons: evaluation.reasons,
          evaluation,
          expiringCreditCount: evaluation.consequences.expiringCredits.length
        };
        candidate.score = scoreCandidate(candidate, weights, query);
        results.push(candidate);

        if (results.length >= maxCandidates * 4) break;
      }
      if (results.length >= maxCandidates * 4) break;
    }
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.breakDays !== a.breakDays) return b.breakDays - a.breakDays;
    return a.startDate.localeCompare(b.startDate);
  });

  const selected = results.slice(0, maxCandidates);
  return selected.map((candidate) => {
    const evaluation = withAttendance(candidate.evaluation, context);
    return { ...candidate, evaluation, reasons: evaluation.reasons };
  });
}

/** Adds NMC consequences only for the shortlisted candidates. */
function withAttendance(
  evaluation: LeaveEvaluation,
  context: LeaveValidationContext
): LeaveEvaluation {
  if (evaluation.consequences.attendance.length > 0) return evaluation;
  const weekendDays = weekendDaysFrom(context);
  const required =
    resolvePolicySegments(context.policyVersions, evaluation.startDate, evaluation.endDate, context.policyScope ?? {})
      .map((segment) => segment.version?.work.nmcRequiredPunchesPerMonth ?? 21)
      .at(0) ?? 21;

  const impacts = [...new Set(eachDate(evaluation.startDate, evaluation.endDate).map(monthKey))].map(
    (key) => {
      const [year, month] = key.split('-').map(Number);
      const report = computeMonthAttendance({
        year,
        month,
        weekendDays,
        holidays: context.holidays,
        leaves: context.leaves,
        records: context.attendanceRecords,
        required,
        today: context.today,
        extraLeave: {
          category: evaluation.category,
          startDate: evaluation.startDate,
          endDate: evaluation.endDate,
          halfDay: evaluation.halfDay
        }
      });
      return {
        monthKey: key,
        projected: report.projectedTotal,
        required: report.required,
        shortage: report.projectedShortage,
        leaveDays: report.leaveDays
      };
    }
  );

  const reasons = [...evaluation.reasons];
  for (const impact of impacts.filter((item) => item.shortage)) {
    reasons.push({
      code: 'NMC_PROJECTED_SHORTAGE',
      severity: 'warning',
      message: `Planned leave would leave ${impact.monthKey} with about ${impact.projected} NMC punches against a requirement of ${impact.required}.`
    });
  }

  return {
    ...evaluation,
    reasons,
    consequences: { ...evaluation.consequences, attendance: impacts }
  };
}

export function rankCandidates(
  candidates: PlanCandidate[],
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
  query: Pick<SearchQuery, 'preferredStart' | 'preferredEnd'> = {}
): PlanCandidate[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate, weights, {
        startDate: candidate.startDate,
        endDate: candidate.endDate,
        categories: [candidate.category],
        ...query
      })
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.breakDays !== a.breakDays) return b.breakDays - a.breakDays;
      return a.leaveDays - b.leaveDays;
    });
}

export interface BreakIdea {
  startDate: ISODate;
  endDate: ISODate;
  breakDays: number;
  leaveDays: number;
  category: string;
  explanation: string;
}

/**
 * Finds the best holidays/weekends that can be turned into longer breaks with
 * the fewest leave days, without creating an infeasible request.
 */
export function findLongBreaks(
  query: SearchQuery,
  context: LeaveValidationContext,
  limit = 5
): BreakIdea[] {
  const candidates = searchCandidates(
    { ...query, minBreakDays: query.minBreakDays ?? 4, maxCandidates: 120 },
    context,
    { ...DEFAULT_RANKING_WEIGHTS, breakLength: 55, fewerLeaveDays: 30 }
  );

  const bestByWindow = new Map<string, PlanCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.breakDays}:${candidate.startDate.slice(0, 7)}`;
    const existing = bestByWindow.get(key);
    if (!existing || candidate.leaveDays < existing.leaveDays) {
      bestByWindow.set(key, candidate);
    }
  }

  return [...bestByWindow.values()]
    .sort((a, b) => {
      if (b.breakDays !== a.breakDays) return b.breakDays - a.breakDays;
      return a.leaveDays - b.leaveDays;
    })
    .slice(0, limit)
    .map((candidate) => ({
      startDate: candidate.startDate,
      endDate: candidate.endDate,
      breakDays: candidate.breakDays,
      leaveDays: candidate.leaveDays,
      category: candidate.category,
      explanation: `${candidate.leaveDays} ${candidate.category} day${
        candidate.leaveDays === 1 ? '' : 's'
      } from ${formatDate(candidate.startDate)} to ${formatDate(
        candidate.endDate
      )} gives a ${candidate.breakDays}-day break including adjacent weekends and holidays.`
    }));
}

export function candidateKey(candidate: Pick<PlanCandidate, 'category' | 'startDate' | 'endDate'>): string {
  return `${candidate.category}:${candidate.startDate}:${candidate.endDate}`;
}
