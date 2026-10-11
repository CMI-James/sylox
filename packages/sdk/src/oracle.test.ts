import { describe, expect, it, vi } from "vitest";
import { Oracle } from "./oracle.js";
import { SyloxError } from "./errors.js";
import type { SyloxNetwork } from "./networks.js";

/**
 * Oracle has no 1:1 source file (it's a new, thinner module built from
 * asset-data.ts as REFERENCE, per this PR's brief - not a port of a
 * single existing file with its own existing test). These tests are
 * new, covering: the Result-unwrapping error path (shared with every
 * other Result-returning oracle read), the Option<T> null-handling for
 * live()/latest()/firstEpoch(), and ring()'s epoch-reconstruction math
 * (ported close to verbatim from asset-data.ts's fetchEffectiveRing,
 * whose own correctness is exercised here against a fresh fixture).
 */

const mockClient = {
  assets: vi.fn(),
  score: vi.fn(),
  check_stale: vi.fn(),
  latest: vi.fn(),
  live: vi.fn(),
  first_epoch: vi.fn(),
  ring: vi.fn(),
  effective_window: vi.fn(),
};

vi.mock("./contracts/risk-oracle.js", () => ({
  riskOracleClient: () => mockClient,
}));

const NETWORK: SyloxNetwork = {
  rpcUrl: "https://fake-rpc.example",
  networkPassphrase: "Test SDF Network ; September 2015",
  contracts: { riskOracle: "CFAKE_ORACLE", eventRegistry: "CFAKE_REGISTRY" },
  // demoAsset is required on SyloxNetwork (both deployment source files
  // are committed - see networks.ts's doc comment) but unused by any
  // test in this file; a minimal well-shaped fixture satisfies the type.
  demoAsset: { contract_id: "CFAKE_DEMO_ASSET", asset_code: "DEMOUSD", issuer: "GFAKE_ISSUER" },
};

const ASSET = "CFAKE_ASSET";

function okResult<T>(value: T) {
  return { isErr: () => false, unwrap: () => value };
}

function errResult() {
  return { isErr: () => true, unwrapErr: () => ({ message: "raw contract doc comment" }) };
}

describe("Oracle.assets", () => {
  it("returns the raw Address[] from RiskOracle.assets()", async () => {
    mockClient.assets.mockResolvedValueOnce({ result: ["CASSET1", "CASSET2"] });
    const oracle = new Oracle(NETWORK);
    expect(await oracle.assets()).toEqual(["CASSET1", "CASSET2"]);
  });
});

describe("Oracle.score", () => {
  it("unwraps a successful Result and returns the RiskScore as-is, bigints preserved", async () => {
    const riskScore = { band: { tag: "Normal", values: undefined }, epoch: BigInt(42), formula_version: 1, score: 87, stale: false };
    mockClient.score.mockResolvedValueOnce({ result: okResult(riskScore), simulation: undefined });
    const oracle = new Oracle(NETWORK);
    const result = await oracle.score(ASSET);
    expect(result).toBe(riskScore);
    expect(result.epoch).toBe(BigInt(42));
  });

  it("throws a SyloxError (UnknownAsset) when the Result is Err", async () => {
    mockClient.score.mockResolvedValueOnce({
      result: errResult(),
      simulation: { error: "HostError: Error(Contract, #100)" },
    });
    const oracle = new Oracle(NETWORK);
    try {
      await oracle.score(ASSET);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SyloxError);
      expect((e as SyloxError).contractErrorName).toBe("UnknownAsset");
    }
  });
});

describe("Oracle.band", () => {
  it("derives the band from score()", async () => {
    const riskScore = { band: { tag: "Watch", values: undefined }, epoch: BigInt(1), formula_version: 1, score: 50, stale: false };
    mockClient.score.mockResolvedValueOnce({ result: okResult(riskScore), simulation: undefined });
    const oracle = new Oracle(NETWORK);
    expect(await oracle.band(ASSET)).toEqual({ tag: "Watch", values: undefined });
  });
});

describe("Oracle.isStale", () => {
  it("unwraps a successful Result", async () => {
    mockClient.check_stale.mockResolvedValueOnce({ result: okResult(true), simulation: undefined });
    const oracle = new Oracle(NETWORK);
    expect(await oracle.isStale(ASSET)).toBe(true);
  });

  it("throws a SyloxError when the Result is Err", async () => {
    mockClient.check_stale.mockResolvedValueOnce({
      result: errResult(),
      simulation: { error: "HostError: Error(Contract, #100)" },
    });
    const oracle = new Oracle(NETWORK);
    await expect(oracle.isStale(ASSET)).rejects.toBeInstanceOf(SyloxError);
  });
});

describe("Oracle.latest", () => {
  it("returns the decoded SignalSet when present", async () => {
    const signal = { peg_ratio: BigInt(10_000_000), posted_at: BigInt(1000) };
    mockClient.latest.mockResolvedValueOnce({ result: signal });
    const oracle = new Oracle(NETWORK);
    expect(await oracle.latest(ASSET)).toBe(signal);
  });

  it("returns null when the contract Option<T> decodes as null", async () => {
    mockClient.latest.mockResolvedValueOnce({ result: null });
    const oracle = new Oracle(NETWORK);
    expect(await oracle.latest(ASSET)).toBeNull();
  });
});

