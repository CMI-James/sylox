import { rpc } from "@stellar/stellar-sdk";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { SyloxError } from "../errors.js";

/**
 * Section 19.7: "If simulation reports archived entries, the SDK
 * builds and submits a restore transaction first (with user consent
 * callback)." Threaded through every prepare* call in actions.ts as an
 * optional `onRestoreNeeded` callback.
 *
 * Mechanism (confirmed directly against this package's own pinned
 * @stellar/stellar-sdk 17.2.1 source, the same way errors.ts's
 * extractErrorCode already confirms `rpc.Api.isSimulationError`):
 * `tx.simulation` can be a `SimulateTransactionRestoreResponse`
 * (checked via `rpc.Api.isSimulationRestore`), which carries a
 * `restorePreamble: {minResourceFee, transactionData}`.
 *
 * The restore itself goes through `tx.simulate({ restore: true })`,
 * not a bare `restoreFootprint` + `simulate()` pair. Calling
 * `restoreFootprint` directly submits the restore transaction using
 * the account's CURRENT sequence number, but `tx` itself was already
 * built against that same sequence number during the original
 * simulation - a later plain `tx.simulate()` call skips rebuilding
 * (`AssembledTransaction.simulate`'s own `if (!this.built)` guard),
 * so it would reuse that now-stale, already-consumed sequence number
 * and the eventual send would fail with a bad sequence error. It also
 * never checks whether the restore itself actually succeeded.
 * `simulate({ restore: true })`'s own internal implementation (read
 * directly from node_modules) does this correctly: it calls
 * `restoreFootprint`, checks the result's status (throwing
 * `AssembledTransaction.Errors.RestorationFailure` on failure), and
 * on success fetches a FRESH account, rebuilds the transaction against
 * that fresh sequence number, and re-simulates - exactly once, inside
 * the SDK's own code, never re-implemented here.
 */
export interface RestoreNeeded {
  /** The minimum resource fee stellar-sdk computed for the restore transaction. */
  minResourceFee: string;
}

export type OnRestoreNeeded = (info: RestoreNeeded) => Promise<boolean> | boolean;

/**
 * Checks whether `tx`'s own simulation reports that a restore is
 * needed; if so, and `onRestoreNeeded` is provided and returns/resolves
 * true, restores and rebuilds `tx` via `tx.simulate({ restore: true })`
 * so the caller's normal error/success path continues unchanged
 * afterward, against a transaction built with a fresh sequence number.
 * If `onRestoreNeeded` is omitted, or returns false, throws a clear
 * SyloxError rather than silently proceeding against a transaction
 * that both the brief and the real simulation response agree will
 * fail without a restore. A restore that itself fails is also surfaced
 * as a SyloxError, never the SDK's raw RestorationFailure.
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

  try {
    await tx.simulate({ restore: true });
  } catch (e) {
    if (e instanceof AssembledTransaction.Errors.RestorationFailure) {
      throw new SyloxError(`The archived ledger entry restore failed: ${e.message}`, {
        code: null,
        contractErrorName: null,
      });
    }
    throw e;
  }
}
