import type { AuditFields, ISODate } from '../common/types';
import type { LeaveStatus } from '../leave/types';

export type SharedLeaveSource = 'whatsapp' | 'manual' | 'import';

/**
 * Leave shared by another doctor. It is deliberately separate from the
 * signed-in doctor's LeaveRequest records: shared leave has no ledger effect and
 * is only used for roster availability and temporary planning.
 */
export interface SharedLeave extends AuditFields {
  id: string;
  doctorId: string;
  doctorName: string;
  employeeId: string;
  department: string;
  startDate: ISODate;
  endDate: ISODate;
  category: string;
  status: LeaveStatus;
  source: SharedLeaveSource;
  reason: string;
  notes: string;
}

export function sharedLeaveCoversDate(
  leave: Pick<SharedLeave, 'startDate' | 'endDate'>,
  date: ISODate
): boolean {
  return date >= leave.startDate && date <= leave.endDate;
}

export function isSharedLeaveActive(
  leave: Pick<SharedLeave, 'status'>
): boolean {
  return leave.status !== 'cancelled' && leave.status !== 'rejected';
}