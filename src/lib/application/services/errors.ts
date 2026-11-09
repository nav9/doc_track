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

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item) => {
      if (item instanceof Error) {
        return { name: item.name, message: item.message, stack: item.stack };
      }
      if (typeof item === 'bigint') return item.toString();
      return item;
    });
  } catch {
    return String(value);
  }
}

/** Human-readable message with the underlying value preserved for diagnostics. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const value = error as { message?: unknown; name?: unknown };
    if (typeof value.message === 'string' && value.message.trim()) return value.message;
    return safeJson(error);
  }
  if (error === undefined) return 'An unexpected error occurred (undefined).';
  return String(error);
}

/** Detailed context stored in Activity logs and shown with blocking errors. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return safeJson({
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause
    });
  }
  return safeJson(error);
}
