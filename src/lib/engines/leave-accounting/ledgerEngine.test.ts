import { describe, expect, it } from 'vitest';
import {
  allocateCclCredits,
  computeBalances,
  computeCategoryBalance,
  createReversal,
  cclAvailableOn,
  creditLots,
  expiryDateFor,
  expiredCredits,
  isCreditValidOn,
  ledgerWithLineage
} from './ledgerEngine';
import {
  cclCredit,
  clCredits,
  credit,
  debit,
  makeContext,
  makePolicy,
  NOW,
  TODAY
} from '../../../test/fixtures';

const policy = makePolicy();

describe('ledger balances', () => {
  it('derives available CL from credits minus debits', () => {
    const transactions = [clCredits(15), debit('CL', 3.5, '2026-03-04')];
    const balance = computeCategoryBalance('CL', transactions, {
      today: TODAY,
      policy,
      employmentStart: '2020-01-01'
    });
    expect(balance.credited).toBe(15);
    expect(balance.used).toBe(3.5);
    expect(balance.available).toBe(11.5);
  });

  it('does not spend credits from a previous policy period when carry-forward is off', () => {
    const transactions = [clCredits(15, 2025), clCredits(15, 2026)];
    const balance = computeCategoryBalance('CL', transactions, {
      today: TODAY,
      policy,
      employmentStart: '2020-01-01'
    });
    expect(balance.credited).toBe(15);
    expect(balance.available).toBe(15);
  });

  it('derives EL availability from the annual usage cap', () => {
    const transactions = [debit('EL', 12, '2026-05-01')];
    const balance = computeCategoryBalance('EL', transactions, {
      today: TODAY,
      policy,
      employmentStart: '2020-01-01'
    });
    expect(balance.credited).toBe(30);
    expect(balance.available).toBe(18);
    expect(balance.notes.join(' ')).toContain('usage cap');
  });

  it('keeps LOP balances negative', () => {
    const transactions = [debit('LOP', 2, '2026-04-02')];
    const balance = computeCategoryBalance('LOP', transactions, {
      today: TODAY,
      policy,
      employmentStart: '2020-01-01'
    });
    expect(balance.available).toBe(-2);
  });

  it('builds a balance for every policy category', () => {
    const balances = computeBalances([clCredits(15)], {
      today: TODAY,
      policy,
      employmentStart: '2020-01-01'
    });
    expect(Object.keys(balances)).toEqual(expect.arrayContaining(['CL', 'EL', 'CCL', 'SPCL', 'RH']));
  });
});

describe('CCL credit expiry', () => {
  it('expires three calendar months after the earned date', () => {
    expect(expiryDateFor(policy, 'CCL', '2026-08-01')).toBe('2026-11-01');
    expect(expiryDateFor(policy, 'CCL', '2026-01-31')).toBe('2026-04-30');
    expect(expiryDateFor(policy, 'CL', '2026-08-01')).toBeNull();
  });

  it('treats the expiry date as inclusive', () => {
    const creditTx = cclCredit('2026-08-01', 1);
    expect(creditTx.expiryDate).toBe('2026-11-01');
    expect(isCreditValidOn(creditTx, '2026-11-01')).toBe(true);
    expect(isCreditValidOn(creditTx, '2026-11-02')).toBe(false);
  });

  it('excludes expired credits from availability and reports them', () => {
    const transactions = [cclCredit('2026-06-01', 1), cclCredit('2026-10-01', 1)];
    const balance = computeCategoryBalance('CCL', transactions, {
      today: TODAY,
      policy,
      employmentStart: '2020-01-01'
    });
    expect(balance.available).toBe(1);
    expect(balance.expired).toBe(1);
    expect(cclAvailableOn(transactions, TODAY)).toBe(1);
    expect(expiredCredits(transactions, TODAY)).toHaveLength(1);
  });

  it('reports credits expiring within the warning horizon', () => {
    const transactions = [cclCredit('2026-09-01', 1)]; // expires 2026-12-01
    const balance = computeCategoryBalance('CCL', transactions, {
      today: TODAY,
      policy,
      employmentStart: '2020-01-01',
      expiringWithinDays: 30
    });
    expect(balance.expiringSoon).toHaveLength(1);
    expect(balance.expiringSoon[0].expiryDate).toBe('2026-12-01');
  });
});

