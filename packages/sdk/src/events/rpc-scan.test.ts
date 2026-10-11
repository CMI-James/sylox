import { describe, expect, it, vi, beforeEach } from "vitest";
import { nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import type { CacheAdapter } from "./cache-adapter.js";

/**
 * Ported from web/app/lib/stellar-rpc-events.test.ts, ADAPTED for this
 * SDK's class-based `EventsScanner` (instantiated per test, taking an
 * injected `CacheAdapter`) in place of the source file's module-level
 * singleton + hardcoded `sessionStorage`. Every test that exercised
 * "persists across a reload via sessionStorage" below is rewritten
 * against a fresh `EventsScanner` instance backed by a fake, in-memory
 * `CacheAdapter` instead - the same real behavior (does the cache
 * survive the module/instance being torn down and recreated?), just
 * driven through the injected interface this SDK actually exposes
 * rather than a global `sessionStorage` this package never touches.
 */

/**
 * A fake RPC whose retention floor moves forward a few ledgers on
 * every getHealth() call - exactly the real-time drift FLOOR_MARGIN
 * exists to stay clear of. Also lets a test simulate the rare case
 * where a chunk's request still lands out of range despite the
 * margin, to exercise the one bounded retry, and lets `latestLedger`
 * be advanced mid-test to simulate new ledgers closing between two
 * calls (for the incremental-refresh tests).
 */
function makeFakeServer(opts: {
  latestLedger: number;
  initialOldestLedger: number;
  driftPerHealthCall: number;
  /** Ledgers, keyed by ledger number, that have a fake event. */
  eventLedgers: number[];
  /** If true, the FIRST getEvents call for each distinct range fails with the out-of-range error (simulating drift catching a chunk mid-flight), succeeding only on retry. */
  failFirstAttempt?: boolean;
}) {
  let oldestLedger = opts.initialOldestLedger;
  let latestLedger = opts.latestLedger;
  let healthCallCount = 0;
  let getEventsCallCount = 0;
  const failedOnce = new Set<string>();

  return {
    getHealth: vi.fn(async () => {
      healthCallCount++;
      const result = {
        status: "healthy" as const,
        latestLedger,
        oldestLedger,
        ledgerRetentionWindow: latestLedger - oldestLedger,
      };
      oldestLedger += opts.driftPerHealthCall;
      return result;
    }),
    getEvents: vi.fn(async (request: { startLedger?: number; endLedger?: number; cursor?: string }) => {
      getEventsCallCount++;
      if (request.cursor) {
        throw new Error("unexpected cursor-based follow-up request in this fake");
      }

      const { startLedger, endLedger } = request;
      if (startLedger === undefined || endLedger === undefined) {
        throw new Error("fake server expects startLedger/endLedger");
      }

      const rangeKey = `${startLedger}-${endLedger}`;
      if (opts.failFirstAttempt && !failedOnce.has(rangeKey)) {
        failedOnce.add(rangeKey);
        throw { code: -32600, message: `startLedger must be within the ledger range: ${oldestLedger} - ${latestLedger}` };
      }
      if (startLedger < oldestLedger) {
        throw { code: -32600, message: `startLedger must be within the ledger range: ${oldestLedger} - ${latestLedger}` };
      }

      const matching = opts.eventLedgers.filter((l) => l >= startLedger && l < endLedger);
      const events = matching.map((ledger) => ({
        ledger,
        ledgerClosedAt: new Date(ledger * 1000).toISOString(),
        topic: [nativeToScVal("sylox", { type: "symbol" }), nativeToScVal("event_proposed", { type: "symbol" })],
        value: nativeToScVal(ledger, { type: "u64" }),
        id: `event-${ledger}`,
      }));

      const cursorLedger = endLedger - 1;
      return {
        events,
        cursor: `${BigInt(cursorLedger) << BigInt(32)}-4294967295`,
        latestLedger,
        oldestLedger,
        latestLedgerCloseTime: String(latestLedger * 5),
        oldestLedgerCloseTime: String(oldestLedger * 5),
      };
    }),
    advanceLatestLedger(by: number) {
      latestLedger += by;
    },
    addEventLedger(ledger: number) {
      opts.eventLedgers.push(ledger);
    },
    get callCounts() {
      return { healthCallCount, getEventsCallCount };
    },
  };
}

const { fakeServerInstance, ServerMock } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the fake's real shape is defined below makeFakeServer, which this hoisted block runs before (vi.hoisted semantics).
  const state: { instance: any } = { instance: null };
  class FakeServerConstructor {
    constructor() {
      return state.instance;
    }
  }
  return { fakeServerInstance: state, ServerMock: FakeServerConstructor };
});

