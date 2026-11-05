/**
 * Continuous policy validation used by the Policy Studio.
 *
 * Errors block publishing. Warnings may be published after acknowledgement.
 * Information explains consequences of the configuration.
 */
import type { ValidationIssue } from '../../domain/common/types';
import { isISODate } from '../../domain/common/types';
import type { LeaveCategoryRule, PolicyVersion, RuleCondition } from '../../domain/policy/types';
import { RULE_TRIGGERS } from '../../domain/policy/types';
import { describeCategoryRule, validateWorkSettings } from '../policy-engine/policyEngine';

const KNOWN_CONDITION_FIELDS = new Set([
  'duty.durationHours',
  'duty.status',
  'duty.qualifyingDay',
  'pdo.dateIsHoliday',
  'pdo.punchOutAtOrBeforeCutoff',
  'pdo.punchOut'
]);

function isNonNegativeInteger(value: number | null | undefined): boolean {
  return value === null || value === undefined || (Number.isInteger(value) && value >= 0);
}

function validateCategory(rule: LeaveCategoryRule): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const prefix = `CATEGORY_${rule.code}`;
  const push = (suffix: string, severity: ValidationIssue['severity'], message: string) =>
    issues.push({ code: `${prefix}_${suffix}`, severity, message, field: `${rule.code}.${suffix}` });

  if (!rule.code.trim()) push('CODE_REQUIRED', 'error', 'Every leave category needs a short code.');
  if (!rule.fullForm.trim()) push('FULL_FORM_REQUIRED', 'error', `Enter the full form of ${rule.code}.`);
  if (rule.entitlement.amount !== null) {
    if (rule.entitlement.amount < 0) {
      push('ENTITLEMENT_NEGATIVE', 'error', `${rule.code} entitlement cannot be negative.`);
    }
    if (rule.entitlement.unit === 'days' && rule.entitlement.amount > 365) {
      push('ENTITLEMENT_TOO_HIGH', 'error', `${rule.code} entitlement cannot exceed 365 days.`);
    }
    if (rule.entitlement.unit === 'months' && rule.entitlement.amount > 24) {
      push('ENTITLEMENT_MONTHS_TOO_HIGH', 'error', `${rule.code} entitlement cannot exceed 24 months.`);
    }
  }
  if (rule.entitlement.usageCap !== null) {
    if (rule.entitlement.usageCap < 0) {
      push('USAGE_CAP_NEGATIVE', 'error', `${rule.code} usage cap cannot be negative.`);
    }
    if (rule.entitlement.amount !== null && rule.entitlement.usageCap > rule.entitlement.amount) {
      push(
        'USAGE_CAP_ABOVE_ENTITLEMENT',
        'warning',
        `${rule.code} allows using more (${rule.entitlement.usageCap}) than the credited entitlement (${rule.entitlement.amount}).`
      );
    }
  }
  if (rule.maxDaysPerMonth !== null) {
    if (!isNonNegativeInteger(rule.maxDaysPerMonth)) {
      push('MONTHLY_LIMIT_INTEGER', 'error', `${rule.code} monthly limit must be a whole number.`);
    }
    if (rule.maxDaysPerMonth > 31) {
      push('MONTHLY_LIMIT_TOO_HIGH', 'error', `${rule.code} monthly limit cannot exceed 31 days.`);
    }
    if (rule.entitlement.amount !== null && rule.maxDaysPerMonth > rule.entitlement.amount) {
      push(
        'MONTHLY_LIMIT_ABOVE_ENTITLEMENT',
        'warning',
        `${rule.code} monthly limit exceeds the annual entitlement.`
      );
    }
  }
  if (rule.minDaysPerRequest !== null && rule.minDaysPerRequest < 0) {
    push('MIN_NEGATIVE', 'error', `${rule.code} minimum duration cannot be negative.`);
  }
  if (rule.maxContinuousDays !== null && rule.maxContinuousDays < 0) {
    push('MAX_NEGATIVE', 'error', `${rule.code} maximum duration cannot be negative.`);
  }
  if (rule.maxContinuousDays === 0) {
    push('MAX_ZERO', 'error', `${rule.code} maximum duration must be at least one day.`);
  }
  if (
    rule.minDaysPerRequest !== null &&
    rule.maxContinuousDays !== null &&
    rule.minDaysPerRequest > rule.maxContinuousDays
  ) {
    push(
      'MIN_ABOVE_MAX',
      'error',
      `${rule.code} minimum request (${rule.minDaysPerRequest}) exceeds the maximum stretch (${rule.maxContinuousDays}).`
    );
  }
  if (rule.maxContinuousDays !== null && rule.maxContinuousDays > 365) {
    push('MAX_TOO_HIGH', 'error', `${rule.code} maximum duration cannot exceed 365 days.`);
  }
  if (rule.cooldown) {
    if (!Number.isInteger(rule.cooldown.months) || rule.cooldown.months < 0) {
      push('COOLDOWN_INVALID', 'error', `${rule.code} cooldown must be a whole number of months.`);
    }
    if (rule.cooldown.months > 24) {
      push('COOLDOWN_TOO_LONG', 'error', `${rule.code} cooldown cannot exceed 24 months.`);
    }
  }
  if (rule.eligibility && rule.eligibility.minServiceMonths < 0) {
    push('ELIGIBILITY_NEGATIVE', 'error', `${rule.code} minimum service cannot be negative.`);
  }
  if (rule.eligibility && rule.eligibility.minServiceMonths > 600) {
    push('ELIGIBILITY_TOO_LONG', 'error', `${rule.code} minimum service cannot exceed 50 years.`);
  }
  if (rule.expiry) {
    if (!Number.isInteger(rule.expiry.months) || rule.expiry.months < 1) {
      push('EXPIRY_INVALID', 'error', `${rule.code} expiry must be at least one calendar month.`);
    }
    if (rule.expiry.months > 24) {
      push('EXPIRY_TOO_LONG', 'warning', `${rule.code} credits valid for more than 24 months are unusual.`);
    }
  }
  if (rule.halfDay.allowed && rule.code === 'RH') {
    push('RH_HALF_DAY', 'error', 'RH cannot be configured as a half-day leave.');
  }
  if (rule.counting === 'working-days' && !rule.holidayTreatment.consumesGeneralHolidays) {
    issues.push({
      code: `${prefix}_INFO_COUNTING`,
      severity: 'info',
      message: `${rule.code} consumes working days only; weekends and holidays inside the period are free.`
    });
  }
  if (rule.entitlement.creditTiming === 'monthly' && rule.entitlement.amount === null) {
    push('MONTHLY_WITHOUT_ENTITLEMENT', 'error', `${rule.code} cannot be credited monthly without an entitlement.`);
  }
  if (rule.entitlement.proratedInJoiningPeriod && rule.entitlement.amount === null) {
    push(
      'PRORATE_WITHOUT_ENTITLEMENT',
      'warning',
      `${rule.code} is set to prorate, but no fixed entitlement exists to prorate.`
    );
  }
  if (!rule.description.trim()) {
    push('DESCRIPTION_MISSING', 'warning', `${rule.code} has no description for the Leave Rules page.`);
  }
  for (const warning of describeCategoryRule(rule).warnings) {
    push('DESCRIPTION_WARNING', 'warning', warning);
  }
  return issues;
}

