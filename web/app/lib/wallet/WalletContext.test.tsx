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

const { restoreWalletSilently } = vi.hoisted(() => ({
  restoreWalletSilently: vi.fn(),
}));

vi.mock("./kit", async () => {
  const actual = await vi.importActual<typeof import("./kit")>("./kit");
  return {
    ...actual,
    restoreWalletSilently,
    getKit: async () => ({
      disconnect: vi.fn(async () => {}),
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
