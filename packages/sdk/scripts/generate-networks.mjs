#!/usr/bin/env node
// Regenerates src/networks.generated.ts from the two deployment records
// at the repo root (deployments/testnet.json, required, and
// deployments/testnet-demo-asset.json, also required - both are
// committed to the repo, see this PR's review: "testnet-demo-asset.json
// was committed in #60," so there is no "may be absent" case left to
// handle here).
//
// WHY A GENERATION STEP, NOT A RUNTIME READ (PR #69 review, required
// fix #1): the previous version of src/networks.ts read both JSON files
// off disk at runtime via node:fs/node:path/node:url, which (a) breaks
// in a browser (the web app in PR 2 has no filesystem) and (b) breaks
// once this package is published, since deployments/*.json lives
// outside packages/sdk and is never part of the published npm tarball.
// This script runs at BUILD TIME (locally, and in CI as a drift check -
// see .github/workflows/ci.yml's sdk-networks-drift job) and writes
// plain TypeScript constants to src/networks.generated.ts, which IS
// part of the package and contains no node:* imports at all. The
// generated file is committed, same convention as
// src/contracts/*/src/*.ts (generate-bindings.mjs's own output).
//
// Run via `npm run generate:networks -w packages/sdk`, or automatically
// as this package's own `prebuild`/`pretest` npm lifecycle hooks (see
// package.json) - either way, run it again any time
// deployments/testnet.json or deployments/testnet-demo-asset.json
// changes (e.g. after a contract redeploy) and commit the result; see
// this package's README's "Regenerating after a redeploy" section.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/sdk/scripts/ -> repo root is two levels up.
const repoRoot = path.resolve(__dirname, "../../..");
const sdkRoot = path.resolve(__dirname, "..");

function die(message) {
  console.error(`generate-networks: ${message}`);
  process.exit(1);
}

function loadRequiredJson(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  if (!existsSync(fullPath)) {
    die(`${fullPath} not found. This file is committed to the repo and required to generate src/networks.generated.ts.`);
  }
  try {
    return JSON.parse(readFileSync(fullPath, "utf8"));
  } catch (err) {
    die(`${fullPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const testnetDeployment = loadRequiredJson("deployments/testnet.json");
const testnetDemoAsset = loadRequiredJson("deployments/testnet-demo-asset.json");

function requireField(obj, keyPath, sourceLabel) {
  const value = keyPath.split(".").reduce((acc, key) => acc?.[key], obj);
  if (value === undefined || value === null) {
    die(`${sourceLabel} is missing required field "${keyPath}".`);
  }
  return value;
}

const rpcUrl = requireField(testnetDeployment, "rpc_url", "deployments/testnet.json");
const networkPassphrase = requireField(testnetDeployment, "passphrase", "deployments/testnet.json");
const riskOracleId = requireField(testnetDeployment, "contracts.risk_oracle.id", "deployments/testnet.json");
const eventRegistryId = requireField(testnetDeployment, "contracts.event_registry.id", "deployments/testnet.json");
const demoAsset = requireField(testnetDemoAsset, "demo_asset", "deployments/testnet-demo-asset.json");

const banner = `/**
 * GENERATED FILE - do not edit by hand.
 *
 * Produced by scripts/generate-networks.mjs from
 * deployments/testnet.json and deployments/testnet-demo-asset.json at
 * the repo root. Regenerate with \`npm run generate:networks -w
 * packages/sdk\` (also runs automatically before \`build\`/\`test\` via
 * this package's prebuild/pretest npm scripts) any time either source
 * file changes - e.g. after a contract redeploy - then commit the
 * result. CI's sdk-networks-drift job (.github/workflows/ci.yml) fails
 * the build if this file is out of sync with those two source files, so
 * it cannot silently drift.
 *
 * Both source files are build-time inputs, not optional runtime reads:
 * both are committed to the repo (deployments/testnet-demo-asset.json
 * since PR #60), and this generator fails loudly if either is missing
 * or malformed rather than producing a partial file.
 */
`;

const generated = `${banner}
export const GENERATED_TESTNET_NETWORK = {
  rpcUrl: ${JSON.stringify(rpcUrl)},
  networkPassphrase: ${JSON.stringify(networkPassphrase)},
  contracts: {
    riskOracle: ${JSON.stringify(riskOracleId)},
    eventRegistry: ${JSON.stringify(eventRegistryId)},
  },
  demoAsset: ${JSON.stringify(demoAsset, null, 2).split("\n").join("\n  ")},
} as const;
`;

const outPath = path.join(sdkRoot, "src", "networks.generated.ts");
writeFileSync(outPath, generated);
console.log(`generate-networks: wrote ${outPath}`);
