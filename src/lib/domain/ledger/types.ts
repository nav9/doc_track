import type { ApprovalState, AuditFields, ISODate, ISODateTime } from '../common/types';

export type LedgerDirection = 'credit' | 'debit';

export type LedgerSource =
  | 'entitlement'
  | 'usage'
  | 'duty-ccl'
  | 'pdo-conversion'
  | 'adjustment'
  | 'reversal'
  | 'expiry'
  | 'cancellation'
  | 'lop'
  | 'import';

export interface LedgerAllocation {
  creditId: string;
  amount: number;
}

/**
 * A single immutable ledger entry. Balances are always derived from these
 * entries; nothing mutates a stored balance directly.
 *
 * Corrections are made with a compensating reversal that references the
 * original entry, never by deleting history.
 */
export interface LedgerTransaction extends AuditFields {
  id: string;
  profileId: string;
  employmentId: string;
  category: string;
  direction: LedgerDirection;
  amount: number;
  unit: 'days';
  /** Date the credit/debit applies to (usually the leave date). */
  effectiveDate: ISODate;
  /** When the entry was recorded. */
  transactionDate: ISODateTime;
  source: LedgerSource;
  reason: string;
  notes: string;
  approvalStatus: ApprovalState;
  /** Credit validity end date; null means it does not expire. */
  expiryDate: ISODate | null;
  /** Reversal target, leave request or source duty. */
  relatedTransactionId: string | null;
  leaveRequestId: string | null;
  reversalOf: string | null;
  /** Which CCL credits a debit consumes, earliest expiry first. */
  allocations: LedgerAllocation[] | null;
}

export interface CreditLot {
  id: string;
  category: string;
  effectiveDate: ISODate;
  expiryDate: ISODate | null;
  amount: number;
  remaining: number;
  source: LedgerSource;
  reason: string;
  employmentId: string;
}

export interface ExpiringCredit {
  creditId: string;
  category: string;
  amount: number;
  expiryDate: ISODate;
  reason: string;
}

export interface CategoryBalance {
  category: string;
  credited: number;
  used: number;
  pending: number;
  /** Approval-rejected entries do not consume balance. */
  available: number;
  expired: number;
  expiringSoon: ExpiringCredit[];
  periodStart: ISODate;
  periodEnd: ISODate;
  periodLabel: string;
  indeterminate: boolean;
  notes: string[];
}

export function signedAmount(transaction: LedgerTransaction): number {
  return transaction.direction === 'credit' ? transaction.amount : -transaction.amount;
}

export function isReversal(transaction: Pick<LedgerTransaction, 'source' | 'reversalOf'>): boolean {
  return transaction.source === 'reversal' || Boolean(transaction.reversalOf);
}
