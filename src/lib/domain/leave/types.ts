import type { ApprovalState, AuditFields, ISODate } from '../common/types';

export type LeaveStatus = 'planned' | 'pending' | 'approved' | 'rejected' | 'cancelled';
export type HalfDayPortion = 'first' | 'second';
export type LeaveSource = 'manual' | 'planner' | 'roster' | 'import' | 'retrospective';

export const LEAVE_STATUSES: LeaveStatus[] = [
  'planned',
  'pending',
  'approved',
  'rejected',
  'cancelled'
];

export interface LeaveRequest extends AuditFields {
  id: string;
  profileId: string;
  employmentId: string;
  policyId: string;
  policyVersionId: string;
  category: string;
  startDate: ISODate;
  endDate: ISODate;
  /** Set only for a single-day half-day leave. */
  halfDay: HalfDayPortion | null;
  calendarDays: number;
  /** Days actually consumed from the balance. */
  leaveDays: number;
  status: LeaveStatus;
  approvalRequired: boolean;
  approvalState: ApprovalState;
  approvalNote: string;
  reason: string;
  notes: string;
  /** Application metadata entered in the planner. */
  purpose?: string;
  coveringDoctor?: string;
  source: LeaveSource;
  /** For planner-created plans, the policy version used for the decision. */
  plannedWithPolicyVersionId: string | null;
  ledgerTransactionIds: string[];
  cancelledAt: string | null;
  cancellationReason: string;
}

export interface LeaveDraft {
  category: string;
  startDate: ISODate;
  endDate: ISODate;
  halfDay: HalfDayPortion | null;
  status: LeaveStatus;
  reason: string;
  notes: string;
  approvalState: ApprovalState;
}

/** Leave that still affects balances and calendars. */
export function isActiveLeave(leave: Pick<LeaveRequest, 'status'>): boolean {
  return leave.status !== 'cancelled' && leave.status !== 'rejected';
}

/** Leave that consumes balance while planned or awaiting approval. */
export function consumesBalance(leave: Pick<LeaveRequest, 'status'>): boolean {
  return isActiveLeave(leave);
}

export function leaveStatusLabel(status: LeaveStatus): string {
  switch (status) {
    case 'planned':
      return 'Planned';
    case 'pending':
      return 'Pending approval';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'cancelled':
      return 'Cancelled';
  }
}

export const HALF_DAY_LABELS: Record<HalfDayPortion, string> = {
  first: 'First half',
  second: 'Second half'
};

export function portionForDate(
  leave: Pick<LeaveRequest, 'startDate' | 'halfDay'>,
  date: ISODate
): HalfDayPortion | 'full' | null {
  if (date !== leave.startDate) return 'full';
  return leave.halfDay ?? 'full';
}
