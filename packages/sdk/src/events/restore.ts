import { rpc } from "@stellar/stellar-sdk";
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { SyloxError } from "../errors.js";

/**
 * Section 19.7: "If simulation reports archived entries, the SDK
 * builds and submits a restore transaction first (with user consent
 * callback)." Threaded through every prepare* call in actions.ts as an
 * optional `onRestoreNeeded` callback.
 *
 * Mechanism (confirmed directly against this package's own pinned
 * @stellar/stellar-sdk 17.2.1 type defs, the same way
 * errors.ts's extractErrorCode already confirms `rpc.Api.isSimulationError`):
 * `tx.simulation` can be a `SimulateTransactionRestoreResponse`
 * (checked via `rpc.Api.isSimulationRestore`, a real, documented type
 * guard - "Checks if a simulation response indicates that a
 * restoration is needed"), which carries a `restorePreamble:
 * {minResourceFee, transactionData}`. `AssembledTransaction` itself
 * exposes a `restoreFootprint(restorePreamble, account?)` method that
 * builds, signs (via the Client's own configured signTransaction) and
 * submits the restore transaction, then returns the network response -
 * exactly the "builds and submits a restore transaction" the brief
 * asks for, not a stub.
 *
 * Implemented for real (not just the callback's signature/shape) since
 * the mechanism IS there and IS type-checkable in this exact pinned SDK
 * version - the brief's own fallback ("if the mechanism genuinely isn't
 * there or is too uncertain to get right... throw a clear SyloxError")
 * doesn't apply here. What's NOT verified live (no reproducible way to
 * force a real archived ledger entry against a freshly-deployed
 * testnet contract within this PR's scope) is the end-to-end restore
 * flow actually succeeding against live testnet - call this a partial
 * verification, noted explicitly in the PR description: the TYPE-LEVEL
 * mechanism and control flow are real and type-checked, the live
 * restore-and-resubmit path itself is unexercised by the smoke test.
 *
 * PR #69 review, required fix #2: `tx.restoreFootprint(...)` below
 * signs and submits its OWN transaction, separate from the caller's
 * original write - and @stellar/stellar-sdk's AssembledTransaction
 * requires `signTransaction` to have been supplied when the Client that
 * built `tx` was CONSTRUCTED, not merely by the time a later
 * `signAndSend` call provides one (confirmed directly against
 * restoreFootprint's own doc comment: "A signTransaction function must
 * be provided during the Client initialization" / "Throws an error if
 * no signTransaction function is provided during Client
 * initialization"). Previously, every prepare* in actions.ts built its
 * client from a bare `address: string` with no signer at all, so this
 * function's `await tx.restoreFootprint(...)` call below would have
 * thrown that exact error the first time a real restore was ever
 * needed - the mechanism was real and type-checked, as the paragraph
 * above says, but NOT actually reachable end-to-end. Fixed by having
 * every prepare* accept the full `Signer` and pass it into
 * eventRegistryClient (contracts/event-registry.ts), which now wires
 * `signTransaction` into the Client at construction time - so by the
 * time this function runs, `tx` already carries a working signer and
 * `restoreFootprint` can actually sign and submit.
 */
export interface RestoreNeeded {
  /** The minimum resource fee stellar-sdk computed for the restore transaction. */
  minResourceFee: string;
}

export type OnRestoreNeeded = (info: RestoreNeeded) => Promise<boolean> | boolean;

/**
 * Checks whether `tx`'s own simulation reports that a restore is
 * needed; if so, and `onRestoreNeeded` is provided and returns/resolves
 * true, builds, signs and submits the restore transaction via
 * `tx.restoreFootprint`, then re-simulates `tx` itself (re-running the
 * original prepare call) so the caller's normal error/success path
 * continues unchanged afterward. If `onRestoreNeeded` is omitted, or
 * returns false, throws a clear SyloxError rather than silently
 * proceeding against a transaction that both the brief and the real
 * simulation response agree will fail without a restore.
 */
export async function maybeRestore<T>(
  tx: AssembledTransaction<T>,
  onRestoreNeeded?: OnRestoreNeeded,
): Promise<void> {
  const sim = tx.simulation;
  if (!sim || !rpc.Api.isSimulationRestore(sim)) return;

  if (!onRestoreNeeded) {
    throw new SyloxError(
      "This transaction needs an archived ledger entry restored before it can run, but no onRestoreNeeded callback was provided. Pass one to consent to (and pay for) the restore.",
      { code: null, contractErrorName: null },
    );
  }

  const consented = await onRestoreNeeded({ minResourceFee: sim.restorePreamble.minResourceFee });
  if (!consented) {
    throw new SyloxError("Restore declined: this transaction needs an archived ledger entry restored first.", {
      code: null,
      contractErrorName: null,
    });
  }

  await tx.restoreFootprint(sim.restorePreamble);
  // Re-simulate the original call now that the footprint is restored -
  // AssembledTransaction's own `simulate()` re-runs simulation in
  // place, refreshing `tx.simulation`/`tx.result` for the caller's
  // normal post-prepare error check to see.
  await tx.simulate();
}
