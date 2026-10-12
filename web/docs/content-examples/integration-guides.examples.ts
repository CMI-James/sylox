// Literal source for the fenced ```ts code blocks in
// ../content/docs/integration-guides.mdx. Each exported function below
// is copied, verbatim between its START/END markers, into that page's
// prose. scripts/check-doc-examples.test.ts asserts the two stay
// byte-identical, and this file itself is included by the workspace's
// own tsconfig.json ("**/*.ts"), so `npm run typecheck -w web/docs`
// (already wired into CI's `docs` job) fails the build the moment an
// example calls something that doesn't exist on the real @sylox/sdk.
//
// Every example here is written against the real, current SDK surface
// (packages/sdk/src/index.ts and what it re-exports) - never the
// technical-doc.md Section 20 pseudocode, which predates the SDK and
// names methods (al.markets, al.staking) that were never built.
import { Sylox, Networks, type Signer } from "@sylox/sdk";

declare const walletSigner: Signer;

// START show-issuer-risk
export async function showIssuerRisk(al: Sylox, issuedAsset: string) {
  const band = await al.oracle.band(issuedAsset);
  const stale = await al.oracle.isStale(issuedAsset);

  if (stale) {
    return "Data stale";
  }
  switch (band.tag) {
    case "Normal":
      return "Normal";
    case "Watch":
      return "Watch";
    case "Warning":
      return "Warning";
    case "Distress":
      return "Distress";
    case "Event":
      return "Event";
  }
}
// END show-issuer-risk

// START check-before-buying
export async function checkBeforeBuying(al: Sylox, issuedAsset: string) {
  const stale = await al.oracle.isStale(issuedAsset);
  const { band } = await al.oracle.score(issuedAsset);
  const gate = await al.events.coverGate(issuedAsset);

  const blocked = stale || band.tag === "Distress" || band.tag === "Event" || gate.tag !== "Clear";
  return { blocked, band: band.tag, gate: gate.tag };
}
// END check-before-buying

// START read-definitions
export async function readDepegDefinition(al: Sylox, issuedAsset: string) {
  const status = await al.events.status(issuedAsset, "Depeg");
  return status;
}
// END read-definitions

// START watch-for-events
export async function watchForDeclaredEvent(al: Sylox, issuedAsset: string) {
  const { events } = await al.events.list({ limit: 10 });
  return events.filter((event) => event.asset === issuedAsset && event.state.tag === "Declared");
}
// END watch-for-events

// START propose-and-challenge
export async function proposeAndChallenge(al: Sylox, issuedAsset: string, suspectEventId: bigint, evidenceHash: Uint8Array) {
  const proposed = await al.events.proposeTier1(issuedAsset, "Depeg");
  const challenged = await al.events.challenge(suspectEventId, evidenceHash);
  return { proposed, challenged };
}
// END propose-and-challenge

// Shows a signer actually being wired into a Sylox instance, since the
// examples above all take `al` as a parameter rather than constructing
// one themselves - this is the one place that constructs it, matching
// the pattern used throughout sdk-reference.mdx.
export const al: Sylox = new Sylox({ network: Networks.Testnet, signer: walletSigner });
