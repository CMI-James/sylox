// Literal source for the fenced ```ts code blocks in
// ../content/docs/sdk-reference.mdx. Each exported member below is
// copied, verbatim between its START/END markers, into that page's
// prose. scripts/check-doc-examples.test.ts asserts the two stay
// byte-identical, and this file itself is included by the workspace's
// own tsconfig.json ("**/*.ts"), so `npm run typecheck -w web/docs`
// (already wired into CI's `docs` job) fails the build the moment an
// example calls something that doesn't exist on the real @sylox/sdk.
//
// Written against the real, current SDK surface (packages/sdk/src/
// index.ts and what it re-exports), not technical-doc.md Section 19's
// own pseudocode, which predates the SDK (al.markets/al.staking/
// stream.onBandChanged were never built - see this PR's description).
import {
  Sylox,
  Networks,
  SyloxError,
  noopCacheAdapter,
  prepareFinalize,
  confirmFinalize,
  type Signer,
  type CacheAdapter,
} from "@sylox/sdk";

declare const walletSigner: Signer;

// START construct
export const al = new Sylox({
  network: Networks.Testnet,
  signer: walletSigner,
});
// END construct

// START read-only-construct
export const readOnly = new Sylox({ network: Networks.Testnet });
// END read-only-construct

// START read-oracle
export async function readOracle(issuedAsset: string) {
  const assets = await al.oracle.assets();
  const riskScore = await al.oracle.score(issuedAsset);
  const stale = await al.oracle.isStale(issuedAsset);
  return { assets, riskScore, stale };
}
// END read-oracle

// START read-events
export async function readEvents(issuedAsset: string) {
  const status = await al.events.status(issuedAsset, "Depeg");
  const gate = await al.events.coverGate(issuedAsset);
  const { events } = await al.events.list({ limit: 20 });
  return { status, gate, events };
}
// END read-events

// START write-propose
export async function proposeDepeg(issuedAsset: string) {
  const result = await al.events.proposeTier1(issuedAsset, "Depeg");
  return result; // { result: bigint (the new event id), txHash }
}
// END write-propose

// START write-finalize-prepare-confirm
export async function finalizeEvent(eventId: bigint, signer: Signer) {
  const prepared = await prepareFinalize(Networks.Testnet, eventId, signer);
  // Inspect `prepared` here if you want to show the user a confirmation
  // step before signing: the transaction has already been simulated,
  // so a failure would have thrown before this line.
  const sent = await confirmFinalize(prepared, signer);
  return sent.txHash;
}
// END write-finalize-prepare-confirm

// START error-shape
export async function describeFailure(issuedAsset: string) {
  try {
    await al.oracle.score(issuedAsset);
  } catch (e) {
    if (e instanceof SyloxError) {
      return { code: e.code, contractErrorName: e.contractErrorName, message: e.message };
    }
    throw e;
  }
}
// END error-shape

// START cache-adapter
export const sessionCacheAdapter: CacheAdapter = {
  get(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // A full or unavailable sessionStorage is a cache miss, not a failure.
    }
  },
};

export const alWithCache = new Sylox({
  network: Networks.Testnet,
  signer: walletSigner,
  cacheAdapter: sessionCacheAdapter,
});
// END cache-adapter

// START default-cache-adapter
export const defaultCacheAdapter: CacheAdapter = noopCacheAdapter;
// END default-cache-adapter
