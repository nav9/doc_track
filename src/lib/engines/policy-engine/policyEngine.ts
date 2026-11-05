/**
 * Policy resolution.
 *
 * A policy version is immutable once published. The engine selects the version
 * that was effective on a given date for a given employment scope; it never
 * "upgrades" a historical date to the newest policy. A leave request that spans
 * a policy change is split into segments and each segment is evaluated under
 * the policy effective on its dates (PA-006).
 */
import type { ISODate, ValidationIssue } from '../../domain/common/types';
import type { PeriodKind } from '../../domain/common/dates';
import { addDays, addMonths, periodBounds } from '../../domain/common/dates';
import type {
  ConsequenceRule,
  DutyShiftDefinition,
  LeaveCategoryRule,
  PolicyVersion,
  RuleCondition,
  RuleConsequence
} from '../../domain/policy/types';
import {
  CONSEQUENCE_LABELS,
  TRIGGER_LABELS
} from '../../domain/policy/types';

export interface PolicyScope {
  organisationId?: string | null;
  department?: string | null;
  designation?: string | null;
  employmentType?: string | null;
}

export function isVersionEffectiveOn(version: PolicyVersion, date: ISODate): boolean {
  return (
    version.effectiveFrom <= date &&
    (version.effectiveTo === null || date <= version.effectiveTo)
  );
}

function scopeMatches(version: PolicyVersion, scope: PolicyScope): boolean {
  const check = (policyValue: string | null, scopeValue: string | null | undefined): boolean => {
    if (!policyValue) return true; // policy applies to any value
    if (!scopeValue) return false; // policy is narrower than the known scope
    return policyValue === scopeValue;
  };
  return (
    check(version.organisationId, scope.organisationId) &&
    check(version.department, scope.department) &&
    check(version.designation, scope.designation) &&
    check(version.employmentType, scope.employmentType)
  );
}

/** Selects the published version effective on `date`, preferring narrower and newer scopes. */
function scopeSpecificity(version: PolicyVersion): number {
  return [
    version.organisationId,
    version.department,
    version.designation,
    version.employmentType
  ].filter(Boolean).length;
}

export function selectPolicyVersion(
  versions: PolicyVersion[],
  date: ISODate,
  scope: PolicyScope = {}
): PolicyVersion | null {
  const candidates = versions
    .filter(
      (version) =>
        version.status === 'published' && isVersionEffectiveOn(version, date) && scopeMatches(version, scope)
    )
    .sort((a, b) => {
      // A policy scoped to the doctor's organisation/department is more
      // specific than a general one and wins when both are effective.
      const specificity = scopeSpecificity(b) - scopeSpecificity(a);
      if (specificity !== 0) return specificity;
      if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
      if (a.version !== b.version) return b.version - a.version;
      return a.id < b.id ? 1 : -1;
    });
  return candidates[0] ?? null;
}

export interface PolicySegment {
  start: ISODate;
  end: ISODate;
  version: PolicyVersion | null;
}

/**
 * Splits a range into segments with a stable policy version. Adjacent segments
 * with the same version are merged so evaluation does one pass per policy.
 */
export function resolvePolicySegments(
  versions: PolicyVersion[],
  start: ISODate,
  end: ISODate,
  scope: PolicyScope = {}
): PolicySegment[] {
  if (end < start) return [];
  const boundaries = new Set<ISODate>([start]);
  for (const version of versions) {
    if (version.status !== 'published') continue;
    if (version.effectiveFrom > start && version.effectiveFrom <= end) {
      boundaries.add(version.effectiveFrom);
    }
    if (version.effectiveTo) {
      const dayAfter = addDays(version.effectiveTo, 1);
      if (dayAfter > start && dayAfter <= end) boundaries.add(dayAfter);
    }
  }

  const ordered = [...boundaries].sort();
  const segments: PolicySegment[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const segmentStart = ordered[index];
    const segmentEnd = index + 1 < ordered.length ? addDays(ordered[index + 1], -1) : end;
    if (segmentEnd < segmentStart) continue;
    const version = selectPolicyVersion(versions, segmentStart, scope);
    const previous = segments[segments.length - 1];
    if (previous && previous.version?.id === version?.id && addDays(previous.end, 1) === segmentStart) {
      previous.end = segmentEnd;
      continue;
    }
    segments.push({ start: segmentStart, end: segmentEnd, version });
  }
  return segments;
}

