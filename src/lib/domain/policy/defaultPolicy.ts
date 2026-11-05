/**
 * The initial "Medical College" leave policy.
 *
 * These values are the starting configuration only: every number lives here as
 * policy data and is editable in the Policy Studio. No engine hardcodes them.
 * Each value cites the source document that established it.
 *
 * Where the source documents leave a detail open, the field is nullable or
 * marked configurable and the open question is recorded in
 * POLICY_ASSUMPTIONS.md rather than resolved silently here.
 */
import type { AuditFields, ISODate } from '../common/types';
import type {
  ConsequenceRule,
  DutyShiftDefinition,
  LeaveCategoryRule,
  PolicyVersion,
  PolicyWorkSettings
} from './types';

export const DEFAULT_POLICY_ID = 'policy_medical_college';
export const DEFAULT_ORGANISATION_ID = 'org_primary';

export const MEDICAL_COLLEGE_SHIFTS: DutyShiftDefinition[] = [
  {
    id: 'shift_night_24h',
    name: 'Night duty (24 hours)',
    kind: 'night',
    startTime: '09:00',
    endTime: '09:00',
    crossesMidnight: true,
    durationHours: 24,
    qualifiesForCclOnHoliday: true,
    notes:
      'Medical college night duty runs 9:00 AM to 9:00 AM the next day. The source brief also describes a 10:30 AM start with a 1.5-hour pre-duty period that is not granted; the start time is configurable here (PA-018).'
  },
  {
    id: 'shift_day_6h',
    name: 'Day shift (6 hours)',
    kind: 'day',
    startTime: '08:00',
    endTime: '14:00',
    crossesMidnight: false,
    durationHours: 6,
    qualifiesForCclOnHoliday: false,
    notes: 'Corporate hospital shift; available for other employers.'
  },
  {
    id: 'shift_evening_6h',
    name: 'Evening shift (6 hours)',
    kind: 'other',
    startTime: '14:00',
    endTime: '20:00',
    crossesMidnight: false,
    durationHours: 6,
    qualifiesForCclOnHoliday: false,
    notes: 'Corporate hospital shift; available for other employers.'
  },
  {
    id: 'shift_night_12h',
    name: 'Night shift (12 hours)',
    kind: 'night',
    startTime: '20:00',
    endTime: '08:00',
    crossesMidnight: true,
    durationHours: 12,
    qualifiesForCclOnHoliday: false,
    notes: 'Corporate hospital shift; not used by the medical college roster.'
  }
];

export const MEDICAL_COLLEGE_WORK: PolicyWorkSettings = {
  weekendDays: [0, 6],
  workDayStart: '09:00',
  workDayEnd: '16:00',
  pdoPunchOutCutoff: '16:00',
  academicYearStartMonth: 8,
  nmcRequiredPunchesPerMonth: 21,
  unusedPdoConversionMonths: null,
  dateFormat: 'dd MMM yyyy'
};

function dayCategory(partial: Partial<LeaveCategoryRule> & Pick<LeaveCategoryRule, 'code' | 'fullForm'>): LeaveCategoryRule {
  return {
    enabled: true,
    description: '',
    entitlement: {
      amount: 0,
      unit: 'days',
      period: 'calendar-year',
      creditTiming: 'year-start',
      proratedInJoiningPeriod: false,
      usageCap: null,
      notes: ''
    },
    halfDay: { allowed: false, notes: '' },
    minDaysPerRequest: null,
    maxContinuousDays: null,
    maxDaysPerMonth: null,
    counting: 'calendar-days',
    cooldown: null,
    eligibility: null,
    expiry: null,
    carryForward: { allowed: false, maxDays: null, encashable: false, notes: '' },
    belowMinimumException: null,
    approval: { required: true, notes: 'Management approval prevents staffing shortages.' },
    holidayTreatment: { consumesWeekends: true, consumesGeneralHolidays: true },
    retrospectiveAllowed: false,
    negativeBalanceAllowed: false,
    notes: '',
    source: 'Medical college leave rules',
    ...partial
  } as LeaveCategoryRule;
}

