import { Client } from "./event-registry/src/index.js";
import type { SyloxNetwork } from "../networks.js";

export * from "./event-registry/src/index.js";

/**
 * Ported from web/app/lib/contracts/event-registry.ts, pointed at this
 * package's own `Networks.Testnet` contract id. `publicKey` sets the
 * transaction's own source account at construction time (confirmed
 * against @stellar/stellar-sdk's own docs: "the account that
 * constructed the transaction") - every read-only call site omits it
 * (irrelevant for simulation-only reads); every WRITE call site
 * (events/actions.ts's prepare*) must pass the connected wallet's
 * address here, or the simulated/signed transaction's source account
 * won't match the wallet that's about to sign it.
 */
export function eventRegistryClient(network: SyloxNetwork, publicKey?: string) {
  return new Client({
    contractId: network.contracts.eventRegistry,
    networkPassphrase: network.networkPassphrase,
    rpcUrl: network.rpcUrl,
    publicKey,
  });
}
