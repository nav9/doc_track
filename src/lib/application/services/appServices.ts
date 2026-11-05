/**
 * Application services.
 *
 * The UI calls these methods and never touches IndexedDB or the engines
 * directly. Each method loads the data it needs, delegates rules to the pure
 * engines, then persists the result. Returned snapshots are reloaded by the UI
 * store after every mutation, so all views stay consistent.
 */
import type { Repositories } from '../ports/repositories';
import type { DataSnapshot } from '../dto/snapshot';
import { countSnapshot, emptySnapshot } from '../dto/snapshot';
import type {
  ApplyImportResult,
  DataVersion,
  ExportKind,
  ImportPreview
} from '../dto/version';
import type { AppSettings, LogEntry, LogLevel } from '../../domain/settings/types';
import { defaultSettings } from '../../domain/settings/types';
import type {
  DoctorProfile,
  EmploymentRecord,
  Organisation,
  ProfileDraft
} from '../../domain/profile/profile';
import { validateProfileDraft } from '../../domain/profile/profile';
import type { PolicyVersion } from '../../domain/policy/types';
import { createDefaultPolicyVersion } from '../../domain/policy/defaultPolicy';
import { clonePlain } from '../../domain/common/clone';
import { getCategoryRule, selectPolicyVersion } from '../../engines/policy-engine/policyEngine';
import type { PolicyScope } from '../../engines/policy-engine/policyEngine';
import type { LeaveRequest, LeaveStatus, HalfDayPortion } from '../../domain/leave/types';
import { isActiveLeave } from '../../domain/leave/types';
import type { LedgerTransaction } from '../../domain/ledger/types';
import { computeBalances } from '../../engines/leave-accounting/ledgerEngine';
import {
  allocateCclCredits,
  createCredit,
  createDebit,
  createReversal,
  expiryDateFor
} from '../../engines/leave-accounting/ledgerEngine';
import type { LeaveValidationContext } from '../../engines/leave-validation/leaveValidation';
import { evaluateLeaveRequest } from '../../engines/leave-validation/leaveValidation';
import type { Duty, PdoRecord } from '../../domain/duty/types';
import {
  planDuty,
  decidePdoOutcome,
  unusedPdoConversion,
  validateDutyInput,
  weekendDaysFor
} from '../../engines/duty-engine/dutyEngine';
import type { AttendanceRecord } from '../../domain/attendance/types';
import type { CalendarEvent, EventName, Holiday } from '../../domain/calendar/holidays';
import { validateHoliday } from '../../domain/calendar/holidays';
import type { DutyRoster, RosterDoctor } from '../../domain/roster/types';
import { addDays, monthKey, monthsBetween, periodBounds, todayLocal } from '../../domain/common/dates';
import { newId, stableId } from '../../domain/common/ids';
import { roundDays } from '../../domain/common/types';
import type { ApprovalState, ValidationIssue } from '../../domain/common/types';
import { Clock } from './clock';
import { ServiceError } from './errors';
import { APP_VERSION } from '../../app/version';
import {
  buildPreview,
  encodeEnvelope,
  extractChunks,
  mergeSnapshots,
  normalizeSnapshotData,
  parseEnvelopes
} from '../../infrastructure/import-export/envelope';
import type { Envelope } from '../../infrastructure/import-export/envelope';
import { fileNameForExport } from './exportNames';

export interface DutyInput {
  id?: string;
  date: string;
  shiftId: string;
  status: Duty['status'];
  remarks: string;
  swapDirection?: 'gave-away' | 'took-over' | null;
  otherDoctorName?: string;
  compensationDate?: string | null;
  swapReason?: string;
}

export interface CreateLeaveInput {
  category: string;
  startDate: string;
  endDate: string;
  halfDay?: HalfDayPortion | null;
  status?: LeaveStatus;
  reason: string;
  notes: string;
  source?: LeaveRequest['source'];
  approvalState?: ApprovalState;
}

export interface RosterSaveOptions {
  syncDuties: boolean;
}

export class AppServices {
  readonly clock: Clock;
  private settingsCache: AppSettings | null = null;
  private logWrites = 0;

  constructor(private readonly repos: Repositories) {
    this.clock = new Clock(() => this.settingsCache ?? undefined);
  }

  // ---------------------------------------------------------------- bootstrap

  async init(): Promise<DataSnapshot> {
    let settings = await this.repos.settings.get();
    if (!settings) {
      settings = defaultSettings(this.clock.nowISO());
      await this.repos.settings.put(settings);
    }
    this.settingsCache = settings;

    if ((await this.repos.policies.count()) === 0) {
      await this.repos.policies.put(createDefaultPolicyVersion(this.clock.nowISO()));
    }

    await this.ensureEntitlementCredits();
    await this.pruneLogs();
    return this.repos.snapshot.readAll();
  }

  async getSettings(): Promise<AppSettings> {
    if (!this.settingsCache) {
      const stored = await this.repos.settings.get();
      this.settingsCache = stored ?? defaultSettings(this.clock.nowISO());
      if (!stored) await this.repos.settings.put(this.settingsCache);
    }
    return this.settingsCache;
  }

