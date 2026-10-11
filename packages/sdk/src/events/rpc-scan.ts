import { rpc, xdr } from "@stellar/stellar-sdk";
import { planChunks } from "./chunk-plan.js";
import type { CacheAdapter } from "./cache-adapter.js";
import { noopCacheAdapter } from "./cache-adapter.js";

/**
 * Ported from web/app/lib/stellar-rpc-events.ts. RPC getEvents
 * pagination, found by testing directly against this protocol's
 * testnet contracts:
 *
 * A single getEvents call only advances its cursor by roughly
 * CHUNK_LEDGERS_PER_REQUEST ledgers, REGARDLESS of how wide a range
 * was requested or whether endLedger bounds it tighter - it does not
 * error when it stops short, it just returns whatever it found (zero,
 * for a quiet slice) together with a cursor pointing just past where
 * it stopped.
 *
 * Because getEvents only pages FORWARD (oldest cursor -> newest), and
 * the list this feeds needs newest-first, this walks whole CHUNK_SIZE-
 * ledger ranges backward from latestLedger toward the retention floor
 * (endLedger bounds each chunk precisely - confirmed EXCLUSIVE against
 * the real RPC), until either `limit` events are collected or the
 * floor is reached.
 *
 * INCREMENTAL CACHING is the actual efficiency win, not chunk size:
 * events in already-scanned ledgers never change, so a second call for
 * the same (contract, topics) only scans from the newest ledger already
 * covered up to the new latestLedger - normally 1 request - instead of
 * repeating the whole backward walk. Cached in memory for the lifetime
 * of the `EventsScanner` instance, optionally mirrored through an
 * injected `CacheAdapter` (see cache-adapter.ts's own doc comment for
 * why this SDK can't hardcode sessionStorage the way the source file
 * did) so a longer-lived host (e.g. a browser tab) doesn't pay a cold
 * scan again either.
 *
 * STOPGAP: EventRegistry doesn't yet expose a direct read listing every
 * event it has ever stored. Everything here stays behind one
 * EventsScanner class for exactly that reason - swapping the source
 * later is meant to be a one-class change.
 */

export interface EventRecordRaw {
  ledger: number;
  ledgerClosedAt: string;
  topic: unknown[];
  value: unknown;
  id: string;
}

export interface PaginatedEventsResult {
  /** Newest-first, deduped by event id, capped at the query's limit. */
  events: EventRecordRaw[];
  /** The oldest ledger actually scanned before stopping - use this (never getHealth's claimed oldestLedger) for an honest "events in the last N days/hours" label, since it's what was genuinely searched. */
  oldestLedgerScanned: number;
  latestLedger: number;
  latestLedgerCloseTime: number;
  requestCount: number;
  /** True if the scan stopped before reaching the floor it was asked to cover. The result is still correct (newest-first, no gaps up to oldestLedgerScanned), just possibly short of real history further back. */
  stoppedAtRequestCap: boolean;
}

export interface EventQuery {
  contractId: string;
  /** Base64 XDR topic filter segments, e.g. [symbolTopic("sylox"), symbolTopic("event_proposed"), "*"]. */
  topics: string[];
  /** Stop once this many events have been collected, even if the floor hasn't been reached. */
  limit: number;
}

// Measured RPC scan limit per request, not documented - a single
// getEvents call's cursor advances by roughly this many ledgers
// regardless of the requested range's own size. If this ever drifts,
// chunks just take more or fewer internal pages to cover (fetchChunk
// still cursor-follows to completion either way).
const CHUNK_SIZE = 10_000;

const FLOOR_MARGIN = 100; // Headroom above the RPC's own retention floor, so real-time drift during the scan never reaches it in practice.
const REQUEST_CAP = 20; // Hard backstop on the whole scan (counts every request, including the one retry and any internal per-chunk paging).

export interface FetchEventsOptions {
  /** Called after every chunk lands during a cold (or partially cold) scan, with the events found SO FAR (newest-first). Never called for a fully-cached, already-warm result. */
  onProgress?: (eventsSoFar: EventRecordRaw[]) => void;
}

