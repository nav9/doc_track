import { describe, expect, it } from 'vitest';
import {
  consecutiveDuties,
  decidePdoOutcome,
  planDuty,
  unusedPdoConversion,
  validateDutyInput
} from './dutyEngine';
import { makeDuty, makeHoliday, makePdo, makePolicy, TODAY } from '../../../test/fixtures';

const policy = makePolicy();
const holidays = [makeHoliday('2026-11-09', 'GH', 'General holiday')];

describe('duty consequences', () => {
  it('creates a next-day PDO for a weekday 24-hour duty without CCL', () => {
    const duty = makeDuty({ date: '2026-11-05' }); // Thursday
    const plan = planDuty(duty, { policy, holidays });
    expect(plan.qualifyingDay).toBe(false);
    expect(plan.pdoDate).toBe('2026-11-06');
    expect(plan.cclCredits).toHaveLength(0);
  });

  it('credits CCL for a Saturday duty and still schedules the PDO', () => {
    const duty = makeDuty({ date: '2026-11-07' }); // Saturday
    const plan = planDuty(duty, { policy, holidays });
    expect(plan.qualifyingDay).toBe(true);
    expect(plan.pdoDate).toBe('2026-11-08'); // Sunday
    expect(plan.cclCredits).toEqual([
      { category: 'CCL', amount: 1, expiryMonths: 3, reason: 'Duty on 2026-11-07 (Qualifying duty earns CCL)' }
    ]);
  });

  it('credits exactly one CCL for a Sunday duty — no duplicate Sunday rule', () => {
    const duty = makeDuty({ date: '2026-11-08' }); // Sunday
    const plan = planDuty(duty, { policy, holidays });
    expect(plan.pdoDate).toBe('2026-11-09');
    expect(plan.cclCredits).toHaveLength(1);
  });

  it('credits CCL for a general-holiday duty', () => {
    const duty = makeDuty({ date: '2026-11-09' });
    const plan = planDuty(duty, { policy, holidays });
    expect(plan.qualifyingDay).toBe(true);
    expect(plan.cclCredits).toHaveLength(1);
  });

  it('creates one PDO per duty for consecutive duties', () => {
    const first = planDuty(makeDuty({ date: '2026-11-05' }), { policy, holidays });
    const second = planDuty(makeDuty({ date: '2026-11-06' }), { policy, holidays });
    expect(first.pdoDate).toBe('2026-11-06');
    expect(second.pdoDate).toBe('2026-11-07');

    const groups = consecutiveDuties([
      makeDuty({ date: '2026-11-05' }),
      makeDuty({ date: '2026-11-06' }),
      makeDuty({ date: '2026-11-10' })
    ]);
    expect(groups.map((group) => group.length)).toEqual([2, 1]);
  });

  it('does not create consequences for a 6-hour shift under the medical college rule', () => {
    const duty = makeDuty({ durationHours: 6, shiftId: 'shift_day_6h', date: '2026-11-07' });
    const plan = planDuty(duty, { policy, holidays });
    expect(plan.pdoDate).toBeNull();
    expect(plan.notes.join(' ')).toContain('requires at least 24 hours');
  });

  it('does not create a PDO when the policy rule is disabled', () => {
    const disabled = makePolicy({
      rules: policy.rules.map((rule) =>
        rule.id === 'rule_duty_pdo' ? { ...rule, enabled: false } : rule
      )
    });
    const plan = planDuty(makeDuty({ date: '2026-11-05' }), { policy: disabled, holidays });
    expect(plan.pdoDate).toBeNull();
    expect(plan.notes.join(' ')).toContain('No enabled rule');
  });

  it('does not credit CCL before the duty is completed', () => {
    const plan = planDuty(
      makeDuty({ date: '2026-11-07', status: 'planned' }),
      { policy, holidays }
    );
    expect(plan.cclCredits).toHaveLength(0);
  });
});

describe('PDO outcomes', () => {
  it('converts a PDO that falls on a holiday', () => {
    const pdo = makePdo({ date: '2026-11-09' }); // GH
    const decision = decidePdoOutcome(pdo, { policy, holidays, today: TODAY });
    expect(decision.convert).toBe(true);
    expect(decision.status).toBe('converted-holiday');
    expect(decision.expiryMonths).toBe(3);
  });

  it('converts a PDO that falls on a Sunday via the weekend setting', () => {
    const pdo = makePdo({ date: '2026-11-08' });
    const decision = decidePdoOutcome(pdo, { policy, holidays, today: TODAY });
    expect(decision.convert).toBe(true);
    expect(decision.status).toBe('converted-holiday');
  });

  it('converts a worked PDO with a punch-out at or before 4 PM', () => {
    const pdo = makePdo({ date: '2026-11-06', punchOutAt: '2026-11-06T15:45:00' });
    const decision = decidePdoOutcome(pdo, { policy, holidays, today: TODAY });
    expect(decision.convert).toBe(true);
    expect(decision.status).toBe('converted-worked');
    expect(decision.requiresApproval).toBe(false);
  });

  it('requires approval for a punch-out after the cutoff', () => {
    const pdo = makePdo({ date: '2026-11-06', punchOutAt: '2026-11-06T17:10:00' });
    const decision = decidePdoOutcome(pdo, { policy, holidays, today: TODAY });
    expect(decision.convert).toBe(false);
    expect(decision.requiresApproval).toBe(true);
  });

  it('converts only after approval when the punch-out is missing', () => {
    const pdo = makePdo({ date: '2026-11-06', approvalRequired: true });
    const decision = decidePdoOutcome(pdo, { policy, holidays, today: TODAY });
    expect(decision.convert).toBe(true);
    expect(decision.requiresApproval).toBe(true);
  });

  it('leaves a future PDO scheduled', () => {
    const pdo = makePdo({ date: '2026-11-20' });
    const decision = decidePdoOutcome(pdo, { policy, holidays, today: TODAY });
    expect(decision.convert).toBe(false);
    expect(decision.status).toBe('scheduled');
  });
});

describe('unused PDO conversion', () => {
  it('is manual by default because no automatic delay is configured', () => {
    const pdo = makePdo({ date: '2026-01-05' });
    const decision = unusedPdoConversion(pdo, { policy, holidays, today: TODAY });
    expect(decision.convert).toBe(false);
    expect(decision.reason).toContain('manually');
  });

  it('converts automatically when a policy delay is configured', () => {
    const policyWithDelay = makePolicy({
      rules: policy.rules.map((rule) =>
        rule.id === 'rule_pdo_unused_ccl'
          ? { ...rule, config: { ...rule.config, autoConvertAfterMonths: 2 } }
          : rule
      )
    });
    const decision = unusedPdoConversion(makePdo({ date: '2026-08-01' }), {
      policy: policyWithDelay,
      holidays,
      today: TODAY
    });
    expect(decision.convert).toBe(true);
    expect(decision.status).toBe('converted-unused');
  });
});

describe('duty validation', () => {
  it('rejects a duplicate duty on the same date', () => {
    const issues = validateDutyInput({
      date: '2026-11-05',
      startTime: '09:00',
      endTime: '09:00',
      shiftId: 'shift_night_24h',
      existing: [makeDuty({ date: '2026-11-05' })]
    });
    expect(issues.map((issue) => issue.code)).toContain('DUTY_DUPLICATE');
  });

  it('requires a shift and valid times', () => {
    const issues = validateDutyInput({
      date: '2026-11-05',
      startTime: '9',
      endTime: '',
      shiftId: '',
      existing: []
    });
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['DUTY_SHIFT_REQUIRED', 'DUTY_TIME_INVALID'])
    );
  });
});
