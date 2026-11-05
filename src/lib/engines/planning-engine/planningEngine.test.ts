import { describe, expect, it } from 'vitest';
import {
  checkExactRange,
  continuousBreak,
  findLongBreaks,
  searchCandidates
} from './planningEngine';
import {
  clCredits,
  cclCredit,
  makeContext,
  makeHoliday,
  makeLeave,
  range,
  spclCredits,
  TODAY
} from '../../../test/fixtures';

const context = makeContext({
  ledger: [clCredits(15), spclCredits(15), cclCredit('2026-10-01', 1)]
});

describe('exact-range feasibility', () => {
  it('returns one verdict per requested category', () => {
    const results = checkExactRange(
      { startDate: '2026-11-10', endDate: '2026-11-13', categories: ['CL', 'EL', 'SPCL'] },
      context
    );
    expect(results).toHaveLength(3);
    expect(results.find((result) => result.category === 'EL')?.status).toBe('possible');
    expect(results.find((result) => result.category === 'CL')?.status).toBe('not-possible');
  });
});

describe('candidate search', () => {
  const query = {
    startDate: '2026-11-09',
    endDate: '2026-12-06',
    categories: ['CL'],
    maxCandidates: 20
  };

  it('never returns invalid candidates', () => {
    const candidates = searchCandidates(query, context);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(['possible', 'conditional']).toContain(candidate.status);
      expect(candidate.startDate >= query.startDate).toBe(true);
      expect(candidate.endDate <= query.endDate).toBe(true);
      expect(candidate.startDate <= candidate.endDate).toBe(true);
    }
  });

  it('respects the CL monthly cap inside the window', () => {
    const candidates = searchCandidates(query, context);
    const november = candidates.filter(
      (candidate) =>
        candidate.startDate.startsWith('2026-11') && candidate.endDate.startsWith('2026-11')
    );
    expect(november.length).toBeGreaterThan(0);
    expect(november.every((candidate) => candidate.leaveDays <= 3)).toBe(true);
  });

  it('respects existing leave', () => {
    const existing = makeLeave({
      category: 'CL',
      startDate: '2026-11-16',
      endDate: '2026-11-18',
      leaveDays: 3
    });
    const candidates = searchCandidates(query, { ...context, leaves: [existing] });
    expect(
      candidates.some(
        (candidate) =>
          candidate.startDate <= '2026-11-18' && candidate.endDate >= '2026-11-16'
      )
    ).toBe(false);
  });

  it('honours a minimum break filter', () => {
    const candidates = searchCandidates(
      { ...query, minBreakDays: 5 },
      context
    );
    expect(candidates.every((candidate) => candidate.breakDays >= 5)).toBe(true);
  });

  it('honours maxLeaveDays', () => {
    const candidates = searchCandidates({ ...query, maxLeaveDays: 2 }, context);
    expect(candidates.every((candidate) => candidate.leaveDays <= 2)).toBe(true);
  });

  it('orders candidates by score without ranking invalid ones', () => {
    const candidates = searchCandidates(query, context);
    for (let index = 1; index < candidates.length; index += 1) {
      expect(candidates[index - 1].score).toBeGreaterThanOrEqual(candidates[index].score);
    }
  });

  it('rejects an unreasonably large window', () => {
    expect(() =>
      searchCandidates({ ...query, startDate: '2026-01-01', endDate: '2026-12-31' }, context)
    ).toThrow(/92 days/);
  });

  it('returns nothing for an inverted window', () => {
    expect(
      searchCandidates({ ...query, startDate: '2026-12-01', endDate: '2026-11-01' }, context)
    ).toEqual([]);
  });

  it('produces EL episodes of at least four days only', () => {
    const candidates = searchCandidates(
      { ...query, categories: ['EL'], maxCandidates: 50 },
      context
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => candidate.leaveDays >= 4)).toBe(true);
    expect(candidates.every((candidate) => candidate.calendarDays <= 8)).toBe(true);
  });

  it('respects a mid-window policy change', () => {
    const base = makeContext({ ledger: [clCredits(15)] });
    const oldPolicy = base.policyVersions[0];
    const newPolicy = {
      ...oldPolicy,
      id: 'policy-v2',
      version: 2,
      effectiveFrom: '2026-12-01',
      effectiveTo: null,
      categories: oldPolicy.categories.map((category) =>
        category.code === 'CL' ? { ...category, maxDaysPerMonth: 1 } : category
      )
    };
    const candidates = searchCandidates(
      { ...query, startDate: '2026-11-25', endDate: '2026-12-10' },
      { ...base, policyVersions: [oldPolicy, newPolicy] }
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(
      candidates.some(
        (candidate) => candidate.startDate.startsWith('2026-12') && candidate.leaveDays > 1
      )
    ).toBe(false);
  });
});

describe('continuous break calculation', () => {
  it('extends across adjacent weekends', () => {
    const result = continuousBreak('2026-11-13', '2026-11-13', [], [0, 6]); // Friday
    expect(result.breakStart).toBe('2026-11-13');
    expect(result.breakEnd).toBe('2026-11-15');
    expect(result.breakDays).toBe(3);
  });

  it('extends across adjacent general holidays', () => {
    const result = continuousBreak(
      '2026-11-09',
      '2026-11-09',
      [makeHoliday('2026-11-10', 'GH')],
      [0, 6]
    );
    // The preceding weekend (7–8 Nov) is also part of the continuous break.
    expect(result.breakStart).toBe('2026-11-07');
    expect(result.breakEnd).toBe('2026-11-10');
    expect(result.breakDays).toBe(4);
  });
});

describe('long break suggestions', () => {
  it('finds breaks that use weekends and few leave days', () => {
    const ideas = findLongBreaks(
      { startDate: TODAY, endDate: '2026-12-20', categories: ['CL'], minBreakDays: 4 },
      context,
      3
    );
    expect(ideas.length).toBeGreaterThan(0);
    expect(ideas.every((idea) => idea.breakDays >= 4)).toBe(true);
    expect(ideas.every((idea) => idea.leaveDays > 0)).toBe(true);
  });
});

describe('date-range boundaries', () => {
  it('finds a valid CL candidate on a leap day', () => {
    const leapContext = makeContext({
      today: '2028-02-01',
      ledger: [clCredits(15, 2028)],
      policyVersions: [makeContext().policyVersions[0]]
    });
    const { startDate, endDate } = range('2028-02-29', 1);
    const results = checkExactRange({ startDate, endDate, categories: ['CL'] }, leapContext);
    expect(results[0].status).toBe('possible');
  });
});
