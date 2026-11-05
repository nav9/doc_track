/**
 * Leave accounting.
 *
 * Balances are always reconstructed from the ledger:
 *   credits (entitlement, CCL earned, adjustments)
 *   − debits (usage, LOP)
 * Expiry is derived from each credit's validity window. Reversals cancel the
 * original entry and are kept in history rather than deleting anything.
 *
 * CCL consumption follows the policy rule "earliest-expiring credit first".
 * Replay is deterministic, so an imported backup produces identical balances.
 */
import type { ISODate } from '../../domain/common/types';
import { roundDays } from '../../domain/common/types';
import { addDays, addMonths, periodBounds, todayLocal } from '../../domain/common/dates';
import type { Period, PeriodKind } from '../../domain/common/dates';
import type {
  CategoryBalance,
  CreditLot,
  ExpiringCredit,
  LedgerAllocation,
  LedgerTransaction
} from '../../domain/ledger/types';
import type { PolicyVersion } from '../../domain/policy/types';
import { getCategoryRule } from '../policy-engine/policyEngine';

export interface BalanceContext {
  today: ISODate;
  policy: PolicyVersion | null;
  employmentStart?: ISODate | null;
  academicYearStartMonth?: number;
  /** Horizon for "expiring soon" warnings. */
  expiringWithinDays?: number;
}

interface ReplayResult {
  lots: CreditLot[];
  usedByCategory: Record<string, number>;
}

/** A transaction is cancelled when another entry reverses it. */
export function reversedIds(transactions: LedgerTransaction[]): Set<string> {
  return new Set(
    transactions
      .filter((transaction) => transaction.reversalOf)
      .map((transaction) => transaction.reversalOf as string)
  );
}

export function activeTransactions(transactions: LedgerTransaction[]): LedgerTransaction[] {
  const reversed = reversedIds(transactions);
  return transactions.filter(
    (transaction) => !reversed.has(transaction.id) && transaction.source !== 'reversal'
  );
}

function creditValidityEnd(credit: LedgerTransaction): ISODate | null {
  return credit.expiryDate;
}

export function isCreditValidOn(credit: Pick<LedgerTransaction, 'expiryDate'>, date: ISODate): boolean {
  return credit.expiryDate === null || credit.expiryDate >= date;
}

function consumeLots(
  lots: CreditLot[],
  category: string,
  amount: number,
  onDate: ISODate
): number {
  let remaining = amount;
  const ordered = lots
    .filter(
      (lot) =>
        lot.category === category &&
        lot.remaining > 0 &&
        lot.effectiveDate <= onDate
    )
    .sort((a, b) => {
      const aExpiry = a.expiryDate ?? '9999-12-31';
      const bExpiry = b.expiryDate ?? '9999-12-31';
      if (aExpiry !== bExpiry) return aExpiry < bExpiry ? -1 : 1;
      if (a.effectiveDate !== b.effectiveDate) return a.effectiveDate < b.effectiveDate ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });

  for (const lot of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(lot.remaining, remaining);
    lot.remaining = roundDays(lot.remaining - take);
    remaining = roundDays(remaining - take);
  }
  return remaining;
}

function replay(transactions: LedgerTransaction[]): ReplayResult {
  const active = activeTransactions(transactions);
  const credits = active
    .filter((transaction) => transaction.direction === 'credit')
    .sort((a, b) => {
      if (a.effectiveDate !== b.effectiveDate) return a.effectiveDate < b.effectiveDate ? -1 : 1;
      return a.createdAt < b.createdAt ? -1 : 1;
    });

  const lots: CreditLot[] = credits.map((credit) => ({
    id: credit.id,
    category: credit.category,
    effectiveDate: credit.effectiveDate,
    expiryDate: creditValidityEnd(credit),
    amount: credit.amount,
    remaining: credit.amount,
    source: credit.source,
    reason: credit.reason,
    employmentId: credit.employmentId
  }));

  const debits = active
    .filter((transaction) => transaction.direction === 'debit')
    .sort((a, b) => {
      if (a.effectiveDate !== b.effectiveDate) return a.effectiveDate < b.effectiveDate ? -1 : 1;
      return a.createdAt < b.createdAt ? -1 : 1;
    });

  const usedByCategory: Record<string, number> = {};
  for (const debit of debits) {
    const shortfall = consumeLots(lots, debit.category, debit.amount, debit.effectiveDate);
    usedByCategory[debit.category] = roundDays(
      (usedByCategory[debit.category] ?? 0) + (debit.amount - shortfall)
    );
  }

  return { lots, usedByCategory };
}

