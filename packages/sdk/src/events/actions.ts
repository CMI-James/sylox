import { eventRegistryClient } from "../contracts/event-registry.js";
import type { CureProgress, EventKind } from "../contracts/event-registry.js";
import {
  extractErrorCode,
  finalizeError,
  checkpointCureError,
  proposeTier1Error,
  challengeError,
  SyloxError,
} from "../errors.js";
import type { Signer } from "../signer.js";
import type { SyloxNetwork } from "../networks.js";
import { maybeRestore, type OnRestoreNeeded } from "./restore.js";

/**
 * Ported from web/app/lib/event-actions.ts. `prepareFinalize`/
 * `confirmFinalize`/`prepareCheckpointCure`/`confirmCheckpointCure`
 * port directly, swapping their error-throwing to the new
 * SyloxError-based errors.ts instead of string interpolation.
 * `proposeTier1` and `challenge` are NEW (Section 19.6) - they don't
 * exist anywhere in the codebase yet, written here following the exact
 * same prepare/confirm pattern as finalize/checkpointCure.
 */

export interface WriteResult<T> {
  result: T;
  /** The transaction hash, for a stellar.expert link - present once the transaction has actually been sent. */
  txHash: string;
}

/**
 * A prepared transaction, tagged with the address it was simulated
 * for. eventRegistryClient(network, publicKey) bakes that address into
 * the built transaction's own source account at construction time, so
 * a transaction built for one address can never be signed and sent by
 * another - confirm* checks `preparedFor` against the signer it's
 * given and refuses to reuse a stale transaction if the connected
 * wallet changed in between.
 */
export interface Prepared<T> {
  tx: T;
  preparedFor: string;
}

export interface PrepareOptions {
  /** Section 19.7 / 19.6 "Archived entries": called if simulation reports a needed restore. See events/restore.ts's own doc comment for the exact mechanism. Omit to throw a clear SyloxError instead of restoring. */
  onRestoreNeeded?: OnRestoreNeeded;
}

export async function prepareCheckpointCure(
  network: SyloxNetwork,
  eventId: bigint,
  address: string,
  options: PrepareOptions = {},
): Promise<Prepared<Awaited<ReturnType<ReturnType<typeof eventRegistryClient>["checkpoint_cure"]>>>> {
  const registry = eventRegistryClient(network, address);
  const tx = await registry.checkpoint_cure({ event_id: eventId });
  await maybeRestore(tx, options.onRestoreNeeded);
  if (tx.result.isErr()) {
    throw checkpointCureError(extractErrorCode(tx));
  }
  return { tx, preparedFor: address };
}

export async function confirmCheckpointCure(
  prepared: Awaited<ReturnType<typeof prepareCheckpointCure>>,
  signer: Signer,
): Promise<WriteResult<CureProgress>> {
  if (prepared.preparedFor !== signer.publicKey) {
    throw new SyloxError(
      "The connected wallet changed since this was checked. Prepare checkpoint_cure again to re-check with the current wallet.",
      { code: null, contractErrorName: null },
    );
  }
  const sent = await prepared.tx.signAndSend({ signTransaction: signer.signTransaction });
  if (sent.result.isErr()) {
    throw checkpointCureError(extractErrorCode(sent.assembled));
  }
  return {
    result: sent.result.unwrap(),
    txHash: sent.sendTransactionResponse?.hash ?? "",
  };
}

export async function prepareFinalize(
  network: SyloxNetwork,
  eventId: bigint,
  address: string,
  options: PrepareOptions = {},
): Promise<Prepared<Awaited<ReturnType<ReturnType<typeof eventRegistryClient>["finalize"]>>>> {
  const registry = eventRegistryClient(network, address);
  const tx = await registry.finalize({ event_id: eventId });
  await maybeRestore(tx, options.onRestoreNeeded);
  if (tx.result.isErr()) {
    throw finalizeError(extractErrorCode(tx));
  }
  return { tx, preparedFor: address };
}

export async function confirmFinalize(
  prepared: Awaited<ReturnType<typeof prepareFinalize>>,
  signer: Signer,
): Promise<WriteResult<void>> {
  if (prepared.preparedFor !== signer.publicKey) {
    throw new SyloxError(
      "The connected wallet changed since this was checked. Prepare finalize again to re-check with the current wallet.",
      { code: null, contractErrorName: null },
    );
  }
  const sent = await prepared.tx.signAndSend({ signTransaction: signer.signTransaction });
  if (sent.result.isErr()) {
    throw finalizeError(extractErrorCode(sent.assembled));
  }
  return { result: undefined, txHash: sent.sendTransactionResponse?.hash ?? "" };
}

