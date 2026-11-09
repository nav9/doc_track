import { describe, expect, it } from 'vitest';
import {
  contiguousRuns,
  doctorMatches,
  levenshtein,
  monthRows,
  plannerMonths
} from './plannerTools';

describe('planner calendar helpers', () => {
  it('builds January through March of the following year', () => {
    const months = plannerMonths(2026);
    expect(months).toHaveLength(15);
    expect(months[0].label).toBe('January');
    expect(months[14]).toMatchObject({ year: 2027, month: 3, label: 'March' });
  });

  it('lays a month into complete seven-day rows', () => {
    const rows = monthRows(2026, 11, 1);
    expect(rows.every((row) => row.length === 7)).toBe(true);
    expect(rows.flat().filter(Boolean)).toHaveLength(30);
  });

  it('splits selected dates into contiguous episodes', () => {
    expect(contiguousRuns(['2026-11-12', '2026-11-10', '2026-11-11', '2026-11-15'])).toEqual([
      ['2026-11-10', '2026-11-11', '2026-11-12'],
      ['2026-11-15']
    ]);
  });

  it('finds close doctor names with Levenshtein distance', () => {
    expect(levenshtein('asha rao', 'asha rao')).toBe(0);
    expect(doctorMatches('ash rao', ['Asha Rao', 'Meera Iyer'])).toEqual(['Asha Rao']);
  });
});