export function creditLots(transactions: LedgerTransaction[], category?: string): CreditLot[] {
  const { lots } = replay(transactions);
  return category ? lots.filter((lot) => lot.category === category) : lots;
}

function periodForRule(
  category: string,
  context: BalanceContext
): { period: Period; kind: PeriodKind } {
  const rule = getCategoryRule(context.policy, category);
  const kind: PeriodKind = rule?.entitlement.period ?? 'calendar-year';
  const period = periodBounds(kind, context.today, {
    employmentStart: context.employmentStart ?? null,
    academicYearStartMonth: context.academicYearStartMonth
  });
  return { period, kind };
}

function expiryForRule(category: string, context: BalanceContext): number {
  const rule = getCategoryRule(context.policy, category);
  return rule?.expiry?.months ?? 0;
}

/**
 * Computes one category balance for the period containing `today`.
 * Credits outside the period are excluded unless carry-forward is enabled.
 */
export function computeCategoryBalance(
  category: string,
  transactions: LedgerTransaction[],
  context: BalanceContext
): CategoryBalance {
  const rule = getCategoryRule(context.policy, category);
  const carryForward = rule?.carryForward.allowed ?? false;
  const { period } = periodForRule(category, context);
  const notes: string[] = [];

  const { lots } = replay(transactions);
  const categoryLots = lots.filter((lot) => lot.category === category);
  const windowStart = carryForward ? '0000-01-01' : period.start;

  const relevantLots = categoryLots.filter(
    (lot) => lot.effectiveDate >= windowStart && lot.effectiveDate <= period.end
  );
  let credited = roundDays(
    relevantLots.reduce((sum, lot) => sum + lot.amount, 0)
  );

  const active = activeTransactions(transactions);
  const debits = active.filter(
    (transaction) =>
      transaction.direction === 'debit' &&
      transaction.category === category &&
      transaction.effectiveDate >= windowStart &&
      transaction.effectiveDate <= period.end &&
      transaction.approvalStatus !== 'rejected'
  );
  const used = roundDays(debits.reduce((sum, debit) => sum + debit.amount, 0));
  const pending = roundDays(
    debits
      .filter((debit) => debit.approvalStatus === 'pending')
      .reduce((sum, debit) => sum + debit.amount, 0)
  );

  const expiringWithinDays = context.expiringWithinDays ?? 30;
  const horizon = addDays(context.today, expiringWithinDays);
  const expiringSoon: ExpiringCredit[] = [];
  let expired = 0;

  for (const lot of categoryLots) {
    if (lot.expiryDate === null) continue;
    if (lot.expiryDate < context.today) {
      expired = roundDays(expired + lot.remaining);
    } else if (lot.expiryDate <= horizon && lot.remaining > 0) {
      expiringSoon.push({
        creditId: lot.id,
        category: lot.category,
        amount: lot.remaining,
        expiryDate: lot.expiryDate,
        reason: lot.reason
      });
    }
  }
  expiringSoon.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

  // Credits earned but already expired cannot support a balance.
  const validCredits = roundDays(
    categoryLots.reduce((sum, lot) => {
      const valid =
        (lot.expiryDate === null || lot.expiryDate >= context.today) &&
        lot.effectiveDate >= windowStart &&
        lot.effectiveDate <= period.end;
      return sum + (valid ? lot.remaining : 0);
    }, 0)
  );

  let available = roundDays(validCredits);
  if (
    rule &&
    rule.entitlement.creditTiming === 'none' &&
    rule.entitlement.usageCap !== null &&
    !rule.expiry
  ) {
    // Categories such as EL are not credited: the annual figure is a usage
    // limit. Availability is therefore cap − usage, not a credit balance.
    credited = rule.entitlement.usageCap;
    available = roundDays(rule.entitlement.usageCap - used);
    notes.push('Availability is derived from the annual usage cap, not from a credited balance.');
  }
  if (rule && rule.negativeBalanceAllowed) {
    // Categories such as LOP have no credits; the recorded usage is itself the
    // balance, so availability is deliberately negative.
    available = roundDays(-used);
    notes.push('Negative balances are allowed for this category; the shortfall is treated as loss of pay.');
  }
  if (rule && !rule.carryForward.allowed && (rule.entitlement.period !== 'calendar-year' || true)) {
    notes.push('Unused balance lapses at the end of the policy period.');
  }
  if (rule?.entitlement.creditTiming === 'none' && category !== 'CCL') {
    notes.push('This category has no credited balance; availability is derived from earned events.');
  }
  if (!rule) {
    notes.push('No policy rule exists for this category, so the balance cannot be interpreted.');
  }

  return {
    category,
    credited,
    used,
    pending,
    available,
    expired,
    expiringSoon,
    periodStart: period.start,
    periodEnd: period.end,
    periodLabel: period.label,
    indeterminate: Boolean(period.indeterminate || !rule),
    notes
  };
}

