import type { AuditFields, ISODate, ISODateTime } from '../common/types';

export type DutyStatus = 'planned' | 'completed' | 'cancelled';

export interface DutySwap {
  direction: 'gave-away' | 'took-over';
  otherDoctorName: string;
  otherDoctorId: string | null;
  compensationDate: ISODate | null;
  reason: string;
  notes: string;
}

export interface Duty extends AuditFields {
  id: string;
  profileId: string;
  employmentId: string;
  date: ISODate;
  shiftId: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  durationHours: number;
  status: DutyStatus;
  /** Derived at completion time from the holiday list and weekend settings. */
  qualifyingDay: boolean;
  remarks: string;
  swap: DutySwap | null;
  /** Roster entry that produced this duty, when any. */
  rosterEntryId: string | null;
}

export type PdoStatus =
  | 'scheduled'
  | 'converted-holiday'
  | 'converted-worked'
  | 'converted-unused'
  | 'cancelled';

export interface PdoRecord extends AuditFields {
  id: string;
  profileId: string;
  employmentId: string;
  dutyId: string;
  date: ISODate;
  status: PdoStatus;
  punchOutAt: ISODateTime | null;
  cclTransactionId: string | null;
  approvalRequired: boolean;
  notes: string;
}

export function pdoStatusLabel(status: PdoStatus): string {
  switch (status) {
    case 'scheduled':
      return 'Scheduled PDO';
    case 'converted-holiday':
      return 'PDO on a holiday → CCL';
    case 'converted-worked':
      return 'Worked on PDO → CCL';
    case 'converted-unused':
      return 'Unused PDO → CCL';
    case 'cancelled':
      return 'Cancelled';
  }
}

export function isPdoOpen(pdo: Pick<PdoRecord, 'status'>): boolean {
  return pdo.status === 'scheduled';
}
