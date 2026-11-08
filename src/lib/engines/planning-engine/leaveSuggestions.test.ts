import { describe, expect, it } from 'vitest';
import { buildLeaveSuggestions, type LeaveSuggestionInput } from './leaveSuggestions';

const rules: LeaveSuggestionInput['rules'] = [
  { code: 'CCL', available: 0, maxDaysPerMonth: null, minDaysPerRequest: null },
  { code: 'CL', available: 10, maxDaysPerMonth: 3, minDaysPerRequest: null }
];

function input(overrides: Partial<LeaveSuggestionInput> = {}): LeaveSuggestionInput {
  return {
    year: 2026,
    anchor: { startDate: '2026-11-12', endDate: '2026-11-12' },
    leaves: [
      {
        startDate: '2026-11-12',
        endDate: '2026-11-12',
        category: 'CL',
        status: 'pending'
      }
    ],
    holidays: [],
    weekendDays: [0, 6],
    rules,
    ...overrides
  };
}

describe('anchored leave suggestions', () => {
  it('shows nothing until a leave has been entered', () => {
    expect(buildLeaveSuggestions(input({ anchor: null }))).toEqual({});
  });

  it('suggests a nearby bridge day using its category without a question mark', () => {
    const suggestions = buildLeaveSuggestions(input());
    expect(Object.keys(suggestions)).toEqual(['2026-11-13']);
    expect(suggestions['2026-11-13'].category).toBe('CL');
    expect(suggestions['2026-11-13'].label).toBe('CL');
  });

  it('respects the monthly CL limit before proposing a category', () => {
    const suggestions = buildLeaveSuggestions(
      input({
        leaves: [
          {
            startDate: '2026-11-03',
            endDate: '2026-11-04',
            category: 'CL',
            status: 'approved'
          },
          {
            startDate: '2026-11-12',
            endDate: '2026-11-12',
            category: 'CL',
            status: 'pending'
          }
        ]
      })
    );
    expect(suggestions).toEqual({});
  });
});
