/**
 * Storage goes through an interface (brief: "the event-scan cache
 * takes an optional cache adapter (get/set strings)"). The source file
 * this is adapted from, web/app/lib/stellar-rpc-events.ts, hardcodes
 * `sessionStorage` directly (its own `readSessionStorage`/
 * `writeSessionStorage`, lines 339-362) - this SDK has no DOM/browser
 * API available at import time (framework-free, runs in plain Node
 * too), so that's replaced here with this injectable adapter. A later
 * PR (not this one) is expected to have the web app supply its own
 * sessionStorage-backed adapter implementing this same interface - kept
 * deliberately minimal (two methods, plain strings in and out) so that
 * plugs in with no changes needed here.
 */
export interface CacheAdapter {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
}

/**
 * The default when no adapter is given: a no-op that never actually
 * persists anything. Plain Node usage (no storage at all) still works
 * correctly with this - every call is just treated as a cache miss,
 * which only costs a cold RPC scan, never an incorrect result. Cross-
 * process persistence is explicitly NOT required (per the brief);
 * within-instance in-memory caching is handled separately by
 * EventsClient itself (a plain Map), not by this adapter - this
 * adapter's job is only the OPTIONAL extra persistence layer on top
 * (e.g. a browser's sessionStorage), matching the source file's own
 * two-tier memoryCache-then-sessionStorage structure.
 */
export const noopCacheAdapter: CacheAdapter = {
  get: () => null,
  set: () => {},
};
