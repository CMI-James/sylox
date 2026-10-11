import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WalletProvider, useWallet } from "./WalletContext";

function AddressProbe() {
  const { address } = useWallet();
  return <p data-testid="address">{address ?? "none"}</p>;
}

function DisconnectProbe() {
  const { address, disconnect } = useWallet();
  return (
    <div>
      <p data-testid="address">{address ?? "none"}</p>
      <button type="button" onClick={disconnect}>
        Disconnect
      </button>
    </div>
  );
}

function SignProbe() {
  const { address, signTransaction } = useWallet();
  const [signError, setSignError] = useState<string | null>(null);
  return (
    <div>
      <p data-testid="address">{address ?? "none"}</p>
      <p data-testid="sign-error">{signError ?? "none"}</p>
      <button
        type="button"
        onClick={() => {
          signTransaction("fake-xdr").catch((e: unknown) => {
            setSignError(e instanceof Error ? e.message : String(e));
          });
        }}
      >
        Sign
      </button>
    </div>
  );
}

const { restoreWalletSilently, ensureFreighterAccess } = vi.hoisted(() => ({
  restoreWalletSilently: vi.fn(),
  ensureFreighterAccess: vi.fn(async () => {}),
}));

vi.mock("./kit", async () => {
  const actual = await vi.importActual<typeof import("./kit")>("./kit");
  return {
    ...actual,
    restoreWalletSilently,
    ensureFreighterAccess,
    getKit: async () => ({
      disconnect: vi.fn(async () => {}),
      signTransaction: vi.fn(async () => ({ signedTxXdr: "fake-signed-xdr" })),
    }),
  };
});

describe("WalletProvider - silent restore on mount", () => {
  beforeEach(() => {
    restoreWalletSilently.mockReset();
  });

  it("restores a previously-connected address with no popup, e.g. after a reload with an allowed site", async () => {
    restoreWalletSilently.mockResolvedValue("GRESTORED");

    render(
      <WalletProvider>
        <AddressProbe />
      </WalletProvider>,
    );

    expect(screen.getByTestId("address")).toHaveTextContent("none"); // Not yet - the restore is async.
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("GRESTORED"));

    // No dialog/modal of any kind was opened to get there.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("falls back to showing Connect (no address) when there's nothing to restore, e.g. after permission was revoked", async () => {
    restoreWalletSilently.mockResolvedValue(null);

    render(
      <WalletProvider>
        <AddressProbe />
      </WalletProvider>,
    );

    await waitFor(() => expect(restoreWalletSilently).toHaveBeenCalled());
    expect(screen.getByTestId("address")).toHaveTextContent("none");
  });

  it("falls back to Connect, not an error, when the silent restore itself rejects", async () => {
    restoreWalletSilently.mockRejectedValue(new Error("boom"));

    render(
      <WalletProvider>
        <AddressProbe />
      </WalletProvider>,
    );

    await waitFor(() => expect(restoreWalletSilently).toHaveBeenCalled());
    expect(screen.getByTestId("address")).toHaveTextContent("none");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("navigating between pages never remounts the provider, so a restored address survives it (WalletProvider is mounted once, at the root layout - see app/layout.tsx)", async () => {
    restoreWalletSilently.mockResolvedValue("GRESTORED");

    const { rerender } = render(
      <WalletProvider>
        <AddressProbe />
      </WalletProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("GRESTORED"));

    // Simulates a client-side navigation: the provider's own
    // component instance is never torn down and recreated (next/link
    // swaps `children` under the same root layout, never the
    // WalletProvider itself) - restoreWalletSilently must not be
    // called again just because the page content changed underneath it.
    restoreWalletSilently.mockClear();
    rerender(
      <WalletProvider>
        <AddressProbe />
        <p>a different page&apos;s content</p>
      </WalletProvider>,
    );

    expect(screen.getByTestId("address")).toHaveTextContent("GRESTORED");
    expect(restoreWalletSilently).not.toHaveBeenCalled();
  });
});

describe("WalletProvider - disconnect", () => {
  beforeEach(() => {
    restoreWalletSilently.mockReset().mockResolvedValue(null);
  });

  it("clears the address immediately on disconnect", async () => {
    restoreWalletSilently.mockResolvedValue("GRESTORED");
    const user = (await import("@testing-library/user-event")).default.setup();

    render(
      <WalletProvider>
        <DisconnectProbe />
      </WalletProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("GRESTORED"));

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(screen.getByTestId("address")).toHaveTextContent("none");
  });
});

/**
 * issue #59: a Freighter account switch mid-visit (not at restore
 * time - WalletContext already has a connected `address`, and the
 * visitor switches accounts in the Freighter extension before
 * clicking a write action). ensureFreighterAccess itself is mocked
 * directly here (its own real logic, including the live-vs-current
 * comparison, is covered by kit.test.ts) - this exercises
 * WalletContext.signTransaction's own handling of what it throws:
 * updating the displayed address and stopping before ever calling
 * kit.signTransaction.
 */
describe("WalletProvider - signTransaction on a mid-visit Freighter account switch", () => {
  beforeEach(() => {
    restoreWalletSilently.mockReset().mockResolvedValue("GORIGINAL");
    ensureFreighterAccess.mockReset();
  });

  it("updates the displayed address and stops the sign, without ever calling kit.signTransaction", async () => {
    const { FreighterAccountSwitchedError } = await import("./kit");
    ensureFreighterAccess.mockRejectedValue(new FreighterAccountSwitchedError("GSWITCHEDTO"));
    const user = (await import("@testing-library/user-event")).default.setup();

    render(
      <WalletProvider>
        <SignProbe />
      </WalletProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("GORIGINAL"));

    await user.click(screen.getByRole("button", { name: "Sign" }));

    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("GSWITCHEDTO"));
    expect(screen.getByTestId("sign-error")).toHaveTextContent(
      /your freighter account changed to.*check it's the one you want, then try again\./i,
    );
  });

  it("signs normally, with no address change, when the account hasn't switched", async () => {
    ensureFreighterAccess.mockResolvedValue(undefined);
    const user = (await import("@testing-library/user-event")).default.setup();

    render(
      <WalletProvider>
        <SignProbe />
      </WalletProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("GORIGINAL"));

    await user.click(screen.getByRole("button", { name: "Sign" }));

    await waitFor(() => expect(screen.getByTestId("sign-error")).toHaveTextContent("none"));
    expect(screen.getByTestId("address")).toHaveTextContent("GORIGINAL"); // Unchanged.
  });
});
