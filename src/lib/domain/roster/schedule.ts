import type { ISODate } from '../common/types';
import { addDays, dayOfWeek, daysInMonth } from '../common/dates';
import type { LeaveRequest, LeaveStatus } from '../leave/types';
import { isActiveLeave } from '../leave/types';
import type { SharedLeave } from '../multiuser/types';
import { isSharedLeaveActive, sharedLeaveCoversDate } from '../multiuser/types';
import type {
  DutyRoster,
  RosterDoctor,
  RosterEntry,
  UnitNumberStyle
} from './types';

const WORDS = [
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve'
];

export function romanUnit(value: number): string {
  const pairs: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I']
  ];
  let remaining = Math.max(1, Math.floor(value));
  let result = '';
  for (const [amount, glyph] of pairs) {
    while (remaining >= amount) {
      result += glyph;
      remaining -= amount;
    }
  }
  return result;
}

export function unitLabel(value: number, style: UnitNumberStyle = 'roman'): string {
  if (style === 'number') return String(value);
  if (style === 'word') return WORDS[value - 1] ?? String(value);
  return romanUnit(value);
}

export function unitOptions(count: number, style: UnitNumberStyle): string[] {
  return Array.from({ length: Math.max(1, count) }, (_, index) => unitLabel(index + 1, style));
}

/**
 * Unit rotation described by the department:
 * Mon–Thu follow units I–IV, Friday alternates I/III, Saturday alternates II/IV,
 * and Sunday rotates through all units by week of the month.
 */
export function suggestedUnitForDate(date: ISODate, unitCount: number): number {
  const count = Math.max(1, unitCount);
  const weekday = dayOfWeek(date);
  const day = Number(date.slice(8, 10));
  const week = Math.floor((day - 1) / 7);
  if (weekday >= 1 && weekday <= 4) return ((weekday - 1) % count) + 1;
  if (weekday === 5) {
    const odd = Array.from({ length: count }, (_, index) => index + 1).filter(
      (unit) => unit % 2 === 1
    );
    return odd.length ? odd[week % odd.length] : 1;
  }
  if (weekday === 6) {
    // Saturdays alternate 4, 2, 4, 2… as specified for a four-unit roster.
    const even = Array.from({ length: count }, (_, index) => index + 1).filter(
      (unit) => unit % 2 === 0
    );
    const ordered = even.length > 1 ? [even[even.length - 1], ...even.slice(0, -1)] : even;
    return ordered.length ? ordered[week % ordered.length] : count;
  }
  return (week % count) + 1;
}

export function nextRosterMonth(today: ISODate): { year: number; month: number } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export function rosterDateRange(roster: Pick<DutyRoster, 'year' | 'month'>): ISODate[] {
  const prefix = `${roster.year}-${String(roster.month).padStart(2, '0')}`;
  return Array.from(
    { length: daysInMonth(roster.year, roster.month) },
    (_, index) => `${prefix}-${String(index + 1).padStart(2, '0')}`
  );
}

