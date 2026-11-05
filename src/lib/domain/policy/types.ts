import type { AuditFields, ISODate } from '../common/types';
import type { PeriodKind } from '../common/dates';
import type { DateFormat } from '../common/dates';

/** Category codes are open-ended so new leave types never require a migration. */
export type LeaveCategoryCode = string;

export type PolicyStatus = 'draft' | 'published' | 'archived';
export type CreditTiming = 'year-start' | 'monthly' | 'none';
export type CountingMode = 'calendar-days' | 'working-days';
export type ExpiryBoundary = 'inclusive' | 'exclusive';

export interface EntitlementRule {
  /** Days (or months for maternity-style categories) per period. */
  amount: number | null;
  unit: 'days' | 'months';
  period: PeriodKind;
  creditTiming: CreditTiming;
  /** Prorate the entitlement in the period in which the doctor joined. */
  proratedInJoiningPeriod: boolean;
  /** Separate maximum usage per period, even when more is credited. */
  usageCap: number | null;
  notes: string;
}

export interface HalfDayRule {
  allowed: boolean;
  notes: string;
}

export interface CooldownRule {
  months: number;
  from: 'episode-end';
  notes: string;
}

export interface EligibilityRule {
  minServiceMonths: number;
  notes: string;
}

export interface ExpiryRule {
  months: number;
  from: 'earned-date';
  /** `inclusive` keeps the credit usable through the boundary date. */
  boundary: ExpiryBoundary;
  notes: string;
}

export interface CarryForwardRule {
  allowed: boolean;
  maxDays: number | null;
  encashable: boolean;
  notes: string;
}

export interface BelowMinimumException {
  allowed: boolean;
  requiresApproval: boolean;
  requiresLetter: boolean;
  countsTowardsUsageCap: boolean;
  notes: string;
}

export interface ApprovalRule {
  required: boolean;
  notes: string;
}

export interface HolidayTreatment {
  consumesWeekends: boolean;
  consumesGeneralHolidays: boolean;
}

export interface LeaveCategoryRule {
  code: LeaveCategoryCode;
  fullForm: string;
  enabled: boolean;
  description: string;
  entitlement: EntitlementRule;
  halfDay: HalfDayRule;
  minDaysPerRequest: number | null;
  maxContinuousDays: number | null;
  maxDaysPerMonth: number | null;
  counting: CountingMode;
  cooldown: CooldownRule | null;
  eligibility: EligibilityRule | null;
  expiry: ExpiryRule | null;
  carryForward: CarryForwardRule;
  belowMinimumException: BelowMinimumException | null;
  approval: ApprovalRule;
  holidayTreatment: HolidayTreatment;
  retrospectiveAllowed: boolean;
  negativeBalanceAllowed: boolean;
  notes: string;
  source: string;
}

export type RuleTrigger =
  | 'DUTY_COMPLETED'
  | 'DUTY_QUALIFYING_DAY'
  | 'PDO_DATE_IS_HOLIDAY'
  | 'PDO_WORKED_WITH_PUNCHOUT'
  | 'PDO_WORKED_WITHOUT_PUNCHOUT'
  | 'PDO_UNUSED'
  | 'ABSENCE_WITHOUT_LEAVE'
  | 'NMC_SUNDAY_PUNCH_ALLOWED';

export const RULE_TRIGGERS: RuleTrigger[] = [
  'DUTY_COMPLETED',
  'DUTY_QUALIFYING_DAY',
  'PDO_DATE_IS_HOLIDAY',
  'PDO_WORKED_WITH_PUNCHOUT',
  'PDO_WORKED_WITHOUT_PUNCHOUT',
  'PDO_UNUSED',
  'ABSENCE_WITHOUT_LEAVE',
  'NMC_SUNDAY_PUNCH_ALLOWED'
];

export const TRIGGER_LABELS: Record<RuleTrigger, string> = {
  DUTY_COMPLETED: 'a duty is marked completed',
  DUTY_QUALIFYING_DAY: 'the duty falls on a Saturday, Sunday or general holiday',
  PDO_DATE_IS_HOLIDAY: 'the post-duty off date is already a holiday',
  PDO_WORKED_WITH_PUNCHOUT: 'the doctor works on post-duty off and punches out by the cutoff',
  PDO_WORKED_WITHOUT_PUNCHOUT: 'the doctor works on post-duty off but no punch-out is recorded',
  PDO_UNUSED: 'a post-duty off is never used',
  ABSENCE_WITHOUT_LEAVE: 'an absence has no approved leave',
  NMC_SUNDAY_PUNCH_ALLOWED: 'a Sunday NMC punch is added'
};

export type RuleOperator =
  | 'equals'
  | 'not-equals'
  | 'greater-than'
  | 'greater-than-or-equal'
  | 'less-than'
  | 'is-true'
  | 'is-false';

export interface RuleCondition {
  field: string;
  operator: RuleOperator;
  value: string | number | boolean | null;
}

export type RuleConsequenceType =
  | 'create_pdo'
  | 'credit_leave'
  | 'convert_pdo_to_ccl'
  | 'require_approval'
  | 'inform'
  | 'warn';

export const CONSEQUENCE_LABELS: Record<RuleConsequenceType, string> = {
  create_pdo: 'Create a post-duty off',
  credit_leave: 'Credit leave',
  convert_pdo_to_ccl: 'Convert the PDO into CCL',
  require_approval: 'Require management approval',
  inform: 'Show an explanation',
  warn: 'Show a warning'
};

export interface RuleConsequence {
  type: RuleConsequenceType;
  category: LeaveCategoryCode | null;
  amount: number | null;
  expiryMonths: number | null;
  note: string;
}

export interface ConsequenceRule {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  trigger: RuleTrigger;
  conditions: RuleCondition[];
  consequences: RuleConsequence[];
  /** Rules whose evaluation this rule assumes; used for cycle detection. */
  dependsOn: string[];
  /** Typed configuration consumed by the deterministic engines. */
  config: Record<string, string | number | boolean | null>;
  source: string;
  notes: string;
}

export interface DutyShiftDefinition {
  id: string;
  name: string;
  kind: 'day' | 'night' | 'other';
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  durationHours: number;
  qualifiesForCclOnHoliday: boolean;
  notes: string;
}

export interface PolicyWorkSettings {
  weekendDays: number[];
  workDayStart: string;
  workDayEnd: string;
  pdoPunchOutCutoff: string;
  academicYearStartMonth: number;
  nmcRequiredPunchesPerMonth: number;
  /** How unused PDO becomes CCL: `manual` or a number of months. */
  unusedPdoConversionMonths: number | null;
  dateFormat: DateFormat;
}

export interface PolicyVersion extends AuditFields {
  id: string;
  policyId: string;
  version: number;
  status: PolicyStatus;
  name: string;
  description: string;
  organisationId: string | null;
  department: string | null;
  designation: string | null;
  employmentType: string | null;
  effectiveFrom: ISODate;
  effectiveTo: ISODate | null;
  categories: LeaveCategoryRule[];
  rules: ConsequenceRule[];
  work: PolicyWorkSettings;
  shifts: DutyShiftDefinition[];
  changeSummary: string;
  source: string;
  notes: string;
  publishedAt: string | null;
}

export interface PolicySummary {
  policyId: string;
  name: string;
  versions: number;
  activeFrom: ISODate;
  status: PolicyStatus;
}
