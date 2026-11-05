import type { ISODate } from '../lib/domain/common/types';
import { addDays, addMonths } from '../lib/domain/common/dates';
import type { EmploymentRecord } from '../lib/domain/profile/profile';
import type { Holiday, HolidayKind } from '../lib/domain/calendar/holidays';
import type { LeaveRequest } from '../lib/domain/leave/types';
import type { LedgerTransaction } from '../lib/domain/ledger/types';
import type { Duty, PdoRecord } from '../lib/domain/duty/types';
import type { AttendanceRecord } from '../lib/domain/attendance/types';
import type { PolicyVersion } from '../lib/domain/policy/types';
import { createDefaultPolicyVersion } from '../lib/domain/policy/defaultPolicy';
import type { LeaveValidationContext } from '../lib/engines/leave-validation/leaveValidation';
import { createCredit, createDebit, expiryDateFor } from '../lib/engines/leave-accounting/ledgerEngine';

export const NOW = '2026-11-05T09:00:00.000Z';
export const TODAY: ISODate = '2026-11-05';
export const EMPLOYMENT_START: ISODate = '2020-01-01';

export function makePolicy(overrides: Partial<PolicyVersion> = {}): PolicyVersion {
  return { ...createDefaultPolicyVersion(NOW, '2000-01-01'), ...overrides };
}

export function makeEmployment(overrides: Partial<EmploymentRecord> = {}): EmploymentRecord {
  return {
    id: 'emp_1',
    profileId: 'profile_1',
    organisationId: 'org_primary',
    department: 'Orthopaedics',
    designation: 'Assistant Professor',
    unit: 'Unit 1',
    employmentType: 'permanent',
    startDate: EMPLOYMENT_START,
    endDate: null,
    policyId: 'policy_medical_college',
    isPrimary: true,
    notes: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

let creditCounter = 0;

export function credit(
  category: string,
  amount: number,
  effectiveDate: ISODate,
  options: { expiryDate?: ISODate | null; policy?: PolicyVersion; id?: string } = {}
): LedgerTransaction {
  creditCounter += 1;
  return createCredit({
    id: options.id ?? `credit_${category}_${creditCounter}`,
    profileId: 'profile_1',
    employmentId: 'emp_1',
    category,
    amount,
    effectiveDate,
    source: category === 'CCL' ? 'duty-ccl' : 'entitlement',
    reason: `${category} credit`,
    now: NOW,
    expiryDate:
      options.expiryDate !== undefined
        ? options.expiryDate
        : options.policy
          ? expiryDateFor(options.policy, category, effectiveDate)
          : null
  });
}

export function debit(
  category: string,
  amount: number,
  effectiveDate: ISODate,
  options: { id?: string; leaveRequestId?: string } = {}
): LedgerTransaction {
  creditCounter += 1;
  return createDebit({
    id: options.id ?? `debit_${category}_${creditCounter}`,
    profileId: 'profile_1',
    employmentId: 'emp_1',
    category,
    amount,
    effectiveDate,
    source: category === 'LOP' ? 'lop' : 'usage',
    reason: `${category} usage`,
    now: NOW,
    leaveRequestId: options.leaveRequestId ?? null
  });
}

export function makeHoliday(date: ISODate, kind: HolidayKind = 'GH', name = 'Holiday'): Holiday {
  return {
    id: `hol_${date}_${kind}`,
    year: Number(date.slice(0, 4)),
    date,
    name,
    kind,
    source: 'manual',
    notes: '',
    createdAt: NOW,
    updatedAt: NOW
  };
}

export function makeLeave(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  const startDate = overrides.startDate ?? '2026-11-10';
  return {
    id: overrides.id ?? `leave_${Math.random().toString(36).slice(2, 8)}`,
    profileId: 'profile_1',
    employmentId: 'emp_1',
    policyId: 'policy_medical_college',
    policyVersionId: 'policyver_medical_college_v1',
    category: 'CL',
    startDate,
    endDate: overrides.endDate ?? startDate,
    halfDay: null,
    calendarDays: 1,
    leaveDays: 1,
    status: 'approved',
    approvalRequired: true,
    approvalState: 'approved',
    approvalNote: '',
    reason: '',
    notes: '',
    source: 'manual',
    plannedWithPolicyVersionId: null,
    ledgerTransactionIds: [],
    cancelledAt: null,
    cancellationReason: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

export function makeDuty(overrides: Partial<Duty> = {}): Duty {
  return {
    id: overrides.id ?? `duty_${Math.random().toString(36).slice(2, 8)}`,
    profileId: 'profile_1',
    employmentId: 'emp_1',
    date: overrides.date ?? '2026-11-07',
    shiftId: 'shift_night_24h',
    shiftName: 'Night duty (24 hours)',
    startTime: '09:00',
    endTime: '09:00',
    crossesMidnight: true,
    durationHours: 24,
    status: 'completed',
    qualifyingDay: false,
    remarks: '',
    swap: null,
    rosterEntryId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

export function makePdo(overrides: Partial<PdoRecord> = {}): PdoRecord {
  return {
    id: overrides.id ?? `pdo_${Math.random().toString(36).slice(2, 8)}`,
    profileId: 'profile_1',
    employmentId: 'emp_1',
    dutyId: 'duty_1',
    date: overrides.date ?? '2026-11-08',
    status: 'scheduled',
    punchOutAt: null,
    cclTransactionId: null,
    approvalRequired: false,
    notes: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

export function makeAttendanceRecord(
  date: ISODate,
  state: AttendanceRecord['state'] = 'confirmed'
): AttendanceRecord {
  return {
    id: `att_${date}_${state}`,
    profileId: 'profile_1',
    date,
    state,
    source: 'manual',
    note: '',
    createdAt: NOW,
    updatedAt: NOW
  };
}

export function makeContext(
  overrides: Partial<LeaveValidationContext> = {}
): LeaveValidationContext {
  return {
    today: TODAY,
    employment: makeEmployment(),
    policyVersions: [makePolicy()],
    holidays: [],
    leaves: [],
    ledger: [],
    duties: [],
    pdos: [],
    attendanceRecords: [],
    ...overrides
  };
}

/** Fifteen CL days credited for the 2026 calendar year. */
export function clCredits(amount = 15, year = 2026): LedgerTransaction {
  return credit('CL', amount, `${year}-01-01`, { id: `cl-credit-${year}` });
}

export function spclCredits(amount = 15, year = 2026): LedgerTransaction {
  return credit('SPCL', amount, `${year}-01-01`, { id: `spcl-credit-${year}` });
}

export function cclCredit(earnedOn: ISODate, amount = 1, id?: string): LedgerTransaction {
  return credit('CCL', amount, earnedOn, {
    expiryDate: addDays(addMonths(earnedOn, 3), 0),
    id
  });
}

export function range(start: ISODate, days: number): { startDate: ISODate; endDate: ISODate } {
  return { startDate: start, endDate: addDays(start, days - 1) };
}
