import { Client } from "./token/src/index.js";
import type { SyloxNetwork } from "../networks.js";

export * from "./token/src/index.js";

// Generated once from TUSD's contract spec, but every Stellar Asset
// Contract shares the same SEP-41 interface (name/symbol/decimals/...),
// so this one set of generated bindings works as a client for any
// asset's address at runtime - exactly like riskOracleClient()/
// eventRegistryClient() already build a Client with a runtime
// contractId from one set of generated bindings, just pointed at a
// different address each time instead of a fixed one. Ported from
// web/app/lib/contracts/token.ts.
export function tokenClient(network: SyloxNetwork, contractId: string) {
  return new Client({
    contractId,
    networkPassphrase: network.networkPassphrase,
    rpcUrl: network.rpcUrl,
  });
}

// A token's name never changes once issued, so this is cached for the
// lifetime of the module (process/session) rather than re-fetched on
// every call - same reasoning as any other static on-chain metadata.
// Keyed by contractId alone (not network) since this SDK only ever
// targets one network's worth of contract ids per process in practice;
// a multi-network consumer that genuinely needs two caches can
// construct two Sylox instances - there is no cross-instance state
// here beyond this one cache, documented as the one implementation
// judgment call worth calling out explicitly.
const nameCache = new Map<string, string>();

/**
 * The asset's SEP-41 name() (format "CODE:ISSUER" for a classic-asset
 * Stellar Asset Contract, e.g. "USDC:GBBD..."). Falls back to a
 * shortened contract address if the read fails, rather than throwing -
 * a name is a label, not risk data, so a caller display path is never
 * worth blocking on it.
 */
export async function assetDisplayName(network: SyloxNetwork, contractId: string): Promise<string> {
  const cached = nameCache.get(contractId);
  if (cached) return cached;

  try {
    const tx = await tokenClient(network, contractId).name();
    const name = tx.result;
    nameCache.set(contractId, name);
    return name;
  } catch {
    return `${contractId.slice(0, 4)}…${contractId.slice(-4)}`;
  }
}