export interface DoctorChoice {
  id: string;
  prefix?: string;
  name: string;
  employeeId: string;
  department: string;
  designation: string;
  unit: string;
  profileId: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export function syntheticSelfDoctor(
  profile: { id: string; prefix: string; name: string; employeeId: string; department: string; designation: string; unit: string } | null,
  now: string
): DoctorChoice | null {
  if (!profile) return null;
  return {
    id: '',
    prefix: profile.prefix,
    name: `${profile.prefix} ${profile.name}`.replace(/\s+/g, ' ').trim(),
    employeeId: profile.employeeId,
    department: profile.department,
    designation: profile.designation,
    unit: profile.unit,
    profileId: profile.id,
    notes: 'Current profile',
    createdAt: now,
    updatedAt: now
  };
}

export function leaveForDoctorOn(
  doctor: Pick<DoctorChoice, 'profileId'> | null,
  date: ISODate,
  leaves: LeaveRequest[],
  statuses: LeaveStatus[]
): LeaveRequest | undefined {
  if (!doctor?.profileId) return undefined;
  return leaves.find(
    (leave) =>
      isActiveLeave(leave) &&
      statuses.includes(leave.status) &&
      leave.profileId === doctor.profileId &&
      date >= leave.startDate &&
      date <= leave.endDate
  );
}

export function sharedLeaveForDoctorOn(
  doctor: Pick<DoctorChoice, 'id' | 'name' | 'employeeId'> | null,
  date: ISODate,
  leaves: SharedLeave[],
  statuses: LeaveStatus[]
): SharedLeave | undefined {
  if (!doctor) return undefined;
  return leaves.find(
    (leave) =>
      isSharedLeaveActive(leave) &&
      statuses.includes(leave.status) &&
      sharedLeaveCoversDate(leave, date) &&
      (leave.doctorId === doctor.id ||
        (leave.employeeId &&
          doctor.employeeId &&
          leave.employeeId.trim().toLowerCase() === doctor.employeeId.trim().toLowerCase()) ||
        leave.doctorName.trim().toLowerCase() === doctor.name.trim().toLowerCase())
  );
}

export function validateRosterRow(input: {
  entry: RosterEntry;
  doctors: DoctorChoice[];
  department: string;
  unitCount: number;
  showLeaveWarnings: boolean;
  leaveStatuses: LeaveStatus[];
  leaves: LeaveRequest[];
  sharedLeaves?: SharedLeave[];
  ownDoctor: DoctorChoice | null;
}): { level: 'error' | 'warning'; message: string } | null {
  const { entry, doctors, unitCount, showLeaveWarnings, leaveStatuses, leaves } = input;
  if (!entry.doctorName.trim()) {
    return { level: 'error', message: 'Choose a doctor for this duty.' };
  }
  const unitNumber = entry.unitNumber ?? Number(entry.unit);
  if (!Number.isFinite(unitNumber) || unitNumber < 1 || unitNumber > unitCount) {
    return { level: 'error', message: `Choose a unit between 1 and ${unitCount}.` };
  }

  const doctor =
    doctors.find(
      (item) =>
        item.id === entry.doctorId ||
        (item.employeeId &&
          entry.employeeId &&
          item.employeeId.toLowerCase() === entry.employeeId.toLowerCase()) ||
        item.name.toLowerCase() === entry.doctorName.trim().toLowerCase()
    ) ?? null;
  if (!doctor && entry.doctorId) {
    return { level: 'error', message: 'This doctor was removed from the roster list. Choose another doctor.' };
  }
  if (!doctor && doctors.length > 0) {
    return { level: 'error', message: 'This name is not in the central doctor list. Add the doctor in Roster settings or choose an existing doctor.' };
  }
  if (doctor && input.department.trim() && doctor.department.trim() && doctor.department.trim().toLowerCase() !== input.department.trim().toLowerCase()) {
    return { level: 'error', message: `${doctor.name} belongs to ${doctor.department}, not ${input.department}.` };
  }
  if (showLeaveWarnings) {
    const leave = leaveForDoctorOn(
      { profileId: doctor?.profileId ?? input.ownDoctor?.profileId ?? null },
      entry.date,
      leaves,
      leaveStatuses
    );
    if (leave) {
      return {
        level: 'warning',
        message: `${doctor?.name ?? entry.doctorName} is on ${leave.status} ${leave.category} leave on this date.`
      };
    }
    const sharedLeave = sharedLeaveForDoctorOn(
      doctor ?? { id: entry.doctorId ?? '', name: entry.doctorName, employeeId: entry.employeeId },
      entry.date,
      input.sharedLeaves ?? [],
      leaveStatuses
    );
    if (sharedLeave) {
      return {
        level: 'warning',
        message: `${doctor?.name ?? entry.doctorName} is on ${sharedLeave.status} ${sharedLeave.category} leave (shared) on this date.`
      };
    }
  }
  return null;
}

/** Assigns the least-loaded available doctor to every date. */
export function autoAssignDoctors(input: {
  entries: RosterEntry[];
  doctors: DoctorChoice[];
  leaves: LeaveRequest[];
  leaveStatuses: LeaveStatus[];
  sharedLeaves?: SharedLeave[];
  ownDoctor: DoctorChoice | null;
  department: string;
  unitCount: number;
  unitStyle: UnitNumberStyle;
}): RosterEntry[] {
  const pool = input.doctors.length ? input.doctors : input.ownDoctor ? [input.ownDoctor] : [];
  if (pool.length === 0) return input.entries.map((entry) => ({ ...entry }));
  const loads = new Map<string, number>(pool.map((doctor) => [doctor.id || doctor.name, 0]));

  return [...input.entries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => {
      const available = pool.filter(
        (doctor) =>
          !leaveForDoctorOn(doctor, entry.date, input.leaves, input.leaveStatuses) &&
          !sharedLeaveForDoctorOn(
            doctor,
            entry.date,
            input.sharedLeaves ?? [],
            input.leaveStatuses
          )
      );
      const candidates = available.length ? available : pool;
      const chosen = [...candidates].sort((a, b) => {
        const loadA = loads.get(a.id || a.name) ?? 0;
        const loadB = loads.get(b.id || b.name) ?? 0;
        if (loadA !== loadB) return loadA - loadB;
        return a.name.localeCompare(b.name);
      })[0];
      loads.set(chosen.id || chosen.name, (loads.get(chosen.id || chosen.name) ?? 0) + 1);
      const unitNumber = suggestedUnitForDate(entry.date, input.unitCount);
      return {
        ...entry,
        doctorId: chosen.id || null,
        doctorName: chosen.name,
        employeeId: chosen.employeeId,
        department: chosen.department || input.department,
        unitNumber,
        unit: unitLabel(unitNumber, input.unitStyle)
      };
    });
}

export function syncUnitLabels(
  entries: RosterEntry[],
  unitCount: number,
  style: UnitNumberStyle
): RosterEntry[] {
  return entries.map((entry) => {
    const unitNumber = entry.unitNumber ?? suggestedUnitForDate(entry.date, unitCount);
    return { ...entry, unitNumber, unit: unitLabel(unitNumber, style) };
  });
}

export function shiftRosterMonth(roster: DutyRoster, year: number, month: number): DutyRoster {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const lastDay = daysInMonth(year, month);
  const unitCount = roster.unitCount ?? 4;
  const style = roster.unitStyle ?? 'roman';
  return {
    ...roster,
    id: '',
    year,
    month,
    entries: roster.entries.map((entry) => {
      const day = Math.min(Number(entry.date.slice(8, 10)), lastDay);
      const date = `${prefix}-${String(day).padStart(2, '0')}`;
      const unitNumber = suggestedUnitForDate(date, unitCount);
      return {
        ...entry,
        id: `${entry.id}_${year}_${month}`,
        dutyId: null,
        date,
        unitNumber,
        unit: unitLabel(unitNumber, style)
      };
    }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}