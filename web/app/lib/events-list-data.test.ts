import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EventRecord } from "@sylox/sdk";

const { listFn, assetDisplayName, rulingDeadlineFn } = vi.hoisted(() => ({
  listFn: vi.fn(),
  assetDisplayName: vi.fn(async () => "USDC"),
  rulingDeadlineFn: vi.fn(async (): Promise<{ result: bigint | null }> => ({ result: null })),
}));

vi.mock("./sylox-client", () => ({
  al: {
    events: {
      list: listFn,
    },
  },
}));

vi.mock("@sylox/sdk", async () => {
  const actual = await vi.importActual<typeof import("@sylox/sdk")>("@sylox/sdk");
  return {
    ...actual,
    assetDisplayName,
    eventRegistryClient: () => ({
      ruling_deadline: rulingDeadlineFn,
    }),
  };
});

function fakeRecord(id: bigint, state: string, asset = "CASSET"): EventRecord {
  return {
    id,
    asset,
    bond: BigInt(0),
    declared_at: null,
    def_version: 1,
    escalated_at: null,
    evidence_hash: new Uint8Array(32),
    kind: { tag: "Depeg", values: undefined },
    proposed_at: BigInt(1_790_000_000),
    proposer: "GPROPOSER",
    state: { tag: state, values: undefined } as EventRecord["state"],
    tier: 1,
    window_start: BigInt(1_790_000_000),
  };
}

describe("listRegistryEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assetDisplayName.mockResolvedValue("USDC");
    rulingDeadlineFn.mockResolvedValue({ result: null });
  });

  it("reshapes each al.events.list() record into an EventListRow with the current state (not a frozen log view)", async () => {
    listFn.mockResolvedValue({
      events: [fakeRecord(BigInt(1), "Cured")],
      oldestLedgerScanned: 90,
      latestLedger: 200,
      stoppedAtRequestCap: false,
    });

    const { listRegistryEvents } = await import("./events-list-data");
    const result = await listRegistryEvents();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].state).toBe("Cured");
    expect(result.rows[0].id).toBe(BigInt(1));
  });

  it("calls onRowProgress with each row as its display shape resolves, via al.events.list's own onProgress", async () => {
    let capturedOnProgress: ((record: EventRecord) => void) | undefined;
    listFn.mockImplementation(async (opts: { onProgress?: (record: EventRecord) => void }) => {
      capturedOnProgress = opts.onProgress;
      opts.onProgress?.(fakeRecord(BigInt(1), "Proposed"));
      await Promise.resolve();
      opts.onProgress?.(fakeRecord(BigInt(2), "Proposed"));
      return {
        events: [fakeRecord(BigInt(1), "Proposed"), fakeRecord(BigInt(2), "Proposed")],
        oldestLedgerScanned: 80,
        latestLedger: 200,
        stoppedAtRequestCap: false,
      };
    });

    const { listRegistryEvents } = await import("./events-list-data");
    const progressRowIds: bigint[] = [];
    const result = await listRegistryEvents({ onRowProgress: (row) => progressRowIds.push(row.id) });

    expect(capturedOnProgress).toBeDefined();
    expect(new Set(progressRowIds)).toEqual(new Set([BigInt(1), BigInt(2)]));
    expect(result.rows.map((r) => r.id).sort()).toEqual([BigInt(1), BigInt(2)].sort());
  });

  it("never reshapes the same id's row twice, even though onProgress reports overlapping records repeatedly", async () => {
    const record = fakeRecord(BigInt(1), "Proposed");
    listFn.mockImplementation(async (opts: { onProgress?: (record: EventRecord) => void }) => {
      opts.onProgress?.(record);
      opts.onProgress?.(record);
      return {
        events: [record],
        oldestLedgerScanned: 80,
        latestLedger: 200,
        stoppedAtRequestCap: false,
      };
    });

    const { listRegistryEvents } = await import("./events-list-data");
    await listRegistryEvents({ onRowProgress: () => {} });

    expect(assetDisplayName).toHaveBeenCalledTimes(1);
  });

  it("reads ruling_deadline for an Escalated event's countdown, and nothing extra for a closed one", async () => {
    listFn.mockResolvedValue({
      events: [fakeRecord(BigInt(1), "Escalated"), fakeRecord(BigInt(2), "Cured")],
      oldestLedgerScanned: 80,
      latestLedger: 200,
      stoppedAtRequestCap: false,
    });
    rulingDeadlineFn.mockResolvedValue({ result: BigInt(1_800_000_000) });

    const { listRegistryEvents } = await import("./events-list-data");
    const result = await listRegistryEvents();

    const escalated = result.rows.find((r) => r.id === BigInt(1));
    const cured = result.rows.find((r) => r.id === BigInt(2));
    expect(escalated?.windowClosesAt).toBe(BigInt(1_800_000_000));
    expect(cured?.windowClosesAt).toBeNull();
    expect(rulingDeadlineFn).toHaveBeenCalledTimes(1); // Only for the Escalated row.
  });

  it("forwards oldestLedgerScanned, latestLedger, and stoppedAtRequestCap straight from al.events.list()", async () => {
    listFn.mockResolvedValue({
      events: [],
      oldestLedgerScanned: 12_345,
      latestLedger: 99_999,
      stoppedAtRequestCap: true,
    });

    const { listRegistryEvents } = await import("./events-list-data");
    const result = await listRegistryEvents();

    expect(result.oldestLedgerScanned).toBe(12_345);
    expect(result.latestLedger).toBe(99_999);
    expect(result.stoppedAtRequestCap).toBe(true);
    expect(result.rows).toEqual([]);
  });

  it("passes limit: 50 to al.events.list(), matching this screen's own default", async () => {
    listFn.mockResolvedValue({ events: [], oldestLedgerScanned: 0, latestLedger: 0, stoppedAtRequestCap: false });

    const { listRegistryEvents } = await import("./events-list-data");
    await listRegistryEvents();

    expect(listFn).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
  });
});