export const MEDICAL_COLLEGE_CATEGORIES: LeaveCategoryRule[] = [
  dayCategory({
    code: 'CL',
    fullForm: 'Casual Leave',
    description:
      'Short-notice personal leave. Up to three days per calendar month and fifteen days per year.',
    entitlement: {
      amount: 15,
      unit: 'days',
      period: 'calendar-year',
      creditTiming: 'year-start',
      proratedInJoiningPeriod: true,
      usageCap: 15,
      notes: 'Credited at the start of the year; monthly crediting can be enabled later.'
    },
    halfDay: { allowed: true, notes: 'First or second half of the day.' },
    maxDaysPerMonth: 3,
    counting: 'calendar-days',
    approval: { required: true, notes: 'Approval is sought before the leave, except retrospective illness.' },
    retrospectiveAllowed: true,
    source: 'OriginalPrompt.txt — CL: 15 days per year, maximum 3 per month.'
  }),
  dayCategory({
    code: 'EL',
    fullForm: 'Earned Leave',
    description:
      'Long leave available after one year of service. Four to eight days per episode, once every three calendar months, capped at thirty days a year.',
    entitlement: {
      amount: null,
      unit: 'days',
      period: 'calendar-year',
      creditTiming: 'none',
      proratedInJoiningPeriod: false,
      usageCap: 30,
      notes: 'Thirty days is a maximum usage limit, not a credited balance (PA-003).'
    },
    halfDay: { allowed: false, notes: 'EL cannot be taken as a half day.' },
    minDaysPerRequest: 4,
    maxContinuousDays: 8,
    counting: 'calendar-days',
    cooldown: {
      months: 3,
      from: 'episode-end',
      notes: 'Measured in calendar months from the end date of the previous episode.'
    },
    eligibility: {
      minServiceMonths: 12,
      notes: 'EL is available only after one year of service.'
    },
    carryForward: {
      allowed: false,
      maxDays: null,
      encashable: false,
      notes: 'Unused EL is not carried forward or encashed under the initial policy.'
    },
    belowMinimumException: {
      allowed: true,
      requiresApproval: true,
      requiresLetter: true,
      countsTowardsUsageCap: true,
      notes: 'Fewer than four remaining EL days may be taken with a letter and approval (PA-005).'
    },
    approval: { required: true, notes: 'Approval is required for the episode.' },
    source: 'OriginalPrompt.txt — EL: minimum 4 days, maximum 8 in a stretch, once every 3 calendar months, 30-day annual cap.'
  }),
  dayCategory({
    code: 'CCL',
    fullForm: 'Compensatory Casual Leave',
    description:
      'Leave earned by doing duty on a Saturday, Sunday or general holiday, or by staying back for official work with approval. Each credit is valid for three calendar months.',
    entitlement: {
      amount: null,
      unit: 'days',
      period: 'calendar-year',
      creditTiming: 'none',
      proratedInJoiningPeriod: false,
      usageCap: null,
      notes: 'Earned through duty events; no annual accumulation limit.'
    },
    halfDay: { allowed: true, notes: 'First or second half of the day.' },
    counting: 'calendar-days',
    expiry: {
      months: 3,
      from: 'earned-date',
      boundary: 'inclusive',
      notes: 'Valid for three calendar months from the date earned, not the approval date (PA-001).'
    },
    approval: { required: true, notes: 'Approval is required to take CCL.' },
    source: 'OriginalPrompt.txt — CCL: earned on qualifying duty, three-month validity from the earned date.'
  }),
  dayCategory({
    code: 'SPCL',
    fullForm: 'Special Casual Leave',
    description:
      'Conference and academic leave. Only working days are consumed; weekends and general holidays inside the period are free.',
    entitlement: {
      amount: 15,
      unit: 'days',
      period: 'calendar-year',
      creditTiming: 'year-start',
      proratedInJoiningPeriod: false,
      usageCap: 15,
      notes: 'Calendar year, per the Phase 1 clarification.'
    },
    halfDay: { allowed: true, notes: 'First or second half of the day.' },
    counting: 'working-days',
    holidayTreatment: { consumesWeekends: false, consumesGeneralHolidays: false },
    approval: { required: true, notes: 'Conference or academic purpose must be approved.' },
    source: 'OriginalPrompt.txt — SpCL: 15 days, working days only, calendar year.'
  }),
  dayCategory({
    code: 'RH',
    fullForm: 'Restricted Holiday',
    description:
      'One restricted holiday per six-month period, anchored to the doctor’s joining date and subject to the published RH list.',
    entitlement: {
      amount: 1,
      unit: 'days',
      period: 'employment-year',
      creditTiming: 'year-start',
      proratedInJoiningPeriod: false,
      usageCap: null,
      notes: 'Entitlement is checked per six-month period of the employment year, not by a 183-day wait.'
    },
    halfDay: { allowed: false, notes: 'RH cannot be taken as a half day.' },
    maxContinuousDays: 1,
    maxDaysPerMonth: null,
    counting: 'calendar-days',
    approval: { required: true, notes: 'Subject to the doctor’s RH list and period availability.' },
    source: 'OriginalPrompt.txt — RH: once in six months, based on the joining date.'
  }),
  dayCategory({
    code: 'GH',
    fullForm: 'General Holiday',
    description:
      'A gazetted holiday from the published holiday list. GH is not a balance; it is a holiday with duty and CCL consequences.',
    entitlement: {
      amount: null,
      unit: 'days',
      period: 'calendar-year',
      creditTiming: 'none',
      proratedInJoiningPeriod: false,
      usageCap: null,
      notes: 'Holiday dates come from the holiday list.'
    },
    counting: 'calendar-days',
    approval: { required: false, notes: 'No approval needed; the holiday list defines the days.' },
    source: 'OriginalPrompt.txt — GH: published holiday list.'
  }),
  dayCategory({
    code: 'LOP',
    fullForm: 'Loss of Pay',
    description:
      'Unpaid absence used when leave balances are exhausted or an absence is not covered by approved leave.',
    entitlement: {
      amount: null,
      unit: 'days',
      period: 'calendar-year',
      creditTiming: 'none',
      proratedInJoiningPeriod: false,
      usageCap: null,
      notes: 'No balance; recorded to explain absences.'
    },
    halfDay: { allowed: true, notes: 'Half-day LOP may be combined with half-day CL or CCL.' },
    counting: 'calendar-days',
    approval: { required: true, notes: 'HR records LOP; HR may later convert it to CL or CCL.' },
    retrospectiveAllowed: true,
    negativeBalanceAllowed: true,
    source: 'OriginalPrompt.txt — LOP for exhausted balances and uncovered absences.'
  }),
  dayCategory({
    code: 'ML',
    fullForm: 'Maternity Leave',
    description: 'Three calendar months paid leave, followed by three calendar months of loss of pay.',
    entitlement: {
      amount: 3,
      unit: 'months',
      period: 'calendar-year',
      creditTiming: 'none',
      proratedInJoiningPeriod: false,
      usageCap: null,
      notes: 'Phase 1 records the entitlement; the detailed workflow is deferred (PA-014).'
    },
    counting: 'calendar-days',
    approval: { required: true, notes: 'Approval and documentation required.' },
    source: 'OriginalPrompt.txt — Maternity: three months paid plus three months LOP.'
  }),
  dayCategory({
    code: 'PL',
    fullForm: 'Paternity Leave',
    description: 'One week of paid leave with prior permission.',
    entitlement: {
      amount: 7,
      unit: 'days',
      period: 'calendar-year',
      creditTiming: 'year-start',
      proratedInJoiningPeriod: false,
      usageCap: 7,
      notes: 'Permission required before availing (PA-014).'
    },
    counting: 'calendar-days',
    approval: { required: true, notes: 'Prior permission is required.' },
    source: 'OriginalPrompt.txt — Paternity: one week paid with permission.'
  })
];

