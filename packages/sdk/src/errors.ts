import { rpc } from "@stellar/stellar-sdk";
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";

/**
 * Ported from web/app/lib/contract-errors.ts (ADAPTED, not copied
 * verbatim - see this PR's description for the reasoning). That file's
 * `describe*Error(code)` functions returned a plain string; this
 * module's brief requirement (Section 19.7: "the SDK throws
 * `SyloxError` with the contract error name") needs a richer thrown
 * value than a plain `Error`, so every describe* function below
 * CONSTRUCTS a `SyloxError` directly instead of just returning a
 * sentence.
 *
 * The plain-sentence copy itself (every string value in the four maps
 * below) is unchanged from contract-errors.ts - "already reviewed and
 * approved by the engineer in a past PR," per this PR's brief - never
 * reworded here.
 */

/**
 * Thrown by every SDK write/read path that can fail against a
 * contract's own `#[contracterror]` enum. Carries both the numeric
 * code (the stable, versioned signal - see extractErrorCode's own doc
 * comment below) and, when known, the Rust enum variant NAME that code
 * maps to (Section 14's own Code/Name table; contracts/event-registry/
 * src/error.rs and contracts/risk-oracle/src/error.rs for the full
 * enums) - never the raw contract doc-comment text, which is meant for
 * someone reading the contract source, not a caller catching an error.
 */
export class SyloxError extends Error {
  /** The numeric contract error code (`Error(Contract, #<code>)`), or null when none could be extracted (e.g. a non-contract failure, or a successful simulation misused as an error path). */
  readonly code: number | null;
  /** The Rust `#[contracterror]` enum variant name this code maps to (e.g. "WrongState", "UnknownAsset"), or null when the code is unmapped by this SDK. */
  readonly contractErrorName: string | null;

  constructor(message: string, opts: { code: number | null; contractErrorName: string | null }) {
    super(message);
    this.name = "SyloxError";
    this.code = opts.code;
    this.contractErrorName = opts.contractErrorName;
  }
}

/**
 * Keyed by the numeric error code (never the doc-comment text, which
 * could be reworded without changing the code), read from the real
 * simulation diagnostic (`Error(Contract, #<code>)`) rather than
 * `unwrapErr().message` - see `extractErrorCode`'s own doc comment for
 * why that's the more reliable signal.
 *
 * Each map is specific to ONE action (`finalize`, `checkpointCure`,
 * ...), not shared globally per contract: the same numeric code can
 * mean something different to say to the caller depending on what they
 * were actually trying to do, and not every code a contract CAN return
 * is reachable from a given call - only the ones listed here are. See
 * contracts/event-registry/src/error.rs and contracts/risk-oracle/src/
 * error.rs for the full enums these are drawn from.
 */
interface ErrorCopyEntry {
  name: string;
  message: string;
}
type ErrorCopyMap = Record<number, ErrorCopyEntry>;

// EventRegistry.finalize's own real error set (contracts/event-registry/src/lib.rs:
// require_config -> NotInitialized; get_event -> UnknownEvent; the
// state check -> WrongState; get_def -> UnknownDefinition; the
// challenge-window check -> ChallengeWindowOpen; cure_outcome's
// NotReady arm -> DataNotFinal. Nothing else is reachable from this
// specific call - leave_active/declare never return Err in this build).
const FINALIZE_ERRORS: ErrorCopyMap = {
  2: { name: "NotInitialized", message: "The protocol isn't ready yet. Try again in a moment." },
  204: { name: "ChallengeWindowOpen", message: "The challenge window for this event is still open." },
  206: { name: "WrongState", message: "This event has already moved past this step." },
  213: {
    name: "DataNotFinal",
    message: "This event's price data isn't fully settled yet. Try again once the pending hours finalize.",
  },
  215: { name: "UnknownEvent", message: "This event no longer exists." },
  200: { name: "UnknownDefinition", message: "This event's rules (its definition) couldn't be found." },
};

// EventRegistry.checkpoint_cure's own real error set (same file: same
// require_config/get_event/get_def calls; the state check returns
// WrongState both for a non-Proposed event AND for a non-Depeg kind,
// Section 8.5 - "has already moved past this step" still reads
// correctly either way, since IssuerFreeze genuinely has no cure step
// to check).
const CHECKPOINT_CURE_ERRORS: ErrorCopyMap = {
  2: { name: "NotInitialized", message: "The protocol isn't ready yet. Try again in a moment." },
  206: {
    name: "WrongState",
    message: "This event has already moved past this step, or doesn't use a cure check.",
  },
  215: { name: "UnknownEvent", message: "This event no longer exists." },
  200: { name: "UnknownDefinition", message: "This event's rules (its definition) couldn't be found." },
};

