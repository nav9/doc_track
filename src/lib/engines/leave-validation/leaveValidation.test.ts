import { describe, expect, it } from 'vitest';
import { addDays } from '../../domain/common/dates';
import { evaluateLeaveRequest, evaluationSummary } from './leaveValidation';
import {
  cclCredit,
  clCredits,
  credit,
  debit,
  makeContext,
  makeDuty,
  makeEmployment,
  makeHoliday,
  makeLeave,
  makePolicy,
  makePdo,
  range,
  spclCredits,
  TODAY
} from '../../../test/fixtures';

function codes(evaluation: ReturnType<typeof evaluateLeaveRequest>): string[] {
  return evaluation.reasons.map((reason) => reason.code);
}

function status(
  category: string,
  startDate: string,
  days: number,
  overrides: Parameters<typeof makeContext>[0] = {},
  extra: { halfDay?: 'first' | 'second' | null } = {}
) {
  const { startDate: start, endDate } = range(startDate, days);
  return evaluateLeaveRequest(
    { category, startDate: start, endDate, halfDay: extra.halfDay ?? null },
    makeContext({
      ledger: [clCredits(15), spclCredits(15)],
      ...overrides
    })
  );
}

describe('CL — casual leave', () => {
  it('allows a single day within balance', () => {
    const evaluation = status('CL', '2026-11-10', 1);
    expect(evaluation.status).toBe('possible');
    expect(evaluation.leaveDays).toBe(1);
    expect(evaluationSummary(evaluation)).toBe('Possible');
  });

  it('rejects more than three CL days in a calendar month', () => {
    const existing = makeLeave({
      category: 'CL',
      startDate: '2026-11-02',
      endDate: '2026-11-04',
      leaveDays: 3,
      calendarDays: 3
    });
    const evaluation = status('CL', '2026-11-24', 1, { leaves: [existing] });
    expect(evaluation.status).toBe('not-possible');
    expect(codes(evaluation)).toContain('MONTHLY_LIMIT');
  });

  it('counts a half day as 0.5 against the monthly limit', () => {
    const existing = [
      makeLeave({
        category: 'CL',
        startDate: '2026-11-02',
        endDate: '2026-11-03',
        leaveDays: 2,
        calendarDays: 2
      }),
      makeLeave({
        category: 'CL',
        startDate: '2026-11-04',
        endDate: '2026-11-04',
        halfDay: 'first',
        leaveDays: 0.5,
        calendarDays: 1
      })
    ];
    const half = status('CL', '2026-11-24', 1, { leaves: existing }, { halfDay: 'first' });
    expect(half.status).toBe('possible');
    expect(half.leaveDays).toBe(0.5);

    const full = status('CL', '2026-11-24', 1, { leaves: existing });
    expect(full.status).toBe('not-possible');
    expect(codes(full)).toContain('MONTHLY_LIMIT');
  });

  it('rejects a request when the balance is exhausted', () => {
    const evaluation = status('CL', '2026-11-10', 1, { ledger: [debit('CL', 15, '2026-06-01')] });
    expect(evaluation.status).toBe('not-possible');
    expect(codes(evaluation)).toContain('INSUFFICIENT_BALANCE');
  });

  it('allows a half day and rejects a full day overlapping an existing half day', () => {
    const existing = makeLeave({
      category: 'CL',
      startDate: '2026-11-10',
      endDate: '2026-11-10',
      halfDay: 'first',
      leaveDays: 0.5
    });
    const sameHalf = status('CL', '2026-11-10', 1, { leaves: [existing] }, { halfDay: 'first' });
    expect(sameHalf.status).toBe('not-possible');
    expect(codes(sameHalf)).toContain('LEAVE_OVERLAP');

    const otherHalf = status('CCL', '2026-11-10', 1, {
      leaves: [existing],
      ledger: [clCredits(15), cclCredit('2026-10-01', 1)]
    }, { halfDay: 'second' });
    expect(otherHalf.status).toBe('possible');
  });

  it('rejects a half day spanning multiple dates', () => {
    const evaluation = evaluateLeaveRequest(
      { category: 'CL', startDate: '2026-11-10', endDate: '2026-11-11', halfDay: 'first' },
      makeContext({ ledger: [clCredits(15)] })
    );
    expect(codes(evaluation)).toContain('HALF_DAY_MULTI_DAY');
  });

  it('supports retrospective CL with a warning', () => {
    const evaluation = status('CL', '2026-10-01', 1);
    expect(evaluation.status).toBe('possible');
    expect(codes(evaluation)).toContain('RETROSPECTIVE_ALLOWED');
  });
});