  async saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    const next: AppSettings = {
      ...current,
      ...clonePlain(patch),
      id: 'app',
      updatedAt: this.clock.nowISO()
    };
    await this.repos.settings.put(next);
    this.settingsCache = next;
    await this.log('INFO', 'settings', 'Settings updated', Object.keys(patch).join(', '));
    return next;
  }

  async snapshot(): Promise<DataSnapshot> {
    return this.repos.snapshot.readAll();
  }

  primaryEmployment(snapshot: DataSnapshot): EmploymentRecord | null {
    const byDefault = this.settingsCache?.defaultEmploymentId;
    return (
      snapshot.employments.find((employment) => employment.id === byDefault) ??
      snapshot.employments.find((employment) => employment.isPrimary) ??
      snapshot.employments[0] ??
      null
    );
  }

  policyScope(employment: EmploymentRecord | null): PolicyScope {
    if (!employment) return {};
    return {
      organisationId: employment.organisationId,
      department: employment.department,
      employmentType: employment.employmentType
    };
  }

  policyFor(
    snapshot: DataSnapshot,
    date: string,
    employment: EmploymentRecord | null
  ): PolicyVersion | null {
    return selectPolicyVersion(snapshot.policies, date, this.policyScope(employment));
  }

  // ------------------------------------------------------------------ profile

  async saveProfile(
    draft: ProfileDraft,
    options: {
      resolvedPrefix?: string;
      employmentType?: EmploymentRecord['employmentType'];
      joiningDate?: string;
      employmentEndDate?: string | null;
      organisationName?: string;
    } = {}
  ): Promise<{ profile: DoctorProfile; employment: EmploymentRecord }> {
    const issues = validateProfileDraft(draft, options.resolvedPrefix);
    if (issues.length > 0) {
      throw new ServiceError(
        'PROFILE_INVALID',
        issues[0].message,
        issues.map((issue) => ({
          code: issue.code,
          severity: 'error' as const,
          message: issue.message
        }))
      );
    }

    const now = this.clock.nowISO();
    const snapshot = await this.snapshot();
    const existingProfile = snapshot.profiles[0];
    const profile: DoctorProfile = {
      id: existingProfile?.id ?? newId('profile'),
      prefix: (options.resolvedPrefix ?? draft.prefix).trim(),
      name: draft.name.trim(),
      employeeId: draft.employeeId.trim(),
      department: draft.department.trim(),
      designation: draft.designation?.trim() ?? '',
      speciality: draft.speciality?.trim() ?? '',
      unit: draft.unit?.trim() ?? '',
      hospitalName: (options.organisationName ?? draft.hospitalName ?? '').trim(),
      role: draft.role ?? 'doctor',
      contactEmail: draft.contactEmail?.trim() ?? '',
      contactPhone: draft.contactPhone?.trim() ?? '',
      notes: draft.notes?.trim() ?? '',
      createdAt: existingProfile?.createdAt ?? now,
      updatedAt: now
    };

    let organisation = snapshot.organisations.find(
      (item) => item.name.toLowerCase() === profile.hospitalName.toLowerCase() && profile.hospitalName
    );
    if (!organisation) {
      organisation = {
        id: snapshot.organisations[0]?.id ?? 'org_primary',
        name: profile.hospitalName || 'Primary hospital',
        kind: 'medical-college',
        address: '',
        notes: '',
        createdAt: now,
        updatedAt: now
      };
      await this.repos.organisations.put(organisation);
    }

    const existingEmployment = snapshot.employments.find(
      (employment) => employment.profileId === profile.id
    );
    const employment: EmploymentRecord = {
      id: existingEmployment?.id ?? newId('emp'),
      profileId: profile.id,
      organisationId: organisation.id,
      department: profile.department,
      designation: profile.designation,
      unit: profile.unit,
      employmentType: options.employmentType ?? existingEmployment?.employmentType ?? 'permanent',
      startDate: options.joiningDate || existingEmployment?.startDate || this.clock.today(),
      endDate: options.employmentEndDate ?? existingEmployment?.endDate ?? null,
      policyId: existingEmployment?.policyId ?? null,
      isPrimary: true,
      notes: '',
      createdAt: existingEmployment?.createdAt ?? now,
      updatedAt: now
    };

    // Only one primary employment in the Phase 1 UI; the model supports more.
    for (const other of snapshot.employments) {
      if (other.id !== employment.id && other.isPrimary) {
        await this.repos.employments.put({ ...other, isPrimary: false, updatedAt: now });
      }
    }

    await this.repos.profiles.put(profile);
    await this.repos.employments.put(employment);
    await this.saveSettings({
      onboarded: true,
      defaultEmploymentId: employment.id,
      defaultPolicyId: snapshot.policies[0]?.policyId ?? null
    });

    await this.ensureEntitlementCredits();
    await this.log('INFO', 'profile', 'Profile saved', profile.employeeId ? 'employee id present' : '');
    return { profile, employment };
  }

  // --------------------------------------------------------------- accounting

  /**
   * Creates entitlement credits idempotently. Only the current and next policy
   * period are seeded; historical credits arrive through an import or are
   * created for the period when they were earned.
   */
  async ensureEntitlementCredits(): Promise<void> {
    const snapshot = await this.snapshot();
    const employment = this.primaryEmployment(snapshot);
    if (!employment) return;
    const today = this.clock.today();
    const policy = this.policyFor(snapshot, today, employment);
    if (!policy) return;

    const existingIds = new Set(snapshot.ledger.map((transaction) => transaction.id));
    const created: LedgerTransaction[] = [];

    for (const category of policy.categories) {
      if (!category.enabled || category.code === 'RH') continue;
      if (category.entitlement.creditTiming === 'none') continue;
      if (category.entitlement.amount === null || category.entitlement.unit === 'months') continue;

      const options = {
        employmentStart: employment.startDate,
        academicYearStartMonth: policy.work.academicYearStartMonth
      };
      const current = periodBounds(category.entitlement.period, today, options);
      const next = periodBounds(category.entitlement.period, addDays(current.end, 1), options);
      for (const period of [current, next]) {
        if (employment.startDate > period.end) continue;
        const id = stableId('ent', employment.id, category.code, period.start);
        if (existingIds.has(id)) continue;

        let amount = category.entitlement.amount;
        if (
          category.entitlement.proratedInJoiningPeriod &&
          employment.startDate > period.start &&
          employment.startDate <= period.end
        ) {
          const monthsRemaining = Math.min(
            12,
            monthsBetween(employment.startDate, period.end) + 1
          );
          amount = Math.max(0.5, Math.round(((amount * monthsRemaining) / 12) * 2) / 2);
        }

        created.push(
          createCredit({
            id,
            profileId: employment.profileId,
            employmentId: employment.id,
            category: category.code,
            amount,
            effectiveDate: period.start,
            source: 'entitlement',
            reason: `${category.code} entitlement for ${period.label}`,
            notes: category.entitlement.proratedInJoiningPeriod ? 'Prorated for the joining period.' : '',
            now: this.clock.nowISO()
          })
        );
        existingIds.add(id);
      }
    }

    if (created.length > 0) {
      await this.repos.ledger.bulkPut(created);
      await this.log('INFO', 'ledger', 'Entitlement credits created', `${created.length} credits`);
    }
  }

  /** Full validation context for engines. */
  async leaveContext(snapshot?: DataSnapshot): Promise<{
    context: LeaveValidationContext;
    employment: EmploymentRecord | null;
    profile: DoctorProfile | null;
    policy: PolicyVersion | null;
  }> {
    const data = snapshot ?? (await this.snapshot());
    const employment = this.primaryEmployment(data);
    const today = this.clock.today();
    const policy = this.policyFor(data, today, employment);
    const context: LeaveValidationContext = {
      today,
      employment,
      policyVersions: data.policies,
      policyScope: this.policyScope(employment),
      holidays: data.holidays,
      leaves: data.leaves,
      ledger: data.ledger,
      duties: data.duties,
      pdos: data.pdos,
      attendanceRecords: data.attendance,
      fallbackWeekendDays: weekendDaysFor(policy)
    };
    return { context, employment, profile: data.profiles[0] ?? null, policy };
  }

  async createLeave(input: CreateLeaveInput): Promise<LeaveRequest> {
    await this.ensureEntitlementCredits();
    const snapshot = await this.snapshot();
    const employment = this.primaryEmployment(snapshot);
    const profile = snapshot.profiles[0];
    if (!employment || !profile) {
      throw new ServiceError('NO_PROFILE', 'Complete the profile before recording leave.');
    }

    const halfDay = input.halfDay ?? null;
    const evaluation = evaluateLeaveRequest(
      {
        category: input.category,
        startDate: input.startDate,
        endDate: input.endDate,
        halfDay
      },
      await this.leaveContext(snapshot).then((result) => result.context)
    );

    if (evaluation.status === 'not-possible' || evaluation.status === 'indeterminate') {
      const blocking = evaluation.reasons.find(
        (reason) => reason.severity === 'error' || reason.severity === 'condition'
      );
      throw new ServiceError(
        evaluation.status === 'indeterminate' ? 'LEAVE_INDETERMINATE' : 'LEAVE_NOT_POSSIBLE',
        blocking?.message ?? 'The leave cannot be recorded under the active policy.',
        evaluation.reasons
      );
    }

    const policy = this.policyFor(snapshot, input.startDate, employment);
    if (!policy) {
      throw new ServiceError('NO_POLICY', 'No published policy covers these dates.');
    }
    const rule = getCategoryRule(policy, input.category);
    const approvalRequired = rule?.approval.required ?? false;
    const approvalState: ApprovalState =
      input.approvalState ?? (approvalRequired ? 'pending' : 'not-required');
    const status: LeaveStatus = input.status ?? 'planned';
    const now = this.clock.nowISO();
    const leaveId = newId('leave');
    const ledgerTransactions: LedgerTransaction[] = [];

    if (evaluation.leaveDays > 0) {
      const allocations =
        input.category === 'CCL'
          ? allocateCclCredits(snapshot.ledger, evaluation.leaveDays, input.endDate).allocations
          : null;
      const approvalStatus: LedgerTransaction['approvalStatus'] =
        approvalState === 'approved'
          ? 'approved'
          : approvalState === 'pending'
            ? 'pending'
            : approvalState === 'rejected'
              ? 'rejected'
              : 'not-required';
      ledgerTransactions.push(
        createDebit({
          id: newId('ledger'),
          profileId: profile.id,
          employmentId: employment.id,
          category: input.category,
          amount: evaluation.leaveDays,
          effectiveDate: input.startDate,
          source: input.category === 'LOP' ? 'lop' : 'usage',
          reason: `${input.category} from ${input.startDate} to ${input.endDate}`,
          notes: input.reason,
          now,
          leaveRequestId: leaveId,
          approvalStatus,
          allocations
        })
      );
    }

    const leave: LeaveRequest = {
      id: leaveId,
      profileId: profile.id,
      employmentId: employment.id,
      policyId: policy.policyId,
      policyVersionId: policy.id,
      category: input.category,
      startDate: input.startDate,
      endDate: input.endDate,
      halfDay,
      calendarDays: evaluation.calendarDays,
      leaveDays: evaluation.leaveDays,
      status,
      approvalRequired,
      approvalState,
      approvalNote: evaluation.consequences.approvalNote,
      reason: input.reason,
      notes: input.notes,
      source: input.source ?? 'manual',
      plannedWithPolicyVersionId: input.source === 'planner' ? policy.id : null,
      ledgerTransactionIds: ledgerTransactions.map((transaction) => transaction.id),
      cancelledAt: null,
      cancellationReason: '',
      createdAt: now,
      updatedAt: now
    };

    await this.repos.leaves.put(leave);
    if (ledgerTransactions.length > 0) {
      await this.repos.ledger.bulkPut(ledgerTransactions);
    }
    await this.log('INFO', 'leave', 'Leave recorded', `${leave.category} ${leave.startDate}..${leave.endDate}`);
    return leave;
  }

  async cancelLeave(id: string, reason: string): Promise<void> {
    const snapshot = await this.snapshot();
    const leave = snapshot.leaves.find((item) => item.id === id);
    if (!leave) throw new ServiceError('LEAVE_NOT_FOUND', 'Leave record not found.');
    if (leave.status === 'cancelled') return;

    const now = this.clock.nowISO();
    const reversed = new Set(snapshot.ledger.filter((tx) => tx.reversalOf).map((tx) => tx.reversalOf));
    const reversals = snapshot.ledger
      .filter((tx) => leave.ledgerTransactionIds.includes(tx.id) && !reversed.has(tx.id))
      .map((tx) =>
        createReversal(tx, {
          id: newId('ledger'),
          now,
          reason: `Leave cancelled: ${reason || 'no reason given'}`
        })
      );

    if (reversals.length > 0) await this.repos.ledger.bulkPut(reversals);
    await this.repos.leaves.put({
      ...leave,
      status: 'cancelled',
      cancelledAt: now,
      cancellationReason: reason,
      updatedAt: now
    });
    await this.log('INFO', 'leave', 'Leave cancelled', leave.category);
  }

  async setLeaveStatus(
    id: string,
    status: LeaveStatus,
    approvalState: ApprovalState,
    note = ''
  ): Promise<void> {
    const snapshot = await this.snapshot();
    const leave = snapshot.leaves.find((item) => item.id === id);
    if (!leave) throw new ServiceError('LEAVE_NOT_FOUND', 'Leave record not found.');
    const now = this.clock.nowISO();
    await this.repos.leaves.put({
      ...leave,
      status,
      approvalState,
      approvalNote: note || leave.approvalNote,
      updatedAt: now
    });
    const ledgerApproval: ApprovalState =
      approvalState === 'approved' ? 'approved' : approvalState === 'rejected' ? 'rejected' : approvalState;
    for (const transactionId of leave.ledgerTransactionIds) {
      const transaction = snapshot.ledger.find((tx) => tx.id === transactionId);
      if (transaction) {
        await this.repos.ledger.put({
          ...transaction,
          approvalStatus: ledgerApproval,
          updatedAt: now
        });
      }
    }
    await this.log('INFO', 'leave', 'Leave status changed', `${status}/${approvalState}`);
  }

  async adjustLedger(input: {
    category: string;
    amount: number;
    direction: 'credit' | 'debit';
    effectiveDate: string;
    reason: string;
  }): Promise<void> {
    if (!input.reason.trim()) {
      throw new ServiceError('ADJUSTMENT_REASON', 'Enter a reason for the manual adjustment.');
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 60) {
      throw new ServiceError('ADJUSTMENT_AMOUNT', 'Enter an adjustment between 0 and 60 days.');
    }
    const snapshot = await this.snapshot();
    const employment = this.primaryEmployment(snapshot);
    const profile = snapshot.profiles[0];
    if (!employment || !profile) throw new ServiceError('NO_PROFILE', 'Complete the profile first.');
    const now = this.clock.nowISO();
    const base = {
      id: newId('ledger'),
      profileId: profile.id,
      employmentId: employment.id,
      category: input.category,
      amount: roundDays(input.amount),
      effectiveDate: input.effectiveDate,
      reason: input.reason,
      notes: 'Manual adjustment',
      now,
      approvalStatus: 'approved' as const
    };
    const transaction =
      input.direction === 'credit'
        ? createCredit({ ...base, source: 'adjustment' })
        : createDebit({ ...base, source: 'adjustment' });
    await this.repos.ledger.put(transaction);
    await this.log('INFO', 'ledger', 'Manual adjustment', `${input.direction} ${input.category}`);
  }

  async balances(snapshot?: DataSnapshot): Promise<ReturnType<typeof computeBalances>> {
    const data = snapshot ?? (await this.snapshot());
    const employment = this.primaryEmployment(data);
    const policy = this.policyFor(data, this.clock.today(), employment);
    return computeBalances(data.ledger, {
      today: this.clock.today(),
      policy,
      employmentStart: employment?.startDate ?? null,
      academicYearStartMonth: policy?.work.academicYearStartMonth
    });
  }

  // --------------------------------------------------------------------- duty

  async saveDuty(input: DutyInput): Promise<Duty> {
    const snapshot = await this.snapshot();
    const employment = this.primaryEmployment(snapshot);
    const profile = snapshot.profiles[0];
    if (!employment || !profile) {
      throw new ServiceError('NO_PROFILE', 'Complete the profile before adding duties.');
    }
    const today = this.clock.today();
    const policy = this.policyFor(snapshot, input.date, employment);
    if (!policy) throw new ServiceError('NO_POLICY', 'No published policy covers this duty date.');

    const shift = policy.shifts.find((item) => item.id === input.shiftId) ?? policy.shifts[0];
    if (!shift) throw new ServiceError('NO_SHIFT', 'The policy defines no duty shifts.');

    const issues = validateDutyInput({
      date: input.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      shiftId: shift.id,
      existing: snapshot.duties,
      excludeDutyId: input.id ?? null
    });
    if (issues.length > 0) {
      throw new ServiceError(
        issues[0].code,
        issues[0].message,
        issues.map((issue) => ({
          code: issue.code,
          severity: issue.severity === 'warning' ? ('warning' as const) : ('error' as const),
          message: issue.message
        }))
      );
    }

    const now = this.clock.nowISO();
    const existing = input.id ? snapshot.duties.find((duty) => duty.id === input.id) : undefined;
    const dutyId = existing?.id ?? newId('duty');
    const duty: Duty = {
      id: dutyId,
      profileId: profile.id,
      employmentId: employment.id,
      date: input.date,
      shiftId: shift.id,
      shiftName: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      crossesMidnight: shift.crossesMidnight,
      durationHours: shift.durationHours,
      status: input.status,
      qualifyingDay: false,
      remarks: input.remarks,
      swap:
        input.swapDirection && input.otherDoctorName
          ? {
              direction: input.swapDirection,
              otherDoctorName: input.otherDoctorName,
              otherDoctorId: null,
              compensationDate: input.compensationDate || null,
              reason: input.swapReason ?? '',
              notes: ''
            }
          : null,
      rosterEntryId: existing?.rosterEntryId ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    const plan = planDuty(duty, { policy, holidays: snapshot.holidays });
    duty.qualifyingDay = plan.qualifyingDay;

    await this.repos.duties.put(duty);

    // Remove consequences that no longer apply (reversal, never deletion).
    const reversed = new Set(snapshot.ledger.filter((tx) => tx.reversalOf).map((tx) => tx.reversalOf));
    const dutyCredits = snapshot.ledger.filter(
      (tx) => dutyCclDutyId(tx) === dutyId && !reversed.has(tx.id) && tx.direction === 'credit'
    );
    const shouldHaveCredits = input.status === 'completed' && plan.cclCredits.length > 0;
    if (!shouldHaveCredits || duty.date !== existing?.date || input.status !== existing?.status) {
      const reversals = dutyCredits.map((tx) =>
        createReversal(tx, { id: newId('ledger'), now, reason: 'Duty consequences recalculated' })
      );
      if (reversals.length) await this.repos.ledger.bulkPut(reversals);
    }

    const existingPdo = snapshot.pdos.find((pdo) => pdo.dutyId === dutyId);
    if (input.status === 'completed' && plan.pdoDate) {
      const pdoId = existingPdo?.id ?? stableId('pdo', dutyId);
      const pdo: PdoRecord = {
        id: pdoId,
        profileId: profile.id,
        employmentId: employment.id,
        dutyId,
        date: plan.pdoDate,
        status: existingPdo && existingPdo.status !== 'scheduled' ? existingPdo.status : 'scheduled',
        punchOutAt: existingPdo?.punchOutAt ?? null,
        cclTransactionId: existingPdo?.cclTransactionId ?? null,
        approvalRequired: existingPdo?.approvalRequired ?? false,
        notes: existingPdo?.notes ?? '',
        createdAt: existingPdo?.createdAt ?? now,
        updatedAt: now
      };
      await this.repos.pdos.put(pdo);

      // A PDO that lands on a holiday converts immediately (rule PDO_DATE_IS_HOLIDAY).
      const decision = decidePdoOutcome(pdo, {
        policy,
        holidays: snapshot.holidays,
        today
      });
      if (decision.convert && decision.status === 'converted-holiday') {
        const creditId = stableId('pdo-ccl', pdoId);
        if (!snapshot.ledger.some((tx) => tx.id === creditId)) {
          await this.repos.ledger.put(
            createCredit({
              id: creditId,
              profileId: profile.id,
              employmentId: employment.id,
              category: 'CCL',
              amount: 1,
              effectiveDate: pdo.date,
              source: 'pdo-conversion',
              reason: `PDO on ${pdo.date} fell on a holiday`,
              now,
              expiryDate: expiryDateFor(policy, 'CCL', pdo.date),
              relatedTransactionId: dutyId
            })
          );
        }
        await this.repos.pdos.put({
          ...pdo,
          status: 'converted-holiday',
          cclTransactionId: creditId
        });
      }
    } else if (existingPdo && existingPdo.status === 'scheduled') {
      await this.repos.pdos.put({
        ...existingPdo,
        status: 'cancelled',
        updatedAt: now,
        notes: 'Duty changed; PDO cancelled.'
      });
    }

    if (input.status === 'completed') {
      for (const [index, credit] of plan.cclCredits.entries()) {
        const creditId = stableId('ccl', dutyId, duty.date, index);
        const previousCredit = snapshot.ledger.find((tx) => tx.id === creditId);
        if (previousCredit && !reversed.has(creditId)) continue;
        await this.repos.ledger.put(
          createCredit({
            // A reversed credit keeps its reversal record, so a fresh entry is
            // written instead of resurrecting the same identifier.
            id: previousCredit ? newId('ledger') : creditId,
            profileId: profile.id,
            employmentId: employment.id,
            category: credit.category,
            amount: credit.amount,
            effectiveDate: duty.date,
            source: 'duty-ccl',
            reason: credit.reason,
            now,
            expiryDate: expiryDateFor(policy, credit.category, duty.date),
            relatedTransactionId: dutyId
          })
        );
      }
    }

    await this.log('INFO', 'duty', 'Duty saved', `${input.date} ${shift.name}`);
    return duty;
  }

  async cancelDuty(id: string): Promise<void> {
    const snapshot = await this.snapshot();
    const duty = snapshot.duties.find((item) => item.id === id);
    if (!duty) throw new ServiceError('DUTY_NOT_FOUND', 'Duty not found.');
    const now = this.clock.nowISO();
    const reversed = new Set(snapshot.ledger.filter((tx) => tx.reversalOf).map((tx) => tx.reversalOf));
    const reversals = snapshot.ledger
      .filter((tx) => dutyCclDutyId(tx) === duty.id && !reversed.has(tx.id) && tx.direction === 'credit')
      .map((tx) => createReversal(tx, { id: newId('ledger'), now, reason: 'Duty cancelled' }));
    if (reversals.length) await this.repos.ledger.bulkPut(reversals);
    for (const pdo of snapshot.pdos.filter((item) => item.dutyId === duty.id && item.status === 'scheduled')) {
      await this.repos.pdos.put({ ...pdo, status: 'cancelled', updatedAt: now, notes: 'Duty cancelled.' });
    }
    await this.repos.duties.put({ ...duty, status: 'cancelled', updatedAt: now });
    await this.log('INFO', 'duty', 'Duty cancelled', duty.date);
  }

  async resolvePdo(
    pdoId: string,
    action: 'worked' | 'unused' | 'approve',
    punchOutTime?: string
  ): Promise<{ converted: boolean; message: string }> {
    const snapshot = await this.snapshot();
    const pdo = snapshot.pdos.find((item) => item.id === pdoId);
    if (!pdo) throw new ServiceError('PDO_NOT_FOUND', 'PDO record not found.');
    if (pdo.status !== 'scheduled') {
      return { converted: false, message: 'This PDO is already resolved.' };
    }
    const employment = this.primaryEmployment(snapshot);
    const profile = snapshot.profiles[0];
    if (!employment || !profile) throw new ServiceError('NO_PROFILE', 'Complete the profile first.');
    const policy = this.policyFor(snapshot, pdo.date, employment);
    const today = this.clock.today();
    const now = this.clock.nowISO();

    let punchOutAt = pdo.punchOutAt;
    if (action === 'worked') {
      if (!punchOutTime) {
        throw new ServiceError('PDO_PUNCHOUT_REQUIRED', 'Enter the punch-out time.');
      }
      punchOutAt = `${pdo.date}T${punchOutTime}:00`;
    }

    const candidate: PdoRecord = {
      ...pdo,
      punchOutAt,
      approvalRequired: action === 'approve' ? false : pdo.approvalRequired
    };

    const manualUnused = action === 'unused';
    const forcedApprove = action === 'approve';
    const decision = forcedApprove
      ? {
          convert: true,
          status: 'converted-worked' as const,
          requiresApproval: false,
          reason:
            'Management approval was recorded, so the PDO converts into one CCL credit.',
          expiryMonths: null
        }
      : manualUnused
        ? unusedPdoConversion(candidate, { policy, holidays: snapshot.holidays, today })
        : decidePdoOutcome(candidate, { policy, holidays: snapshot.holidays, today });

    if (!decision.convert && !manualUnused) {
      await this.repos.pdos.put({ ...candidate, approvalRequired: decision.requiresApproval, updatedAt: now });
      return { converted: false, message: decision.reason };
    }

    const earnedOn = action === 'unused' ? today : pdo.date;
    const creditId = stableId('pdo-ccl', pdo.id);
    if (!snapshot.ledger.some((tx) => tx.id === creditId)) {
      await this.repos.ledger.put(
        createCredit({
          id: creditId,
          profileId: profile.id,
          employmentId: employment.id,
          category: 'CCL',
          amount: 1,
          effectiveDate: earnedOn,
          source: 'pdo-conversion',
          reason:
            action === 'unused'
              ? `Unused PDO from ${pdo.date} converted to CCL`
              : `PDO on ${pdo.date} converted to CCL`,
          now,
          expiryDate: expiryDateFor(policy, 'CCL', earnedOn),
          relatedTransactionId: pdo.dutyId
        })
      );
    }

    await this.repos.pdos.put({
      ...candidate,
      status: manualUnused ? 'converted-unused' : decision.status,
      cclTransactionId: creditId,
      notes: decision.reason,
      updatedAt: now
    });
    await this.log('INFO', 'pdo', 'PDO converted to CCL', pdo.date);
    return { converted: true, message: decision.reason };
  }

  // --------------------------------------------------------------- attendance

  async setAttendance(date: string, state: AttendanceRecord['state'] | null, note = ''): Promise<void> {
    const snapshot = await this.snapshot();
    const profile = snapshot.profiles[0];
    if (!profile) throw new ServiceError('NO_PROFILE', 'Complete the profile first.');
    const id = stableId('att', profile.id, date);
    if (state === null) {
      await this.repos.attendance.remove(id);
    } else {
      const existing = snapshot.attendance.find((record) => record.id === id);
      await this.repos.attendance.put({
        id,
        profileId: profile.id,
        date,
        state,
        source: 'manual',
        note,
        createdAt: existing?.createdAt ?? this.clock.nowISO(),
        updatedAt: this.clock.nowISO()
      });
    }
    await this.log('INFO', 'attendance', state === null ? 'Punch cleared' : `Punch marked ${state}`, date);
  }

  // ---------------------------------------------------------- holidays/events

  async saveHoliday(input: Omit<Holiday, 'createdAt' | 'updatedAt' | 'source'> & { id?: string }): Promise<void> {
    const error = validateHoliday(input);
    if (error) throw new ServiceError('HOLIDAY_INVALID', error);
    const snapshot = await this.snapshot();
    const existing = input.id ? snapshot.holidays.find((holiday) => holiday.id === input.id) : undefined;
    const duplicate = snapshot.holidays.find(
      (holiday) =>
        holiday.date === input.date && holiday.kind === input.kind && holiday.id !== (input.id ?? '')
    );
    if (duplicate) {
      throw new ServiceError(
        'HOLIDAY_DUPLICATE',
        `${input.date} is already listed as a ${input.kind === 'GH' ? 'general' : 'restricted'} holiday.`
      );
    }
    const now = this.clock.nowISO();
    await this.repos.holidays.put({
      id: input.id ?? newId('holiday'),
      year: Number(input.date.slice(0, 4)),
      date: input.date,
      name: input.name.trim(),
      kind: input.kind,
      notes: input.notes ?? '',
      source: existing?.source ?? 'manual',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
    await this.log('INFO', 'holidays', 'Holiday saved', `${input.kind} ${input.date}`);
  }

  async deleteHoliday(id: string): Promise<void> {
    await this.repos.holidays.remove(id);
    await this.log('INFO', 'holidays', 'Holiday removed', id.slice(0, 24));
  }

  async importHolidays(holidays: Omit<Holiday, 'createdAt' | 'updatedAt' | 'source' | 'id'>[]): Promise<{ added: number; skipped: number }> {
    const snapshot = await this.snapshot();
    const existing = new Set(snapshot.holidays.map((holiday) => `${holiday.date}:${holiday.kind}`));
    const now = this.clock.nowISO();
    const toAdd = holidays
      .filter((holiday) => !existing.has(`${holiday.date}:${holiday.kind}`))
      .map((holiday) => ({
        ...holiday,
        id: newId('holiday'),
        year: Number(holiday.date.slice(0, 4)),
        source: 'imported' as const,
        createdAt: now,
        updatedAt: now
      }));
    if (toAdd.length) await this.repos.holidays.bulkPut(toAdd);
    await this.log('INFO', 'holidays', 'Holidays imported', `${toAdd.length} added`);
    return { added: toAdd.length, skipped: holidays.length - toAdd.length };
  }

  async saveEvent(input: {
    id?: string;
    title: string;
    date: string;
    endDate: string | null;
    type: CalendarEvent['type'];
    allDay: boolean;
    startTime: string | null;
    endTime: string | null;
    notes: string;
  }): Promise<void> {
    if (!input.title.trim()) throw new ServiceError('EVENT_TITLE', 'Enter an event name.');
    if (input.endDate && input.endDate < input.date) {
      throw new ServiceError('EVENT_RANGE', 'The event end date cannot be before its start date.');
    }
    const snapshot = await this.snapshot();
    const profile = snapshot.profiles[0];
    if (!profile) throw new ServiceError('NO_PROFILE', 'Complete the profile first.');
    const now = this.clock.nowISO();
    const existing = input.id ? snapshot.events.find((event) => event.id === input.id) : undefined;
    await this.repos.events.put({
      id: input.id ?? newId('event'),
      profileId: profile.id,
      title: input.title.trim(),
      date: input.date,
      endDate: input.endDate,
      type: input.type,
      allDay: input.allDay,
      startTime: input.startTime,
      endTime: input.endTime,
      notes: input.notes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });

    // Remember the name for the event-name suggestion list.
    const name = snapshot.eventNames.find(
      (item) => item.name.toLowerCase() === input.title.trim().toLowerCase()
    );
    if (!name) {
      await this.repos.eventNames.put({
        id: newId('evname'),
        name: input.title.trim(),
        useCount: 1,
        createdAt: now,
        updatedAt: now
      });
    }
    await this.log('INFO', 'events', 'Event saved', input.date);
  }

  async deleteEvent(id: string): Promise<void> {
    await this.repos.events.remove(id);
    await this.log('INFO', 'events', 'Event removed', id.slice(0, 24));
  }

  async saveEventName(name: string): Promise<void> {
    if (!name.trim()) return;
    const snapshot = await this.snapshot();
    const existing = snapshot.eventNames.find(
      (item) => item.name.toLowerCase() === name.trim().toLowerCase()
    );
    const now = this.clock.nowISO();
    await this.repos.eventNames.put(
      existing
        ? { ...existing, useCount: existing.useCount + 1, updatedAt: now }
        : { id: newId('evname'), name: name.trim(), useCount: 1, createdAt: now, updatedAt: now }
    );
  }

  // ------------------------------------------------------------------- roster

  async saveRoster(roster: DutyRoster, options: RosterSaveOptions = { syncDuties: true }): Promise<DutyRoster> {
    // The editor passes a Svelte $state proxy; persist a plain copy so IndexedDB
    // never receives a Proxy (which it cannot structured-clone).
    roster = clonePlain(roster);
    const snapshot = await this.snapshot();
    const profile = snapshot.profiles[0];
    if (!profile) throw new ServiceError('NO_PROFILE', 'Complete the profile first.');
    const now = this.clock.nowISO();
    const rosterId = roster.id || stableId('roster', profile.id, `${roster.year}-${roster.month}`);
    const previous = snapshot.rosters.find((item) => item.id === rosterId);

    const monthPrefix = `${roster.year}-${String(roster.month).padStart(2, '0')}`;
    const seenDates = new Set<string>();
    for (const entry of roster.entries) {
      if (!entry.date.startsWith(monthPrefix)) {
        throw new ServiceError(
          'ROSTER_DATE',
          `The entry ${entry.date} is outside ${monthPrefix}.`
        );
      }
      if (seenDates.has(entry.date)) {
        throw new ServiceError(
          'ROSTER_DUPLICATE',
          `More than one roster entry exists for ${entry.date}. Remove the duplicate before saving.`
        );
      }
      seenDates.add(entry.date);
      if (!entry.doctorName.trim()) {
        throw new ServiceError('ROSTER_DOCTOR', `Choose a doctor for ${entry.date}.`);
      }
    }

    const saved: DutyRoster = {
      ...roster,
      id: rosterId,
      profileId: profile.id,
      entries: roster.entries.map((entry) => ({
        ...entry,
        id: entry.id || newId('rentry')
      })),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now
    };

    if (options.syncDuties) {
      const keptDutyIds = new Set<string>();
      const employment = this.primaryEmployment(snapshot);
      for (const entry of saved.entries) {
        if (!employment) break;
        const policy = this.policyFor(snapshot, entry.date, employment);
        const shift =
          policy?.shifts.find((item) =>
            entry.dutyType === 'night'
              ? item.kind === 'night' && item.durationHours === 24
              : entry.dutyType === 'day'
                ? item.durationHours === 6 && item.startTime < '12:00'
                : entry.dutyType === 'evening'
                  ? item.durationHours === 6 && item.startTime >= '12:00'
                  : item.id === 'shift_night_24h'
          ) ?? policy?.shifts[0];
        const dutyId = entry.dutyId ?? stableId('duty', rosterId, entry.id);
        const existingDuty = snapshot.duties.find((duty) => duty.id === dutyId);
        const duty: Duty = {
          id: dutyId,
          profileId: profile.id,
          employmentId: employment.id,
          date: entry.date,
          shiftId: shift?.id ?? 'shift_night_24h',
          shiftName: shift?.name ?? 'Duty',
          startTime: entry.startTime || shift?.startTime || '09:00',
          endTime: entry.endTime || shift?.endTime || '09:00',
          crossesMidnight: (entry.startTime || '09:00') >= (entry.endTime || '09:00'),
          durationHours: shift?.durationHours ?? 24,
          status: existingDuty?.status === 'completed' ? 'completed' : 'planned',
          qualifyingDay: existingDuty?.qualifyingDay ?? false,
          remarks: entry.remarks,
          swap: existingDuty?.swap ?? null,
          rosterEntryId: entry.id,
          createdAt: existingDuty?.createdAt ?? now,
          updatedAt: now
        };
        await this.repos.duties.put(duty);
        keptDutyIds.add(dutyId);
        entry.dutyId = dutyId;
      }

      // Duties whose roster entry was removed are cancelled, not deleted.
      for (const entry of previous?.entries ?? []) {
        if (entry.dutyId && !keptDutyIds.has(entry.dutyId)) {
          const duty = snapshot.duties.find((item) => item.id === entry.dutyId);
          if (duty) {
            await this.repos.duties.put({ ...duty, status: 'cancelled', updatedAt: now });
          }
        }
      }
    }

    await this.repos.rosters.put(saved);
    await this.log('INFO', 'roster', 'Roster saved', `${saved.month}/${saved.year} · ${saved.entries.length} entries`);
    return saved;
  }

  async deleteRoster(id: string): Promise<void> {
    const snapshot = await this.snapshot();
    const roster = snapshot.rosters.find((item) => item.id === id);
    const now = this.clock.nowISO();
    for (const entry of roster?.entries ?? []) {
      if (!entry.dutyId) continue;
      const duty = snapshot.duties.find((item) => item.id === entry.dutyId);
      if (duty) await this.repos.duties.put({ ...duty, status: 'cancelled', updatedAt: now });
    }
    await this.repos.rosters.remove(id);
    await this.log('INFO', 'roster', 'Roster deleted', id.slice(0, 24));
  }

  async saveRosterDoctor(
    input: Omit<RosterDoctor, 'createdAt' | 'updatedAt' | 'id'> & { id?: string }
  ): Promise<void> {
    if (!input.name.trim()) throw new ServiceError('DOCTOR_NAME', 'Enter the doctor’s name.');
    const snapshot = await this.snapshot();
    const existing = input.id ? snapshot.doctors.find((doctor) => doctor.id === input.id) : undefined;
    const now = this.clock.nowISO();
    await this.repos.doctors.put({
      ...input,
      id: input.id ?? newId('doctor'),
      name: input.name.trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
  }

  copyPreviousMonth(
    previous: DutyRoster,
    year: number,
    month: number
  ): DutyRoster {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const entries = previous.entries.map((entry) => {
      const day = Math.min(Number(entry.date.slice(8, 10)), lastDay);
      return {
        ...entry,
        id: '',
        dutyId: null,
        date: `${prefix}-${String(day).padStart(2, '0')}`
      };
    });
    return {
      ...previous,
      id: '',
      year,
      month,
      entries,
      createdAt: this.clock.nowISO(),
      updatedAt: this.clock.nowISO()
    };
  }

  // -------------------------------------------------------------- policy/work

  async savePolicyDraft(policy: PolicyVersion): Promise<void> {
    if (policy.status !== 'draft') {
      throw new ServiceError('POLICY_IMMUTABLE', 'Published policy versions cannot be edited.');
    }
    await this.repos.policies.put({ ...clonePlain(policy), updatedAt: this.clock.nowISO() });
    await this.log('INFO', 'policy', 'Policy draft saved', policy.id || policy.policyId);
  }

  async createPolicyDraft(base?: PolicyVersion): Promise<PolicyVersion> {
    const snapshot = await this.snapshot();
    const source = base ?? snapshot.policies[0] ?? createDefaultPolicyVersion(this.clock.nowISO());
    const existing = snapshot.policies.filter((policy) => policy.policyId === source.policyId);
    const nextVersion = Math.max(0, ...existing.map((policy) => policy.version)) + 1;
    const now = this.clock.nowISO();
    const draft: PolicyVersion = {
      ...clonePlain(source),
      id: '',
      version: nextVersion,
      status: 'draft',
      publishedAt: null,
      changeSummary: '',
      createdAt: now,
      updatedAt: now
    };
    return draft;
  }

  async publishPolicy(policy: PolicyVersion): Promise<PolicyVersion> {
    if (policy.status !== 'draft') {
      throw new ServiceError('POLICY_IMMUTABLE', 'Only a draft can be published.');
    }
    policy = clonePlain(policy);
    const now = this.clock.nowISO();
    // Publishing consumes the saved draft. Otherwise the version list would show
    // both a saved draft and a published row with the same version number.
    if (policy.id) await this.repos.policies.remove(policy.id);
    const published: PolicyVersion = {
      ...policy,
      id: newId('policyver'),
      status: 'published',
      publishedAt: now,
      createdAt: now,
      updatedAt: now
    };
    await this.repos.policies.put(published);
    await this.saveSettings({ defaultPolicyId: published.policyId });
    await this.log('INFO', 'policy', 'Policy published', `v${published.version} from ${published.effectiveFrom}`);
    return published;
  }

  // -------------------------------------------------------- export / import

  private exportSnapshot(
    kind: ExportKind,
    full: DataSnapshot,
    options: { rosterId?: string; year?: number }
  ): DataSnapshot {
    const base = emptySnapshot();
    if (kind === 'full') {
      return { ...full, settings: full.settings };
    }
    if (kind === 'leave') {
      return {
        ...base,
        profiles: full.profiles,
        organisations: full.organisations,
        employments: full.employments,
        leaves: full.leaves,
        ledger: full.ledger,
        duties: full.duties,
        pdos: full.pdos,
        attendance: full.attendance
      };
    }
    if (kind === 'policy') {
      return { ...base, policies: full.policies };
    }
    if (kind === 'roster') {
      return {
        ...base,
        rosters: options.rosterId
          ? full.rosters.filter((roster) => roster.id === options.rosterId)
          : full.rosters
      };
    }
    return {
      ...base,
      holidays: options.year
        ? full.holidays.filter((holiday) => holiday.year === options.year)
        : full.holidays
    };
  }

  async exportText(
    kind: ExportKind,
    options: { rosterId?: string; year?: number; label?: string } = {}
  ): Promise<{ text: string; filename: string; count: number }> {
    const snapshot = await this.snapshot();
    const part = this.exportSnapshot(kind, snapshot, options);
    const label =
      options.label ??
      ({
        full: 'Complete DocTrack backup',
        leave: 'Leave history',
        policy: 'Leave policy package',
        roster: 'Duty roster',
        holidays: 'Holiday list'
      } as const)[kind];
    const text = await encodeEnvelope({
      kind,
      label,
      appVersion: APP_VERSION,
      counts: countSnapshot(part),
      data: part as unknown as Record<string, unknown>
    });
    await this.log('INFO', 'export', 'Data exported', kind);
    return { text, filename: fileNameForExport(kind, this.clock.now()), count: countSnapshot(part).leaveRequests };
  }

  async previewImport(text: string): Promise<ImportPreview> {
    const envelopes = await parseEnvelopes(text);
    const snapshots = envelopes.map((envelope) =>
      normalizeSnapshotData(envelope.data, envelope.kind)
    );
    const merged = mergeSnapshots(snapshots.map((part) => part.snapshot));
    const conflicts = snapshots.flatMap((part) => part.conflicts);
    const invalid = snapshots.reduce((sum, part) => sum + part.invalid, 0);
    return buildPreview(
      envelopes[0],
      merged,
      invalid,
      conflicts,
      extractChunks(text).length
    );
  }

  async applyImport(preview: ImportPreview): Promise<ApplyImportResult> {
    const current = await this.snapshot();
    const settings = await this.getSettings();
    const versionId = settings.versioningEnabled
      ? (await this.createVersion('import', `Before import — ${preview.label}`))?.id ?? null
      : null;

    let merged: DataSnapshot;
    if (preview.kind === 'full') {
      // ImportPreview is held in Svelte $state while the doctor reviews it. Its
      // snapshot is a reactive proxy, and IndexedDB cannot structured-clone a
      // proxy, so normalise it before replaceAll just as merge imports do.
      const imported = clonePlain(preview.snapshot);
      merged = {
        ...imported,
        settings: [
          {
            ...settings,
            ...(imported.settings[0] ?? {}),
            id: 'app',
            onboarded: settings.onboarded || imported.profiles.length > 0
          }
        ]
      };
    } else {
      const target = clonePlain(current);
      const counts = { added: 0, updated: 0, skipped: 0 };
      const mergeCollection = <T extends { id: string }>(
        key: keyof DataSnapshot,
        items: T[]
      ) => {
        const list = target[key] as unknown as T[];
        for (const item of items) {
          if (item.id.startsWith('holiday_') || key === 'holidays') {
            const holiday = item as unknown as Holiday;
            const duplicate = (list as unknown as Holiday[]).find(
              (existing) =>
                existing.date === holiday.date && existing.kind === holiday.kind
            );
            if (duplicate) {
              counts.skipped += 1;
              continue;
            }
          }
          const index = list.findIndex((existing) => existing.id === item.id);
          if (index >= 0) {
            list[index] = item;
            counts.updated += 1;
          } else {
            list.push(item);
            counts.added += 1;
          }
        }
      };

      mergeCollection('profiles', preview.snapshot.profiles);
      mergeCollection('organisations', preview.snapshot.organisations);
      mergeCollection('employments', preview.snapshot.employments);
      mergeCollection('leaves', preview.snapshot.leaves);
      mergeCollection('ledger', preview.snapshot.ledger);
      mergeCollection('duties', preview.snapshot.duties);
      mergeCollection('pdos', preview.snapshot.pdos);
      mergeCollection('attendance', preview.snapshot.attendance);
      mergeCollection('holidays', preview.snapshot.holidays);
      mergeCollection('events', preview.snapshot.events);
      mergeCollection('eventNames', preview.snapshot.eventNames);
      mergeCollection('doctors', preview.snapshot.doctors);
      mergeCollection('rosters', preview.snapshot.rosters);

      // Imported policy versions always arrive as drafts: a published version
      // is immutable and must never be silently replaced by an import.
      const existingMax = new Map<string, number>();
      for (const policy of target.policies) {
        existingMax.set(policy.policyId, Math.max(existingMax.get(policy.policyId) ?? 0, policy.version));
      }
      for (const policy of preview.snapshot.policies) {
        const nextVersion = (existingMax.get(policy.policyId) ?? 0) + 1;
        existingMax.set(policy.policyId, nextVersion);
        target.policies.push({
          ...policy,
          id: newId('policyver'),
          version: nextVersion,
          status: 'draft',
          publishedAt: null,
          changeSummary: 'Imported policy — review before publishing.',
          updatedAt: this.clock.nowISO()
        });
        counts.added += 1;
      }

      merged = target;
      await this.repos.snapshot.replaceAll(merged);
      await this.log('INFO', 'import', 'Data imported', `${preview.kind} · ${counts.added} added`);
      return { versionId, added: counts.added, updated: counts.updated, skipped: counts.skipped, conflicts: preview.conflicts };
    }

    await this.repos.snapshot.replaceAll(merged);
    this.settingsCache = merged.settings[0] ?? settings;
    await this.log('INFO', 'import', 'Full backup restored', preview.label);
    return {
      versionId,
      added: preview.counts.leaveRequests + preview.counts.ledgerEntries,
      updated: 0,
      skipped: 0,
      conflicts: preview.conflicts
    };
  }

  // ----------------------------------------------------------------- versions

  async createVersion(reason: DataVersion['reason'], label: string): Promise<DataVersion | null> {
    const settings = await this.getSettings();
    if (!settings.versioningEnabled) return null;
    const snapshot = await this.snapshot();
    const version: DataVersion = {
      id: newId('version'),
      createdAt: this.clock.nowISO(),
      reason,
      label,
      summary: `${snapshot.leaves.length} leave records, ${snapshot.ledger.length} ledger entries`,
      counts: countSnapshot(snapshot),
      snapshot
    };
    await this.repos.versions.put(version);
    await this.pruneVersions();
    return version;
  }

  async pruneVersions(): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.versioningEnabled) return;
    const versions = await this.repos.versions.all();
    const excess = versions.length - Math.max(1, settings.versionRetention);
    if (excess <= 0) return;
    const oldest = versions
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, excess);
    for (const version of oldest) await this.repos.versions.remove(version.id);
    if (oldest.length) {
      await this.log('INFO', 'versions', 'Old versions purged', `${oldest.length} removed`);
    }
  }

  async rollbackTo(versionId: string): Promise<void> {
    const version = await this.repos.versions.get(versionId);
    if (!version) throw new ServiceError('VERSION_NOT_FOUND', 'That version no longer exists.');
    await this.createVersion('rollback', 'Before rollback');
    await this.repos.snapshot.replaceAll(version.snapshot);
    this.settingsCache = (await this.repos.settings.get()) ?? this.settingsCache;
    await this.log('WARN', 'versions', 'Rolled back', `${version.label} (${version.createdAt})`);
  }

  async deleteVersion(versionId: string): Promise<void> {
    await this.repos.versions.remove(versionId);
    await this.log('INFO', 'versions', 'Version deleted', versionId.slice(0, 24));
  }

  async versionActivity(): Promise<{ total: number; averagePerDay: number; recent: number }> {
    const versions = await this.repos.versions.all();
    const cutoff = this.clock.now().getTime() - 30 * 86400000;
    const recent = versions.filter(
      (version) => new Date(version.createdAt).getTime() >= cutoff
    ).length;
    return { total: versions.length, recent, averagePerDay: Math.round((recent / 30) * 10) / 10 };
  }

  // --------------------------------------------------------------------- logs

  async log(level: LogLevel, category: string, message: string, context = ''): Promise<void> {
    try {
      const settings = await this.getSettings();
      if (!settings.logLevels[level]) return;
      const entry: LogEntry = {
        id: newId('log'),
        at: this.clock.nowISO(),
        level,
        category,
        message,
        context: context.slice(0, 300)
      };
      await this.repos.logs.put(entry);
      this.logWrites += 1;
      if (this.logWrites % 40 === 0) await this.pruneLogs();
    } catch {
      // Logging must never break a user action.
    }
  }

  async pruneLogs(): Promise<void> {
    const settings = await this.getSettings();
    const cutoff = new Date(
      this.clock.now().getTime() - Math.max(1, settings.logRetentionDays) * 86400000
    ).toISOString();
    const logs = await this.repos.logs.all();
    const expired = logs.filter((entry) => entry.at < cutoff);
    for (const entry of expired) await this.repos.logs.remove(entry.id);
  }

  async clearLogs(): Promise<void> {
    await this.repos.logs.clear();
    await this.log('INFO', 'logs', 'Logs cleared');
  }

  // ----------------------------------------------------------- administration

  async listPolicies(): Promise<PolicyVersion[]> {
    return this.repos.policies.all();
  }

  async listVersions(): Promise<DataVersion[]> {
    return this.repos.versions.all();
  }

  async listLogs(): Promise<LogEntry[]> {
    return this.repos.logs.all();
  }

  async metaGet<T>(key: string): Promise<T | undefined> {
    return this.repos.meta.get<T>(key);
  }

  async metaSet<T>(key: string, value: T): Promise<void> {
    await this.repos.meta.set(key, value);
  }

  async metaRemove(key: string): Promise<void> {
    await this.repos.meta.remove(key);
  }

  // ----------------------------------------------------------------- backups

  async backupData(): Promise<{ text: string; filename: string }> {
    const { text, filename } = await this.exportText('full');
    await this.saveSettings({ lastBackupAt: this.clock.nowISO() });
    await this.log('INFO', 'backup', 'Backup created', filename);
    return { text, filename };
  }

  async recordManualBackup(): Promise<void> {
    await this.saveSettings({ lastBackupAt: this.clock.nowISO() });
  }

  async markDismissed(
    key: 'greetingDismissed' | 'storageWarningDismissed',
    value = true
  ): Promise<void> {
    await this.saveSettings({ [key]: value });
  }
}

/** Duty-earned CCL entries for a duty, used when consequences are recalculated. */
function dutyCclDutyId(transaction: LedgerTransaction): string | null {
  return transaction.source === 'duty-ccl' ? transaction.relatedTransactionId : null;
}