// RiskOracle.score's only reachable error (contracts/risk-oracle/src/lib.rs's
// score(): storage::get_asset_config -> UnknownAsset).
const SCORE_ERRORS: ErrorCopyMap = {
  100: { name: "UnknownAsset", message: "This asset isn't tracked by the oracle." },
};

// EventRegistry.cover_gate's only reachable error (lib.rs's cover_gate():
// require_config -> NotInitialized).
const COVER_GATE_ERRORS: ErrorCopyMap = {
  2: { name: "NotInitialized", message: "The protocol isn't ready yet. Try again in a moment." },
};

// EventRegistry.propose_tier1's reachable errors (lib.rs: require_config
// -> NotInitialized; get_def -> UnknownDefinition; the live-version
// check -> VersionNotCovered; the live-event check -> EventInProgress;
// check_depeg/check_issuer_freeze -> Tier1CheckFailed; the
// gated-cooldown re-check also surfaces as EventInProgress).
const PROPOSE_TIER1_ERRORS: ErrorCopyMap = {
  2: { name: "NotInitialized", message: "The protocol isn't ready yet. Try again in a moment." },
  200: { name: "UnknownDefinition", message: "This asset has no canonical Depeg definition registered yet." },
  201: { name: "EventInProgress", message: "An event is already open for this asset and kind." },
  202: {
    name: "Tier1CheckFailed",
    message: "The ring buffer data doesn't meet the definition's own threshold for this proposal.",
  },
  214: {
    name: "VersionNotCovered",
    message: "This definition version isn't the current canonical one and isn't pinned by any live cover.",
  },
};

// EventRegistry.challenge's reachable errors (lib.rs: require_config ->
// NotInitialized; get_event -> UnknownEvent; the state check ->
// WrongState; the window check -> ChallengeWindowClosed).
const CHALLENGE_ERRORS: ErrorCopyMap = {
  2: { name: "NotInitialized", message: "The protocol isn't ready yet. Try again in a moment." },
  215: { name: "UnknownEvent", message: "This event no longer exists." },
  206: { name: "WrongState", message: "This event can no longer be challenged - it has moved past that step." },
  205: { name: "ChallengeWindowClosed", message: "The challenge window for this event has already closed." },
};

function fallbackEntry(code: number | null): ErrorCopyEntry {
  // Keeps the code for support even when there's no plain sentence for
  // it yet - never shows the raw contract/doc-comment text, but also
  // never hides which error this actually was.
  return {
    name: "",
    message: code === null ? "The contract rejected this action." : `The contract rejected this action (error ${code}).`,
  };
}

function buildError(map: ErrorCopyMap, code: number | null): SyloxError {
  if (code === null) {
    const entry = fallbackEntry(null);
    return new SyloxError(entry.message, { code: null, contractErrorName: null });
  }
  const entry = map[code] ?? fallbackEntry(code);
  return new SyloxError(entry.message, { code, contractErrorName: entry.name || null });
}

export function finalizeError(code: number | null): SyloxError {
  return buildError(FINALIZE_ERRORS, code);
}

export function checkpointCureError(code: number | null): SyloxError {
  return buildError(CHECKPOINT_CURE_ERRORS, code);
}

export function scoreError(code: number | null): SyloxError {
  return buildError(SCORE_ERRORS, code);
}

export function coverGateError(code: number | null): SyloxError {
  return buildError(COVER_GATE_ERRORS, code);
}

export function proposeTier1Error(code: number | null): SyloxError {
  return buildError(PROPOSE_TIER1_ERRORS, code);
}

export function challengeError(code: number | null): SyloxError {
  return buildError(CHALLENGE_ERRORS, code);
}

/**
 * The real, reliable signal for which contract error this was: the
 * numeric code embedded in the simulation's own diagnostic text
 * (`Error(Contract, #<code>)`), not `Result.unwrapErr().message` -
 * which is the error's Rust DOC COMMENT, decoded verbatim by the SDK
 * from the contract's own spec. That text is meant for someone reading
 * the contract source, not a caller catching an error, and matching
 * against it would silently break the moment a doc comment gets
 * reworded for clarity - the numeric code is the stable, versioned
 * contract.
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
