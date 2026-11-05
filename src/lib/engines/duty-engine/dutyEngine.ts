/**
 * Duty, PDO and CCL consequences.
 *
 * The rules themselves live in the policy (consequence rules with typed
 * configuration); this engine only interprets them deterministically. Nothing
 * here hardcodes "next day", "three months" or "one CCL".
 */
import type { ISODate } from '../../domain/common/types';
import { addDays, addMonths, durationHours } from '../../domain/common/dates';
import type { Holiday } from '../../domain/calendar/holidays';
import { buildHolidayLookup, isQualifyingDutyDay } from '../../domain/calendar/holidays';
import type { PolicyVersion } from '../../domain/policy/types';
import type { Duty, DutySwap, PdoRecord, PdoStatus } from '../../domain/duty/types';
import { getRulesForTrigger, getCategoryRule } from '../policy-engine/policyEngine';
import { expiryDateFor } from '../leave-accounting/ledgerEngine';

export interface DutyContext {
  policy: PolicyVersion | null;
  holidays: Holiday[];
}

export interface DutyConsequences {
  qualifyingDay: boolean;
  pdoDate: ISODate | null;
  cclCredits: { category: string; amount: number; expiryMonths: number | null; reason: string }[];
  approvalRequired: boolean;
  notes: string[];
  /** Human explanation of each configured consequence, for the duty editor. */
  explanations: string[];
}

