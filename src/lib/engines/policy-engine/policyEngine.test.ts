import { describe, expect, it } from 'vitest';
import {
  describeCategoryRule,
  explainConsequenceRule,
  getCategoryRule,
  resolvePolicySegments,
  rhPeriodFor,
  selectPolicyVersion
} from './policyEngine';
import { createDefaultPolicyVersion } from '../../domain/policy/defaultPolicy';
import { makePolicy, NOW } from '../../../test/fixtures';

function version(id: string, number: number, from: string, to: string | null) {
  return {
    ...createDefaultPolicyVersion(NOW, from),
    id,
    version: number,
    effectiveFrom: from,
    effectiveTo: to,
    publishedAt: NOW
  };
}

describe('policy version resolution', () => {
  const v1 = version('v1', 1, '2025-01-01', '2026-06-30');
  const v2 = version('v2', 2, '2026-07-01', null);

  it('uses the policy effective on a historical date', () => {
    expect(selectPolicyVersion([v1, v2], '2026-03-15')?.id).toBe('v1');
  });

  it('uses the newer policy from its effective date', () => {
    expect(selectPolicyVersion([v1, v2], '2026-07-01')?.id).toBe('v2');
  });

  it('returns null when no policy covers the date', () => {
    expect(selectPolicyVersion([v1, v2], '2024-12-31')).toBeNull();
  });

  it('splits a range that crosses a policy change', () => {
    const segments = resolvePolicySegments([v1, v2], '2026-06-29', '2026-07-02');
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ start: '2026-06-29', end: '2026-06-30' });
    expect(segments[0].version?.id).toBe('v1');
    expect(segments[1]).toMatchObject({ start: '2026-07-01', end: '2026-07-02' });
    expect(segments[1].version?.id).toBe('v2');
  });

  it('marks uncovered segments when coverage is missing', () => {
    const segments = resolvePolicySegments([v2], '2026-06-29', '2026-07-02');
    expect(segments[0].version).toBeNull();
    expect(segments[1].version?.id).toBe('v2');
  });

  it('prefers a scoped policy over a general one', () => {
    const scoped = { ...v2, id: 'scoped', organisationId: 'org_primary', department: 'Orthopaedics' };
    const selected = selectPolicyVersion([v2, scoped], '2026-08-01', {
      organisationId: 'org_primary',
      department: 'Orthopaedics'
    });
    expect(selected?.id).toBe('scoped');
    expect(selectPolicyVersion([v2, scoped], '2026-08-01', { department: 'Medicine' })?.id).toBe('v2');
  });
});

describe('plain-English policy descriptions', () => {
  const policy = makePolicy();

  it('describes CL entitlement, monthly cap and half-day support', () => {
    const description = describeCategoryRule(getCategoryRule(policy, 'CL')!);
    const text = description.facts.map((fact) => fact.text).join(' ');
    expect(text).toContain('15 days per calendar year');
    expect(text).toContain('At most 3 days in any calendar month');
    expect(text).toContain('half day');
  });

  it('describes the EL episode rules and cooldown in calendar months', () => {
    const description = describeCategoryRule(getCategoryRule(policy, 'EL')!);
    const text = description.facts.map((fact) => fact.text).join(' ');
    expect(text).toContain('4 days per application');
    expect(text).toContain('8 days in one continuous episode');
    expect(text).toContain('3 calendar months');
  });

  it('explains consequence rules as sentences', () => {
    const rule = policy.rules.find((item) => item.id === 'rule_duty_qualifying_ccl')!;
    const text = explainConsequenceRule(rule);
    expect(text).toContain('Saturday, Sunday or general holiday');
    expect(text).toContain('credit 1 CCL day');
  });

  it('offers the 6-hour and 12-hour shifts for other employers without using them by default', () => {
    expect(policy.shifts.some((shift) => shift.durationHours === 6)).toBe(true);
    expect(policy.shifts.some((shift) => shift.durationHours === 12)).toBe(true);
  });
});

describe('RH six-month periods', () => {
  it('anchors periods to the joining date rather than 183 days', () => {
    const joining = '2020-05-15';
    const first = rhPeriodFor(joining, '2020-06-01');
    expect(first?.start).toBe('2020-05-15');
    expect(first?.end).toBe('2020-11-14');
    const second = rhPeriodFor(joining, '2020-11-15');
    expect(second?.start).toBe('2020-11-15');
    expect(second?.end).toBe('2021-05-14');
  });

  it('keeps month-end joining dates stable', () => {
    const period = rhPeriodFor('2026-08-31', '2026-09-10');
    expect(period?.start).toBe('2026-08-31');
    expect(period?.end).toBe('2027-02-27');
  });

  it('returns null when the date predates joining', () => {
    expect(rhPeriodFor('2026-01-10', '2025-12-01')).toBeNull();
  });
});