export const MEDICAL_COLLEGE_RULES: ConsequenceRule[] = [
  {
    id: 'rule_duty_pdo',
    title: 'Completed 24-hour duty creates post-duty off',
    description:
      'When a duty is marked completed, a post-duty off is created for the following day.',
    enabled: true,
    trigger: 'DUTY_COMPLETED',
    conditions: [{ field: 'duty.durationHours', operator: 'greater-than-or-equal', value: 24 }],
    consequences: [
      { type: 'create_pdo', category: null, amount: 1, expiryMonths: null, note: 'PDO on the next calendar day.' }
    ],
    dependsOn: [],
    config: { pdoOffsetDays: 1 },
    source: 'OriginalPrompt.txt — each completed 24-hour duty generates next-day PDO.',
    notes: 'Consecutive duties therefore create one PDO per duty (PA-009).'
  },
  {
    id: 'rule_duty_qualifying_ccl',
    title: 'Qualifying duty earns CCL',
    description:
      'Duty performed on a Saturday, Sunday or general holiday earns one CCL credit with a three-month validity.',
    enabled: true,
    trigger: 'DUTY_QUALIFYING_DAY',
    conditions: [
      { field: 'duty.status', operator: 'equals', value: 'completed' },
      { field: 'duty.qualifyingDay', operator: 'is-true', value: true }
    ],
    consequences: [
      { type: 'credit_leave', category: 'CCL', amount: 1, expiryMonths: 3, note: 'One CCL credit.' }
    ],
    dependsOn: ['rule_duty_pdo'],
    config: { creditCategory: 'CCL', creditAmount: 1, expiryMonths: 3 },
    source: 'OriginalPrompt.txt — holiday or weekend night duty earns CCL valid for three months.',
    notes: 'A Sunday duty earns Monday PDO plus this single CCL; no duplicate Sunday rule (PA-010).'
  },
  {
    id: 'rule_pdo_holiday_ccl',
    title: 'PDO falling on a holiday becomes CCL',
    description:
      'If the post-duty off date is already a holiday or weekend, the PDO is converted into a CCL credit.',
    enabled: true,
    trigger: 'PDO_DATE_IS_HOLIDAY',
    conditions: [{ field: 'pdo.dateIsHoliday', operator: 'is-true', value: true }],
    consequences: [
      { type: 'convert_pdo_to_ccl', category: 'CCL', amount: 1, expiryMonths: 3, note: 'PDO converts into CCL.' }
    ],
    dependsOn: ['rule_duty_pdo'],
    config: { expiryMonths: 3 },
    source: 'OriginalPrompt.txt — if the PDO date is already a holiday, the PDO earns a CCL.',
    notes: ''
  },
  {
    id: 'rule_pdo_worked_ccl',
    title: 'Working on PDO earns CCL',
    description:
      'If the doctor works on a PDO and punches out at or before 4 PM, the PDO converts into CCL without further approval.',
    enabled: true,
    trigger: 'PDO_WORKED_WITH_PUNCHOUT',
    conditions: [{ field: 'pdo.punchOutAtOrBeforeCutoff', operator: 'is-true', value: true }],
    consequences: [
      { type: 'convert_pdo_to_ccl', category: 'CCL', amount: 1, expiryMonths: 3, note: 'PDO converts into CCL.' }
    ],
    dependsOn: ['rule_duty_pdo'],
    config: { expiryMonths: 3, requiresApproval: false },
    source: 'OriginalPrompt.txt — punching out up to 4 PM on a PDO earns CCL.',
    notes: 'The doctor does not have to stay until 4 PM; any punch-out up to the cutoff qualifies.'
  },
  {
    id: 'rule_pdo_missing_punchout',
    title: 'Missing punch-out on PDO needs approval',
    description:
      'If the doctor works on a PDO but no punch-out is recorded, management approval is required before the conversion.',
    enabled: true,
    trigger: 'PDO_WORKED_WITHOUT_PUNCHOUT',
    conditions: [{ field: 'pdo.punchOut', operator: 'equals', value: null }],
    consequences: [
      { type: 'require_approval', category: 'CCL', amount: 1, expiryMonths: null, note: 'Approval required.' }
    ],
    dependsOn: ['rule_duty_pdo'],
    config: { expiryMonths: 3 },
    source: 'OriginalPrompt.txt — a missing punch-out requires management approval.',
    notes: ''
  },
  {
    id: 'rule_pdo_unused_ccl',
    title: 'Unused PDO converts to CCL',
    description:
      'An unused PDO never expires; it can be converted into a CCL credit. Conversion may be manual or automatic after a configured number of months.',
    enabled: true,
    trigger: 'PDO_UNUSED',
    conditions: [],
    consequences: [
      { type: 'convert_pdo_to_ccl', category: 'CCL', amount: 1, expiryMonths: 3, note: 'Converted to CCL.' }
    ],
    dependsOn: ['rule_duty_pdo'],
    config: { expiryMonths: 3, autoConvertAfterMonths: null },
    source: 'OriginalPrompt.txt — an unused PDO does not expire and automatically converts to CCL.',
    notes: 'The moment of automatic conversion is not specified, so it is manual by default (PA-019).'
  },
  {
    id: 'rule_absence_lop',
    title: 'Absence without leave may become LOP',
    description:
      'An absence without approved leave is recorded as loss of pay, and HR may retrospectively convert it to CL or CCL.',
    enabled: true,
    trigger: 'ABSENCE_WITHOUT_LEAVE',
    conditions: [],
    consequences: [
      { type: 'inform', category: 'LOP', amount: null, expiryMonths: null, note: 'HR may convert to CL or CCL.' }
    ],
    dependsOn: [],
    config: {},
    source: 'OriginalPrompt.txt — absence without approval is LOP unless converted retrospectively.',
    notes: ''
  },
  {
    id: 'rule_nmc_sunday_punch',
    title: 'Sunday NMC punches count',
    description:
      'Sunday punches may be added to make up a monthly NMC attendance shortage.',
    enabled: true,
    trigger: 'NMC_SUNDAY_PUNCH_ALLOWED',
    conditions: [],
    consequences: [
      { type: 'inform', category: null, amount: null, expiryMonths: null, note: 'A Sunday punch counts towards 21.' }
    ],
    dependsOn: [],
    config: {},
    source: 'OriginalPrompt.txt — NMC punching may be done on Sundays to cover a shortage.',
    notes: ''
  }
];

