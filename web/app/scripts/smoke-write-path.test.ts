// Standalone write-path smoke check against LIVE testnet RPC. Builds
// and simulates (never signs, never sends - no auth, nothing hits
// chain) prepareFinalize and prepareCheckpointCure, proving
// @sylox/sdk's request/build/simulate/decode-the-error pipeline
// actually works end to end under the currently pinned SDK - including
// errors.ts's own extractErrorCode, which depends on the real
// simulation diagnostic's exact `Error(Contract, #<code>)` shape, not
// just a mocked one. Nothing a mocked test alone can catch if a future
// SDK bump silently changes either wire shape (see
// web/app/README.md's "Write-path smoke test" section for when to run
// this).
//
// Deliberately NOT part of `npm test` or CI's gate: vitest.config.ts
// excludes this exact file by name, so the default run (and any
// plain filtered `vitest run <pattern>`) skips it. Run it explicitly
// via `npm run smoke:write-path -w web/app`, which points at a
// separate config (vitest.smoke.config.ts) that includes ONLY this
// file. Written as a Vitest file (real assertions, not
// console.log-and-hope) because Vitest is already configured for this
// project's path aliases (@/) and TypeScript - not because this is
// meant to run alongside the rest of the suite.
import { describe, it, expect } from "vitest";
import { Networks, SyloxError, prepareFinalize, prepareCheckpointCure } from "@sylox/sdk";

// Event 0 (DEMOUSD, IssuerFreeze) - the deferred #38 merge check's own
// event. Deliberately reused rather than a fresh event, same reasoning
// as always: finalize/checkpoint_cure on this id's eventual state hits
// a permanent, state-based simulation failure, never a flaky one. This
// test accepts TWO deterministic outcomes rather than hardcoding one
// (see packages/sdk/scripts/smoke.mjs's own identical fix, commit
// 3772358, "Smoke test: accept UnknownEvent or WrongState for event 0,
// not just the latter"): on the current redeployed EventRegistry,
// event 0 doesn't exist yet (the DEMOUSD trigger script hasn't run),
// so finalize(0)/checkpoint_cure(0) hit UnknownEvent (215) rather than
// WrongState (206). Once the trigger runs and the real event 0 exists
// (already past finalize-able state, as the original DEMOUSD event
// always had by the time this smoke test was first written),
// WrongState (206) becomes the right answer again - same shape, no
// further test change needed either way.
const DEMOUSD_EVENT_ID = BigInt(0);

// Any funded testnet account works - simulation needs a real address
// to build the transaction's source account, but nothing here ever
// signs or submits, so this address's own key is never needed and
// never used. (event 0's real proposer, already public via
// stellar.expert from the #38 merge check - not a secret.)
const TEST_ADDRESS = "GBXYFBRIS5M7S2UDQ64AE4QHSJG7UIN6VRPDDAEBKP724V344GAL5MJP";

const TEST_SIGNER = {
  publicKey: TEST_ADDRESS,
  // Never actually called - both expected outcomes below are plain
  // simulation errors, not an archived-entry restore, so
  // prepareFinalize/prepareCheckpointCure never reach signAndSend.
  signTransaction: async () => {
    throw new Error("signTransaction should never be called for either expected outcome in this smoke test");
  },
};

/** Asserts the error is a SyloxError matching one of two known-acceptable (code, contractErrorName) outcomes - see DEMOUSD_EVENT_ID's own doc comment for why both are legitimate right now. */
function expectKnownOutcome(e: unknown, acceptable: Array<{ code: number; contractErrorName: string }>) {
  expect(e).toBeInstanceOf(SyloxError);
  const error = e as SyloxError;
  const matched = acceptable.some((a) => a.code === error.code && a.contractErrorName === error.contractErrorName);
  if (!matched) {
    throw new Error(
      `Unexpected SyloxError: code=${error.code}, contractErrorName=${error.contractErrorName}, message=${error.message}. Expected one of: ${JSON.stringify(acceptable)}.`,
    );
  }
}

describe("write-path smoke test (live testnet RPC, no signing)", () => {
  it("prepareFinalize builds, simulates, and decodes EventRegistry's error (UnknownEvent or WrongState) as a typed SyloxError with the plain user-facing sentence, never the raw contract doc comment", { timeout: 20_000 }, async () => {
    let caught: unknown;
    try {
      await prepareFinalize(Networks.Testnet, DEMOUSD_EVENT_ID, TEST_SIGNER);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expectKnownOutcome(caught, [
      { code: 215, contractErrorName: "UnknownEvent" },
      { code: 206, contractErrorName: "WrongState" },
    ]);
    const error = caught as SyloxError;
    expect(error.message).toMatch(/this event no longer exists\.|this event has already moved past this step\./i);
  });

  it("prepareCheckpointCure builds, simulates, and decodes EventRegistry's error (UnknownEvent or WrongState) as a typed SyloxError with the plain user-facing sentence, never the raw contract doc comment", { timeout: 20_000 }, async () => {
    let caught: unknown;
    try {
      await prepareCheckpointCure(Networks.Testnet, DEMOUSD_EVENT_ID, TEST_SIGNER);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expectKnownOutcome(caught, [
      { code: 215, contractErrorName: "UnknownEvent" },
      { code: 206, contractErrorName: "WrongState" },
    ]);
    const error = caught as SyloxError;
    expect(error.message).toMatch(
      /this event no longer exists\.|this event has already moved past this step, or doesn't use a cure check\./i,
    );
  });
});