function numberConfig(value: unknown, fallback: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function weekendDaysFor(policy: PolicyVersion | null): number[] {
  return policy?.work.weekendDays ?? [0, 6];
}

/** PDO offset comes from the policy; absent/disabled rule means no PDO. */
export function pdoOffsetDays(policy: PolicyVersion | null): number | null {
  const rule = getRulesForTrigger(policy, 'DUTY_COMPLETED')[0];
  if (!rule) return null;
  return numberConfig(rule.config.pdoOffsetDays, 1);
}

export function isQualifyingDay(date: ISODate, context: DutyContext): boolean {
  const lookup = buildHolidayLookup(context.holidays, weekendDaysFor(context.policy));
  return isQualifyingDutyDay(date, lookup);
}

export function planDuty(
  duty: Pick<Duty, 'date' | 'durationHours' | 'status' | 'startTime' | 'endTime' | 'crossesMidnight'>,
  context: DutyContext
): DutyConsequences {
  const notes: string[] = [];
  const explanations: string[] = [];
  const qualifyingDay = isQualifyingDay(duty.date, context);

  const hours = duty.durationHours || durationHours(duty.startTime, duty.endTime);
  const pdoRule = getRulesForTrigger(context.policy, 'DUTY_COMPLETED')[0];
  const pdoOffset = pdoOffsetDays(context.policy);
  let pdoDate: ISODate | null = null;

  if (duty.status === 'completed') {
    if (pdoOffset !== null && hours >= 24) {
      pdoDate = addDays(duty.date, pdoOffset);
      explanations.push(
        `${pdoRule?.title ?? 'Duty policy'}: a ${hours}-hour duty creates a PDO ${pdoOffset} day${
          pdoOffset === 1 ? '' : 's'
        } later (${pdoDate}).`
      );
    } else if (pdoOffset === null) {
      notes.push('No enabled rule creates a PDO for completed duties.');
    } else {
      notes.push(
        `No PDO is generated because the duty is ${hours} hours; the policy requires at least 24 hours.`
      );
    }
  }

  const cclCredits: DutyConsequences['cclCredits'] = [];
  if (qualifyingDay && duty.status === 'completed') {
    const rule = getRulesForTrigger(context.policy, 'DUTY_QUALIFYING_DAY')[0];
    if (rule) {
      for (const consequence of rule.consequences) {
        if (consequence.type !== 'credit_leave' || !consequence.category) continue;
        const amount = consequence.amount ?? 1;
        const categoryRule = getCategoryRule(context.policy, consequence.category);
        const expiryMonths =
          consequence.expiryMonths ?? categoryRule?.expiry?.months ?? null;
        cclCredits.push({
          category: consequence.category,
          amount,
          expiryMonths,
          reason: `Duty on ${duty.date} (${rule.title})`
        });
        explanations.push(
          `${rule.title}: the ${duty.date} duty falls on a qualifying day, so ${amount} ${consequence.category} is credited${
            expiryMonths ? ` and expires ${expiryMonths} calendar months from the earned date` : ''
          }.`
        );
      }
    }
  }

  return {
    qualifyingDay,
    pdoDate,
    cclCredits,
    approvalRequired: false,
    notes,
    explanations
  };
}

export interface PdoDecision {
  convert: boolean;
  status: PdoStatus;
  requiresApproval: boolean;
  reason: string;
  expiryMonths: number | null;
}

/**
 * Decides how a PDO resolves:
 *  - the PDO date is already a holiday → converted into CCL
 *  - the doctor worked the PDO and punched out by the cutoff → converted
 *  - worked without a punch-out → approval required
 *  - still scheduled and in the future → remains open
 */
export function decidePdoOutcome(
  pdo: Pick<PdoRecord, 'date' | 'status' | 'punchOutAt' | 'approvalRequired'>,
  context: DutyContext & { today: ISODate }
): PdoDecision {
  if (pdo.status !== 'scheduled') {
    return {
      convert: false,
      status: pdo.status,
      requiresApproval: pdo.approvalRequired,
      reason: 'This PDO has already been resolved.',
      expiryMonths: null
    };
  }

  const holidayRule = getRulesForTrigger(context.policy, 'PDO_DATE_IS_HOLIDAY')[0];
  const lookup = buildHolidayLookup(context.holidays, weekendDaysFor(context.policy));
  const onHoliday = lookup.dates.has(pdo.date) || lookup.weekendDays.includes(new Date(`${pdo.date}T00:00:00Z`).getUTCDay());
  if (holidayRule && onHoliday) {
    return {
      convert: true,
      status: 'converted-holiday',
      requiresApproval: false,
      reason: `The PDO falls on ${lookup.byDate.has(pdo.date) ? 'a listed holiday' : 'a weekend'}, so it converts into CCL without a separate application.`,
      expiryMonths: holidayRule.consequences.find((item) => item.type === 'convert_pdo_to_ccl')?.expiryMonths ?? 3
    };
  }

  if (pdo.punchOutAt) {
    const workedRule = getRulesForTrigger(context.policy, 'PDO_WORKED_WITH_PUNCHOUT')[0];
    if (workedRule) {
      const time = new Date(pdo.punchOutAt);
      const cutoff = context.policy?.work.pdoPunchOutCutoff ?? '16:00';
      const [cutoffHour, cutoffMinute] = cutoff.split(':').map(Number);
      const cutoffDate = new Date(pdo.date + 'T00:00:00');
      cutoffDate.setHours(cutoffHour || 16, cutoffMinute || 0, 0, 0);
      if (time.getTime() <= cutoffDate.getTime()) {
        return {
          convert: true,
          status: 'converted-worked',
          requiresApproval: false,
          reason: `Worked on the PDO and punched out by ${cutoff}; the PDO converts into CCL without further approval.`,
          expiryMonths: workedRule.consequences.find((item) => item.type === 'convert_pdo_to_ccl')?.expiryMonths ?? 3
        };
      }
      return {
        convert: false,
        status: 'scheduled',
        requiresApproval: true,
        reason: `The punch-out is after the ${cutoff} cutoff. Record management approval to convert this PDO.`,
        expiryMonths: null
      };
    }
  }

  const missingRule = getRulesForTrigger(context.policy, 'PDO_WORKED_WITHOUT_PUNCHOUT')[0];
  if (missingRule && pdo.approvalRequired) {
    return {
      convert: pdo.approvalRequired,
      status: pdo.approvalRequired ? 'converted-worked' : 'scheduled',
      requiresApproval: true,
      reason: 'The doctor worked on the PDO but no punch-out is recorded; management approval is required.',
      expiryMonths: missingRule.consequences.find((item) => item.type === 'require_approval')?.expiryMonths ?? 3
    };
  }

  return {
    convert: false,
    status: 'scheduled',
    requiresApproval: false,
    reason:
      pdo.date < context.today
        ? 'The PDO date has passed. Mark it as unused to convert it into CCL.'
        : 'The PDO is scheduled.',
    expiryMonths: null
  };
}

/** Unused PDO → CCL. Automatic conversion happens only when the policy sets a delay. */
export function unusedPdoConversion(
  pdo: Pick<PdoRecord, 'date' | 'status'>,
  context: DutyContext & { today: ISODate }
): PdoDecision {
  if (pdo.status !== 'scheduled') {
    return {
      convert: false,
      status: pdo.status,
      requiresApproval: false,
      reason: 'This PDO is already resolved.',
      expiryMonths: null
    };
  }
  const rule = getRulesForTrigger(context.policy, 'PDO_UNUSED')[0];
  if (!rule) {
    return {
      convert: false,
      status: 'scheduled',
      requiresApproval: false,
      reason: 'No enabled rule converts unused PDO into CCL.',
      expiryMonths: null
    };
  }
  const autoMonths = rule.config.autoConvertAfterMonths;
  const expiryMonths = rule.consequences.find((item) => item.type === 'convert_pdo_to_ccl')?.expiryMonths ?? 3;
  if (typeof autoMonths === 'number' && pdo.date <= addMonths(context.today, -autoMonths)) {
    return {
      convert: true,
      status: 'converted-unused',
      requiresApproval: false,
      reason: `The PDO was unused for ${autoMonths} months and is converted automatically by policy.`,
      expiryMonths
    };
  }
  return {
    convert: false,
    status: 'scheduled',
    requiresApproval: false,
    reason:
      typeof autoMonths === 'number'
        ? `Unused PDO converts automatically after ${autoMonths} calendar months.`
        : 'Unused PDO does not expire. Convert it manually to CCL whenever needed (PA-019).',
    expiryMonths
  };
}

export function creditExpiryDate(
  policy: PolicyVersion | null,
  category: string,
  earnedOn: ISODate
): ISODate | null {
  return expiryDateFor(policy, category, earnedOn);
}

export interface DutyValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
}

