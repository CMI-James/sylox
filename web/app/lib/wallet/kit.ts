import { NETWORK_PASSPHRASE } from "@/lib/contracts/deployment";

/**
 * The Stellar Wallets Kit bundles its OWN @stellar/stellar-sdk, which
 * now resolves to the exact same 17.2.1 this app itself pins (issue
 * #37's upgrade - `npm ls @stellar/stellar-sdk` shows one copy,
 * deduped). The XDR-strings-only rule below predates that upgrade,
 * written when the two sides ran different SDK majors and a
 * Transaction or other SDK object could fail type checks across
 * versions even when TypeScript compiled cleanly. Left in place for
 * now even though both sides match - issue #37's own plan is to drop
 * it in a later PR once the single-SDK-version upgrade has run in
 * production for a while, not to lift it in the same PR that landed
 * the upgrade. Nothing here imports a type or value from that bundled
 * SDK; everything that crosses the kit/app boundary is still a plain
 * XDR string, never a Transaction or other SDK object.
 *
 * Imported only from inside the wallet picker's open handler (never
 * from a module eagerly loaded on every page), and only the three
 * wallet modules this app actually offers (Freighter, xBull, Albedo -
 * each imported by its own subpath, not defaultModules(), which pulls
 * in every "no extra config" module the kit ships, including several
 * this app has no reason to list) - so the fetched bundle is only ever
 * what someone opening the connect modal could actually pick from.
 */
/**
 * Networks is a string enum whose TESTNET value is the exact same
 * passphrase deployments/testnet.json already carries - looked up by
 * value rather than importing Networks.TESTNET directly, so this
 * stays anchored to the deployment record (the app's one source of
 * truth for which network it's pointed at) instead of a second,
 * independent "testnet" constant that could silently drift from it.
 * No fallback to Networks.TESTNET: a passphrase that doesn't match any
 * known kit network is a real misconfiguration (a bad
 * deployments/testnet.json, or a future mainnet deploy the kit
 * doesn't recognize yet) and must fail loudly, not silently connect
 * wallets to the wrong network. A pure function so this one
 * easy-to-get-wrong rule - throw, never fall back - can be unit
 * tested directly, without going through the kit's own dynamic import.
 */
export function resolveKitNetwork(
  passphrase: string,
  knownNetworks: Record<string, string>,
): string {
  const network = Object.values(knownNetworks).find((n) => n === passphrase);
  if (!network) {
    throw new Error(`NETWORK_PASSPHRASE "${passphrase}" doesn't match any network the wallet kit knows about.`);
  }
  return network;
}

async function loadKit() {
  const [{ StellarWalletsKit, Networks }, { FreighterModule }, { xBullModule }, { AlbedoModule }] =
    await Promise.all([
      import("@creit.tech/stellar-wallets-kit"),
      import("@creit.tech/stellar-wallets-kit/modules/freighter"),
      import("@creit.tech/stellar-wallets-kit/modules/xbull"),
      import("@creit.tech/stellar-wallets-kit/modules/albedo"),
    ]);

  const network = resolveKitNetwork(NETWORK_PASSPHRASE, Networks);

  StellarWalletsKit.init({
    modules: [new FreighterModule(), new xBullModule(), new AlbedoModule()],
    network: network as (typeof Networks)[keyof typeof Networks],
  });

  return StellarWalletsKit;
}

// Matches FreighterModule.productId (@creit.tech/stellar-wallets-kit's
// own modules/freighter.js) - kept as a plain literal rather than an
// import, so checking "is Freighter the active wallet" never needs to
// load that module on its own; getKit() already loaded it once if
// Freighter was actually picked.
const FREIGHTER_ID = "freighter";

let kitPromise: ReturnType<typeof loadKit> | null = null;

/** Lazily loads and initializes the kit exactly once; every caller after the first gets the same in-flight/resolved promise. */
export function getKit() {
  if (!kitPromise) kitPromise = loadKit();
  return kitPromise;
}

