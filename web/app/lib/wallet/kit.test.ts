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

const ADDRESS_A = "GCWWB2WYVRE4SSMASR6EMFQ7D3K6BEOLN5UQAXGS5YWPX2ZJ44JYKER5";
const ADDRESS_B = "GBXYFBRIS5M7S2UDQ64AE4QHSJG7UIN6VRPDDAEBKP724V344GAL5MJP";

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
  const getAddress = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    isAllowed.mockReset();
    requestAccess.mockReset();
    // Freighter's own current account defaults to matching
    // ADDRESS_A - most tests below pass ADDRESS_A as the app's
    // current address and aren't about the account-switch case at
    // all, so this keeps them from tripping over it by accident.
    getAddress.mockReset().mockResolvedValue({ address: ADDRESS_A });
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
    vi.doMock("@stellar/freighter-api", () => ({ isAllowed, requestAccess, getAddress }));
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
    vi.doMock("@stellar/freighter-api", () => ({ isAllowed, requestAccess, getAddress }));
  }

  it("does nothing for a non-Freighter wallet - isAllowed/requestAccess are never called", async () => {
    mockKitModules("xbull");
    const { ensureFreighterAccess } = await import("./kit");

    await ensureFreighterAccess(ADDRESS_A);

    expect(isAllowed).not.toHaveBeenCalled();
    expect(requestAccess).not.toHaveBeenCalled();
  });

  it("does nothing further when Freighter already allows the site and the account hasn't changed", async () => {
    mockKitModules("freighter");
    isAllowed.mockResolvedValue({ isAllowed: true });
    const { ensureFreighterAccess } = await import("./kit");

    await expect(ensureFreighterAccess(ADDRESS_A)).resolves.toBeUndefined();

    expect(isAllowed).toHaveBeenCalled();
    expect(requestAccess).not.toHaveBeenCalled();
  });

  it("requests access when Freighter no longer allows the site, and succeeds once access is granted", async () => {
    mockKitModules("freighter");
    isAllowed.mockResolvedValue({ isAllowed: false });
    requestAccess.mockResolvedValue({ address: ADDRESS_A });
    const { ensureFreighterAccess } = await import("./kit");

    await expect(ensureFreighterAccess(ADDRESS_A)).resolves.toBeUndefined();

    expect(requestAccess).toHaveBeenCalled();
  });

  it("throws a plain-language message, not a raw error, when access is denied", async () => {
    mockKitModules("freighter");
    isAllowed.mockResolvedValue({ isAllowed: false });
    requestAccess.mockResolvedValue({ error: { message: "User declined access" } });
    const { ensureFreighterAccess } = await import("./kit");

    await expect(ensureFreighterAccess(ADDRESS_A)).rejects.toThrow(
      /freighter needs permission for this site\. connect freighter, then try again\./i,
    );
  });

  it("also requests access when isAllowed itself errors, treating that the same as not allowed", async () => {
    mockKitModules("freighter");
    isAllowed.mockResolvedValue({ isAllowed: false, error: { message: "internal error" } });
    requestAccess.mockResolvedValue({ address: ADDRESS_A });
    const { ensureFreighterAccess } = await import("./kit");

    await expect(ensureFreighterAccess(ADDRESS_A)).resolves.toBeUndefined();
    expect(requestAccess).toHaveBeenCalled();
  });

  it("shows a plain message, not '[object Object]', when no wallet has been selected yet", async () => {
    mockKitModulesNoWalletSelected();
    const { ensureFreighterAccess } = await import("./kit");

    await expect(ensureFreighterAccess(ADDRESS_A)).rejects.toThrow(/connect a wallet, then try again\./i);
    // Never calls into Freighter at all - there's no wallet to check permission for yet.
    expect(isAllowed).not.toHaveBeenCalled();
    expect(requestAccess).not.toHaveBeenCalled();
  });

  /**
   * issue #59: a switch mid-visit. Access is fine (isAllowed: true),
   * but Freighter's own CURRENT account (getAddress) no longer
   * matches the address the app is about to sign with.
   */
  it("throws FreighterAccountSwitchedError with the new address when Freighter's current account differs from the app's", async () => {
    mockKitModules("freighter");
    isAllowed.mockResolvedValue({ isAllowed: true });
    getAddress.mockResolvedValue({ address: ADDRESS_B });
    const { ensureFreighterAccess, FreighterAccountSwitchedError } = await import("./kit");

    await expect(ensureFreighterAccess(ADDRESS_A)).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(FreighterAccountSwitchedError);
      expect((e as InstanceType<typeof FreighterAccountSwitchedError>).newAddress).toBe(ADDRESS_B);
      return true;
    });
  });

  it("FreighterAccountSwitchedError's own message names the new address in plain words", async () => {
    mockKitModules("freighter");
    isAllowed.mockResolvedValue({ isAllowed: true });
    getAddress.mockResolvedValue({ address: ADDRESS_B });
    const { ensureFreighterAccess } = await import("./kit");

    await expect(ensureFreighterAccess(ADDRESS_A)).rejects.toThrow(
      /your freighter account changed to.*check it's the one you want, then try again\./i,
    );
  });

  it("never throws the account-switch error when the addresses genuinely match", async () => {
    mockKitModules("freighter");
    isAllowed.mockResolvedValue({ isAllowed: true });
    getAddress.mockResolvedValue({ address: ADDRESS_A });
    const { ensureFreighterAccess } = await import("./kit");

    await expect(ensureFreighterAccess(ADDRESS_A)).resolves.toBeUndefined();
  });

  it("never throws the account-switch error when Freighter's own getAddress itself errors (nothing reliable to compare against)", async () => {
    mockKitModules("freighter");
    isAllowed.mockResolvedValue({ isAllowed: true });
    getAddress.mockResolvedValue({ address: "", error: { message: "could not read address" } });
    const { ensureFreighterAccess } = await import("./kit");

    await expect(ensureFreighterAccess(ADDRESS_A)).resolves.toBeUndefined();
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
  const freighterGetAddress = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    isAllowed.mockReset();
    disconnect.mockReset().mockResolvedValue(undefined);
    freighterGetAddress.mockReset();
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
        // getAddress (freighterGetAddress below), which is the LIVE
        // current account.
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
    vi.doMock("@stellar/freighter-api", () => ({ isAllowed, getAddress: freighterGetAddress }));
  }

  it("resolves null, with no wallet or network calls, when nothing was ever selected", async () => {
    mockKitModules({});
    const { restoreWalletSilently } = await import("./kit");

    await expect(restoreWalletSilently()).resolves.toBeNull();
    expect(isAllowed).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("restores the cached address for Freighter when isAllowed is true and it matches Freighter's live current account", async () => {
    mockKitModules({ selectedProductId: "freighter", getAddressResult: { address: "GFREIGHTER" } });
    isAllowed.mockResolvedValue({ isAllowed: true });
    freighterGetAddress.mockResolvedValue({ address: "GFREIGHTER" });
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

  /**
   * issue #59: a restore with a mismatch. The kit's own cache
   * (persisted the last time the app ran) says one address; Freighter
   * itself (the visitor switched accounts in the extension since then)
   * says a different one. The live one wins.
   */
  it("returns Freighter's live current address, not the kit's stale cached one, when they differ", async () => {
    mockKitModules({ selectedProductId: "freighter", getAddressResult: { address: ADDRESS_A } });
    isAllowed.mockResolvedValue({ isAllowed: true });
    freighterGetAddress.mockResolvedValue({ address: ADDRESS_B });
    const { restoreWalletSilently } = await import("./kit");

    await expect(restoreWalletSilently()).resolves.toBe(ADDRESS_B);
  });

  it("returns the cached address unchanged when it matches Freighter's live current account", async () => {
    mockKitModules({ selectedProductId: "freighter", getAddressResult: { address: ADDRESS_A } });
    isAllowed.mockResolvedValue({ isAllowed: true });
    freighterGetAddress.mockResolvedValue({ address: ADDRESS_A });
    const { restoreWalletSilently } = await import("./kit");

    await expect(restoreWalletSilently()).resolves.toBe(ADDRESS_A);
  });

  it("falls back to the kit's cached address when Freighter's own getAddress itself errors (nothing reliable to compare against)", async () => {
    mockKitModules({ selectedProductId: "freighter", getAddressResult: { address: ADDRESS_A } });
    isAllowed.mockResolvedValue({ isAllowed: true });
    freighterGetAddress.mockResolvedValue({ address: "", error: { message: "could not read address" } });
    const { restoreWalletSilently } = await import("./kit");

    await expect(restoreWalletSilently()).resolves.toBe(ADDRESS_A);
  });
});
