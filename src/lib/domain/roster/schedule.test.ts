import { describe, expect, it } from 'vitest';
import {
  autoAssignDoctors,
  nextRosterMonth,
  shiftRosterMonth,
  suggestedUnitForDate,
  unitLabel,
  type DoctorChoice
} from './schedule';
import type { DutyRoster, RosterEntry } from './types';
import type { LeaveRequest } from '../leave/types';

function doctor(name: string, profileId: string | null = null): DoctorChoice {
  return {
    id: `doctor_${name}`,
    name,
    employeeId: `E-${name}`,
    department: 'Orthopaedics',
    designation: 'Senior Resident',
    unit: 'Unit I',
    profileId,
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

function entry(date: string): RosterEntry {
  return {
    id: `entry_${date}`,
    date,
    doctorId: null,
    doctorName: '',
    employeeId: '',
    department: 'Orthopaedics',
    unit: 'I',
    startTime: '09:00',
    endTime: '09:00',
    dutyType: 'night',
    remarks: '',
    swapNote: '',
    dutyId: null
  };
}

describe('roster schedule', () => {
  it('formats units in roman, number and word styles', () => {
    expect(unitLabel(1, 'roman')).toBe('I');
    expect(unitLabel(4, 'roman')).toBe('IV');
    expect(unitLabel(4, 'number')).toBe('4');
    expect(unitLabel(4, 'word')).toBe('Four');
  });

  it('applies the weekday unit rotation and alternates weekends', () => {
    expect(suggestedUnitForDate('2026-11-02', 4)).toBe(1);
    expect(suggestedUnitForDate('2026-11-05', 4)).toBe(4);
    expect(suggestedUnitForDate('2026-11-06', 4)).toBe(1);
    expect(suggestedUnitForDate('2026-11-13', 4)).toBe(3);
    expect(suggestedUnitForDate('2026-11-14', 4)).toBe(4);
    expect(suggestedUnitForDate('2026-11-21', 4)).toBe(2);
    expect(suggestedUnitForDate('2026-11-01', 4)).toBe(1);
    expect(suggestedUnitForDate('2026-11-08', 4)).toBe(2);
  });

  it('chooses the next month and year across December', () => {
    expect(nextRosterMonth('2026-12-15')).toEqual({ year: 2027, month: 1 });
  });

  it('avoids assigning a doctor on approved leave when alternatives exist', () => {
    const leave: LeaveRequest = {
      id: 'leave_1',
      profileId: 'profile_one',
      employmentId: 'employment_one',
      policyId: 'policy',
      policyVersionId: 'version',
      category: 'CL',
      startDate: '2026-11-10',
      endDate: '2026-11-10',
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
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };
    const assigned = autoAssignDoctors({
      entries: [entry('2026-11-10')],
      doctors: [doctor('Dr. One', 'profile_one'), doctor('Dr. Two', 'profile_two')],
      leaves: [leave],
      leaveStatuses: ['approved'],
      ownDoctor: null,
      department: 'Orthopaedics',
      unitCount: 4,
      unitStyle: 'roman'
    });
    expect(assigned[0].doctorName).toBe('Dr. Two');
    expect(assigned[0].unit).toBe('II');
  });

  it('shifts dates and reapplies units when reusing a previous month', () => {
    const roster: DutyRoster = {
      id: 'roster_old',
      profileId: 'profile',
      year: 2026,
      month: 11,
      title: 'Night Duty Roster',
      department: 'Orthopaedics',
      unit: '',
      hospitalName: '',
      entries: [{ ...entry('2026-11-30'), doctorName: 'Dr. One' }],
      notes: '',
      unitCount: 4,
      unitStyle: 'roman',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z'
    };
    const shifted = shiftRosterMonth(roster, 2026, 12);
    expect(shifted.entries[0].date).toBe('2026-12-30');
    expect(shifted.entries[0].unit).toBe('III');
    expect(shifted.id).toBe('');
  });
});