export function getCategoryRule(
  version: PolicyVersion | null | undefined,
  code: string
): LeaveCategoryRule | null {
  if (!version) return null;
  return version.categories.find((category) => category.code === code) ?? null;
}

export function enabledCategories(version: PolicyVersion | null): LeaveCategoryRule[] {
  if (!version) return [];
  return version.categories.filter((category) => category.enabled);
}

export function getRulesForTrigger(
  version: PolicyVersion | null,
  trigger: ConsequenceRule['trigger']
): ConsequenceRule[] {
  if (!version) return [];
  return version.rules.filter((rule) => rule.enabled && rule.trigger === trigger);
}

export function getRuleConfig(
  version: PolicyVersion | null,
  trigger: ConsequenceRule['trigger'],
  key: string
): string | number | boolean | null | undefined {
  const rule = getRulesForTrigger(version, trigger)[0];
  return rule?.config[key];
}

export function findShift(
  version: PolicyVersion | null,
  shiftId: string
): DutyShiftDefinition | null {
  if (!version) return null;
  return version.shifts.find((shift) => shift.id === shiftId) ?? null;
}

export function periodForCategory(
  rule: LeaveCategoryRule,
  date: ISODate,
  options: { employmentStart?: ISODate | null; academicYearStartMonth?: number } = {}
) {
  const kind: PeriodKind = rule.entitlement.period;
  return periodBounds(kind, date, {
    employmentStart: options.employmentStart ?? null,
    academicYearStartMonth: options.academicYearStartMonth
  });
}

const PERIOD_LABELS: Record<PeriodKind, string> = {
  'calendar-year': 'calendar year',
  'academic-year': 'academic year',
  'employment-year': 'employment year'
};

const FIELD_LABELS: Record<string, string> = {
  'duty.durationHours': 'the duty duration',
  'duty.status': 'the duty status',
  'duty.qualifyingDay': 'the duty falls on a qualifying day',
  'pdo.dateIsHoliday': 'whether the PDO date is a holiday',
  'pdo.punchOutAtOrBeforeCutoff': 'whether the punch-out is by the cutoff time',
  'pdo.punchOut': 'the PDO punch-out'
};

const OPERATOR_LABELS: Record<RuleCondition['operator'], string> = {
  equals: 'is',
  'not-equals': 'is not',
  'greater-than': 'is more than',
  'greater-than-or-equal': 'is at least',
  'less-than': 'is less than',
  'is-true': 'is true',
  'is-false': 'is false'
};

export function describeCondition(condition: RuleCondition): string {
  const field = FIELD_LABELS[condition.field] ?? condition.field;
  if (condition.operator === 'is-true') return field;
  if (condition.operator === 'is-false') return `${field} is false`;
  const value =
    condition.value === null || condition.value === ''
      ? 'empty'
      : String(condition.value);
  return `${field} ${OPERATOR_LABELS[condition.operator]} ${value}`;
}

export function describeConsequence(consequence: RuleConsequence): string {
  const category = consequence.category ? ` ${consequence.category}` : '';
  switch (consequence.type) {
    case 'create_pdo':
      return 'create a post-duty off for the next day';
    case 'credit_leave':
      return `credit ${consequence.amount ?? 1}${category} day${
        (consequence.amount ?? 1) === 1 ? '' : 's'
      }${consequence.expiryMonths ? ` valid for ${consequence.expiryMonths} calendar months` : ''}`;
    case 'convert_pdo_to_ccl':
      return `convert the PDO into${category || ' CCL'}${
        consequence.expiryMonths ? ` valid for ${consequence.expiryMonths} calendar months` : ''
      }`;
    case 'require_approval':
      return 'require management approval';
    case 'inform':
      return consequence.note || 'show an explanation';
    case 'warn':
      return consequence.note || 'show a warning';
  }
}

/** Plain-English explanation of a consequence rule for the Rules page and Studio. */
export function explainConsequenceRule(rule: ConsequenceRule): string {
  const trigger = TRIGGER_LABELS[rule.trigger] ?? rule.trigger;
  const conditions = rule.conditions.map(describeCondition);
  const consequences = rule.consequences.map(describeConsequence);
  const conditionText = conditions.length
    ? ` and ${conditions.join(' and ')}`
    : '';
  return `When ${trigger}${conditionText}, the policy will ${consequences.join(', and ')}.`;
}