describe("Oracle.live", () => {
  it("returns the decoded [SubEpoch, SignalSet, SlotState] tuple when present, not a reshaped LiveValue", async () => {
    const tuple = [{ hour: BigInt(1), sub: 0 }, { peg_ratio: BigInt(9_900_000), posted_at: BigInt(500) }, { tag: "Pending", values: undefined }];
    mockClient.live.mockResolvedValueOnce({ result: tuple });
    const oracle = new Oracle(NETWORK);
    const result = await oracle.live(ASSET);
    expect(result).toBe(tuple);
  });

  it("returns null (never a {status:'none'} wrapper) when nothing has been posted", async () => {
    mockClient.live.mockResolvedValueOnce({ result: null });
    const oracle = new Oracle(NETWORK);
    expect(await oracle.live(ASSET)).toBeNull();
  });

  it("treats undefined the same as null (defensive Option<T> handling)", async () => {
    mockClient.live.mockResolvedValueOnce({ result: undefined });
    const oracle = new Oracle(NETWORK);
    expect(await oracle.live(ASSET)).toBeNull();
  });
});

describe("Oracle.firstEpoch", () => {
  it("returns the bigint epoch when present", async () => {
    mockClient.first_epoch.mockResolvedValueOnce({ result: BigInt(100) });
    const oracle = new Oracle(NETWORK);
    expect(await oracle.firstEpoch(ASSET)).toBe(BigInt(100));
  });

  it("returns null (a real decoded value) when the asset was never posted", async () => {
    mockClient.first_epoch.mockResolvedValueOnce({ result: null });
    const oracle = new Oracle(NETWORK);
    expect(await oracle.firstEpoch(ASSET)).toBeNull();
  });

  it("DEVIATION from asset-data.ts's tryFetchFirstEpoch: throws a SyloxError on a genuine failure instead of silently returning undefined", async () => {
    mockClient.first_epoch.mockRejectedValueOnce(new Error("network blip"));
    const oracle = new Oracle(NETWORK);
    await expect(oracle.firstEpoch(ASSET)).rejects.toBeInstanceOf(SyloxError);
  });
});

describe("Oracle.ring", () => {
  const RING_SLOTS = 240;

  it("returns every slot as Empty with effectiveState Empty when the asset was never posted", async () => {
    const slots = Array.from({ length: RING_SLOTS }, () => ({
      epoch: BigInt(0),
      state: { tag: "Empty", values: undefined },
      peg_ratio: BigInt(0),
      pending_until: BigInt(0),
      provisional_sub_coverage: null,
    }));
    mockClient.ring.mockResolvedValueOnce({ result: slots });
    const oracle = new Oracle(NETWORK);
    const result = await oracle.ring(ASSET);
    expect(result.every((s) => s.effectiveState === "Empty")).toBe(true);
    expect(mockClient.effective_window).not.toHaveBeenCalled();
  });

  it("anchors the epoch axis on the newest non-Empty slot's own index, not the last array index", async () => {
    // The newest hour was overturned and reopened (ADR-005): the last
    // array slot is Empty, but an earlier one (index RING_SLOTS - 2)
    // holds the real newest data.
    const slots = Array.from({ length: RING_SLOTS }, (_, i) => ({
      epoch: i === RING_SLOTS - 2 ? BigInt(5000) : BigInt(0),
      state: { tag: i === RING_SLOTS - 2 ? "Final" : "Empty", values: undefined },
      peg_ratio: BigInt(10_000_000),
      pending_until: BigInt(0),
      provisional_sub_coverage: null,
    }));
    mockClient.ring.mockResolvedValueOnce({ result: slots });
    mockClient.effective_window.mockResolvedValueOnce({
      result: Array.from({ length: RING_SLOTS }, () => ({ tag: "Final", values: undefined })),
    });

    const oracle = new Oracle(NETWORK);
    const result = await oracle.ring(ASSET);

    // newestEpoch = anchorSlot.epoch + (RING_SLOTS - 1 - anchorIndex) = 5000 + (240 - 1 - 238) = 5001.
    const expectedNewestEpoch = BigInt(5000) + BigInt(RING_SLOTS - 1 - (RING_SLOTS - 2));
    expect(result[result.length - 1].epoch).toBe(expectedNewestEpoch);
    // Every slot's epoch is sequential, derived from the anchor - never the raw stored 0.
    expect(result[0].epoch).toBe(expectedNewestEpoch - BigInt(RING_SLOTS - 1));
  });

  it("promotes effectiveState from effective_window, independent of the slot's own raw state tag", async () => {
    const slots = Array.from({ length: RING_SLOTS }, (_, i) => ({
      epoch: i === RING_SLOTS - 1 ? BigInt(1000) : BigInt(0),
      state: { tag: i === RING_SLOTS - 1 ? "Pending" : "Empty", values: undefined },
      peg_ratio: BigInt(10_000_000),
      pending_until: BigInt(0),
      provisional_sub_coverage: null,
    }));
    mockClient.ring.mockResolvedValueOnce({ result: slots });
    mockClient.effective_window.mockResolvedValueOnce({
      result: Array.from({ length: RING_SLOTS }, (_, i) =>
        i === RING_SLOTS - 1 ? { tag: "Final", values: undefined } : { tag: "Empty", values: undefined },
      ),
    });

    const oracle = new Oracle(NETWORK);
    const result = await oracle.ring(ASSET);
    // The raw state.tag is still "Pending" (untouched), but effectiveState promotes it to Final.
    expect(result[result.length - 1].state.tag).toBe("Pending");
    expect(result[result.length - 1].effectiveState).toBe("Final");
  });
});
