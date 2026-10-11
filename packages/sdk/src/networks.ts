import { GENERATED_TESTNET_NETWORK } from "./networks.generated.js";

/**
 * PR #69 review, required fix #1: this file previously read
 * `deployments/testnet.json` via a static JSON import, AND read
 * `deployments/testnet-demo-asset.json` off disk at runtime via
 * node:fs/node:path/node:url. Both break in a browser (the web app in
 * PR 2 has no filesystem, no node:* modules) and both break once this
 * package is published (deployments/ lives outside packages/sdk, so
 * neither file is part of the published npm tarball).
 *
 * Fixed by moving both reads to BUILD TIME: scripts/generate-networks.mjs
 * reads both deployment files and writes src/networks.generated.ts,
 * plain TypeScript constants with zero node:* imports. That generated
 * file is committed (same convention as the generated contract
 * bindings under src/contracts/*\/src/), and CI's sdk-networks-drift
 * job (.github/workflows/ci.yml) fails the build if regenerating it
 * produces a diff - so this file can never silently drift from
 * deployments/testnet.json or deployments/testnet-demo-asset.json.
 * This module itself now only re-shapes already-generated plain data;
 * it does no I/O of its own, at import time or otherwise.
 *
 * `demoAsset` is required, not optional: both source deployment files
 * are committed to the repo (testnet-demo-asset.json since PR #60, per
 * the engineer's review - the earlier "it's gitignored, may not exist"
 * premise in this PR's description was incorrect), so there is no
 * "absent at build time" case left to model as an optional field.
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
 * produces networks.generated.ts, and this PR's README for how to
 * regenerate it after a contract redeploy.
 *
 * Only `risk_oracle` and `event_registry` are exposed here:
 * `staking`/`treasury`/market-factory have no generated TS bindings yet
 * (see this PR's description's deviations section) and are out of this
 * PR's scope.
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
