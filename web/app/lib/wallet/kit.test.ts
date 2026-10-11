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

  /** The real kit's own `selectedModule` getter when no wallet has ever been set (see kit.js: `throw { code: -3, message: "Please set the wallet first" }`) - a plain object, never an Error. */
  function mockKitModulesNoWalletSelected() {
    vi.doMock("@creit.tech/stellar-wallets-kit", () => ({
      StellarWalletsKit: {
        init: vi.fn(),
        get selectedModule(): never {
          throw { code: -3, message: "Please set the wallet first" };
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

  it("shows a plain message, not '[object Object]', when no wallet has been selected yet", async () => {
    mockKitModulesNoWalletSelected();
    const { ensureFreighterAccess } = await import("./kit");

    await expect(ensureFreighterAccess()).rejects.toThrow(
      /connect a wallet, then try again\./i,
    );
    // Never calls into Freighter at all - there's no wallet to check permission for yet.
    expect(isAllowed).not.toHaveBeenCalled();
    expect(requestAccess).not.toHaveBeenCalled();
  });
});

/**
 * restoreWalletSilently: the kit itself already persists
 * selectedModuleId/activeAddress to localStorage and seeds its own
 * signals from them - this function only decides whether that
 * already-restored state is still trustworthy enough to surface as
 * connected, with NO popup and NO network call that could prompt one.
 */
describe("restoreWalletSilently", () => {
  const isAllowed = vi.fn();
  const disconnect = vi.fn(async () => {});

  beforeEach(() => {
    vi.resetModules();
    isAllowed.mockReset();
    disconnect.mockReset().mockResolvedValue(undefined);
  });

  function mockKitModules(opts: { selectedProductId?: string; getAddressResult?: { address: string } }) {
    vi.doMock("@creit.tech/stellar-wallets-kit", () => ({
      StellarWalletsKit: {
        init: vi.fn(),
        get selectedModule() {
          if (!opts.selectedProductId) throw { code: -3, message: "Please set the wallet first" };
          return { productId: opts.selectedProductId };
        },
        // StellarWalletsKit's own static getAddress() - reads its
        // already-restored in-memory activeAddress, never a wallet
        // round-trip. Distinct from @stellar/freighter-api's own
        // getAddress, which restoreWalletSilently never calls.
        getAddress: vi.fn(async () => {
          if (opts.getAddressResult) return opts.getAddressResult;
          throw { code: -1, message: "No wallet has been connected." };
        }),
        disconnect,
      },
      Networks: FAKE_NETWORKS,
    }));
    vi.doMock("@creit.tech/stellar-wallets-kit/modules/freighter", () => ({
      FreighterModule: class {},
    }));
    vi.doMock("@creit.tech/stellar-wallets-kit/modules/xbull", () => ({ xBullModule: class {} }));
    vi.doMock("@creit.tech/stellar-wallets-kit/modules/albedo", () => ({ AlbedoModule: class {} }));
    vi.doMock("@stellar/freighter-api", () => ({ isAllowed }));
  }

  it("resolves null, with no wallet or network calls, when nothing was ever selected", async () => {
    mockKitModules({});
    const { restoreWalletSilently } = await import("./kit");

    await expect(restoreWalletSilently()).resolves.toBeNull();
    expect(isAllowed).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("restores the address for Freighter when isAllowed is true, with no requestAccess call", async () => {
    mockKitModules({ selectedProductId: "freighter", getAddressResult: { address: "GFREIGHTER" } });
    isAllowed.mockResolvedValue({ isAllowed: true });
    const { restoreWalletSilently } = await import("./kit");

    await expect(restoreWalletSilently()).resolves.toBe("GFREIGHTER");
    expect(isAllowed).toHaveBeenCalled();
  });

  it("clears the kit's saved state and resolves null when Freighter no longer allows the site", async () => {
    mockKitModules({ selectedProductId: "freighter", getAddressResult: { address: "GFREIGHTER" } });
    isAllowed.mockResolvedValue({ isAllowed: false });
    const { restoreWalletSilently } = await import("./kit");

    await expect(restoreWalletSilently()).resolves.toBeNull();
    expect(disconnect).toHaveBeenCalled();
  });

  it("clears the kit's saved state and resolves null when isAllowed itself errors (wallet locked or missing)", async () => {
    mockKitModules({ selectedProductId: "freighter", getAddressResult: { address: "GFREIGHTER" } });
    isAllowed.mockResolvedValue({ isAllowed: false, error: { message: "not installed" } });
    const { restoreWalletSilently } = await import("./kit");

    await expect(restoreWalletSilently()).resolves.toBeNull();
    expect(disconnect).toHaveBeenCalled();
  });

  it("trusts the kit's own already-restored address for a non-Freighter wallet (xBull/Albedo), with no permission check available", async () => {
    mockKitModules({ selectedProductId: "xbull", getAddressResult: { address: "GXBULL" } });
    const { restoreWalletSilently } = await import("./kit");

    await expect(restoreWalletSilently()).resolves.toBe("GXBULL");
    expect(isAllowed).not.toHaveBeenCalled();
  });

  it("resolves null for a non-Freighter wallet if the kit itself has nothing restored", async () => {
    mockKitModules({ selectedProductId: "xbull" }); // No getAddressResult - kit.getAddress() throws.
    const { restoreWalletSilently } = await import("./kit");

    await expect(restoreWalletSilently()).resolves.toBeNull();
  });
});
