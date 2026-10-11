import { GENERATED_TESTNET_NETWORK } from "./networks.generated.js";

/**
 * `scripts/generate-networks.mjs` reads both deployment files
 * (`deployments/testnet.json` and `deployments/testnet-demo-asset.json`)
 * at BUILD TIME and writes `src/networks.generated.ts`, plain
 * TypeScript constants with zero node:* imports - this module only
 * re-shapes that already-generated plain data, so it does no I/O of
 * its own, at import time or otherwise, and runs the same in Node and
 * in a browser. The generated file is committed (same convention as
 * the generated contract bindings under src/contracts/*\/src/), and
 * CI's sdk-networks-drift job (.github/workflows/ci.yml) fails the
 * build if regenerating it produces a diff, so it can never silently
 * drift from either source deployment file. See this PR's README for
 * how to regenerate after a contract redeploy.
 *
 * `demoAsset` is required, not optional: both source deployment files
 * are committed to the repo, so there is no "absent at build time"
 * case to model as an optional field.
 */
export interface TestnetDeployment {
  network: string;
  passphrase: string;
  rpc_url: string;
  deployed_at: string;
  contracts: {
    risk_oracle: { id: string };
    event_registry: { id: string };
    staking?: { id: string };
    treasury?: { id: string };
  };
  tusd?: { contract_id: string; asset_code: string; issuer: string; note?: string };
  tracked_asset?: { contract_id: string; classic_asset: string; note?: string };
}

/**
 * `deployments/testnet-demo-asset.json`'s shape: whatever
 * `deploy/demo-asset.sh` writes at deploy time. Not part of the core
 * protocol deployment - a sample asset for demoing the SDK/app against,
 * so its shape is looser (an open index signature) rather than a fixed
 * interface that would need updating every time that script's output
 * changes.
 */
export interface TestnetDemoAsset {
  network?: string;
  demo_asset?: {
    contract_id: string;
    asset_code: string;
    issuer: string;
    holder?: string;
    note?: string;
  };
  [key: string]: unknown;
}

export interface SyloxNetwork {
  rpcUrl: string;
  networkPassphrase: string;
  contracts: {
    riskOracle: string;
    eventRegistry: string;
  };
  /** Always present: deployments/testnet-demo-asset.json is committed to the repo and read at build time by scripts/generate-networks.mjs, same as deployments/testnet.json. */
  demoAsset: NonNullable<TestnetDemoAsset["demo_asset"]>;
}

/**
 * Built from src/networks.generated.ts's plain constants - never read
 * from disk at runtime, never imports node:fs/node:path/node:url. See
 * this file's own top-of-file doc comment for the generation step that
 * produces networks.generated.ts.
 *
 * Only `risk_oracle` and `event_registry` are exposed here:
 * `staking`/`treasury`/market-factory have no generated TS bindings yet
 * and are out of scope for this package so far.
 */
export const Networks = {
  Testnet: {
    rpcUrl: GENERATED_TESTNET_NETWORK.rpcUrl,
    networkPassphrase: GENERATED_TESTNET_NETWORK.networkPassphrase,
    contracts: {
      riskOracle: GENERATED_TESTNET_NETWORK.contracts.riskOracle,
      eventRegistry: GENERATED_TESTNET_NETWORK.contracts.eventRegistry,
    },
    demoAsset: GENERATED_TESTNET_NETWORK.demoAsset,
  } satisfies SyloxNetwork,
} as const;
