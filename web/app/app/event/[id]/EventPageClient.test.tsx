import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventPageClient, loadData } from "./EventPageClient";
import { WalletProvider } from "@/lib/wallet/WalletContext";
import type { EventPageData } from "@/lib/event-data";
import type { EventRecord } from "@/lib/contracts/event-registry";

function renderEventPage(eventId: string) {
  return render(
    <WalletProvider>
      <EventPageClient eventId={eventId} />
    </WalletProvider>,
  );
}

const ADDRESS = "GCWWB2WYVRE4SSMASR6EMFQ7D3K6BEOLN5UQAXGS5YWPX2ZJ44JYKER5";
const FIXTURE_ASSET = "CDUMMY00000000000000000000000000000000000000000000FIXTUR";

/** A full EventPageData, close to event-fixtures.ts's own baseRecord, with just the fields each test below needs to vary. */
function buildEventData(overrides: {
  state?: EventRecord["state"]["tag"];
  kind?: EventRecord["kind"]["tag"];
  assetCode?: string;
  asset?: string;
  proposedAt?: bigint;
  declaredAt?: bigint | undefined;
}): EventPageData {
  const proposedAt = overrides.proposedAt ?? BigInt(1_790_000_000);
  return {
    proposal: {
      status: "ok",
      value: {
        record: {
          id: BigInt(42),
          asset: overrides.asset ?? FIXTURE_ASSET,
          kind: { tag: overrides.kind ?? "Depeg", values: undefined } as EventRecord["kind"],
          def_version: 1,
          tier: 1,
          state: { tag: overrides.state ?? "Proposed", values: undefined } as EventRecord["state"],
          window_start: proposedAt,
          proposed_at: proposedAt,
          escalated_at: null,
          declared_at: overrides.declaredAt ?? null,
          evidence_hash: Buffer.alloc(32),
          proposer: "GDFIXTUREPROPOSERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          bond: BigInt(0),
        },
        assetCode: overrides.assetCode ?? "DEMOUSD",
        definitionSentence: "Depeg: below 0.95 of peg for 72 hours, up to 6 missing hours allowed.",
      },
    },
    countdown: { status: "ok", value: { phase: "closed" } },
    cureProgress: { status: "ok", value: null },
  };
}

const { fetchEventPageData } = vi.hoisted(() => ({
  fetchEventPageData: vi.fn(),
}));

vi.mock("@/lib/event-data", async () => {
  const actual = await vi.importActual<typeof import("@/lib/event-data")>("@/lib/event-data");
  return { ...actual, fetchEventPageData };
});

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  vi.stubEnv("NODE_ENV", originalNodeEnv ?? "test");
  fetchEventPageData.mockReset();
});

describe("loadData - fixture routing", () => {
  it("resolves a fixture id from the fixture module outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const data = await loadData("fixture-proposed");
    expect(data.proposal.status).toBe("ok");
    if (data.proposal.status === "ok") {
      expect(data.proposal.value.assetCode).toBe("DEMOUSD");
    }
    // Never touches the live contract fetch for a fixture id.
    expect(fetchEventPageData).not.toHaveBeenCalled();
  });

  it("never resolves a fixture id from the fixture module in production - falls through to the live fetch path, which rejects it", async () => {
    vi.stubEnv("NODE_ENV", "production");
    fetchEventPageData.mockRejectedValue(new Error("should not be called with a non-numeric id"));

    await expect(loadData("fixture-proposed")).rejects.toThrow(/isn't a valid event id/i);
    // Confirms the fixture branch was skipped entirely in production -
    // "fixture-proposed" fails BigInt() parsing before ever reaching
    // fetchEventPageData, the same as any other malformed id would.
    expect(fetchEventPageData).not.toHaveBeenCalled();
  });

  it("all four fixture routes behave the same way in production - rejected as an invalid id, never fixture data", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const id of ["fixture-proposed", "fixture-challenged", "fixture-cured", "fixture-declared"]) {
      await expect(loadData(id)).rejects.toThrow(/isn't a valid event id/i);
    }
  });

  it("passes a real numeric id straight to the live contract fetch, in every environment", async () => {
    const fakeData = { proposal: { status: "error", message: "n/a" } } as unknown as EventPageData;
    fetchEventPageData.mockResolvedValue(fakeData);

    for (const env of ["development", "production", "test"]) {
      fetchEventPageData.mockClear();
      vi.stubEnv("NODE_ENV", env);
      await loadData("42");
      expect(fetchEventPageData).toHaveBeenCalledWith(BigInt(42));
    }
  });
});

