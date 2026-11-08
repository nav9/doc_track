import { describe, expect, it } from 'vitest';
import { computeMonthAttendance, projectAttendanceMonths } from './attendanceEngine';
import {
  makeAttendanceRecord,
  makeHoliday,
  makeLeave
} from '../../../test/fixtures';

const base = {
  year: 2026,
  month: 11,
  weekendDays: [0, 6],
  holidays: [] as ReturnType<typeof makeHoliday>[],
  leaves: [] as ReturnType<typeof makeLeave>[],
  records: [] as ReturnType<typeof makeAttendanceRecord>[],
  required: 21,
  today: '2026-11-30' as const
};

describe('NMC monthly attendance', () => {
  it('assumes punches on every non-Sunday working day', () => {
    const report = computeMonthAttendance(base);
    // November 2026 has 30 days and 5 Sundays → 25 working days.
    expect(report.assumed).toBe(25);
    expect(report.confirmed).toBe(0);
    expect(report.total).toBe(25);
    expect(report.missing).toBe(0);
    expect(report.excludedSundays).toBe(5);
    expect(report.shortage).toBe(false);
  });

  it('distinguishes confirmed punches from assumed ones', () => {
    const report = computeMonthAttendance({
      ...base,
      records: [makeAttendanceRecord('2026-11-02')]
    });
    expect(report.confirmed).toBe(1);
    expect(report.assumed).toBe(24);
    expect(report.confirmedDays).toEqual(['2026-11-02']);
    expect(report.days.find((day) => day.date === '2026-11-02')?.status).toBe('confirmed');
  });

  it('removes a punch when it is explicitly marked absent', () => {
    const report = computeMonthAttendance({
      ...base,
      records: [makeAttendanceRecord('2026-11-04', 'absent')]
    });
    expect(report.total).toBe(24);
    expect(report.missing).toBe(0);
    expect(report.days.find((day) => day.date === '2026-11-04')?.status).toBe('absent');
  });

  it('warns when the month falls below 21 punches', () => {
    const report = computeMonthAttendance({
      ...base,
      leaves: [
        makeLeave({ category: 'CL', startDate: '2026-11-02', endDate: '2026-11-06', leaveDays: 5 })
      ]
    });
    expect(report.total).toBe(20);
    expect(report.shortage).toBe(true);
    expect(report.missing).toBe(1);
    expect(report.projectionNote).toContain('Add 1 punch');
  });

  it('counts a Sunday punch when it is confirmed', () => {
    const report = computeMonthAttendance({
      ...base,
      records: [makeAttendanceRecord('2026-11-01')]
    });
    expect(report.confirmed).toBe(1);
    expect(report.total).toBe(26);
  });

  it('excludes both general and restricted holidays from assumed punches', () => {
    const report = computeMonthAttendance({
      ...base,
      holidays: [makeHoliday('2026-11-09', 'GH'), makeHoliday('2026-11-10', 'RH')]
    });
    expect(report.excludedHolidays).toBe(2);
    expect(report.days.find((day) => day.date === '2026-11-09')?.status).toBe('holiday');
    expect(report.days.find((day) => day.date === '2026-11-10')?.status).toBe('holiday');
  });

  it('does not assume punches for future dates', () => {
    const report = computeMonthAttendance({ ...base, today: '2026-11-10' });
    // Saturdays are working days in this hospital, so 2–7 and 9–10 are assumed.
    expect(report.assumed).toBe(8);
    expect(report.days.filter((day) => day.status === 'future').length).toBe(17);
    expect(report.projectedTotal).toBe(25);
  });

  it('projects the effect of planned leave', () => {
    const months = projectAttendanceMonths(
      [{ year: 2026, month: 11 }],
      {
        ...base,
        leaves: [
          makeLeave({ category: 'SPCL', startDate: '2026-11-09', endDate: '2026-11-13', leaveDays: 5 })
        ]
      }
    );
    expect(months[0].projected).toBe(20);
    expect(months[0].shortage).toBe(true);
  });
});
