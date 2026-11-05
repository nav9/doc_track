import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  addYears,
  dayOfWeek,
  daysInMonth,
  diffDays,
  eachDate,
  formatDate,
  monthGrid,
  monthsBetween,
  periodBounds,
  rangeLength,
  startOfMonth,
  endOfMonth
} from './dates';

describe('date arithmetic', () => {
  it('adds days across a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('handles leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
  });

  it('clamps calendar-month addition at month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2027-01-15', -1)).toBe('2026-12-15');
    expect(addMonths('2026-01-31', 3)).toBe('2026-04-30');
  });

  it('counts inclusive range length and difference', () => {
    expect(rangeLength('2026-11-01', '2026-11-01')).toBe(1);
    expect(rangeLength('2026-11-01', '2026-11-30')).toBe(30);
    expect(diffDays('2026-11-01', '2026-11-30')).toBe(29);
    expect(eachDate('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02'
    ]);
  });

  it('computes weekday independently of timezone', () => {
    expect(dayOfWeek('2026-11-01')).toBe(0); // Sunday
    expect(dayOfWeek('2026-11-05')).toBe(4); // Thursday
    expect(dayOfWeek('2024-02-29')).toBe(4);
  });

  it('counts complete months with end-of-month clamping', () => {
    expect(monthsBetween('2026-01-31', '2026-02-28')).toBe(0);
    expect(monthsBetween('2026-01-15', '2026-04-15')).toBe(3);
    expect(monthsBetween('2026-01-31', '2026-05-01')).toBe(3);
    expect(monthsBetween('2026-09-30', '2026-12-30')).toBe(3);
  });

  it('builds month grids containing the whole month', () => {
    const grid = monthGrid(2026, 11, 1); // November 2026, Monday start
    expect(grid[0][0]).toBe('2026-10-26');
    const flat = grid.flat();
    expect(flat).toContain('2026-11-01');
    expect(flat).toContain('2026-11-30');
    expect(grid.flat().length % 7).toBe(0);
  });

  it('formats dates deterministically', () => {
    expect(formatDate('2026-11-05', 'dd MMM yyyy')).toBe('05 Nov 2026');
    expect(formatDate('2026-11-05', 'yyyy-MM-dd')).toBe('2026-11-05');
    expect(formatDate('2026-11-05', 'EEE, dd MMM yyyy')).toBe('Thu, 05 Nov 2026');
  });

  it('derives calendar, academic and employment periods', () => {
    expect(periodBounds('calendar-year', '2026-11-05')).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
      label: '2026'
    });
    const academic = periodBounds('academic-year', '2026-11-05', {
      academicYearStartMonth: 8
    });
    expect(academic.start).toBe('2026-08-01');
    expect(academic.end).toBe('2027-07-31');

    const employment = periodBounds('employment-year', '2026-11-05', {
      employmentStart: '2020-05-15'
    });
    expect(employment.start).toBe('2026-05-15');
    expect(employment.end).toBe('2027-05-14');

    const missing = periodBounds('employment-year', '2026-11-05');
    expect(missing.indeterminate).toBe(true);
  });

  it('starts and ends months at the correct dates', () => {
    expect(startOfMonth('2026-02-14')).toBe('2026-02-01');
    expect(endOfMonth('2024-02-14')).toBe('2024-02-29');
  });
});
