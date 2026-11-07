import type { AppSettings } from '../../domain/settings/types';
import type { DoctorProfile, EmploymentRecord, Organisation } from '../../domain/profile/profile';
import type { PolicyVersion } from '../../domain/policy/types';
import type { LeaveRequest } from '../../domain/leave/types';
import type { LedgerTransaction } from '../../domain/ledger/types';
import type { Duty, PdoRecord } from '../../domain/duty/types';
import type { AttendanceRecord } from '../../domain/attendance/types';
import type { CalendarEvent, EventName, Holiday } from '../../domain/calendar/holidays';
import type { DutyRoster, RosterDoctor } from '../../domain/roster/types';
import type { SharedLeave } from '../../domain/multiuser/types';

export interface DataSnapshot {
  profiles: DoctorProfile[];
  organisations: Organisation[];
  employments: EmploymentRecord[];
  policies: PolicyVersion[];
  leaves: LeaveRequest[];
  ledger: LedgerTransaction[];
  duties: Duty[];
  pdos: PdoRecord[];
  attendance: AttendanceRecord[];
  holidays: Holiday[];
  events: CalendarEvent[];
  eventNames: EventName[];
  doctors: RosterDoctor[];
  rosters: DutyRoster[];
  sharedLeaves: SharedLeave[];
  settings: AppSettings[];
}

export const SNAPSHOT_COLLECTIONS = [
  'profiles',
  'organisations',
  'employments',
  'policies',
  'leaves',
  'ledger',
  'duties',
  'pdos',
  'attendance',
  'holidays',
  'events',
  'eventNames',
  'doctors',
  'rosters',
  'sharedLeaves'
] as const;

export type SnapshotCollection = (typeof SNAPSHOT_COLLECTIONS)[number];

export function emptySnapshot(): DataSnapshot {
  return {
    profiles: [],
    organisations: [],
    employments: [],
    policies: [],
    leaves: [],
    ledger: [],
    duties: [],
    pdos: [],
    attendance: [],
    holidays: [],
    events: [],
    eventNames: [],
    doctors: [],
    rosters: [],
    sharedLeaves: [],
    settings: []
  };
}

export interface SnapshotCounts {
  profiles: number;
  employments: number;
  policyVersions: number;
  leaveRequests: number;
  ledgerEntries: number;
  duties: number;
  pdos: number;
  attendanceRecords: number;
  holidays: number;
  events: number;
  rosterMonths: number;
  sharedLeaves: number;
}

export function countSnapshot(snapshot: DataSnapshot): SnapshotCounts {
  return {
    profiles: snapshot.profiles.length,
    employments: snapshot.employments.length,
    policyVersions: snapshot.policies.length,
    leaveRequests: snapshot.leaves.length,
    ledgerEntries: snapshot.ledger.length,
    duties: snapshot.duties.length,
    pdos: snapshot.pdos.length,
    attendanceRecords: snapshot.attendance.length,
    holidays: snapshot.holidays.length,
    events: snapshot.events.length,
    rosterMonths: snapshot.rosters.length,
    sharedLeaves: snapshot.sharedLeaves.length
  };
}