describe('EL — earned leave', () => {
  it('requires at least four days', () => {
    const evaluation = status('EL', '2026-11-10', 3);
    expect(evaluation.status).toBe('not-possible');
    expect(codes(evaluation)).toContain('BELOW_MINIMUM');
  });

  it('allows a below-minimum request only when fewer than four days remain', () => {
    const used = debit('EL', 27, '2026-06-01');
    const evaluation = status('EL', '2026-11-10', 3, { ledger: [used] });
    expect(evaluation.status).toBe('conditional');
    expect(codes(evaluation)).toContain('BELOW_MINIMUM_EXCEPTION');
  });

  it('caps a continuous episode at eight calendar days', () => {
    const evaluation = status('EL', '2026-11-09', 9);
    expect(evaluation.status).toBe('not-possible');
    expect(codes(evaluation)).toContain('MAX_CONTINUOUS');
  });

  it('counts weekends inside an EL stretch', () => {
    const evaluation = status('EL', '2026-11-13', 4); // Fri–Mon
    expect(evaluation.leaveDays).toBe(4);
    expect(evaluation.status).toBe('possible');
  });

  it('enforces a three-calendar-month cooldown from the episode end', () => {
    const previous = makeLeave({
      category: 'EL',
      startDate: '2026-09-27',
      endDate: '2026-09-30',
      leaveDays: 4,
      calendarDays: 4
    });
    const blocked = status('EL', '2026-12-01', 4, { leaves: [previous] });
    expect(blocked.status).toBe('not-possible');
    expect(codes(blocked)).toContain('COOLDOWN');

    const allowed = status('EL', '2027-01-05', 4, { leaves: [previous] });
    expect(allowed.status).toBe('possible');
  });

  it('requires one year of service', () => {
    const employment = makeEmployment({ startDate: '2026-03-01' });
    const evaluation = status('EL', '2026-11-10', 4, { employment });
    expect(evaluation.status).toBe('not-possible');
    expect(codes(evaluation)).toContain('ELIGIBILITY_SERVICE');
  });

  it('enforces the annual thirty-day usage cap', () => {
    const evaluation = status('EL', '2026-11-10', 4, {
      leaves: [
        makeLeave({ category: 'EL', startDate: '2026-02-01', endDate: '2026-02-08', leaveDays: 8 }),
        makeLeave({ category: 'EL', startDate: '2026-05-01', endDate: '2026-05-08', leaveDays: 8 }),
        makeLeave({ category: 'EL', startDate: '2026-08-01', endDate: '2026-08-08', leaveDays: 8 }),
        makeLeave({ category: 'EL', startDate: '2026-10-01', endDate: '2026-10-04', leaveDays: 4 })
      ]
    });
    expect(evaluation.status).toBe('not-possible');
    expect(codes(evaluation)).toContain('ANNUAL_CAP');
  });

  it('rejects half-day EL', () => {
    const evaluation = status('EL', '2026-11-10', 1, {}, { halfDay: 'first' });
    expect(codes(evaluation)).toContain('HALF_DAY_NOT_ALLOWED');
  });

  it('merges adjacent episodes for the stretch limit', () => {
    const adjacent = makeLeave({
      category: 'EL',
      startDate: '2026-11-06',
      endDate: '2026-11-09',
      leaveDays: 4
    });
    const evaluation = status('EL', '2026-11-10', 5, { leaves: [adjacent] });
    expect(evaluation.status).toBe('not-possible');
    expect(codes(evaluation)).toContain('MERGE_EXCEEDS_MAX');
  });
});

