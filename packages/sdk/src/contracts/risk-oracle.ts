import { Client } from "./risk-oracle/src/index.js";
import type { SyloxNetwork } from "../networks.js";

export * from "./risk-oracle/src/index.js";

/**
 * Ported from web/app/lib/contracts/risk-oracle.ts, pointed at this
 * package's own `Networks.Testnet` contract id instead of the web
 * app's own deployment.ts. Unlike the web app's module-level singleton
 * (which only ever points at ONE preset network), this takes the
 * network explicitly - this package has no implicit "the" network the
 * way a single Next.js app does; `Sylox`'s own constructor (index.ts)
 * is what fixes a network for the lifetime of one SDK instance.
 */
export function riskOracleClient(network: SyloxNetwork) {
  return new Client({
    contractId: network.contracts.riskOracle,
    networkPassphrase: network.networkPassphrase,
    rpcUrl: network.rpcUrl,
  });
}