export function describeRuleType(rule: ConsequenceRule): string {
  return rule.consequences
    .map((consequence) => CONSEQUENCE_LABELS[consequence.type])
    .join(', ');
}

export interface CategoryDescription {
  code: string;
  fullForm: string;
  summary: string;
  facts: { label: string; text: string }[];
  warnings: string[];
}

function daysLabel(value: number | null, unit: 'days' | 'months' = 'days', word = 'day'): string {
  if (value === null) return 'not limited';
  return `${value} ${unit === 'months' ? 'calendar month' : word}${value === 1 ? '' : 's'}`;
}

/** Converts a category rule into readable facts without losing configuration. */
export function describeCategoryRule(rule: LeaveCategoryRule): CategoryDescription {
  const facts: { label: string; text: string }[] = [];
  const warnings: string[] = [];
  const period = PERIOD_LABELS[rule.entitlement.period];

  if (rule.entitlement.creditTiming === 'none') {
    facts.push({
      label: 'Entitlement',
      text:
        rule.entitlement.usageCap !== null
          ? `No fixed credit. Maximum usage of ${daysLabel(rule.entitlement.usageCap)} per ${period}.`
          : 'No fixed credit. Earned through qualifying events.'
    });
  } else {
    const timing =
      rule.entitlement.creditTiming === 'year-start'
        ? `credited at the start of the ${period}`
        : `credited monthly across the ${period}`;
    facts.push({
      label: 'Entitlement',
      text: `${daysLabel(rule.entitlement.amount, rule.entitlement.unit)} per ${period}, ${timing}.`
    });
    if (rule.entitlement.proratedInJoiningPeriod) {
      facts.push({ label: 'Joining year', text: 'Prorated for the year the doctor joins.' });
    }
    if (rule.entitlement.usageCap !== null) {
      facts.push({
        label: 'Usage cap',
        text: `${daysLabel(rule.entitlement.usageCap)} may be used per ${period}.`
      });
    }
  }

  if (rule.maxDaysPerMonth !== null) {
    facts.push({
      label: 'Monthly limit',
      text: `At most ${daysLabel(rule.maxDaysPerMonth)} in any calendar month.`
    });
  }
  if (rule.minDaysPerRequest !== null) {
    facts.push({
      label: 'Minimum request',
      text: `${daysLabel(rule.minDaysPerRequest)} per application.`
    });
  }
  if (rule.maxContinuousDays !== null) {
    facts.push({
      label: 'Maximum stretch',
      text: `${daysLabel(rule.maxContinuousDays)} in one continuous episode.`
    });
  }
  facts.push({
    label: 'Day counting',
    text:
      rule.counting === 'calendar-days'
        ? 'Every calendar day counts, including weekends and general holidays.'
        : 'Only working days count; weekends and general holidays inside the period are free.'
  });
  facts.push({
    label: 'Half day',
    text: rule.halfDay.allowed
      ? 'May be taken as a half day: first half or second half.'
      : 'Cannot be taken as a half day.'
  });
  if (rule.cooldown) {
    facts.push({
      label: 'Cooldown',
      text: `After an episode ends, the next episode can start only after ${daysLabel(
        rule.cooldown.months,
        'months'
      )} (calendar months from the end date).`
    });
  }
  if (rule.eligibility) {
    facts.push({
      label: 'Eligibility',
      text:
        rule.eligibility.minServiceMonths > 0
          ? `Requires ${daysLabel(rule.eligibility.minServiceMonths, 'months')} of completed service.`
          : 'No minimum service requirement.'
    });
  }
  if (rule.expiry) {
    facts.push({
      label: 'Expiry',
      text: `Each credit expires ${daysLabel(rule.expiry.months, 'months')} from the date it was earned. ${
        rule.expiry.boundary === 'inclusive'
          ? 'The final date is still usable.'
          : 'The credit stops being usable at the start of the final date.'
      }`
    });
  }
  if (rule.code === 'RH') {
    facts.push({
      label: 'Six-month periods',
      text: 'One RH per six-month period, anchored to the joining date. No fixed 183-day wait.'
    });
  }
  facts.push({
    label: 'Carry forward',
    text: rule.carryForward.allowed
      ? `Unused days may carry forward${rule.carryForward.maxDays !== null ? `, up to ${daysLabel(rule.carryForward.maxDays)}` : ''}.`
      : 'Unused days lapse at the end of the period.'
  });
  facts.push({
    label: 'Encashment',
    text: rule.carryForward.encashable ? 'Balance may be encashed.' : 'Balance cannot be encashed.'
  });
  facts.push({
    label: 'Approval',
    text: rule.approval.required
      ? 'Management approval is required; policy eligibility does not guarantee approval.'
      : 'No management approval is required by the policy.'
  });
  if (rule.retrospectiveAllowed) {
    facts.push({
      label: 'Retrospective',
      text: 'May be applied retrospectively, for example for illness, subject to approval.'
    });
  }
  if (rule.belowMinimumException) {
    facts.push({
      label: 'Exception',
      text: rule.belowMinimumException.allowed
        ? `A shorter request may be allowed${
            rule.belowMinimumException.requiresLetter ? ' with a written request' : ''
          }${rule.belowMinimumException.requiresApproval ? ' and management approval' : ''}.`
        : 'No exception to the minimum duration.'
    });
  }
  if (rule.notes) facts.push({ label: 'Notes', text: rule.notes });

  if (rule.entitlement.amount === null && rule.entitlement.usageCap === null && rule.entitlement.creditTiming !== 'none') {
    warnings.push('This category has no configured entitlement; evaluation may be indeterminate.');
  }
  if (rule.code === 'RH' && rule.entitlement.period !== 'employment-year') {
    warnings.push('RH entitlement is expected to follow an employment-year (joining-date) basis.');
  }

  return {
    code: rule.code,
    fullForm: rule.fullForm,
    summary: rule.description,
    facts,
    warnings
  };
}

