import { Sylox, Networks } from "@sylox/sdk";
import { sessionStorageCacheAdapter } from "./sylox-cache-adapter";

/**
 * The app's one shared `Sylox` instance, built once at module scope -
 * not reconstructed per call. Two different construction-cost
 * assumptions are both at play here, and this follows whichever one
 * actually matters for each half of the instance:
 *
 * - `al.oracle`/`al.events`'s own reads (`score`, `ring`, `event`,
 *   `coverGate`, ...) are exactly as cheap to reconstruct as the old
 *   `riskOracleClient()`/`eventRegistryClient()` were (a plain
 *   generated-bindings `Client`, built fresh per call, per their own
 *   implementation) - a shared instance changes nothing about their
 *   cost, so there's no new caching concern introduced for them.
 * - `al.events.list()`'s RPC event-log scan is genuinely NOT
 *   cheap to redo (`EventsScanner`'s own in-memory + sessionStorage
 *   cache, ported from `lib/stellar-rpc-events.ts`'s own
 *   module-level `memoryCache`/sessionStorage mirror) - that cache
 *   only helps across calls if the same `Events`/`EventsScanner`
 *   instance (and therefore this same `Sylox`) is reused, exactly
 *   like the old module-level scan cache was implicitly shared by
 *   every caller in the same page session.
 *
 * No signer is passed here - this instance is read-only. Every write
 * (propose_tier1/challenge/finalize/checkpoint_cure) goes through the
 * standalone `prepare*`/`confirm*` functions imported directly from
 * `@sylox/sdk`, each given the connected wallet's own signer
 * explicitly (see components/WriteActionButton.tsx and
 * app/event/[id]/EventPageClient.tsx) - never this shared instance's
 * `al.events.proposeTier1()`-style bundled-signer convenience methods,
 * since event-actions' own prepare/confirm UI flow needs the explicit
 * two-step control those standalone functions give it.
 */
export const al = new Sylox({
  network: Networks.Testnet,
  cacheAdapter: sessionStorageCacheAdapter,
});
