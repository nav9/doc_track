/**
 * Deep clone for domain records.
 *
 * Svelte 5 `$state` values are Proxies, and `structuredClone` throws a
 * DataCloneError when it meets one. Domain records contain only JSON-safe data
 * (ISO date strings, numbers, booleans, nulls and arrays), so JSON serialization
 * gives an independent plain copy that IndexedDB and `structuredClone` can use.
 *
 * Components should normally use `$state.snapshot` at their own boundary; this
 * helper protects application services that may also be called with a proxy.
 */
export function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
