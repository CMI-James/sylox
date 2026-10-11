import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EventRecord, EventDefinition } from "@sylox/sdk";

const { assetDisplayName, eventFn } = vi.hoisted(() => ({
  assetDisplayName: vi.fn(async () => "USDC"),
  eventFn: vi.fn(),
}));

vi.mock("./sylox-client", () => ({
  al: {
    events: {
      event: eventFn,
    },
  },
}));

const { definitionFn, rulingDeadlineFn, checkpointCureFn } = vi.hoisted(() => ({
  definitionFn: vi.fn(),
  rulingDeadlineFn: vi.fn(async (): Promise<{ result: bigint | null | undefined }> => ({ result: null })),
  checkpointCureFn: vi.fn(async () => ({
    result: { isErr: () => true, unwrapErr: () => ({ message: "WrongState" }) },
  })),
}));

vi.mock("@sylox/sdk", async () => {
  const actual = await vi.importActual<typeof import("@sylox/sdk")>("@sylox/sdk");
  return {
    ...actual,
    assetDisplayName,
    eventRegistryClient: () => ({
      definition: definitionFn,
      ruling_deadline: rulingDeadlineFn,
      checkpoint_cure: checkpointCureFn,
    }),
  };
});

function fakeRecord(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    asset: "CASSET",
    bond: BigInt(0),
    declared_at: null,
    def_version: 1,
    escalated_at: null,
    evidence_hash: new Uint8Array(32),
    id: BigInt(1),
    kind: { tag: "Depeg", values: undefined },
    proposed_at: BigInt(1_790_000_000),
    proposer: "GPROPOSER",
    state: { tag: "Proposed", values: undefined },
    tier: 1,
    window_start: BigInt(1_790_000_000),
    ...overrides,
  };
}

function fakeDefinition(overrides: Partial<EventDefinition> = {}): EventDefinition {
  return {
    asset: "CASSET",
    auth_revocation_threshold: 2,
    challenge_secs: BigInt(86_400),
    cure_threshold: BigInt(0),
    depeg_threshold: BigInt(9_500_000),
    depeg_window_secs: BigInt(259_200),
    freeze_pct_bps: 500,
    halt_window_secs: BigInt(0),
    kind: { tag: "Depeg", values: undefined },
    max_missing_epochs: 6,
    mint_spike_bps: 0,
    reference: { tag: "Usd", values: undefined },
    ruling_deadline_secs: BigInt(1_209_600),
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  assetDisplayName.mockResolvedValue("USDC");
  rulingDeadlineFn.mockResolvedValue({ result: null });
});

describe("fetchEventPageData - countdown (ruling_deadline Option<T> handling)", () => {
  it("reads the real ruling_deadline for an Escalated event", async () => {
    eventFn.mockResolvedValue(fakeRecord({ state: { tag: "Escalated", values: undefined } }));
    definitionFn.mockResolvedValue({ result: fakeDefinition() });
    rulingDeadlineFn.mockResolvedValue({ result: BigInt(1_800_000_000) });

    const { fetchEventPageData } = await import("./event-data");
    const data = await fetchEventPageData(BigInt(1));

    expect(data.countdown).toEqual({
      status: "ok",
      value: { phase: "ruling", deadline: BigInt(1_800_000_000) },
    });
  });

  it("fails the countdown section when ruling_deadline resolves to null - the real SDK shape for an Escalated event with no deadline stored", async () => {
    eventFn.mockResolvedValue(fakeRecord({ state: { tag: "Escalated", values: undefined } }));
    definitionFn.mockResolvedValue({ result: fakeDefinition() });
    rulingDeadlineFn.mockResolvedValue({ result: null });

    const { fetchEventPageData } = await import("./event-data");
    const data = await fetchEventPageData(BigInt(1));

    expect(data.countdown.status).toBe("error");
    if (data.countdown.status !== "error") throw new Error("expected 'error'");
    expect(data.countdown.message).toMatch(/no ruling deadline/i);
    // The other sections still load fine - one section's failure never takes down the page.
    expect(data.proposal.status).toBe("ok");
  });

  it("fails the countdown section when ruling_deadline resolves to undefined too", async () => {
    eventFn.mockResolvedValue(fakeRecord({ state: { tag: "Escalated", values: undefined } }));
    definitionFn.mockResolvedValue({ result: fakeDefinition() });
    rulingDeadlineFn.mockResolvedValue({ result: undefined });

    const { fetchEventPageData } = await import("./event-data");
    const data = await fetchEventPageData(BigInt(1));

    expect(data.countdown.status).toBe("error");
    if (data.countdown.status !== "error") throw new Error("expected 'error'");
    expect(data.countdown.message).toMatch(/no ruling deadline/i);
  });

  it("shows the challenge countdown for a Proposed event, never calling ruling_deadline", async () => {
    const proposedAt = BigInt(1_790_000_000);
    eventFn.mockResolvedValue(fakeRecord({ state: { tag: "Proposed", values: undefined }, proposed_at: proposedAt }));
    definitionFn.mockResolvedValue({ result: fakeDefinition({ challenge_secs: BigInt(86_400) }) });

    const { fetchEventPageData } = await import("./event-data");
    const data = await fetchEventPageData(BigInt(1));

    expect(data.countdown).toEqual({
      status: "ok",
      value: { phase: "challenge", deadline: proposedAt + BigInt(86_400) },
    });
    expect(rulingDeadlineFn).not.toHaveBeenCalled();
  });

  it("shows 'closed' for a Cured/Declared/Rejected event, never calling ruling_deadline", async () => {
    eventFn.mockResolvedValue(fakeRecord({ state: { tag: "Cured", values: undefined } }));
    definitionFn.mockResolvedValue({ result: fakeDefinition() });

    const { fetchEventPageData } = await import("./event-data");
    const data = await fetchEventPageData(BigInt(1));

    expect(data.countdown).toEqual({ status: "ok", value: { phase: "closed" } });
    expect(rulingDeadlineFn).not.toHaveBeenCalled();
  });
});
