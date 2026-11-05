import type { EvaluationReason } from '../../engines/leave-validation/leaveValidation';

export class ServiceError extends Error {
  readonly code: string;
  readonly reasons: EvaluationReason[];

  constructor(code: string, message: string, reasons: EvaluationReason[] = []) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.reasons = reasons;
  }
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'An unexpected error occurred.';
}
