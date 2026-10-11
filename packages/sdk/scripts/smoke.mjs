#!/usr/bin/env node
// Live smoke script (per the brief, modeled on issue #55 / the web
// app's own scripts/smoke-write-path.test.ts): read USDC's score and
// live reading, read event 0, and simulate finalize(0) expecting
// WrongState. Run by hand against live testnet; output pasted verbatim
// into this PR's description. Written as plain Node (.mjs), not a
// vitest file, since this is meant to be run directly with no test
// runner - it hits live RPC and is never part of `npm test`.
//
// Uses testnetDeployment's existing addresses (the tracked USDC SAC id
// from deployments/testnet.json) and event id 0 - the same already-
// Declared/finalized event web/app/scripts/smoke-write-path.test.ts
// uses, so finalize(0) is guaranteed to hit WrongState deterministically.
import { Sylox, Networks } from "../dist/index.js";

// The tracked USDC SAC id (deployments/testnet.json's own
// `tracked_asset.contract_id`) - not re-exported through
// Networks.Testnet (out of this PR's `riskOracle`/`eventRegistry`-only
// scope), so read directly here, the same address the brief's own
// smoke-test description names.
const TRACKED_USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const EVENT_ID = 0n;

async function main() {
  const al = new Sylox({ network: Networks.Testnet });

  console.log("== Networks.Testnet ==");
  console.log(JSON.stringify(Networks.Testnet, null, 2));

  console.log("\n== al.oracle.score(USDC) ==");
  try {
    const score = await al.oracle.score(TRACKED_USDC_SAC);
    console.log({
      band: score.band.tag,
      epoch: score.epoch.toString(),
      formulaVersion: score.formula_version,
      score: score.score,
      stale: score.stale,
    });
  } catch (e) {
    console.log("score() threw:", e.name, e.message, "code:", e.code, "contractErrorName:", e.contractErrorName);
  }

  console.log("\n== al.oracle.live(USDC) ==");
  try {
    const live = await al.oracle.live(TRACKED_USDC_SAC);
    if (live === null) {
      console.log("live() -> null (no live reading posted yet)");
    } else {
      const [subEpoch, signalSet, slotState] = live;
      console.log({
        subEpoch,
        signalSet: {
          peg_ratio: signalSet.peg_ratio?.toString?.() ?? signalSet.peg_ratio,
          posted_at: signalSet.posted_at?.toString?.() ?? signalSet.posted_at,
        },
        slotState: slotState.tag,
      });
    }
  } catch (e) {
    console.log("live() threw:", e.name, e.message);
  }

  console.log("\n== al.events.event(0) ==");
  try {
    const event = await al.events.event(EVENT_ID);
    if (event === null) {
      console.log("event(0) -> null (no such event)");
    } else {
      console.log({
        id: event.id.toString(),
        asset: event.asset,
        kind: event.kind.tag,
        state: event.state.tag,
        proposedAt: event.proposed_at.toString(),
        declaredAt: event.declared_at === null ? null : event.declared_at.toString(),
      });
    }
  } catch (e) {
    console.log("event(0) threw:", e.name, e.message);
  }

  console.log("\n== simulate finalize(0) - expecting WrongState (206) ==");
  try {
    const { prepareFinalize } = await import("../dist/events/actions.js");
    // PR #69 review, required fix #2: prepare* now takes the full
    // Signer (needed so a genuine restore mid-prepare can actually
    // sign/submit - see events/restore.ts), not a bare address string.
    // This smoke run never reaches that path (event 0 is expected to
    // already be past finalize-able state, a plain simulation error,
    // not an archived-entry restore), so a signTransaction that throws
    // if ever actually invoked is enough to prove the call shape without
    // needing a real wallet here.
    const stubSigner = {
      publicKey: "GBXYFBRIS5M7S2UDQ64AE4QHSJG7UIN6VRPDDAEBKP724V344GAL5MJP",
      signTransaction: async () => {
        throw new Error("smoke.mjs: signTransaction should not be called for this deterministic WrongState case.");
      },
    };
    await prepareFinalize(Networks.Testnet, EVENT_ID, stubSigner);
    console.log("UNEXPECTED: prepareFinalize did not throw.");
    process.exitCode = 1;
  } catch (e) {
    console.log("prepareFinalize threw (expected):");
    console.log("  name:", e.name);
    console.log("  message:", e.message);
    console.log("  code:", e.code);
    console.log("  contractErrorName:", e.contractErrorName);
    if (e.code !== 206 || e.contractErrorName !== "WrongState") {
      console.log("UNEXPECTED: expected code 206 / WrongState.");
      process.exitCode = 1;
    }
  }
}

main().catch((e) => {
  console.error("smoke script failed:", e);
  process.exitCode = 1;
});