/**
 * NEW (Section 19.6: `al.events.proposeTier1(arsSac, "Depeg")`). "Uses
 * the canonical Depeg definition" - resolves the current canonical
 * definition version the same way asset-data.ts's `fetchOneDefinition`
 * does (lines 482-499): calls `current_version` then uses that version
 * to build the propose_tier1 call, rather than requiring the caller to
 * already know which version is canonical. Mirrors
 * contracts/event-registry/src/lib.rs's real `propose_tier1(caller,
 * asset, kind, version)` signature and its `caller.require_auth()` -
 * this is a WRITE (needs a signer), following the same
 * prepare/confirm, simulate-before-sign pattern as finalize/
 * checkpointCure above.
 *
 * Throws (via proposeTier1Error) if no canonical definition is
 * registered for this (asset, kind) yet - `current_version` returning
 * 0 means UnknownDefinition would be returned by propose_tier1 itself,
 * so this checks for that up front rather than letting the simulation
 * fail with a less specific signal.
 */
export async function prepareProposeTier1(
  network: SyloxNetwork,
  asset: string,
  kind: EventKind["tag"],
  address: string,
  options: PrepareOptions = {},
): Promise<Prepared<Awaited<ReturnType<ReturnType<typeof eventRegistryClient>["propose_tier1"]>>>> {
  const registry = eventRegistryClient(network, address);
  const kindArg: EventKind = { tag: kind, values: undefined };

  const versionTx = await registry.current_version({ asset, kind: kindArg });
  const version = versionTx.result;
  if (version === 0) {
    throw proposeTier1Error(200); // UnknownDefinition - no canonical definition registered for this (asset, kind) yet.
  }

  const tx = await registry.propose_tier1({ caller: address, asset, kind: kindArg, version });
  await maybeRestore(tx, options.onRestoreNeeded);
  if (tx.result.isErr()) {
    throw proposeTier1Error(extractErrorCode(tx));
  }
  return { tx, preparedFor: address };
}

export async function confirmProposeTier1(
  prepared: Awaited<ReturnType<typeof prepareProposeTier1>>,
  signer: Signer,
): Promise<WriteResult<bigint>> {
  if (prepared.preparedFor !== signer.publicKey) {
    throw new SyloxError(
      "The connected wallet changed since this was checked. Prepare proposeTier1 again to re-check with the current wallet.",
      { code: null, contractErrorName: null },
    );
  }
  const sent = await prepared.tx.signAndSend({ signTransaction: signer.signTransaction });
  if (sent.result.isErr()) {
    throw proposeTier1Error(extractErrorCode(sent.assembled));
  }
  return {
    result: sent.result.unwrap(),
    txHash: sent.sendTransactionResponse?.hash ?? "",
  };
}

/**
 * NEW (Section 19.6: `al.events.challenge(eventId, evidenceHash)` -
 * "bond locked in Staking, escalates at once"). Mirrors
 * contracts/event-registry/src/lib.rs's real `challenge(challenger,
 * event_id, evidence: BytesN<32>)` signature and its
 * `challenger.require_auth()` - a WRITE, same prepare/confirm pattern.
 * `evidenceHash` must be exactly 32 bytes (BytesN<32> on the contract
 * side; the generated bindings type it as a plain `Uint8Array` on the
 * TS side) - checked explicitly here with a clear message rather than
 * letting a wrong-length array fail deep inside XDR encoding.
 */
export async function prepareChallenge(
  network: SyloxNetwork,
  eventId: bigint,
  evidenceHash: Uint8Array,
  address: string,
  options: PrepareOptions = {},
): Promise<Prepared<Awaited<ReturnType<ReturnType<typeof eventRegistryClient>["challenge"]>>>> {
  if (evidenceHash.length !== 32) {
    throw new SyloxError(
      `evidenceHash must be exactly 32 bytes (BytesN<32> on EventRegistry.challenge), got ${evidenceHash.length}.`,
      { code: null, contractErrorName: null },
    );
  }
  const registry = eventRegistryClient(network, address);
  const tx = await registry.challenge({ challenger: address, event_id: eventId, evidence: evidenceHash });
  await maybeRestore(tx, options.onRestoreNeeded);
  if (tx.result.isErr()) {
    throw challengeError(extractErrorCode(tx));
  }
  return { tx, preparedFor: address };
}

export async function confirmChallenge(
  prepared: Awaited<ReturnType<typeof prepareChallenge>>,
  signer: Signer,
): Promise<WriteResult<void>> {
  if (prepared.preparedFor !== signer.publicKey) {
    throw new SyloxError(
      "The connected wallet changed since this was checked. Prepare challenge again to re-check with the current wallet.",
      { code: null, contractErrorName: null },
    );
  }
  const sent = await prepared.tx.signAndSend({ signTransaction: signer.signTransaction });
  if (sent.result.isErr()) {
    throw challengeError(extractErrorCode(sent.assembled));
  }
  return { result: undefined, txHash: sent.sendTransactionResponse?.hash ?? "" };
}