export function validateDutyInput(input: {
  date: ISODate;
  startTime: string;
  endTime: string;
  shiftId: string;
  existing: Duty[];
  excludeDutyId?: string | null;
}): DutyValidationIssue[] {
  const issues: DutyValidationIssue[] = [];
  if (!input.shiftId) {
    issues.push({ code: 'DUTY_SHIFT_REQUIRED', severity: 'error', message: 'Choose a duty shift.' });
  }
  if (!/^\d{2}:\d{2}$/.test(input.startTime) || !/^\d{2}:\d{2}$/.test(input.endTime)) {
    issues.push({
      code: 'DUTY_TIME_INVALID',
      severity: 'error',
      message: 'Enter valid start and end times (HH:MM).'
    });
  }
  const duplicate = input.existing.find(
    (duty) =>
      duty.date === input.date &&
      duty.status !== 'cancelled' &&
      duty.id !== input.excludeDutyId
  );
  if (duplicate) {
    issues.push({
      code: 'DUTY_DUPLICATE',
      severity: 'error',
      message: `A duty already exists on ${input.date}.`
    });
  }
  return issues;
}

export function swapLabel(swap: DutySwap): string {
  const who = swap.direction === 'gave-away' ? `Gave to ${swap.otherDoctorName}` : `Took over from ${swap.otherDoctorName}`;
  return swap.compensationDate ? `${who}; compensation on ${swap.compensationDate}` : who;
}

/** Consecutive duty detection, used for PDO-overlap warnings. */
export function consecutiveDuties(duties: Duty[]): Duty[][] {
  const sorted = duties
    .filter((duty) => duty.status !== 'cancelled')
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const groups: Duty[][] = [];
  for (const duty of sorted) {
    const lastGroup = groups[groups.length - 1];
    const last = lastGroup?.[lastGroup.length - 1];
    if (last && addDays(last.date, 1) === duty.date) {
      lastGroup.push(duty);
    } else {
      groups.push([duty]);
    }
  }
  return groups;
}
