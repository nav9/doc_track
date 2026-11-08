import type { AuditFields, ISODate } from '../common/types';

/**
 * Only explicit records are stored. "Assumed" punches are derived from the
 * working calendar and leave data, so they can never be mistaken for confirmed
 * attendance in the database.
 */
export type AttendanceEntryState = 'confirmed' | 'absent';

export interface AttendanceRecord extends AuditFields {
  id: string;
  profileId: string;
  date: ISODate;
  state: AttendanceEntryState;
  source: 'manual' | 'import';
  note: string;
}

export type AttendanceDayStatus =
  | 'confirmed'
  | 'assumed'
  | 'absent'
  | 'sunday'
  | 'holiday'
  | 'leave'
  | 'future';

export interface AttendanceDay {
  date: ISODate;
  status: AttendanceDayStatus;
  counts: number;
  note: string;
  leaveCategory: string | null;
}

export interface MonthAttendance {
  year: number;
  month: number;
  required: number;
  confirmed: number;
  assumed: number;
  total: number;
  missing: number;
  shortage: boolean;
  excludedSundays: number;
  excludedHolidays: number;
  leaveDays: number;
  days: AttendanceDay[];
  projectionNote: string;
  nmcSuspended: boolean;
  nmcSuspensionReason: string;
}

export function attendanceStatusLabel(status: AttendanceDayStatus): string {
  switch (status) {
    case 'confirmed':
      return 'Confirmed punch';
    case 'assumed':
      return 'Assumed punch (not verified)';
    case 'absent':
      return 'No punch recorded';
    case 'sunday':
      return 'Sunday';
    case 'holiday':
      return 'Holiday';
    case 'leave':
      return 'Leave';
    case 'future':
      return 'Future date';
  }
}