interface CachedState {
  /** Newest-first, deduped. */
  events: EventRecordRaw[];
  /** The oldest ledger this cache's own scan(s) have ever covered down to. */
  oldestLedgerScanned: number;
  /** The newest ledger already covered - a refresh only needs to scan forward from here. */
  latestLedgerCovered: number;
  latestLedgerCloseTime: number;
  stoppedAtRequestCap: boolean;
}

interface SerializedEventRecord {
  ledger: number;
  ledgerClosedAt: string;
  topic: string[]; // base64 XDR, one per topic segment.
  value: string; // base64 XDR.
  id: string;
}

interface SerializedCachedState {
  events: SerializedEventRecord[];
  oldestLedgerScanned: number;
  latestLedgerCovered: number;
  latestLedgerCloseTime: number;
  stoppedAtRequestCap: boolean;
}

function toScVal(value: unknown): xdr.ScVal {
  if (xdr.ScVal.is(value)) return value;
  throw new Error("expected an xdr.ScVal");
}

function serializeEvent(raw: EventRecordRaw): SerializedEventRecord {
  return {
    ledger: raw.ledger,
    ledgerClosedAt: raw.ledgerClosedAt,
    topic: (raw.topic as unknown[]).map((t) => toScVal(t).toXDR("base64")),
    value: toScVal(raw.value).toXDR("base64"),
    id: raw.id,
  };
}

function deserializeEvent(serialized: SerializedEventRecord): EventRecordRaw {
  return {
    ledger: serialized.ledger,
    ledgerClosedAt: serialized.ledgerClosedAt,
    topic: serialized.topic.map((t) => xdr.ScVal.fromXDR(t, "base64")),
    value: xdr.ScVal.fromXDR(serialized.value, "base64"),
    id: serialized.id,
  };
}

function serializeCachedState(state: CachedState): SerializedCachedState {
  return { ...state, events: state.events.map(serializeEvent) };
}

/** Rebuilds every cached event's ScVals from their base64 XDR strings. Throws (never returns a partially-rebuilt state) if any entry won't rebuild - the caller treats that as "no usable cache" and rescans. */
function deserializeCachedState(serialized: SerializedCachedState): CachedState {
  return { ...serialized, events: serialized.events.map(deserializeEvent) };
}

export class EventsScanner {
  private readonly server: rpc.Server;
  private readonly memoryCache = new Map<string, CachedState>();
  private readonly cacheAdapter: CacheAdapter;
  private readonly cacheNamespace: string;

  constructor(rpcUrl: string, cacheNamespace: string, cacheAdapter: CacheAdapter = noopCacheAdapter) {
    this.server = new rpc.Server(rpcUrl);
    this.cacheNamespace = cacheNamespace;
    this.cacheAdapter = cacheAdapter;
  }

  private cacheKey(query: EventQuery): string {
    // Network + contract + topics: a testnet redeploy (new contract
    // addresses) can never accidentally serve a stale cache entry for
    // an address that no longer means the same thing.
    return `sylox-events:v2:${this.cacheNamespace}:${query.contractId}:${query.topics.join(",")}`;
  }

  private async readCacheAdapter(key: string): Promise<CachedState | null> {
    try {
      const raw = await this.cacheAdapter.get(key);
      if (!raw) return null;
      const serialized = JSON.parse(raw) as SerializedCachedState;
      return deserializeCachedState(serialized);
    } catch {
      // Covers a missing/malformed entry AND one that parses as JSON
      // but whose events won't rebuild into real ScVals - either way,
      // fail safe: drop the cache and let the caller rescan.
      return null;
    }
  }

  private async writeCacheAdapter(key: string, state: CachedState): Promise<void> {
    try {
      await this.cacheAdapter.set(key, JSON.stringify(serializeCachedState(state)));
    } catch {
      // Falls back to memory-only - an adapter write failure is never a reason to fail the actual fetch.
    }
  }