/**
 * Restores a previously-connected wallet on page load, with no popup
 * and no network call that could prompt one - the kit itself already
 * persists `selectedModuleId`/`activeAddress` to localStorage
 * (`@StellarWalletsKit/selectedModuleId`, `@StellarWalletsKit/
 * activeAddress`) and seeds its own signals from them the moment it's
 * initialized (see `loadKit` above calling `StellarWalletsKit.init`),
 * so there is no separate key of this app's own to read - this
 * function's only job is deciding whether that already-restored state
 * is still trustworthy enough to show as connected.
 *
 * - No wallet was ever selected (or the persisted id matches none of
 *   this app's own modules): resolves `null`, nothing to restore.
 * - Freighter: the one wallet this kit version exposes a real
 *   permission check for. `isAllowed()` (no prompt) confirms the site
 *   still has access; only then does `kit.getAddress()` - reading the
 *   kit's own already-restored memory, not a fresh wallet round-trip -
 *   return the address. Not allowed (or no longer installed/unlocked,
 *   which `isAllowed` surfaces as `error` the same way): the kit's own
 *   saved state is cleared via `disconnect()` so a stale selection
 *   doesn't keep resurfacing on every future load, and this resolves
 *   `null`.
 * - xBull/Albedo: this kit version exposes no silent "is this still
 *   allowed" check for either (unlike Freighter's `isAllowed`), so the
 *   kit's own already-restored `activeAddress` is trusted as-is - the
 *   same thing every OTHER read in this app already does once
 *   connected, and exactly the restore behavior this kit ships by
 *   default. A truly stale xBull/Albedo permission surfaces at the
 *   next sign attempt instead, same as before this function existed.
 */
export async function restoreWalletSilently(): Promise<string | null> {
  const kit = await getKit();

  let selectedProductId: string;
  try {
    selectedProductId = kit.selectedModule.productId;
  } catch {
    return null; // Nothing was ever selected.
  }

  if (selectedProductId !== FREIGHTER_ID) {
    try {
      const { address } = await kit.getAddress();
      return address;
    } catch {
      return null;
    }
  }

  const { isAllowed } = await import("@stellar/freighter-api");
  const allowed = await isAllowed();
  if (allowed.error || !allowed.isAllowed) {
    await kit.disconnect(); // Clears the kit's own saved selection/address so this stale state doesn't keep resurfacing.
    return null;
  }

  try {
    const { address } = await kit.getAddress();
    return address;
  } catch {
    return null;
  }
}

/**
 * Freighter's own site permission is separate from (and can outlive or
 * fall behind) this app's in-memory `address` - the kit's
 * `fetchAddress()` requests access once, on first connect, but nothing
 * calls it again later. If that permission is revoked, or never
 * actually survived (e.g. the extension restarted, or the address was
 * restored into React state - say, via a fast refresh - without the
 * connect flow running again), signTransaction() fails with Freighter's
 * own raw error ("... is not currently connected to Freighter") even
 * though the app still shows a connected wallet. Freighter's
 * `isAllowed()` checks the real current permission with no prompt;
 * `requestAccess()` prompts only if actually needed. Call this right
 * before signing, not just once at connect time.
 */
export async function ensureFreighterAccess(): Promise<void> {
  const kit = await getKit();

  let selectedProductId: string;
  try {
    // `selectedModule` is a getter that THROWS a plain object
    // ({code: -3, message: "Please set the wallet first"}, never an
    // Error) when no wallet has been picked yet - caught here and
    // turned into the same plain-language message the rest of this
    // function already uses, so a caller never has to guard against
    // this rendering as "[object Object]".
    selectedProductId = kit.selectedModule.productId;
  } catch {
    throw new Error("No wallet connected. Connect a wallet, then try again.");
  }
  if (selectedProductId !== FREIGHTER_ID) return; // Only Freighter's permission model works this way.

  const { isAllowed, requestAccess } = await import("@stellar/freighter-api");
  const allowed = await isAllowed();
  if (allowed.error || !allowed.isAllowed) {
    const access = await requestAccess();
    if (access.error) {
      throw new Error("Freighter needs permission for this site. Connect Freighter, then try again.");
    }
  }
}
