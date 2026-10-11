import { rpc } from "@stellar/stellar-sdk";
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";

/**
 * Plain-language copy for the contract error codes a write action in
 * this app can actually trigger - never the raw doc-comment text the
 * generated bindings carry (e.g. `EventRegistry.Error::WrongState`'s
 * own Rust doc comment, "A function's own required state (`Proposed`,
 * `Escalated`, ...) does not match the event's current one.", which
 * read directly as a UI error message before this module existed).
 *
 * Keyed by the numeric error code (never the doc-comment text, which
 * could be reworded without changing the code), read from the real
 * simulation diagnostic (`Error(Contract, #<code>)`) rather than
 * `unwrapErr().message` - see `extractErrorCode`'s own doc comment for
 * why that's the more reliable signal.
 *
 * Each map is specific to ONE action (`finalize`, `checkpoint_cure`),
 * not shared globally per error-registry-contract: the same numeric
 * code can mean something different to say to the user depending on
 * what they were actually trying to do, and not every code a contract
 * CAN return is reachable from a given write action - only the ones
 * listed here are. See contracts/event-registry/src/error.rs and
 * contracts/risk-oracle/src/error.rs for the full enums these are
 * drawn from.
 */
type ErrorCopyMap = Record<number, string>;

// EventRegistry.finalize's own real error set (contracts/event-registry/src/lib.rs:
// require_config -> NotInitialized; get_event -> UnknownEvent; the
// state check -> WrongState; get_def -> UnknownDefinition; the
// challenge-window check -> ChallengeWindowOpen; cure_outcome's
// NotReady arm -> DataNotFinal. Nothing else is reachable from this
// specific call - leave_active/declare never return Err in this build).
const FINALIZE_ERRORS: ErrorCopyMap = {
  2: "The protocol isn't ready yet. Try again in a moment.", // NotInitialized
  204: "The challenge window for this event is still open.",
  206: "This event has already moved past this step.",
  213: "This event's price data isn't fully settled yet. Try again once the pending hours finalize.",
  215: "This event no longer exists.",
  200: "This event's rules (its definition) couldn't be found.",
};

// EventRegistry.checkpoint_cure's own real error set (same file: same
// require_config/get_event/get_def calls; the state check returns
// WrongState both for a non-Proposed event AND for a non-Depeg kind,
// Section 8.5 - "has already moved past this step" still reads
// correctly either way, since IssuerFreeze genuinely has no cure step
// to check).
const CHECKPOINT_CURE_ERRORS: ErrorCopyMap = {
  2: "The protocol isn't ready yet. Try again in a moment.", // NotInitialized
  206: "This event has already moved past this step, or doesn't use a cure check.",
  215: "This event no longer exists.",
  200: "This event's rules (its definition) couldn't be found.",
};

// RiskOracle.score's only reachable error (contracts/risk-oracle/src/lib.rs's
// score(): storage::get_asset_config -> UnknownAsset).
const SCORE_ERRORS: ErrorCopyMap = {
  100: "This asset isn't tracked by the oracle.", // UnknownAsset
};

// EventRegistry.cover_gate's only reachable error (lib.rs's cover_gate():
// require_config -> NotInitialized).
const COVER_GATE_ERRORS: ErrorCopyMap = {
  2: "The protocol isn't ready yet. Try again in a moment.", // NotInitialized
};

function fallbackMessage(code: number | null): string {
  // Keeps the code for support even when there's no plain sentence for
  // it yet - never shows the raw contract/doc-comment text, but also
  // never hides which error this actually was.
  return code === null ? "The contract rejected this action." : `The contract rejected this action (error ${code}).`;
}

function describe(map: ErrorCopyMap, code: number | null): string {
  if (code === null) return fallbackMessage(code);
  return map[code] ?? fallbackMessage(code);
}

export function describeFinalizeError(code: number | null): string {
  return describe(FINALIZE_ERRORS, code);
}

export function describeCheckpointCureError(code: number | null): string {
  return describe(CHECKPOINT_CURE_ERRORS, code);
}

export function describeScoreError(code: number | null): string {
  return describe(SCORE_ERRORS, code);
}

export function describeCoverGateError(code: number | null): string {
  return describe(COVER_GATE_ERRORS, code);
}

/**
 * The real, reliable signal for which contract error this was: the
 * numeric code embedded in the simulation's own diagnostic text
 * (`Error(Contract, #<code>)`), not `Result.unwrapErr().message` -
 * which is the error's Rust DOC COMMENT, decoded verbatim by the SDK
 * from the contract's own spec (confirmed directly against live
 * testnet: EventRegistry.Error::WrongState's `.message` is exactly its
 * error.rs doc comment, word for word). That text is meant for someone
 * reading the contract source, not a UI string, and matching against
 * it would silently break the moment a doc comment gets reworded for
 * clarity - the numeric code is the stable, versioned contract.
 *
 * `AssembledTransaction.simulation` (the officially typed, public
 * `Api.SimulateTransactionResponse`) carries this for a `prepare*`
 * call's own `tx`. A `confirm*` call's `sent` (SentTransaction) has no
 * separate simulation of its own, but holds a reference to the exact
 * same already-simulated `AssembledTransaction` at `sent.assembled` -
 * same object, same cached `.simulation`, populated well before
 * `signAndSend` ever ran.
 */
export function extractErrorCode(tx: AssembledTransaction<unknown>): number | null {
  const sim = tx.simulation;
  if (!sim || !rpc.Api.isSimulationError(sim)) return null;
  const match = sim.error.match(/Error\(Contract,\s*#(\d+)\)/);
  return match ? Number(match[1]) : null;
}