  private async loadCached(key: string): Promise<CachedState | null> {
    const inMemory = this.memoryCache.get(key);
    if (inMemory) return inMemory;
    const fromAdapter = await this.readCacheAdapter(key);
    if (fromAdapter) this.memoryCache.set(key, fromAdapter);
    return fromAdapter;
  }

  private async saveCached(key: string, state: CachedState): Promise<void> {
    this.memoryCache.set(key, state);
    await this.writeCacheAdapter(key, state);
  }

  private buildFilters(query: EventQuery) {
    return [{ contractIds: [query.contractId], topics: [query.topics] }];
  }

  /** One request. Returns null (never throws) on the specific "startLedger out of range" error, so the caller can apply its own bounded-retry policy instead of this function retrying on its own. */
  private async tryGetEvents(
    query: EventQuery,
    range: { start: number; end: number },
  ): Promise<Awaited<ReturnType<rpc.Server["getEvents"]>> | null> {
    try {
      return await this.server.getEvents({
        startLedger: range.start,
        endLedger: range.end, // Exclusive - confirmed against the real RPC.
        filters: this.buildFilters(query),
        limit: 200,
      });
    } catch (e) {
      const message = e && typeof e === "object" && "message" in e ? String(e.message) : "";
      if (/startLedger must be within the ledger range/i.test(message)) return null;
      throw e;
    }
  }

  /** One chunk `[start, end)`, paged forward internally if the chunk itself needs more than one request. */
  private async fetchChunk(
    query: EventQuery,
    range: { start: number; end: number },
  ): Promise<{ events: EventRecordRaw[]; latestLedgerCloseTimeSecs: number; requestCount: number } | null> {
    const events: EventRecordRaw[] = [];
    let cursor: string | undefined;
    let latestLedgerCloseTimeSecs = 0;
    let requestCount = 0;

    for (let page = 0; page < 5; page++) {
      requestCount++;
      let response;
      if (cursor) {
        response = await this.server.getEvents({ cursor, filters: this.buildFilters(query), limit: 200 });
      } else {
        response = await this.tryGetEvents(query, range);
        if (response === null) return null; // Out of range - caller applies the one bounded retry.
      }

      events.push(...(response.events as unknown as EventRecordRaw[]));
      latestLedgerCloseTimeSecs = Number(response.latestLedgerCloseTime);
      cursor = response.cursor;
      const reached = Number(BigInt(cursor.split("-")[0]) >> BigInt(32));
      if (reached >= range.end - 1) break;
    }

    return { events, latestLedgerCloseTimeSecs, requestCount };
  }

  /** Scans `[floor, latestLedger]` backward in fixed chunks, newest-first, stopping at `query.limit` events, the floor, or REQUEST_CAP. */
  private async scanBackward(
    query: EventQuery,
    latestLedger: number,
    floor: number,
    onChunk?: (eventsSoFar: EventRecordRaw[]) => void,
  ): Promise<{
    events: EventRecordRaw[];
    oldestLedgerScanned: number;
    latestLedgerCloseTime: number;
    requestCount: number;
    stoppedAtRequestCap: boolean;
  }> {
    const ranges = planChunks(latestLedger, floor, CHUNK_SIZE);

    const collected: EventRecordRaw[] = [];
    const seenIds = new Set<string>();
    let latestLedgerCloseTime = 0;
    let requestCount = 0;
    let retryUsed = false;
    let oldestLedgerScanned = latestLedger;
    let stoppedAtRequestCap = false;

    for (let i = 0; i < ranges.length; i++) {
      if (requestCount >= REQUEST_CAP) {
        stoppedAtRequestCap = true;
        break;
      }

      let chunk = await this.fetchChunk(query, ranges[i]);
      requestCount += chunk === null ? 1 : chunk.requestCount;

      if (chunk === null) {
        if (retryUsed || requestCount >= REQUEST_CAP) break;
        retryUsed = true;
        const freshHealth = await this.server.getHealth();
        requestCount++;
        const freshFloor = freshHealth.oldestLedger + FLOOR_MARGIN;
        const retryStart = Math.max(freshFloor, ranges[i].start);
        if (retryStart >= ranges[i].end) break;
        chunk = await this.fetchChunk(query, { start: retryStart, end: ranges[i].end });
        requestCount += chunk === null ? 1 : chunk.requestCount;
        if (chunk === null) break;
      }

      if (i === 0) latestLedgerCloseTime = chunk.latestLedgerCloseTimeSecs;
      oldestLedgerScanned = ranges[i].start;

      for (const event of chunk.events) {
        if (seenIds.has(event.id)) continue;
        seenIds.add(event.id);
        collected.push(event);
      }

      if (onChunk) {
        const sortedSoFar = [...collected].sort((a, b) => b.ledger - a.ledger);
        onChunk(sortedSoFar);
      }

      if (collected.length >= query.limit) break;
    }

    collected.sort((a, b) => b.ledger - a.ledger);
    return { events: collected, oldestLedgerScanned, latestLedgerCloseTime, requestCount, stoppedAtRequestCap };
  }