describe("EventPageClient", () => {
  it("shows a loading state before data arrives", () => {
    fetchEventPageData.mockReturnValue(new Promise(() => {}));
    renderEventPage("42");
    expect(screen.getByText(/loading event from the registry/i)).toBeInTheDocument();
  });

  it("shows a page-wide error when the fetch rejects", async () => {
    fetchEventPageData.mockRejectedValue(new Error("RPC unreachable"));
    renderEventPage("42");
    expect(await screen.findByRole("alert")).toHaveTextContent("RPC unreachable");
  });

  it("always shows the testnet banner", () => {
    fetchEventPageData.mockReturnValue(new Promise(() => {}));
    renderEventPage("42");
    expect(screen.getByText(/testnet\. prices are sample data/i)).toBeInTheDocument();
  });

  it("uses the asset's display code in the breadcrumb, not the literal word 'Asset'", async () => {
    const data = buildEventData({ assetCode: "DEMOUSD", asset: "CDEMOUSDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
    fetchEventPageData.mockResolvedValue(data);
    renderEventPage("42");

    await screen.findByRole("heading", { level: 1 });
    const breadcrumbLink = screen.getByRole("link", { name: "DEMOUSD" });
    expect(breadcrumbLink).toHaveAttribute("href", "/asset/CDEMOUSDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(screen.queryByRole("link", { name: "Asset" })).not.toBeInTheDocument();
  });

  it("says 'Payouts for affected markets will appear here once protection markets launch', never a branch name", async () => {
    fetchEventPageData.mockResolvedValue(buildEventData({}));
    renderEventPage("42");

    await screen.findByRole("heading", { level: 1 });
    expect(
      screen.getByText(/payouts for affected markets will appear here once protection markets launch/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/feat\/markets/i)).not.toBeInTheDocument();
  });

  it("shows only the Finalize button (no Checkpoint) for a non-Depeg event", async () => {
    fetchEventPageData.mockResolvedValue(buildEventData({ kind: "IssuerFreeze" }));
    renderEventPage("42");

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("Checkpoint")).not.toBeInTheDocument();
    expect(screen.queryByText(/connect wallet to checkpoint/i)).not.toBeInTheDocument();
    expect(screen.getByText(/connect wallet to finalize/i)).toBeInTheDocument();
  });

  it("shows the Checkpoint button (disabled, with a reason) for a Depeg event that's no longer Proposed", async () => {
    fetchEventPageData.mockResolvedValue(buildEventData({ kind: "Depeg", state: "Cured" }));
    renderEventPage("42");

    await screen.findByRole("heading", { level: 1 });
    const checkpointButton = screen.getByRole("button", { name: "Checkpoint" });
    expect(checkpointButton).toBeDisabled();
    expect(screen.getByText(/only applies while the event's still proposed/i)).toBeInTheDocument();
  });

  it("shows 'Proposed at <proposed_at>' when declared_at is 0 (the real bug case), not an epoch date", async () => {
    const proposedAt = BigInt(1_790_000_000);
    fetchEventPageData.mockResolvedValue(
      buildEventData({ state: "Proposed", proposedAt, declaredAt: BigInt(0) }),
    );
    renderEventPage("42");

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText(/declared at/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/1970-01-01/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(`Proposed at ${new Date(Number(proposedAt) * 1000).toISOString()}.`),
    ).toBeInTheDocument();
  });

  it("shows 'Declared at <declared_at>' once it's really set (non-zero)", async () => {
    const declaredAt = BigInt(1_790_100_000);
    fetchEventPageData.mockResolvedValue(buildEventData({ state: "Declared", declaredAt }));
    renderEventPage("42");

    await screen.findByRole("heading", { level: 1 });
    expect(
      screen.getByText(`Declared at ${new Date(Number(declaredAt) * 1000).toISOString()}.`),
    ).toBeInTheDocument();
  });

  it("shows neither 'Proposed at' nor 'Declared at' for a non-Proposed event with no real declared_at", async () => {
    fetchEventPageData.mockResolvedValue(buildEventData({ state: "Cured", declaredAt: undefined }));
    renderEventPage("42");

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText(/proposed at/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/declared at/i)).not.toBeInTheDocument();
  });

  it("refetches the event after a successful write, so the badge updates without a manual reload", async () => {
    vi.resetModules();
    vi.doMock("@/lib/wallet/kit", async () => {
      const actual = await vi.importActual<typeof import("@/lib/wallet/kit")>("@/lib/wallet/kit");
      return {
        ...actual,
        getKit: async () => ({
          refreshSupportedWallets: vi.fn(async () => [
            { id: "freighter", name: "Freighter", icon: "", isAvailable: true, url: "" },
          ]),
          setWallet: vi.fn(),
          fetchAddress: vi.fn(async () => ({ address: ADDRESS })),
          disconnect: vi.fn(async () => {}),
          signTransaction: vi.fn(async () => ({ signedTxXdr: "fake-xdr" })),
        }),
        ensureFreighterAccess: vi.fn(async () => {}),
        restoreWalletSilently: vi.fn(async () => null),
      };
    });
    vi.doMock("@/lib/event-actions", async () => {
      const actual = await vi.importActual<typeof import("@/lib/event-actions")>("@/lib/event-actions");
      return {
        ...actual,
        prepareFinalize: vi.fn(async (_eventId: bigint, address: string) => ({
          tx: {},
          preparedFor: address,
        })),
        confirmFinalize: vi.fn(async () => ({ result: undefined, txHash: "abc123" })),
      };
    });

    const { EventPageClient: FreshEventPageClient } = await import("./EventPageClient");
    const { WalletProvider: FreshProvider } = await import("@/lib/wallet/WalletContext");

    const proposed = buildEventData({ state: "Proposed" });
    const declared = buildEventData({ state: "Declared", declaredAt: BigInt(1_790_200_000) });
    fetchEventPageData.mockResolvedValueOnce(proposed).mockResolvedValueOnce(declared);

    const user = userEvent.setup();
    render(
      <FreshProvider>
        <FreshEventPageClient eventId="42" />
      </FreshProvider>,
    );

    await screen.findByText("Proposed");
    expect(fetchEventPageData).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /connect wallet to finalize/i }));
    const walletRow = await screen.findByRole("button", { name: /freighter/i });
    await user.click(walletRow);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Finalize" }));
    await user.click(await screen.findByRole("button", { name: /confirm.*sign/i }));

    await waitFor(() => expect(fetchEventPageData).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Declared")).toBeInTheDocument();
    // The "done" confirmation stays up through the refetch - a visitor
    // who just finalized still sees their stellar.expert link, not a
    // page that silently reset mid-action.
    expect(screen.getByText(/finalize: done/i)).toBeInTheDocument();

    vi.doUnmock("@/lib/wallet/kit");
    vi.doUnmock("@/lib/event-actions");
  });
});