export function balanceCategories(
  transactions: LedgerTransaction[],
  policy: PolicyVersion | null
): string[] {
  const fromLedger = new Set(transactions.map((transaction) => transaction.category));
  const fromPolicy = new Set((policy?.categories ?? []).filter((category) => category.enabled).map((category) => category.code));
  return [...new Set([...fromPolicy, ...fromLedger])];
}

export function computeBalances(
  transactions: LedgerTransaction[],
  context: BalanceContext
): Record<string, CategoryBalance> {
  const result: Record<string, CategoryBalance> = {};
  for (const category of balanceCategories(transactions, context.policy)) {
    result[category] = computeCategoryBalance(category, transactions, context);
  }
  return result;
}

export interface AllocationPreview {
  allocations: LedgerAllocation[];
  available: number;
  shortfall: number;
  earliestExpiry: ISODate | null;
}

/**
 * Picks credits for a CCL usage, earliest expiry first. Only credits valid on
 * the leave date are eligible; an expiring credit can cover a leave that falls
 * before its expiry date.
 */
export function allocateCclCredits(
  transactions: LedgerTransaction[],
  amount: number,
  onDate: ISODate
): AllocationPreview {
  const { lots } = replay(transactions);
  const eligible = lots
    .filter(
      (lot) =>
        lot.category === 'CCL' &&
        lot.remaining > 0 &&
        lot.effectiveDate <= onDate &&
        isCreditValidOn(lot, onDate)
    )
    .sort((a, b) => {
      const aExpiry = a.expiryDate ?? '9999-12-31';
      const bExpiry = b.expiryDate ?? '9999-12-31';
      if (aExpiry !== bExpiry) return aExpiry < bExpiry ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });

  const allocations: LedgerAllocation[] = [];
  let remaining = amount;
  for (const lot of eligible) {
    if (remaining <= 0) break;
    const take = Math.min(lot.remaining, remaining);
    allocations.push({ creditId: lot.id, amount: roundDays(take) });
    remaining = roundDays(remaining - take);
  }
  return {
    allocations,
    available: roundDays(amount - remaining),
    shortfall: roundDays(Math.max(0, remaining)),
    earliestExpiry: allocations.length ? eligible.find((lot) => lot.id === allocations[0].creditId)?.expiryDate ?? null : null
  };
}

/** Builds an expiry date from the category rule's expiry configuration. */
export function expiryDateFor(
  policy: PolicyVersion | null,
  category: string,
  earnedOn: ISODate
): ISODate | null {
  const months = expiryForRule(category, {
    today: earnedOn,
    policy,
    employmentStart: null
  });
  if (!months || months <= 0) return null;
  const rule = getCategoryRule(policy, category);
  const boundary = rule?.expiry?.boundary ?? 'inclusive';
  const end = addMonths(earnedOn, months);
  // Three calendar months from 1 Jan is 1 Apr. For an inclusive boundary the
  // credit stays usable through that date; otherwise it stops the day before.
  return boundary === 'inclusive' ? end : addDays(end, -1);
}

export interface CreateCreditInput {
  id: string;
  profileId: string;
  employmentId: string;
  category: string;
  amount: number;
  effectiveDate: ISODate;
  source: LedgerTransaction['source'];
  reason: string;
  notes?: string;
  now: string;
  expiryDate?: ISODate | null;
  approvalStatus?: LedgerTransaction['approvalStatus'];
  relatedTransactionId?: string | null;
}