describe('CCL — compensatory leave', () => {
  it('uses credits valid on the leave date', () => {
    const evaluation = status('CCL', '2026-10-20', 1, {
      ledger: [cclCredit('2026-08-01', 1)]
    });
    expect(evaluation.status).toBe('possible');
    expect(codes(evaluation)).toContain('CCL_ALLOCATED');
  });

  it('rejects CCL after the credit expired', () => {
    const evaluation = status('CCL', '2026-11-05', 1, {
      ledger: [cclCredit('2026-07-01', 1)] // expires 2026-10-01
    });
    expect(evaluation.status).toBe('not-possible');
    expect(codes(evaluation)).toContain('CCL_INSUFFICIENT_VALID');
  });

  it('allows CCL through its expiry date', () => {
    const evaluation = status('CCL', '2026-11-01', 1, {
      ledger: [cclCredit('2026-08-01', 1)]
    });
    expect(evaluation.status).toBe('possible');
  });

  it('consumes the earliest-expiring credit first across a multi-day leave', () => {
    const evaluation = status('CCL', '2026-10-28', 2, {
      ledger: [cclCredit('2026-07-30', 1), cclCredit('2026-10-01', 1)]
    });
    expect(evaluation.status).toBe('possible');
    expect(evaluation.consequences.expiringCredits[0].expiryDate).toBe('2026-10-30');
  });
});

describe('SPCL — special casual leave', () => {
  it('consumes working days only', () => {
    const holidays = [makeHoliday('2026-11-09', 'GH', 'General holiday')];
    const evaluation = status('SPCL', '2026-11-07', 4, { holidays });
    // Sat 7 (weekend), Sun 8 (weekend), Mon 9 (GH), Tue 10 (working)
    expect(evaluation.leaveDays).toBe(1);
    expect(evaluation.status).toBe('possible');
  });

  it('does not consume leave when the range has no working days', () => {
    const evaluation = status('SPCL', '2026-11-07', 2); // Sat + Sun
    expect(evaluation.leaveDays).toBe(0);
    expect(codes(evaluation)).toContain('NO_WORKING_DAYS');
  });

  it('allows half-day SPCL', () => {
    const evaluation = status('SPCL', '2026-11-10', 1, {}, { halfDay: 'second' });
    expect(evaluation.status).toBe('possible');
    expect(evaluation.leaveDays).toBe(0.5);
  });
});

describe('RH — restricted holiday', () => {
  it('allows one RH per six-month period', () => {
    const first = status('RH', '2026-11-10', 1);
    expect(first.status).toBe('possible');

    const second = status('RH', '2026-11-11', 1, {
      leaves: [
        makeLeave({
          category: 'RH',
          startDate: '2026-11-10',
          endDate: '2026-11-10'
        })
      ]
    });
    expect(second.status).toBe('not-possible');
    expect(codes(second)).toContain('RH_PERIOD_USED');
  });

  it('allows RH in the next six-month period without a 183-day wait', () => {
    const evaluation = status('RH', '2026-11-20', 1, {
      employment: makeEmployment({ startDate: '2026-01-01' }),
      leaves: [
        makeLeave({ category: 'RH', startDate: '2026-05-10', endDate: '2026-05-10' })
      ]
    });
    // Periods anchored to 1 Jan: Jan–Jun, then Jul–Dec.
    expect(evaluation.status).toBe('possible');
  });

  it('cannot be taken as a half day', () => {
    const evaluation = status('RH', '2026-11-10', 1, {}, { halfDay: 'first' });
    expect(codes(evaluation)).toContain('HALF_DAY_NOT_ALLOWED');
  });

  it('is indeterminate without a joining date', () => {
    const evaluation = status('RH', '2026-11-10', 1, {
      employment: makeEmployment({ startDate: '' })
    });
    expect(evaluation.status).toBe('indeterminate');
    expect(codes(evaluation)).toContain('RH_NO_JOINING_DATE');
  });
});

describe('GH — general holiday', () => {
  it('cannot be requested as a balance', () => {
    const evaluation = status('GH', '2026-11-10', 1);
    expect(evaluation.status).toBe('not-possible');
    expect(codes(evaluation)).toContain('GH_NOT_A_BALANCE');
  });
});

