import type { AuditFields, ISODate } from '../common/types';
import type { DateFormat } from '../common/dates';

export interface RosterDoctor extends AuditFields {
  id: string;
  name: string;
  employeeId: string;
  department: string;
  unit: string;
  designation: string;
  profileId: string | null;
  notes: string;
}

export type RosterDutyType = 'night' | 'day' | 'evening' | 'other';

export interface RosterEntry {
  id: string;
  date: ISODate;
  doctorId: string | null;
  doctorName: string;
  employeeId: string;
  department: string;
  unit: string;
  startTime: string;
  endTime: string;
  dutyType: RosterDutyType;
  remarks: string;
  swapNote: string;
  /** Linked Duty record so the roster and duty calendar never diverge. */
  dutyId: string | null;
}

/**
 * One doctor's roster for one month. Entries are stored with the roster
 * aggregate so a month is always internally consistent and exports atomically.
 */
export interface DutyRoster extends AuditFields {
  id: string;
  profileId: string;
  year: number;
  month: number;
  title: string;
  department: string;
  unit: string;
  hospitalName: string;
  entries: RosterEntry[];
  notes: string;
}

export interface RosterPdfOptions {
  orientation: 'portrait' | 'landscape';
  showEmployeeId: boolean;
  showDepartment: boolean;
  showUnit: boolean;
  showRemarks: boolean;
  showDutyType: boolean;
  showSignatureBlock: boolean;
  dateFormat: DateFormat;
  title: string;
}

export const DEFAULT_ROSTER_PDF_OPTIONS: RosterPdfOptions = {
  orientation: 'portrait',
  showEmployeeId: true,
  showDepartment: true,
  showUnit: true,
  showRemarks: true,
  showDutyType: true,
  showSignatureBlock: true,
  dateFormat: 'dd MMM yyyy',
  title: 'Night Duty Roster'
};

export const ROSTER_DUTY_TYPES: { value: RosterDutyType; label: string }[] = [
  { value: 'night', label: 'Night duty' },
  { value: 'day', label: 'Day duty' },
  { value: 'evening', label: 'Evening duty' },
  { value: 'other', label: 'Other' }
];