export function createCredit(input: CreateCreditInput): LedgerTransaction {
  return {
    id: input.id,
    profileId: input.profileId,
    employmentId: input.employmentId,
    category: input.category,
    direction: 'credit',
    amount: roundDays(input.amount),
    unit: 'days',
    effectiveDate: input.effectiveDate,
    transactionDate: input.now,
    source: input.source,
    reason: input.reason,
    notes: input.notes ?? '',
    approvalStatus: input.approvalStatus ?? 'approved',
    expiryDate: input.expiryDate ?? null,
    relatedTransactionId: input.relatedTransactionId ?? null,
    leaveRequestId: null,
    reversalOf: null,
    allocations: null,
    createdAt: input.now,
    updatedAt: input.now
  };
}

export interface CreateDebitInput {
  id: string;
  profileId: string;
  employmentId: string;
  category: string;
  amount: number;
  effectiveDate: ISODate;
  source: LedgerTransaction['source'];
  reason: string;
  notes?: string;
  now: string;
  leaveRequestId?: string | null;
  relatedTransactionId?: string | null;
  approvalStatus?: LedgerTransaction['approvalStatus'];
  allocations?: LedgerAllocation[] | null;
  expiryDate?: ISODate | null;
}

export function createDebit(input: CreateDebitInput): LedgerTransaction {
  return {
    id: input.id,
    profileId: input.profileId,
    employmentId: input.employmentId,
    category: input.category,
    direction: 'debit',
    amount: roundDays(input.amount),
    unit: 'days',
    effectiveDate: input.effectiveDate,
    transactionDate: input.now,
    source: input.source,
    reason: input.reason,
    notes: input.notes ?? '',
    approvalStatus: input.approvalStatus ?? 'approved',
    expiryDate: input.expiryDate ?? null,
    relatedTransactionId: input.relatedTransactionId ?? null,
    leaveRequestId: input.leaveRequestId ?? null,
    reversalOf: null,
    allocations: input.allocations ?? null,
    createdAt: input.now,
    updatedAt: input.now
  };
}

/** Reversal entries are the only permitted correction mechanism. */
export function createReversal(
  original: LedgerTransaction,
  options: { id: string; now: string; reason: string }
): LedgerTransaction {
  return {
    ...original,
    id: options.id,
    direction: original.direction === 'credit' ? 'debit' : 'credit',
    source: 'reversal',
    reason: options.reason,
    notes: `Reversal of ${original.id}`,
    transactionDate: options.now,
    createdAt: options.now,
    updatedAt: options.now,
    relatedTransactionId: original.id,
    reversalOf: original.id,
    allocations: null,
    expiryDate: null,
    approvalStatus: 'approved'
  };
}

export interface LineageEntry {
  transaction: LedgerTransaction;
  reversed: boolean;
  reversal: LedgerTransaction | null;
}

/** Newest-first ledger view with reversal lineage attached. */
export function ledgerWithLineage(transactions: LedgerTransaction[]): LineageEntry[] {
  const reversals = new Map<string, LedgerTransaction>();
  for (const transaction of transactions) {
    if (transaction.reversalOf) reversals.set(transaction.reversalOf, transaction);
  }
  return transactions
    .filter((transaction) => !transaction.reversalOf)
    .map((transaction) => ({
      transaction,
      reversed: reversals.has(transaction.id),
      reversal: reversals.get(transaction.id) ?? null
    }))
    .sort((a, b) => {
      if (a.transaction.effectiveDate !== b.transaction.effectiveDate) {
        return a.transaction.effectiveDate < b.transaction.effectiveDate ? 1 : -1;
      }
      return a.transaction.createdAt < b.transaction.createdAt ? 1 : -1;
    });
}

/** Sum of available CCL valid on a date, used by leave validation and the planner. */
export function cclAvailableOn(
  transactions: LedgerTransaction[],
  date: ISODate,
  employmentId?: string
): number {
  const lots = creditLots(transactions, 'CCL').filter(
    (lot) => isCreditValidOn(lot, date) && (!employmentId || lot.employmentId === employmentId)
  );
  return roundDays(lots.reduce((sum, lot) => sum + lot.remaining, 0));
}

export function expiredCredits(
  transactions: LedgerTransaction[],
  today: ISODate = todayLocal()
): CreditLot[] {
  return creditLots(transactions).filter(
    (lot) => lot.remaining > 0 && lot.expiryDate !== null && lot.expiryDate < today
  );
}