describe('LOP — loss of pay', () => {
  it('is always recordable and reports approval', () => {
    const evaluation = status('LOP', '2026-11-10', 1, { ledger: [] });
    expect(evaluation.status).toBe('possible');
    expect(evaluation.consequences.approvalRequired).toBe(true);
  });
});

describe('cross-cutting rules', () => {
  it('rejects leave outside the employment period', () => {
    const employment = makeEmployment({ startDate: '2026-12-01' });
    const evaluation = status('CL', '2026-11-10', 1, { employment });
    expect(codes(evaluation)).toContain('BEFORE_EMPLOYMENT');
  });

  it('warns about a duty inside the requested range', () => {
    const duty = makeDuty({ date: '2026-11-10' });
    const evaluation = status('CL', '2026-11-10', 1, { duties: [duty] });
    expect(evaluation.status).toBe('possible');
    expect(codes(evaluation)).toContain('DUTY_CONFLICT');
  });

  it('reports scheduled PDO inside the range', () => {
    const pdo = makePdo({ date: '2026-11-10' });
    const evaluation = status('CL', '2026-11-10', 1, { pdos: [pdo] });
    expect(codes(evaluation)).toContain('PDO_IN_RANGE');
  });

  it('warns when the leave could cause an NMC shortage', () => {
    const evaluation = status('SPCL', '2026-11-09', 19);
    expect(evaluation.status).toBe('possible');
    expect(codes(evaluation)).toContain('NMC_PROJECTED_SHORTAGE');
  });

  it('applies the correct policy version on each side of an effective date', () => {
    const v1 = makePolicy({ id: 'v1', version: 1, effectiveFrom: '2025-01-01', effectiveTo: '2026-06-30' });
    const v2 = makePolicy({
      id: 'v2',
      version: 2,
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      categories: makePolicy().categories.map((category) =>
        category.code === 'CL' ? { ...category, maxDaysPerMonth: 5 } : category
      )
    });

    const november = status('CL', '2026-11-10', 4, { policyVersions: [v1, v2] });
    expect(november.status).toBe('possible');
    expect(november.consequences.policyVersionIds).toEqual(['v2']);

    const june = status('CL', '2026-06-10', 4, { policyVersions: [v1, v2] });
    expect(june.status).toBe('not-possible');
    expect(codes(june)).toContain('MONTHLY_LIMIT');
  });

  it('is indeterminate when no policy covers the date', () => {
    const policy = makePolicy({ effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' });
    const evaluation = status('CL', '2026-11-10', 1, { policyVersions: [policy] });
    expect(evaluation.status).toBe('indeterminate');
    expect(codes(evaluation)).toContain('POLICY_MISSING');
  });

  it('reports a version change inside the range', () => {
    const v1 = makePolicy({ id: 'v1', version: 1, effectiveFrom: '2025-01-01', effectiveTo: '2026-11-09' });
    const v2 = makePolicy({ id: 'v2', version: 2, effectiveFrom: '2026-11-10', effectiveTo: null });
    const evaluation = status('CL', '2026-11-08', 4, { policyVersions: [v1, v2] });
    expect(codes(evaluation)).toContain('POLICY_CROSSES_VERSIONS');
  });

  it('treats the end of the expiry window as valid for a boundary date', () => {
    const evaluation = status('CCL', '2026-11-01', 1, {
      ledger: [cclCredit('2026-08-01', 1)]
    });
    const nextDay = status('CCL', '2026-11-02', 1, {
      ledger: [credit('CCL', 1, '2026-08-01', { expiryDate: '2026-11-01' })]
    });
    expect(evaluation.status).toBe('possible');
    expect(nextDay.status).toBe('not-possible');
  });

  it('handles a leave spanning the academic-year boundary', () => {
    const evaluation = status('CL', '2027-07-30', 4);
    expect(evaluation.status).toBe('possible');
    expect(addDays('2027-07-31', 1)).toBe('2027-08-01');
  });
});
