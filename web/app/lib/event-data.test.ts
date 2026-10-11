import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EventRecord, EventDefinition } from "./contracts/event-registry";

const { assetDisplayName } = vi.hoisted(() => ({
  assetDisplayName: vi.fn(async () => "USDC"),
}));

vi.mock("./contracts/token", () => ({ assetDisplayName }));

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

function fakeRegistry(opts: {
  record: EventRecord;
  def: EventDefinition;
  rulingDeadline?: bigint | null | undefined;
}) {
  return {
    event: vi.fn(async () => ({ result: opts.record })),
    definition: vi.fn(async () => ({ result: opts.def })),
    ruling_deadline: vi.fn(async () => ({ result: opts.rulingDeadline })),
    checkpoint_cure: vi.fn(async () => ({
      result: { isErr: () => true, unwrapErr: () => ({ message: "WrongState" }) },
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a minimal fake, not the real generated client.
  } as any;
}

vi.mock("./contracts/event-registry", () => ({ eventRegistryClient: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  assetDisplayName.mockResolvedValue("USDC");
});

describe("fetchEventPageData - countdown (ruling_deadline Option<T> handling)", () => {
  it("reads the real ruling_deadline for an Escalated event", async () => {
    const { eventRegistryClient } = await import("./contracts/event-registry");
    const registry = fakeRegistry({
      record: fakeRecord({ state: { tag: "Escalated", values: undefined } }),
      def: fakeDefinition(),
      rulingDeadline: BigInt(1_800_000_000),
    });
    vi.mocked(eventRegistryClient).mockReturnValue(registry);

    const { fetchEventPageData } = await import("./event-data");
    const data = await fetchEventPageData(BigInt(1));

    expect(data.countdown).toEqual({
      status: "ok",
      value: { phase: "ruling", deadline: BigInt(1_800_000_000) },
    });
  });

  it("fails the countdown section when ruling_deadline resolves to null - the real SDK 17 shape for an Escalated event with no deadline stored", async () => {
    const { eventRegistryClient } = await import("./contracts/event-registry");
    const registry = fakeRegistry({
      record: fakeRecord({ state: { tag: "Escalated", values: undefined } }),
      def: fakeDefinition(),
      rulingDeadline: null,
    });
    vi.mocked(eventRegistryClient).mockReturnValue(registry);

    const { fetchEventPageData } = await import("./event-data");
    const data = await fetchEventPageData(BigInt(1));

    expect(data.countdown.status).toBe("error");
    if (data.countdown.status !== "error") throw new Error("expected 'error'");
    expect(data.countdown.message).toMatch(/no ruling deadline/i);
    // The other sections still load fine - one section's failure never takes down the page.
    expect(data.proposal.status).toBe("ok");
  });

  it("fails the countdown section when ruling_deadline resolves to undefined too", async () => {
    const { eventRegistryClient } = await import("./contracts/event-registry");
    const registry = fakeRegistry({
      record: fakeRecord({ state: { tag: "Escalated", values: undefined } }),
      def: fakeDefinition(),
      rulingDeadline: undefined,
    });
    vi.mocked(eventRegistryClient).mockReturnValue(registry);

    const { fetchEventPageData } = await import("./event-data");
    const data = await fetchEventPageData(BigInt(1));

    expect(data.countdown.status).toBe("error");
    if (data.countdown.status !== "error") throw new Error("expected 'error'");
    expect(data.countdown.message).toMatch(/no ruling deadline/i);
  });

  it("shows the challenge countdown for a Proposed event, never calling ruling_deadline", async () => {
    const { eventRegistryClient } = await import("./contracts/event-registry");
    const proposedAt = BigInt(1_790_000_000);
    const registry = fakeRegistry({
      record: fakeRecord({ state: { tag: "Proposed", values: undefined }, proposed_at: proposedAt }),
      def: fakeDefinition({ challenge_secs: BigInt(86_400) }),
    });
    vi.mocked(eventRegistryClient).mockReturnValue(registry);

    const { fetchEventPageData } = await import("./event-data");
    const data = await fetchEventPageData(BigInt(1));

    expect(data.countdown).toEqual({
      status: "ok",
      value: { phase: "challenge", deadline: proposedAt + BigInt(86_400) },
    });
    expect(registry.ruling_deadline).not.toHaveBeenCalled();
  });

  it("shows 'closed' for a Cured/Declared/Rejected event, never calling ruling_deadline", async () => {
    const { eventRegistryClient } = await import("./contracts/event-registry");
    const registry = fakeRegistry({
      record: fakeRecord({ state: { tag: "Cured", values: undefined } }),
      def: fakeDefinition(),
    });
    vi.mocked(eventRegistryClient).mockReturnValue(registry);

    const { fetchEventPageData } = await import("./event-data");
    const data = await fetchEventPageData(BigInt(1));

    expect(data.countdown).toEqual({ status: "ok", value: { phase: "closed" } });
    expect(registry.ruling_deadline).not.toHaveBeenCalled();
  });
});
