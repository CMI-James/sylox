import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WriteActionButton } from "./WriteActionButton";
import { WalletProvider } from "@/lib/wallet/WalletContext";
import type { Prepared } from "@/lib/event-actions";

// Every test in this file either connects through the real picker
// flow (and overrides restoreWalletSilently itself via its own
// vi.doMock, below) or renders WriteActionButton disconnected and
// never cares about a silent restore at all - this file-level mock
// (hoisted before WalletContext's own static import above resolves)
// keeps WalletProvider's mount-time restore from ever reaching the
// real @stellar/freighter-api import, which this jsdom test
// environment can't load (a CJS/ESM interop error, unrelated to
// anything under test here).
vi.mock("@/lib/wallet/kit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/wallet/kit")>("@/lib/wallet/kit");
  return { ...actual, restoreWalletSilently: vi.fn(async () => null) };
});

const ADDRESS_A = "GCWWB2WYVRE4SSMASR6EMFQ7D3K6BEOLN5UQAXGS5YWPX2ZJ44JYKER5";
const ADDRESS_B = "GBXYFBRIS5M7S2UDQ64AE4QHSJG7UIN6VRPDDAEBKP724V344GAL5MJP";

/**
 * A fake kit, driven through the SAME path real connection uses
 * (openPicker -> pick a wallet in the modal -> handleSelectWallet) -
 * not a shortcut that bypasses WalletContext's own logic. Switching
 * `currentAddress` between two renders of the flow is how the
 * "connected wallet changed" test below simulates a real account
 * switch in the extension.
 */
function makeFakeKit(getAddress: () => string) {
  return {
    refreshSupportedWallets: vi.fn(async () => [
      { id: "freighter", name: "Freighter", icon: "", isAvailable: true, url: "" },
    ]),
    setWallet: vi.fn(),
    fetchAddress: vi.fn(async () => ({ address: getAddress() })),
    disconnect: vi.fn(async () => {}),
    signTransaction: vi.fn(async () => ({ signedTxXdr: "fake-xdr" })),
  };
}

/** Mocking "@/lib/wallet/kit" wholesale (as these tests already do for getKit) replaces ensureFreighterAccess and restoreWalletSilently too, since all three live in that module. These tests drive connection through the picker for real, never rely on a silent restore, so a no-op stand-in for each is enough to keep the module shape valid. */
function fakeEnsureFreighterAccess() {
  return vi.fn(async () => {});
}

function fakeRestoreWalletSilently() {
  return vi.fn(async () => null);
}

