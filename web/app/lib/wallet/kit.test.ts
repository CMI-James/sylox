import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveKitNetwork } from "./kit";

const FAKE_NETWORKS = {
  PUBLIC: "Public Global Stellar Network ; September 2015",
  TESTNET: "Test SDF Network ; September 2015",
  FUTURENET: "Test SDF Future Network ; October 2022",
};

describe("resolveKitNetwork", () => {
  it("returns the matching network passphrase", () => {
    expect(resolveKitNetwork(FAKE_NETWORKS.TESTNET, FAKE_NETWORKS)).toBe(FAKE_NETWORKS.TESTNET);
  });

  it("throws, rather than falling back to any default, when the passphrase matches no known network", () => {
    expect(() => resolveKitNetwork("some unrecognized passphrase", FAKE_NETWORKS)).toThrow(
      /doesn't match any network the wallet kit knows about/i,
    );
  });

  it("never silently returns TESTNET for an unmatched passphrase", () => {
    let result: string | null = null;
    try {
      result = resolveKitNetwork("not a real network", FAKE_NETWORKS);
    } catch {
      // expected
    }
    expect(result).toBeNull();
  });
});

/**
 * ensureFreighterAccess: Freighter's own site permission is separate
 * from this app's in-memory wallet state (see kit.ts's own doc
 * comment) - David's real finalize hit exactly this gap: signing
 * failed with Freighter's raw "not currently connected" error even
 * though the app showed a connected wallet. These mock the actual npm
 * packages kit.ts dynamically imports (@creit.tech/stellar-wallets-kit
 * and @stellar/freighter-api), not the @/lib/wallet/kit module itself,
 * so the real getKit()/ensureFreighterAccess() logic under test
 * actually runs.
 */
describe("ensureFreighterAccess", () => {
  const isAllowed = vi.fn();
  const requestAccess = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    isAllowed.mockReset();
    requestAccess.mockReset();
  });

  function mockKitModules(selectedProductId: string) {
    vi.doMock("@creit.tech/stellar-wallets-kit", () => ({
      StellarWalletsKit: {
        init: vi.fn(),
        get selectedModule() {
          return { productId: selectedProductId };
        },
      },
      Networks: FAKE_NETWORKS,
    }));
    vi.doMock("@creit.tech/stellar-wallets-kit/modules/freighter", () => ({
      FreighterModule: class {},
    }));
    vi.doMock("@creit.tech/stellar-wallets-kit/modules/xbull", () => ({ xBullModule: class {} }));
    vi.doMock("@creit.tech/stellar-wallets-kit/modules/albedo", () => ({ AlbedoModule: class {} }));
    vi.doMock("@stellar/freighter-api", () => ({ isAllowed, requestAccess }));
  }

  it("does nothing for a non-Freighter wallet - isAllowed/requestAccess are never called", async () => {
    mockKitModules("xbull");
    const { ensureFreighterAccess } = await import("./kit");

    await ensureFreighterAccess();

    expect(isAllowed).not.toHaveBeenCalled();
    expect(requestAccess).not.toHaveBeenCalled();
  });

  it("does nothing further when Freighter already allows the site", async () => {
    mockKitModules("freighter");
    isAllowed.mockResolvedValue({ isAllowed: true });
    const { ensureFreighterAccess } = await import("./kit");

    await expect(ensureFreighterAccess()).resolves.toBeUndefined();

    expect(isAllowed).toHaveBeenCalled();
    expect(requestAccess).not.toHaveBeenCalled();
  });

  it("requests access when Freighter no longer allows the site, and succeeds once access is granted", async () => {
    mockKitModules("freighter");
    isAllowed.mockResolvedValue({ isAllowed: false });
    requestAccess.mockResolvedValue({ address: "GFAKE" });
    const { ensureFreighterAccess } = await import("./kit");

    await expect(ensureFreighterAccess()).resolves.toBeUndefined();

    expect(requestAccess).toHaveBeenCalled();
  });

  it("throws a plain-language message, not a raw error, when access is denied", async () => {
    mockKitModules("freighter");
    isAllowed.mockResolvedValue({ isAllowed: false });
    requestAccess.mockResolvedValue({ error: { message: "User declined access" } });
    const { ensureFreighterAccess } = await import("./kit");

    await expect(ensureFreighterAccess()).rejects.toThrow(
      /freighter needs permission for this site\. connect freighter, then try again\./i,
    );
  });

  it("also requests access when isAllowed itself errors, treating that the same as not allowed", async () => {
    mockKitModules("freighter");
    isAllowed.mockResolvedValue({ isAllowed: false, error: { message: "internal error" } });
    requestAccess.mockResolvedValue({ address: "GFAKE" });
    const { ensureFreighterAccess } = await import("./kit");

    await expect(ensureFreighterAccess()).resolves.toBeUndefined();
    expect(requestAccess).toHaveBeenCalled();
  });
});
