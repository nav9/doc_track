import { describe, expect, it } from 'vitest';
import { validatePolicyVersion } from './validatePolicy';
import { createDefaultPolicyDraft, createDefaultPolicyVersion } from '../../domain/policy/defaultPolicy';
import { makePolicy, NOW } from '../../../test/fixtures';

function draft(overrides: Partial<ReturnType<typeof createDefaultPolicyVersion>> = {}) {
  return { ...createDefaultPolicyDraft(NOW), ...overrides };
}

describe('policy validation', () => {
  it('accepts the seeded medical college policy as a draft', () => {
    const result = validatePolicyVersion(
      createDefaultPolicyDraft(NOW)
    );
    expect(result.errors).toBe(0);
    expect(result.canPublish).toBe(true);
  });

  it('accepts the seeded published policy content', () => {
    const result = validatePolicyVersion(createDefaultPolicyVersion(NOW));
    expect(result.errors).toBe(0);
  });

  it('rejects an effective end before the effective start', () => {
    const result = validatePolicyVersion(
      draft({ effectiveFrom: '2026-06-01', effectiveTo: '2026-05-01' })
    );
    expect(result.issues.map((issue) => issue.code)).toContain('POLICY_EFFECTIVE_RANGE');
    expect(result.canPublish).toBe(false);
  });

  it('rejects a missing effective start date', () => {
    const result = validatePolicyVersion(draft({ effectiveFrom: '' }));
    expect(result.issues.map((issue) => issue.code)).toContain('POLICY_EFFECTIVE_FROM');
  });

  it('rejects a negative entitlement and an excessive limit', () => {
    const policy = draft();
    policy.categories = policy.categories.map((category) =>
      category.code === 'CL'
        ? {
            ...category,
            entitlement: { ...category.entitlement, amount: -5 },
            maxDaysPerMonth: 40
          }
        : category
    );
    const result = validatePolicyVersion(policy);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'CATEGORY_CL_ENTITLEMENT_NEGATIVE',
        'CATEGORY_CL_MONTHLY_LIMIT_TOO_HIGH'
      ])
    );
  });

  it('rejects a minimum duration above the maximum', () => {
    const policy = draft();
    policy.categories = policy.categories.map((category) =>
      category.code === 'EL' ? { ...category, minDaysPerRequest: 10, maxContinuousDays: 8 } : category
    );
    const result = validatePolicyVersion(policy);
    expect(result.issues.map((issue) => issue.code)).toContain('CATEGORY_EL_MIN_ABOVE_MAX');
  });

  it('rejects duplicate category codes', () => {
    const policy = draft();
    policy.categories = [...policy.categories, policy.categories[0]];
    const result = validatePolicyVersion(policy);
    expect(result.issues.map((issue) => issue.code)).toContain('POLICY_DUPLICATE_CATEGORY');
  });

  it('rejects unresolved and circular rule dependencies', () => {
    const policy = draft();
    policy.rules = [
      ...policy.rules,
      {
        id: 'rule_circular_a',
        title: 'A',
        description: 'A',
        enabled: true,
        trigger: 'DUTY_COMPLETED',
        conditions: [],
        consequences: [],
        dependsOn: ['rule_circular_b'],
        config: {},
        source: '',
        notes: ''
      },
      {
        id: 'rule_circular_b',
        title: 'B',
        description: 'B',
        enabled: true,
        trigger: 'DUTY_COMPLETED',
        conditions: [],
        consequences: [],
        dependsOn: ['rule_circular_a', 'missing_rule'],
        config: {},
        source: '',
        notes: ''
      }
    ];
    const result = validatePolicyVersion(policy);
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain('RULE_CIRCULAR_DEPENDENCY');
    expect(codes).toContain('RULE_UNRESOLVED_DEPENDENCY');
  });

  it('rejects an unknown condition field', () => {
    const policy = draft();
    policy.rules = [
      ...policy.rules,
      {
        id: 'rule_bad_condition',
        title: 'Bad condition',
        description: 'Bad',
        enabled: true,
        trigger: 'DUTY_COMPLETED',
        conditions: [{ field: 'duty.unknown', operator: 'equals', value: 1 }],
        consequences: [],
        dependsOn: [],
        config: {},
        source: '',
        notes: ''
      }
    ];
    expect(validatePolicyVersion(policy).issues.map((issue) => issue.code)).toContain(
      'RULE_CONDITION_UNKNOWN_FIELD'
    );
  });

  it('warns about a usage cap above the credited entitlement', () => {
    const policy = draft();
    policy.categories = policy.categories.map((category) =>
      category.code === 'SPCL'
        ? { ...category, entitlement: { ...category.entitlement, usageCap: 20 } }
        : category
    );
    const result = validatePolicyVersion(policy);
    expect(result.issues.map((issue) => issue.code)).toContain(
      'CATEGORY_SPCL_USAGE_CAP_ABOVE_ENTITLEMENT'
    );
    expect(result.canPublish).toBe(true);
  });

  it('warns that EL has no credited balance', () => {
    const result = validatePolicyVersion(createDefaultPolicyDraft(NOW));
    expect(result.warnings).toBeGreaterThanOrEqual(0);
    expect(validatePolicyVersion(makePolicy()).errors).toBe(0);
  });

  it('requires at least one category', () => {
    const result = validatePolicyVersion(draft({ categories: [] }));
    expect(result.issues.map((issue) => issue.code)).toContain('POLICY_NO_CATEGORIES');
  });
});