export function createDefaultPolicyVersion(
  now: string = new Date().toISOString(),
  effectiveFrom: ISODate = '2000-01-01'
): PolicyVersion {
  const audit: AuditFields = { createdAt: now, updatedAt: now };
  return {
    ...audit,
    id: 'policyver_medical_college_v1',
    policyId: DEFAULT_POLICY_ID,
    version: 1,
    status: 'published',
    name: 'Medical College Leave Policy',
    description:
      'Initial configurable policy for doctors at a medical college hospital, based on the confirmed leave rules.',
    organisationId: null,
    department: null,
    designation: null,
    employmentType: null,
    effectiveFrom,
    effectiveTo: null,
    categories: structuredClone(MEDICAL_COLLEGE_CATEGORIES),
    rules: structuredClone(MEDICAL_COLLEGE_RULES),
    work: { ...MEDICAL_COLLEGE_WORK },
    shifts: structuredClone(MEDICAL_COLLEGE_SHIFTS),
    changeSummary: 'Initial published policy.',
    source: 'OriginalPrompt.txt and PHASE1_IMPLEMENTATION_PROMPT.md',
    notes:
      'Policy values are fully configurable. Open interpretations are recorded in POLICY_ASSUMPTIONS.md.',
    publishedAt: now
  };
}

export function createDefaultPolicyDraft(now: string = new Date().toISOString()): PolicyVersion {
  const base = createDefaultPolicyVersion(now);
  return {
    ...base,
    id: '',
    version: base.version + 1,
    status: 'draft',
    publishedAt: null,
    changeSummary: ''
  };
}
