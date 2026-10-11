// Standalone write-path smoke check against LIVE testnet RPC. Builds
// and simulates (never signs, never sends - no auth, nothing hits
// chain) prepareFinalize and prepareCheckpointCure, proving the
// generated bindings' request/build/simulate/decode-the-error pipeline
// actually works end to end under the currently pinned SDK, something
// no mocked test can catch if a future SDK bump silently changes the
// wire shape (see web/app/README.md's "Write-path smoke test" section
// for when to run this).
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
import { prepareFinalize, prepareCheckpointCure } from "@/lib/event-actions";

// Event 0 (DEMOUSD, IssuerFreeze) - the deferred #38 merge check's own
// event, already finalized (state: Declared) by the time this smoke
// test was written. Deliberately reused rather than a fresh event:
// finalize/checkpoint_cure on an already-Declared event hits
// EventRegistry's WrongState check (error.rs: WrongState = 206,
// "A function's own required state (`Proposed`, `Escalated`, ...)
// does not match the event's current one.") on EVERY call, forever -
// a stable, deterministic simulation failure, not a flaky one. If a
// later PR needs to re-point this at a different id (this one gets
// pruned from the ring, or a cleaner stable target exists), keep the
// same shape: pick an event whose simulation failure is permanent and
// state-based, not timing-dependent.
const DEMOUSD_EVENT_ID = BigInt(0);

// Any funded testnet account works - simulation needs a real address
// to build the transaction's source account, but nothing here ever
// signs or submits, so this address's own key is never needed and
// never used. (event 0's real proposer, already public via
// stellar.expert from the #38 merge check - not a secret.)
const TEST_ADDRESS = "GBXYFBRIS5M7S2UDQ64AE4QHSJG7UIN6VRPDDAEBKP724V344GAL5MJP";

const WRONG_STATE_MESSAGE =
  "A function's own required state (`Proposed`, `Escalated`, ...)\ndoes not match the event's current one.";

describe("write-path smoke test (live testnet RPC, no signing)", () => {
  it("prepareFinalize builds, simulates, and decodes EventRegistry's WrongState (206) for an already-Declared event", async () => {
    await expect(prepareFinalize(DEMOUSD_EVENT_ID, TEST_ADDRESS)).rejects.toThrow(
      `Couldn't finalize this event: ${WRONG_STATE_MESSAGE}`,
    );
  });

  it("prepareCheckpointCure builds, simulates, and decodes EventRegistry's WrongState (206) for an already-Declared event", async () => {
    await expect(prepareCheckpointCure(DEMOUSD_EVENT_ID, TEST_ADDRESS)).rejects.toThrow(
      `Couldn't check the cure progress: ${WRONG_STATE_MESSAGE}`,
    );
  });
});
