/** Stable identifier helpers. */

let counter = 0;

/**
 * Creates an identifier. Uses `crypto.randomUUID` when available and falls back
 * to a counter + timestamp so the application still works in older WebViews.
 */
export function newId(prefix: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${(counter += 1).toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
  return `${prefix}_${random}`;
}

/** Deterministic identifier, used for idempotent entitlement credits. */
export function stableId(...parts: (string | number)[]): string {
  return parts
    .map((part) => String(part).trim().replace(/\s+/g, '-').toLowerCase())
    .join(':');
}