/** `connectButtonName` picks which exact button opens the picker - a standalone WalletButton reads "Connect wallet"; WriteActionButton's own disconnected state reads "Connect wallet to <label>", and a test with only one of the two must say which it means so a loose /connect wallet/i never matches the wrong one once both are rendered together. */
async function connectWallet(user: ReturnType<typeof userEvent.setup>, connectButtonName: string) {
  await user.click(screen.getByRole("button", { name: connectButtonName }));
  const walletRow = await screen.findByRole("button", { name: /freighter/i });
  await user.click(walletRow);
  // The modal closes and the address becomes available once fetchAddress resolves.
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

describe("WriteActionButton", () => {
  it("shows 'Connect wallet to <label>' when no wallet is connected, and never calls prepare", async () => {
    vi.doMock("@/lib/wallet/kit", () => ({ getKit: async () => makeFakeKit(() => ADDRESS_A), ensureFreighterAccess: fakeEnsureFreighterAccess(), restoreWalletSilently: fakeRestoreWalletSilently() }));
    const prepare = vi.fn();

    render(
      <WalletProvider>
        <WriteActionButton label="Checkpoint" prepare={prepare} confirm={vi.fn()} />
      </WalletProvider>,
    );

    expect(screen.getByRole("button", { name: /connect wallet to checkpoint/i })).toBeInTheDocument();
    expect(prepare).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/wallet/kit");
  });

  it("shows the disabled state with its reason, without ever calling prepare", () => {
    const prepare = vi.fn();
    render(
      <WalletProvider>
        <WriteActionButton
          label="Finalize"
          prepare={prepare}
          confirm={vi.fn()}
          disabled
          disabledReason="Only applies to an event that's still Proposed."
        />
      </WalletProvider>,
    );

    expect(screen.getByRole("button", { name: "Finalize" })).toBeDisabled();
    expect(screen.getByText(/only applies to an event/i)).toBeInTheDocument();
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe("WriteActionButton - connected flow", () => {
  it("calls prepare with the connected address once a wallet connects, then confirm with a matching signer", async () => {
    vi.resetModules();
    vi.doMock("@/lib/wallet/kit", () => ({ getKit: async () => makeFakeKit(() => ADDRESS_A), ensureFreighterAccess: fakeEnsureFreighterAccess(), restoreWalletSilently: fakeRestoreWalletSilently() }));
    const { WalletProvider: FreshProvider } = await import("@/lib/wallet/WalletContext");
    const { WriteActionButton: FreshButton } = await import("./WriteActionButton");

    const user = userEvent.setup();
    const prepare = vi.fn(async (address: string): Promise<Prepared<{ id: string }>> => ({
      tx: { id: "tx-1" },
      preparedFor: address,
    }));
    const confirm = vi.fn(
      async (
        _prepared: Prepared<{ id: string }>,
        _signer: { publicKey: string; signTransaction: unknown },
      ) => ({ txHash: "abc123" }),
    );

    render(
      <FreshProvider>
        <FreshButton label="Checkpoint" prepare={prepare} confirm={confirm} />
      </FreshProvider>,
    );

    await connectWallet(user, "Connect wallet to checkpoint");
    await user.click(screen.getByRole("button", { name: "Checkpoint" }));
    expect(prepare).toHaveBeenCalledWith(ADDRESS_A);

    await user.click(await screen.findByRole("button", { name: /confirm.*sign/i }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0]).toEqual({ tx: { id: "tx-1" }, preparedFor: ADDRESS_A });
    expect(confirm.mock.calls[0][1].publicKey).toBe(ADDRESS_A);

    vi.doUnmock("@/lib/wallet/kit");
  });

  it("shows the simulated error in plain words and never calls confirm when prepare rejects", async () => {
    vi.resetModules();
    vi.doMock("@/lib/wallet/kit", () => ({ getKit: async () => makeFakeKit(() => ADDRESS_A), ensureFreighterAccess: fakeEnsureFreighterAccess(), restoreWalletSilently: fakeRestoreWalletSilently() }));
    const { WalletProvider: FreshProvider } = await import("@/lib/wallet/WalletContext");
    const { WriteActionButton: FreshButton } = await import("./WriteActionButton");

    const user = userEvent.setup();
    const prepare = vi.fn(async () => {
      throw new Error("Couldn't finalize this event: challenge window still open.");
    });
    const confirm = vi.fn();

    render(
      <FreshProvider>
        <FreshButton label="Finalize" prepare={prepare} confirm={confirm} />
      </FreshProvider>,
    );

    await connectWallet(user, "Connect wallet to finalize");
    await user.click(screen.getByRole("button", { name: "Finalize" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/challenge window still open/i);
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /confirm.*sign/i })).not.toBeInTheDocument();

    vi.doUnmock("@/lib/wallet/kit");
  });

  it("re-prepares against the new address if the connected wallet changes before confirm", async () => {
    vi.resetModules();
    let currentAddress = ADDRESS_A;
    vi.doMock("@/lib/wallet/kit", () => ({ getKit: async () => makeFakeKit(() => currentAddress), ensureFreighterAccess: fakeEnsureFreighterAccess(), restoreWalletSilently: fakeRestoreWalletSilently() }));
    const { WalletProvider: FreshProvider } = await import("@/lib/wallet/WalletContext");
    const { WriteActionButton: FreshButton } = await import("./WriteActionButton");
    const { WalletButton: FreshWalletButton } = await import("./WalletButton");

    const user = userEvent.setup();
    const prepare = vi.fn(async (address: string): Promise<Prepared<{ id: string }>> => ({
      tx: { id: `tx-for-${address}` },
      preparedFor: address,
    }));
    const confirm = vi.fn(
      async (
        _prepared: Prepared<{ id: string }>,
        _signer: { publicKey: string; signTransaction: unknown },
      ) => ({ txHash: "xyz789" }),
    );

    render(
      <FreshProvider>
        <FreshWalletButton />
        <FreshButton label="Checkpoint" prepare={prepare} confirm={confirm} />
      </FreshProvider>,
    );

    // Connect as A, simulate - prepared for A.
    await connectWallet(user, "Connect wallet");
    await user.click(screen.getByRole("button", { name: "Checkpoint" }));
    await screen.findByRole("button", { name: /confirm.*sign/i });
    expect(prepare).toHaveBeenLastCalledWith(ADDRESS_A);

    // Switch wallets: disconnect, then reconnect as B - same real UI
    // path a visitor would use to switch accounts, not a direct state
    // injection.
    await user.click(screen.getByRole("button", { name: "GCWW…KER5, wallet options" })); // The connected-address button, opening its menu.
    await user.click(await screen.findByRole("menuitem", { name: /disconnect/i }));
    currentAddress = ADDRESS_B;
    await connectWallet(user, "Connect wallet");

    // Confirm now - preparedFor (A) no longer matches the live address
    // (B), so it must re-prepare against B before ever calling confirm.
    await user.click(screen.getByRole("button", { name: /confirm.*sign/i }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());

    expect(prepare).toHaveBeenLastCalledWith(ADDRESS_B);
    expect(confirm.mock.calls[0][0]).toEqual({ tx: { id: "tx-for-GBXYFBRIS5M7S2UDQ64AE4QHSJG7UIN6VRPDDAEBKP724V344GAL5MJP" }, preparedFor: ADDRESS_B });
    expect(confirm.mock.calls[0][1].publicKey).toBe(ADDRESS_B);
    // Never signed the transaction that was built for the old address.
    expect(confirm).not.toHaveBeenCalledWith(
      expect.objectContaining({ preparedFor: ADDRESS_A }),
      expect.anything(),
    );

    vi.doUnmock("@/lib/wallet/kit");
  });

  it("checks Freighter access before signing, and calls onSuccess once confirm resolves", async () => {
    vi.resetModules();
    const checkAccess = vi.fn(async () => {});
    vi.doMock("@/lib/wallet/kit", () => ({
      getKit: async () => makeFakeKit(() => ADDRESS_A),
      ensureFreighterAccess: checkAccess,
      restoreWalletSilently: fakeRestoreWalletSilently(),
    }));
    const { WalletProvider: FreshProvider } = await import("@/lib/wallet/WalletContext");
    const { WriteActionButton: FreshButton } = await import("./WriteActionButton");

    const user = userEvent.setup();
    const prepare = vi.fn(async (address: string): Promise<Prepared<{ id: string }>> => ({
      tx: { id: "tx-1" },
      preparedFor: address,
    }));
    // Unlike the other tests' confirm stubs, this one actually calls
    // signer.signTransaction - the real path confirmCheckpointCure/
    // confirmFinalize take via tx.signAndSend({ signTransaction }) -
    // so ensureFreighterAccess (wired into WalletContext's own
    // signTransaction) is genuinely exercised, not bypassed.
    const confirm = vi.fn(
      async (
        _prepared: Prepared<{ id: string }>,
        signer: { publicKey: string; signTransaction: (xdr: string) => Promise<unknown> },
      ) => {
        await signer.signTransaction("fake-xdr-to-sign");
        return { txHash: "abc123" };
      },
    );
    const onSuccess = vi.fn();

    render(
      <FreshProvider>
        <FreshButton label="Finalize" prepare={prepare} confirm={confirm} onSuccess={onSuccess} />
      </FreshProvider>,
    );

    await connectWallet(user, "Connect wallet to finalize");
    await user.click(screen.getByRole("button", { name: "Finalize" }));
    await user.click(await screen.findByRole("button", { name: /confirm.*sign/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    // Access was checked before the transaction was actually signed -
    // never the other way around, and never skipped.
    expect(checkAccess).toHaveBeenCalled();
    expect(await screen.findByText(/finalize: done/i)).toBeInTheDocument();

    vi.doUnmock("@/lib/wallet/kit");
  });

  it("never calls onSuccess when confirm itself fails", async () => {
    vi.resetModules();
    vi.doMock("@/lib/wallet/kit", () => ({
      getKit: async () => makeFakeKit(() => ADDRESS_A),
      ensureFreighterAccess: fakeEnsureFreighterAccess(),
      restoreWalletSilently: fakeRestoreWalletSilently(),
    }));
    const { WalletProvider: FreshProvider } = await import("@/lib/wallet/WalletContext");
    const { WriteActionButton: FreshButton } = await import("./WriteActionButton");

    const user = userEvent.setup();
    const prepare = vi.fn(async (address: string): Promise<Prepared<{ id: string }>> => ({
      tx: { id: "tx-1" },
      preparedFor: address,
    }));
    const confirm = vi.fn(async () => {
      throw new Error("Couldn't finalize this event: already finalized.");
    });
    const onSuccess = vi.fn();

    render(
      <FreshProvider>
        <FreshButton label="Finalize" prepare={prepare} confirm={confirm} onSuccess={onSuccess} />
      </FreshProvider>,
    );

    await connectWallet(user, "Connect wallet to finalize");
    await user.click(screen.getByRole("button", { name: "Finalize" }));
    await user.click(await screen.findByRole("button", { name: /confirm.*sign/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already finalized/i);
    expect(onSuccess).not.toHaveBeenCalled();

    vi.doUnmock("@/lib/wallet/kit");
  });

  it("shows a plain message, not a raw error, when Freighter access is denied before signing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/wallet/kit", () => ({
      getKit: async () => makeFakeKit(() => ADDRESS_A),
      // The real ensureFreighterAccess throws this exact plain message
      // (see lib/wallet/kit.test.ts) when requestAccess comes back
      // denied - stubbed here with the same message so this test
      // asserts the full stack surfaces it unchanged, not a raw
      // Freighter error object.
      ensureFreighterAccess: vi.fn(async () => {
        throw new Error("Freighter needs permission for this site. Connect Freighter, then try again.");
      }),
      restoreWalletSilently: fakeRestoreWalletSilently(),
    }));
    const { WalletProvider: FreshProvider } = await import("@/lib/wallet/WalletContext");
    const { WriteActionButton: FreshButton } = await import("./WriteActionButton");

    const user = userEvent.setup();
    const prepare = vi.fn(async (address: string): Promise<Prepared<{ id: string }>> => ({
      tx: { id: "tx-1" },
      preparedFor: address,
    }));
    const confirm = vi.fn(
      async (
        _prepared: Prepared<{ id: string }>,
        signer: { publicKey: string; signTransaction: (xdr: string) => Promise<unknown> },
      ) => {
        await signer.signTransaction("fake-xdr-to-sign"); // Throws before this ever resolves.
        return { txHash: "should-not-be-reached" };
      },
    );

    render(
      <FreshProvider>
        <FreshButton label="Finalize" prepare={prepare} confirm={confirm} />
      </FreshProvider>,
    );

    await connectWallet(user, "Connect wallet to finalize");
    await user.click(screen.getByRole("button", { name: "Finalize" }));
    await user.click(await screen.findByRole("button", { name: /confirm.*sign/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /freighter needs permission for this site\. connect freighter, then try again\./i,
    );
    expect(screen.queryByText(/finalize: done/i)).not.toBeInTheDocument();

    vi.doUnmock("@/lib/wallet/kit");
  });
});
