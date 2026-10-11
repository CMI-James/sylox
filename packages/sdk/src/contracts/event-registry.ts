import { Client } from "./event-registry/src/index.js";
import type { SyloxNetwork } from "../networks.js";
import type { Signer } from "../signer.js";

export * from "./event-registry/src/index.js";

/**
 * Ported from web/app/lib/contracts/event-registry.ts, pointed at this
 * package's own `Networks.Testnet` contract id. `publicKey` sets the
 * transaction's own source account at construction time (confirmed
 * against @stellar/stellar-sdk's own docs: "the account that
 * constructed the transaction") - every read-only call site omits the
 * signer entirely (irrelevant for simulation-only reads); every WRITE
 * call site (events/actions.ts's prepare*) must pass the connected
 * wallet's full `Signer` here, or the simulated/signed transaction's
 * source account won't match the wallet that's about to sign it.
 *
 * PR #69 review, required fix #2: takes the full `Signer` (publicKey +
 * signTransaction), not just a bare `publicKey` string, and wires
 * `signTransaction` into the Client's own construction options. See
 * events/restore.ts's doc comment for why this is required, not
 * optional - @stellar/stellar-sdk's AssembledTransaction.restoreFootprint
 * throws "no signTransaction function provided" unless signTransaction
 * was supplied at Client INITIALIZATION (confirmed directly against
 * this package's pinned stellar-sdk's own doc comment on
 * restoreFootprint: "A signTransaction function must be provided
 * during the Client initialization" - supplying it later, e.g. only at
 * signAndSend time, is documented as NOT sufficient for restore
 * specifically, even though it is sufficient for an ordinary sign).
 * Every prepare* call in actions.ts runs maybeRestore (events/restore.ts)
 * against the transaction this client builds - if restore is ever
 * actually needed, it must be able to sign and submit the restore
 * transaction right there, before the caller's own confirm* step ever
 * runs.
 */
export function eventRegistryClient(network: SyloxNetwork, signer?: Signer) {
  return new Client({
    contractId: network.contracts.eventRegistry,
    networkPassphrase: network.networkPassphrase,
    rpcUrl: network.rpcUrl,
    publicKey: signer?.publicKey,
    signTransaction: signer?.signTransaction,
  });
}