export function policyVersionLabel(version: PolicyVersion): string {
  return `${version.name} · v${version.version}`;
}

export function policyEffectiveLabel(version: PolicyVersion): string {
  return `${version.effectiveFrom} → ${version.effectiveTo ?? 'open'}`;
}

/** Structural validation of the work settings that engines rely on. */
export function validateWorkSettings(version: PolicyVersion): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (version.work.weekendDays.length === 0) {
    issues.push({
      code: 'POLICY_WEEKEND_MISSING',
      severity: 'warning',
      message: 'No weekend days are configured, so every day counts as a working day.'
    });
  }
  if (version.work.nmcRequiredPunchesPerMonth < 1 || version.work.nmcRequiredPunchesPerMonth > 31) {
    issues.push({
      code: 'POLICY_NMC_RANGE',
      severity: 'error',
      message: 'The monthly NMC requirement must be between 1 and 31 punches.'
    });
  }
  if (version.work.academicYearStartMonth < 1 || version.work.academicYearStartMonth > 12) {
    issues.push({
      code: 'POLICY_ACADEMIC_MONTH',
      severity: 'error',
      message: 'The academic year start month must be between 1 and 12.'
    });
  }
  if (version.shifts.length === 0) {
    issues.push({
      code: 'POLICY_SHIFT_MISSING',
      severity: 'warning',
      message: 'No duty shifts are defined; duties cannot be added.'
    });
  }
  return issues;
}

/** Helper for the planner: does any published policy cover the date? */
export function hasPolicyCoverage(
  versions: PolicyVersion[],
  start: ISODate,
  end: ISODate,
  scope: PolicyScope
): boolean {
  return resolvePolicySegments(versions, start, end, scope).every((segment) => segment.version);
}

/** Six-month RH periods anchored on the joining date (PA-007). */
export function rhPeriodFor(
  joiningDate: ISODate,
  date: ISODate
): { start: ISODate; end: ISODate; index: number } | null {
  if (!joiningDate) return null;
  let start = joiningDate;
  for (let index = 0; index < 200; index += 1) {
    const end = addDays(addMonths(start, 6), -1);
    if (date >= start && date <= end) return { start, end, index };
    if (date < start) return null;
    start = addDays(end, 1);
  }
  return null;
}
