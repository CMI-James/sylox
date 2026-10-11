import type { CacheAdapter } from "@sylox/sdk";

/**
 * The web app's own implementation of `@sylox/sdk`'s `CacheAdapter`
 * (`packages/sdk/src/events/cache-adapter.ts`): `get`/`set` over plain
 * strings, nothing XDR-shaped - all of that serialization now lives
 * inside the SDK's own `EventsScanner`. This adapter's only job is the
 * same fail-safe sessionStorage wrapping the old
 * `lib/stellar-rpc-events.ts` did itself (`readSessionStorage`/
 * `writeSessionStorage`): a missing, unavailable, or full
 * sessionStorage is never a hard failure, just a cache miss/no-op, so
 * the event scan still works (just without persistence) in an
 * environment (SSR, a locked-down browser) where sessionStorage isn't
 * usable.
 */
export const sessionStorageCacheAdapter: CacheAdapter = {
  get(key: string): string | null {
    try {
      if (typeof sessionStorage === "undefined") return null;
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      if (typeof sessionStorage === "undefined") return;
      sessionStorage.setItem(key, value);
    } catch {
      // Falls back to the SDK's own in-memory-only caching for this
      // session - a full/unavailable sessionStorage is never a reason
      // to fail the actual fetch.
    }
  },
};
