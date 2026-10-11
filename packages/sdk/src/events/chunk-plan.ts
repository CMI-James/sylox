/**
 * Ported verbatim (pure, synchronous, framework-free already) from
 * web/app/lib/chunk-plan.ts. Plans the backward-walking, half-open
 * ledger ranges a chunked getEvents scan requests, newest-first.
 *
 * Every range is `[start, end)`: start inclusive, end exclusive -
 * confirmed empirically that getEvents' own endLedger is exclusive.
 * Two adjacent planned ranges always share their boundary exactly (one's
 * `start` equals the next one's `end`), so there is never a gap or an
 * overlap between them by construction.
 *
 * A fixed chunk size, not a growing one: a single getEvents call only
 * ever advances its cursor by about CHUNK_LEDGERS_PER_REQUEST ledgers
 * REGARDLESS of how wide a range is requested (measured directly
 * against the real RPC) - fixed-size chunks that match the RPC's own
 * real per-request scan distance is both simpler and just as fast as a
 * growing chunk size.
 */
export interface LedgerRange {
  /** Inclusive. */
  start: number;
  /** Exclusive. */
  end: number;
}

/**
 * @param latestLedger The newest ledger to start scanning from (inclusive of this ledger - the first range's `end` is `latestLedger + 1`).
 * @param floor The oldest ledger willing to be scanned (inclusive) - callers pass a safety margin above the RPC's own retention floor here, not the floor itself.
 * @param chunkSize Ledgers per range, at most.
 * @returns Ranges newest-first, covering exactly `[floor, latestLedger]` with no gap or overlap, stopping the moment it reaches `floor`. Empty if `latestLedger < floor`.
 */
export function planChunks(latestLedger: number, floor: number, chunkSize: number): LedgerRange[] {
  if (chunkSize <= 0) throw new Error(`chunkSize must be positive, got ${chunkSize}`);
  if (latestLedger < floor) return [];

  const ranges: LedgerRange[] = [];
  let end = latestLedger + 1;
  while (end > floor) {
    const start = Math.max(floor, end - chunkSize);
    ranges.push({ start, end });
    end = start;
  }
  return ranges;
}