  /**
   * Cached, incrementally-extended, backward-chunked getEvents scan.
   */
  async fetchEventsPaginated(
    query: EventQuery,
    options: FetchEventsOptions = {},
  ): Promise<PaginatedEventsResult> {
    const key = this.cacheKey(query);
    const cached = await this.loadCached(key);

    const health = await this.server.getHealth();
    const floor = health.oldestLedger + FLOOR_MARGIN;

    if (cached && cached.latestLedgerCovered >= health.latestLedger) {
      const stillFresh = cached.events.filter((e) => e.ledger >= floor);
      return {
        events: stillFresh.slice(0, query.limit),
        oldestLedgerScanned: Math.max(cached.oldestLedgerScanned, floor),
        latestLedger: health.latestLedger,
        latestLedgerCloseTime: cached.latestLedgerCloseTime,
        requestCount: 1,
        stoppedAtRequestCap: cached.stoppedAtRequestCap,
      };
    }

    let requestCount = 1;
    let events: EventRecordRaw[];
    let oldestLedgerScanned: number;
    let latestLedgerCloseTime: number;
    let stoppedAtRequestCap: boolean;

    if (cached && cached.latestLedgerCovered >= floor) {
      const incrementalFloor = cached.latestLedgerCovered + 1;
      const incremental = await this.scanBackward(query, health.latestLedger, incrementalFloor, options.onProgress);
      requestCount += incremental.requestCount;

      if (incremental.oldestLedgerScanned > incrementalFloor) {
        events = incremental.events;
        oldestLedgerScanned = incremental.oldestLedgerScanned;
        latestLedgerCloseTime = incremental.latestLedgerCloseTime;
        stoppedAtRequestCap = true;
      } else {
        const seen = new Set(incremental.events.map((e) => e.id));
        const merged = [
          ...incremental.events,
          ...cached.events.filter((e) => !seen.has(e.id) && e.ledger >= floor),
        ];
        merged.sort((a, b) => b.ledger - a.ledger);

        events = merged;
        oldestLedgerScanned = Math.min(cached.oldestLedgerScanned, incremental.oldestLedgerScanned);
        latestLedgerCloseTime = incremental.latestLedgerCloseTime || cached.latestLedgerCloseTime;
        stoppedAtRequestCap = incremental.stoppedAtRequestCap || cached.stoppedAtRequestCap;
      }
    } else {
      const cold = await this.scanBackward(query, health.latestLedger, floor, options.onProgress);
      requestCount += cold.requestCount;

      events = cold.events;
      oldestLedgerScanned = cold.oldestLedgerScanned;
      latestLedgerCloseTime = cold.latestLedgerCloseTime;
      stoppedAtRequestCap = cold.stoppedAtRequestCap;
    }

    await this.saveCached(key, {
      events,
      oldestLedgerScanned,
      latestLedgerCovered: health.latestLedger,
      latestLedgerCloseTime,
      stoppedAtRequestCap,
    });

    return {
      events: events.slice(0, query.limit),
      oldestLedgerScanned,
      latestLedger: health.latestLedger,
      latestLedgerCloseTime,
      requestCount,
      stoppedAtRequestCap,
    };
  }
}