vi.mock("@stellar/stellar-sdk", async () => {
  const actual = await vi.importActual<typeof import("@stellar/stellar-sdk")>("@stellar/stellar-sdk");
  return { ...actual, rpc: { ...actual.rpc, Server: ServerMock } };
});

/** A fake, in-memory CacheAdapter - stands in for a real persistence layer (e.g. a browser's sessionStorage) to exercise "survives a fresh EventsScanner instance" without any actual browser API. */
function makeFakeStore(): { adapter: CacheAdapter; backingStore: Map<string, string> } {
  const backingStore = new Map<string, string>();
  return {
    backingStore,
    adapter: {
      get: (key) => backingStore.get(key) ?? null,
      set: (key, value) => {
        backingStore.set(key, value);
      },
    },
  };
}

const TEST_QUERY = { contractId: "CTEST", topics: ["sylox", "event_proposed", "*"] };
const RPC_URL = "https://fake-rpc.example";
const NAMESPACE = "test-namespace";

describe("EventsScanner.fetchEventsPaginated (backward-chunked scan, incrementally cached)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("finds the newest events in the first chunk when history is recent", async () => {
    const fake = makeFakeServer({
      latestLedger: 100_000,
      initialOldestLedger: 100_000 - 120_960,
      driftPerHealthCall: 1,
      eventLedgers: [99_950, 99_960],
    });
    fakeServerInstance.instance = fake as never;

    const { EventsScanner } = await import("./rpc-scan.js");
    const scanner = new EventsScanner(RPC_URL, NAMESPACE);
    const result = await scanner.fetchEventsPaginated({ ...TEST_QUERY, limit: 2 });

    expect(result.events.map((e) => e.ledger)).toEqual([99_960, 99_950]);
    expect(result.requestCount).toBeLessThanOrEqual(3);
    expect(result.stoppedAtRequestCap).toBe(false);
  });

  it("walks back through multiple chunks when history is older, still finishing within the request cap", async () => {
    const fake = makeFakeServer({
      latestLedger: 100_000,
      initialOldestLedger: 100_000 - 120_960,
      driftPerHealthCall: 1,
      eventLedgers: [100_000 - 25_000],
    });
    fakeServerInstance.instance = fake as never;

    const { EventsScanner } = await import("./rpc-scan.js");
    const scanner = new EventsScanner(RPC_URL, NAMESPACE);
    const result = await scanner.fetchEventsPaginated({ ...TEST_QUERY, limit: 1 });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].ledger).toBe(100_000 - 25_000);
    expect(result.requestCount).toBeLessThanOrEqual(6);
    expect(result.stoppedAtRequestCap).toBe(false);
  });

  it("recovers via the one bounded retry when a chunk lands out of range due to floor drift", async () => {
    const fake = makeFakeServer({
      latestLedger: 100_000,
      initialOldestLedger: 100_000 - 120_960,
      driftPerHealthCall: 50,
      eventLedgers: [99_990],
      failFirstAttempt: true,
    });
    fakeServerInstance.instance = fake as never;

    const { EventsScanner } = await import("./rpc-scan.js");
    const scanner = new EventsScanner(RPC_URL, NAMESPACE);
    const result = await scanner.fetchEventsPaginated({ ...TEST_QUERY, limit: 50 });

    expect(result.events.map((e) => e.ledger)).toContain(99_990);
    expect(fake.callCounts.healthCallCount).toBeGreaterThanOrEqual(2);
  });

  it("returns what it has (not an error) if it hits the request cap before the limit or the floor", async () => {
    const fake = makeFakeServer({
      latestLedger: 1_000_000,
      initialOldestLedger: 0,
      driftPerHealthCall: 0,
      eventLedgers: [],
    });
    fakeServerInstance.instance = fake as never;

    const { EventsScanner } = await import("./rpc-scan.js");
    const scanner = new EventsScanner(RPC_URL, NAMESPACE);
    const result = await scanner.fetchEventsPaginated({ ...TEST_QUERY, limit: 50 });

    expect(result.events).toEqual([]);
    expect(result.stoppedAtRequestCap).toBe(true);
    expect(result.requestCount).toBeLessThanOrEqual(20 + 5);
  });

  it("a second call on the SAME instance with no new ledgers is fully warm - just the one getHealth() call", async () => {
    const fake = makeFakeServer({
      latestLedger: 100_000,
      initialOldestLedger: 100_000 - 120_960,
      driftPerHealthCall: 0,
      eventLedgers: [99_990],
    });
    fakeServerInstance.instance = fake as never;

    const { EventsScanner } = await import("./rpc-scan.js");
    const scanner = new EventsScanner(RPC_URL, NAMESPACE);
    const first = await scanner.fetchEventsPaginated({ ...TEST_QUERY, limit: 50 });
    expect(first.requestCount).toBeGreaterThan(1);

    const eventsCallsBeforeSecond = fake.callCounts.getEventsCallCount;
    const second = await scanner.fetchEventsPaginated({ ...TEST_QUERY, limit: 50 });

    expect(second.events).toEqual(first.events);
    expect(second.requestCount).toBe(1);
    expect(fake.callCounts.getEventsCallCount).toBe(eventsCallsBeforeSecond);
  });

  it("an incremental refresh after new ledgers close only scans the new slice, merging with the cached events", async () => {
    const fake = makeFakeServer({
      latestLedger: 100_000,
      initialOldestLedger: 100_000 - 120_960,
      driftPerHealthCall: 0,
      eventLedgers: [99_990],
    });
    fakeServerInstance.instance = fake as never;

    const { EventsScanner } = await import("./rpc-scan.js");
    const scanner = new EventsScanner(RPC_URL, NAMESPACE);
    const first = await scanner.fetchEventsPaginated({ ...TEST_QUERY, limit: 50 });
    expect(first.events.map((e) => e.ledger)).toEqual([99_990]);

    fake.advanceLatestLedger(500);
    fake.addEventLedger(100_400);

    const second = await scanner.fetchEventsPaginated({ ...TEST_QUERY, limit: 50 });

    expect(second.events.map((e) => e.ledger)).toEqual([100_400, 99_990]);
    expect(second.latestLedger).toBe(100_500);
  });

  it("drops a cached event once its ledger ages below the moving floor", async () => {
    const fake = makeFakeServer({
      latestLedger: 100_000,
      initialOldestLedger: 99_000,
      driftPerHealthCall: 0,
      eventLedgers: [99_150],
    });
    fakeServerInstance.instance = fake as never;

    const { EventsScanner } = await import("./rpc-scan.js");
    const scanner = new EventsScanner(RPC_URL, NAMESPACE);
    const first = await scanner.fetchEventsPaginated({ ...TEST_QUERY, limit: 50 });
    expect(first.events.map((e) => e.ledger)).toEqual([99_150]);

    fakeServerInstance.instance.getHealth = vi.fn(async () => ({
      status: "healthy" as const,
      latestLedger: 100_000,
      oldestLedger: 99_200,
      ledgerRetentionWindow: 800,
    }));

    const second = await scanner.fetchEventsPaginated({ ...TEST_QUERY, limit: 50 });
    expect(second.events.map((e) => e.ledger)).not.toContain(99_150);
  });

  it("calls onProgress after EVERY chunk during a cold scan, not just once at the end", async () => {
    const fake = makeFakeServer({
      latestLedger: 100_000,
      initialOldestLedger: 100_000 - 30_000,
      driftPerHealthCall: 0,
      eventLedgers: [100_000 - 25_000],
    });
    fakeServerInstance.instance = fake as never;

    const { EventsScanner } = await import("./rpc-scan.js");
    const scanner = new EventsScanner(RPC_URL, NAMESPACE);
    const progressCalls: number[][] = [];
    await scanner.fetchEventsPaginated(
      { ...TEST_QUERY, limit: 50 },
      { onProgress: (events) => progressCalls.push(events.map((e) => e.ledger)) },
    );

    expect(progressCalls.length).toBe(3);
    expect(progressCalls[0]).toEqual([]);
    expect(progressCalls[1]).toEqual([]);
    expect(progressCalls[2]).toEqual([100_000 - 25_000]);
  });

  it("persists across a fresh EventsScanner instance (simulating a page reload) via an injected CacheAdapter", async () => {
    const fake = makeFakeServer({
      latestLedger: 100_000,
      initialOldestLedger: 100_000 - 120_960,
      driftPerHealthCall: 0,
      eventLedgers: [99_990],
    });
    fakeServerInstance.instance = fake as never;

    const { EventsScanner } = await import("./rpc-scan.js");
    const { adapter } = makeFakeStore();

    const scanner1 = new EventsScanner(RPC_URL, NAMESPACE, adapter);
    await scanner1.fetchEventsPaginated({ ...TEST_QUERY, limit: 50 });

    // A fresh EventsScanner instance (no shared in-memory state - the
    // real-world equivalent of a page reload) still finds the cached
    // state, because it was mirrored into the injected adapter, which
    // (for a real sessionStorage-backed adapter) a page reload doesn't
    // clear either.
    const eventsCallsBeforeReload = fake.callCounts.getEventsCallCount;
    const scanner2 = new EventsScanner(RPC_URL, NAMESPACE, adapter);
    const afterReload = await scanner2.fetchEventsPaginated({ ...TEST_QUERY, limit: 50 });

    expect(afterReload.events.map((e) => e.ledger)).toEqual([99_990]);
    expect(fake.callCounts.getEventsCallCount).toBe(eventsCallsBeforeReload);
  });

  it("rebuilds real, usable ScVals after a CacheAdapter round-trip, not plain objects scValToNative can't call .switch() on", async () => {
    const fake = makeFakeServer({
      latestLedger: 100_000,
      initialOldestLedger: 100_000 - 120_960,
      driftPerHealthCall: 0,
      eventLedgers: [99_990],
    });
    fakeServerInstance.instance = fake as never;

    const { EventsScanner } = await import("./rpc-scan.js");
    const { adapter, backingStore } = makeFakeStore();

    const scanner1 = new EventsScanner(RPC_URL, NAMESPACE, adapter);
    await scanner1.fetchEventsPaginated({ ...TEST_QUERY, limit: 50 });

    // The literal round-trip the adapter performs: a JSON string in,
    // JSON.parse out. No shortcuts through the scanner's own in-memory
    // Map - a fresh instance below never shares it.
    const key = [...backingStore.keys()].find((k) => k.startsWith("sylox-events:"));
    expect(key).toBeDefined();
    const persisted = backingStore.get(key!);
    expect(persisted).toBeTruthy();
    JSON.parse(persisted!); // Must not throw - the cached value is plain JSON, not live objects.

    const scanner2 = new EventsScanner(RPC_URL, NAMESPACE, adapter);
    const afterReload = await scanner2.fetchEventsPaginated({ ...TEST_QUERY, limit: 50 });

    expect(afterReload.events).toHaveLength(1);
    const rebuiltValue = afterReload.events[0].value;
    expect(() => scValToNative(rebuiltValue as never)).not.toThrow();
    expect(scValToNative(rebuiltValue as never)).toBe(BigInt(99_990));

    const rebuiltTopic = afterReload.events[0].topic as unknown[];
    expect(rebuiltTopic).toHaveLength(2);
    for (const t of rebuiltTopic) {
      expect(() => scValToNative(t as never)).not.toThrow();
    }
  });

  it("drops the cache and rescans, rather than throwing, when a CacheAdapter entry won't rebuild into real ScVals", async () => {
    const fake = makeFakeServer({
      latestLedger: 100_000,
      initialOldestLedger: 100_000 - 120_960,
      driftPerHealthCall: 0,
      eventLedgers: [99_990],
    });
    fakeServerInstance.instance = fake as never;

    const { EventsScanner } = await import("./rpc-scan.js");
    const { adapter, backingStore } = makeFakeStore();

    const scanner1 = new EventsScanner(RPC_URL, NAMESPACE, adapter);
    await scanner1.fetchEventsPaginated({ ...TEST_QUERY, limit: 50 });

    // Corrupt the persisted cache in place: still valid JSON (so
    // JSON.parse itself doesn't throw), but its base64 strings are
    // garbage that xdr.ScVal.fromXDR can't decode as XDR at all.
    const key = [...backingStore.keys()].find((k) => k.startsWith("sylox-events:"));
    expect(key).toBeDefined();
    const parsed = JSON.parse(backingStore.get(key!)!);
    parsed.events[0].value = "not-valid-base64-xdr!!!";
    backingStore.set(key!, JSON.stringify(parsed));

    const eventsCallsBeforeReload = fake.callCounts.getEventsCallCount;
    const scanner2 = new EventsScanner(RPC_URL, NAMESPACE, adapter);
    const afterReload = await scanner2.fetchEventsPaginated({ ...TEST_QUERY, limit: 50 });

    // Never throws, and genuinely rescans (the corrupted cache was
    // treated as "no usable cache", not silently served broken).
    expect(afterReload.events.map((e) => e.ledger)).toEqual([99_990]);
    expect(fake.callCounts.getEventsCallCount).toBeGreaterThan(eventsCallsBeforeReload);
  });

  it("replaces (never merges onto) the cache when an incremental refresh itself stops at the request cap before reaching the old cache's floor", async () => {
    const fake = makeFakeServer({
      latestLedger: 100_000,
      initialOldestLedger: 100_000 - 120_960,
      driftPerHealthCall: 0,
      eventLedgers: [99_990],
    });
    fakeServerInstance.instance = fake as never;

    const { EventsScanner } = await import("./rpc-scan.js");
    const scanner = new EventsScanner(RPC_URL, NAMESPACE);
    const first = await scanner.fetchEventsPaginated({ ...TEST_QUERY, limit: 50 });
    expect(first.events.map((e) => e.ledger)).toEqual([99_990]);

    fake.advanceLatestLedger(500_000);
    fake.addEventLedger(599_995);

    const second = await scanner.fetchEventsPaginated({ ...TEST_QUERY, limit: 50 });

    expect(second.events.map((e) => e.ledger)).toEqual([599_995]);
    expect(second.stoppedAtRequestCap).toBe(true);
  });

  it("replaces (never merges onto) the cache when an incremental refresh stops at its OWN event limit before reaching the old cache's floor, even though the request cap was never hit", async () => {
    const fake = makeFakeServer({
      latestLedger: 100_000,
      initialOldestLedger: 100_000 - 120_960,
      driftPerHealthCall: 0,
      eventLedgers: [99_990],
    });
    fakeServerInstance.instance = fake as never;

    const { EventsScanner } = await import("./rpc-scan.js");
    const scanner = new EventsScanner(RPC_URL, NAMESPACE);
    const first = await scanner.fetchEventsPaginated({ ...TEST_QUERY, limit: 50 });
    expect(first.events.map((e) => e.ledger)).toEqual([99_990]);

    fake.advanceLatestLedger(20_000);
    fake.addEventLedger(119_999);
    fake.addEventLedger(119_998);

    const second = await scanner.fetchEventsPaginated({ ...TEST_QUERY, limit: 1 });

    expect(second.events.map((e) => e.ledger)).toEqual([119_999]);
    expect(second.stoppedAtRequestCap).toBe(true);
    expect(fake.callCounts.healthCallCount + fake.callCounts.getEventsCallCount).toBeLessThan(20);
  });

  it("keys the cache by contract id, so a different contract never serves another's events", async () => {
    const fake = makeFakeServer({
      latestLedger: 100_000,
      initialOldestLedger: 100_000 - 120_960,
      driftPerHealthCall: 0,
      eventLedgers: [99_990],
    });
    fakeServerInstance.instance = fake as never;

    const { EventsScanner } = await import("./rpc-scan.js");
    const scanner = new EventsScanner(RPC_URL, NAMESPACE);
    await scanner.fetchEventsPaginated({ ...TEST_QUERY, contractId: "CONE", limit: 50 });
    const otherContractResult = await scanner.fetchEventsPaginated({ ...TEST_QUERY, contractId: "CTWO", limit: 50 });

    expect(otherContractResult.events.map((e) => e.ledger)).toEqual([99_990]);
  });
});