function validateCondition(condition: RuleCondition, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!KNOWN_CONDITION_FIELDS.has(condition.field)) {
    issues.push({
      code: 'RULE_CONDITION_UNKNOWN_FIELD',
      severity: 'error',
      message: `Rule ${path} references an unknown condition field "${condition.field}".`
    });
  }
  if (
    (condition.operator === 'is-true' || condition.operator === 'is-false') &&
    condition.value !== null &&
    typeof condition.value !== 'boolean'
  ) {
    issues.push({
      code: 'RULE_CONDITION_VALUE_INVALID',
      severity: 'error',
      message: `Rule ${path} uses a boolean operator with a non-boolean value.`
    });
  }
  return issues;
}

export interface PolicyValidationResult {
  issues: ValidationIssue[];
  errors: number;
  warnings: number;
  canPublish: boolean;
}

export function validatePolicyVersion(version: PolicyVersion): PolicyValidationResult {
  const issues: ValidationIssue[] = [];

  if (!version.name.trim()) {
    issues.push({ code: 'POLICY_NAME_REQUIRED', severity: 'error', message: 'Enter a policy name.' });
  }
  if (!isISODate(version.effectiveFrom)) {
    issues.push({
      code: 'POLICY_EFFECTIVE_FROM',
      severity: 'error',
      message: 'Enter a valid effective start date.'
    });
  }
  if (version.effectiveTo !== null) {
    if (!isISODate(version.effectiveTo)) {
      issues.push({
        code: 'POLICY_EFFECTIVE_TO',
        severity: 'error',
        message: 'Enter a valid effective end date, or leave it open.'
      });
    } else if (version.effectiveTo < version.effectiveFrom) {
      issues.push({
        code: 'POLICY_EFFECTIVE_RANGE',
        severity: 'error',
        message: 'The effective end date cannot be before the effective start date.'
      });
    }
  }
  if (version.categories.length === 0) {
    issues.push({
      code: 'POLICY_NO_CATEGORIES',
      severity: 'error',
      message: 'A policy must define at least one leave category.'
    });
  }

  const codes = new Set<string>();
  for (const category of version.categories) {
    if (codes.has(category.code)) {
      issues.push({
        code: 'POLICY_DUPLICATE_CATEGORY',
        severity: 'error',
        message: `Leave category "${category.code}" appears more than once.`
      });
    }
    codes.add(category.code);
    issues.push(...validateCategory(category));
  }

  if (!version.categories.some((category) => category.code === 'CL' && category.enabled)) {
    issues.push({
      code: 'POLICY_CL_MISSING',
      severity: 'warning',
      message: 'No CL category is enabled; most medical college policies expect casual leave.'
    });
  }

  const ruleIds = new Set<string>();
  for (const rule of version.rules) {
    const path = rule.id || rule.title;
    if (!rule.id.trim()) {
      issues.push({ code: 'RULE_ID_REQUIRED', severity: 'error', message: 'Every rule needs an ID.' });
    }
    if (ruleIds.has(rule.id)) {
      issues.push({
        code: 'RULE_DUPLICATE_ID',
        severity: 'error',
        message: `Rule ID "${rule.id}" is used more than once.`
      });
    }
    ruleIds.add(rule.id);
    if (!rule.title.trim()) {
      issues.push({ code: 'RULE_TITLE_REQUIRED', severity: 'error', message: `Rule ${path} needs a title.` });
    }
    if (!RULE_TRIGGERS.includes(rule.trigger)) {
      issues.push({
        code: 'RULE_TRIGGER_UNKNOWN',
        severity: 'error',
        message: `Rule ${path} uses an unknown trigger.`
      });
    }
    for (const condition of rule.conditions) issues.push(...validateCondition(condition, path));
    if (rule.consequences.length === 0) {
      issues.push({
        code: 'RULE_NO_CONSEQUENCE',
        severity: 'warning',
        message: `Rule ${path} has no consequence and will not change any calculation.`
      });
    }
    for (const consequence of rule.consequences) {
      if (consequence.category && !codes.has(consequence.category)) {
        issues.push({
          code: 'RULE_UNKNOWN_CATEGORY',
          severity: 'error',
          message: `Rule ${path} refers to leave category "${consequence.category}", which the policy does not define.`
        });
      }
      if (consequence.amount !== null && consequence.amount < 0) {
        issues.push({
          code: 'RULE_NEGATIVE_AMOUNT',
          severity: 'error',
          message: `Rule ${path} has a negative amount.`
        });
      }
      if (consequence.amount !== null && consequence.amount > 31) {
        issues.push({
          code: 'RULE_AMOUNT_TOO_HIGH',
          severity: 'error',
          message: `Rule ${path} credits more than 31 days at once.`
        });
      }
    }
  }

  for (const rule of version.rules) {
    for (const dependency of rule.dependsOn) {
      if (!ruleIds.has(dependency)) {
        issues.push({
          code: 'RULE_UNRESOLVED_DEPENDENCY',
          severity: 'error',
          message: `Rule "${rule.title}" depends on "${dependency}", which does not exist.`
        });
      }
      if (dependency === rule.id) {
        issues.push({
          code: 'RULE_SELF_DEPENDENCY',
          severity: 'error',
          message: `Rule "${rule.title}" depends on itself.`
        });
      }
    }
  }

  // Detect circular dependencies with a depth-first walk.
  const graph = new Map(version.rules.map((rule) => [rule.id, rule.dependsOn]));
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      issues.push({
        code: 'RULE_CIRCULAR_DEPENDENCY',
        severity: 'error',
        message: `Circular rule dependency: ${[...trail, id].join(' → ')}.`
      });
      return;
    }
    state.set(id, 'visiting');
    for (const next of graph.get(id) ?? []) {
      if (graph.has(next)) visit(next, [...trail, id]);
    }
    state.set(id, 'done');
  };
  for (const rule of version.rules) visit(rule.id, []);

  issues.push(...validateWorkSettings(version));

  // Immutability is enforced by the application service: published versions are
  // never handed to the editor, and publishing creates a new immutable version.
  if (version.status === 'published' && !version.changeSummary.trim()) {
    issues.push({
      code: 'POLICY_CHANGE_SUMMARY',
      severity: 'info',
      message: 'The initial version has no change summary.'
    });
  }
  if (!version.changeSummary.trim() && version.version > 1) {
    issues.push({
      code: 'POLICY_CHANGE_SUMMARY',
      severity: 'warning',
      message: 'Describe what changed in this version before publishing.'
    });
  }

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  return { issues, errors, warnings, canPublish: errors === 0 };
}

export function groupIssuesBySeverity(issues: ValidationIssue[]): Record<ValidationIssue['severity'], ValidationIssue[]> {
  return {
    error: issues.filter((issue) => issue.severity === 'error'),
    warning: issues.filter((issue) => issue.severity === 'warning'),
    info: issues.filter((issue) => issue.severity === 'info')
  };
}