describe('CCL allocation order', () => {
  it('consumes the earliest-expiring credit first', () => {
    const early = cclCredit('2026-08-01', 1, 'ccl-early'); // expires 2026-11-01
    const late = cclCredit('2026-10-01', 1, 'ccl-late'); // expires 2027-01-01
    const preview = allocateCclCredits([late, early], 1, '2026-10-20');
    expect(preview.allocations).toEqual([{ creditId: 'ccl-early', amount: 1 }]);
    expect(preview.shortfall).toBe(0);
  });

  it('splits a request across credits when needed', () => {
    const first = cclCredit('2026-08-01', 1, 'ccl-a');
    const second = cclCredit('2026-09-01', 1, 'ccl-b');
    const preview = allocateCclCredits([first, second], 1.5, '2026-10-20');
    expect(preview.allocations).toEqual([
      { creditId: 'ccl-a', amount: 1 },
      { creditId: 'ccl-b', amount: 0.5 }
    ]);
  });

  it('cannot use a credit that expires before the leave date', () => {
    const creditTx = cclCredit('2026-07-01', 1, 'ccl-old'); // expires 2026-10-01
    const preview = allocateCclCredits([creditTx], 1, '2026-10-02');
    expect(preview.available).toBe(0);
    expect(preview.shortfall).toBe(1);
  });

  it('cannot use a credit earned after the leave date', () => {
    const creditTx = cclCredit('2026-11-01', 1, 'ccl-future');
    const preview = allocateCclCredits([creditTx], 1, '2026-10-30');
    expect(preview.shortfall).toBe(1);
  });

  it('reports remaining lots after a debit', () => {
    const transactions = [cclCredit('2026-08-01', 1, 'ccl-a'), debit('CCL', 0.5, '2026-09-01')];
    const lots = creditLots(transactions, 'CCL');
    expect(lots[0].remaining).toBe(0.5);
  });
});

describe('reversals', () => {
  it('restores balance through a compensating entry, keeping history', () => {
    const usage = debit('CL', 2, '2026-03-02', { id: 'use-1' });
    const reversal = createReversal(usage, { id: 'rev-1', now: NOW, reason: 'Leave cancelled' });

    const before = computeCategoryBalance('CL', [clCredits(15), usage], {
      today: TODAY,
      policy,
      employmentStart: '2020-01-01'
    });
    const after = computeCategoryBalance('CL', [clCredits(15), usage, reversal], {
      today: TODAY,
      policy,
      employmentStart: '2020-01-01'
    });

    expect(before.available).toBe(13);
    expect(after.available).toBe(15);
    const lineage = ledgerWithLineage([usage, reversal]);
    expect(lineage).toHaveLength(1);
    expect(lineage[0].reversed).toBe(true);
    expect(lineage[0].reversal?.id).toBe('rev-1');
  });

  it('reverses an entitlement credit without deleting it', () => {
    const entitlement = credit('SPCL', 15, '2026-01-01', { id: 'ent-spcl' });
    const reversal = createReversal(entitlement, { id: 'rev-ent', now: NOW, reason: 'Correction' });
    const balance = computeCategoryBalance('SPCL', [entitlement, reversal], {
      today: TODAY,
      policy,
      employmentStart: '2020-01-01'
    });
    expect(balance.available).toBe(0);
  });
});

describe('ledger context integration', () => {
  it('computes balances through the shared context helper', () => {
    const context = makeContext({ ledger: [clCredits(15)] });
    const balances = computeBalances(context.ledger, {
      today: context.today,
      policy,
      employmentStart: context.employment?.startDate
    });
    expect(balances.CL.available).toBe(15);
  });
});
