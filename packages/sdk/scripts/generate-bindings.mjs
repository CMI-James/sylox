#!/usr/bin/env node
// Regenerates src/contracts/<name>/ for risk-oracle and event-registry,
// the two contracts this PR's scope covers (al.oracle, al.events) -
// staking/treasury/market-factory have no generated TS bindings yet and
// are explicitly out of scope (see this PR's description). Contract IDs
// are never hardcoded here; they come straight from
// deployments/testnet.json, same convention as web/app's own copy of
// this script (web/app/scripts/generate-bindings.mjs), which this is
// ported from. Per the brief, this is where bindings generation lives
// going forward - the web app's own copy stops being used once a later
// PR cuts the web app over to importing @sylox/sdk instead (not this
// PR's scope; the web app's copy is left untouched here).
//
// GENERATOR: `stellar-js generate`, bundled inside @stellar/stellar-sdk
// starting at 17.2.0, invoked via `npx --no-install stellar-js generate`
// so it always resolves this package's own exact pinned SDK version
// (17.2.1) - same reasoning as the web app's copy of this script.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/sdk/scripts/ -> repo root is two levels up.
const repoRoot = path.resolve(__dirname, "../../..");
const sdkRoot = path.resolve(__dirname, "..");

function die(message) {
  console.error(`generate-bindings: ${message}`);
  process.exit(1);
}

function loadDeployment() {
  const deploymentPath = path.join(repoRoot, "deployments", "testnet.json");
  if (!existsSync(deploymentPath)) {
    die(`${deploymentPath} not found.`);
  }
  return JSON.parse(readFileSync(deploymentPath, "utf8"));
}

// stellar-js generate's own src/ files cross-import each other with an
// explicit .js extension (`from "./types.js"`) - correct, as-is, per
// Node's own ESM resolution rules, and exactly what this package's own
// moduleResolution (NodeNext) REQUIRES (confirmed directly: `tsc
// --moduleResolution NodeNext` rejects an extensionless relative import
// with TS2835, "Relative import paths need explicit file extensions").
//
// DEVIATION from the brief: web/app's own copy of this script
// (web/app/scripts/generate-bindings.mjs) strips that .js extension as
// a Turbopack-specific workaround (Turbopack's own module resolution,
// unlike webpack's, doesn't yet alias a .js specifier back to a
// same-directory .ts file) and the brief accordingly says to "keep that
// step, it's harmless under plain tsc or Node too." Measured directly
// against this package's own NodeNext config, that assumption doesn't
// hold: stripping the extension is NOT harmless here - it actively
// breaks `tsc -p tsconfig.build.json` (TS2835 on every cross-import in
// client.ts). This function is kept, UNCALLED, only so a future PR
// targeting some other bundler has a ready implementation; this
// package's own `generate()` below never calls it, since this package
// has no Turbopack to work around in the first place.
function stripJsExtensionsFromRelativeImports(outDir) {
  const JS_EXTENSION_IMPORT = /((?:from|import)\s+['"])(\.\.?\/[^'"]+)\.js(['"])/g;
  for (const entry of readdirSync(path.join(outDir, "src"))) {
    if (!entry.endsWith(".ts")) continue;
    const filePath = path.join(outDir, "src", entry);
    const source = readFileSync(filePath, "utf8");
    const fixed = source.replace(JS_EXTENSION_IMPORT, "$1$2$3");
    if (fixed !== source) writeFileSync(filePath, fixed);
  }
}
void stripJsExtensionsFromRelativeImports; // Referenced only to document intent above; deliberately never called - see its own doc comment.

function generate(name, contractId, outDir) {
  console.log(`generate-bindings: ${name} (${contractId})`);
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true });
  }
  execFileSync(
    "npx",
    [
      "--no-install",
      "stellar-js",
      "generate",
      "--contract-id",
      contractId,
      "--network",
      "testnet",
      "--contract-name",
      name,
      "--output-dir",
      outDir,
      "--overwrite",
    ],
    { stdio: "inherit", cwd: sdkRoot },
  );
  // No post-processing step - stellar-js generate's own output is
  // already NodeNext-correct as-is (see stripJsExtensionsFromRelativeImports's doc comment).
}

const deployment = loadDeployment();

// risk-oracle and event-registry are this PR's scope (al.oracle,
// al.events). staking/treasury/market-factory have no TS bindings yet
// and are not built here (see PR description's deviations section).
// `token` is also generated - not exposed as its own al.* module, but
// every Stellar Asset Contract shares the same SEP-41 interface, so
// these bindings back the SDK's internal assetDisplayName() helper
// (src/contracts/token.ts), ported from web/app/lib/contracts/token.ts.
const targets = {
  "risk-oracle": deployment.contracts?.risk_oracle?.id,
  "event-registry": deployment.contracts?.event_registry?.id,
  token: deployment.tusd?.contract_id,
};

for (const [name, contractId] of Object.entries(targets)) {
  if (!contractId) {
    die(`deployments/testnet.json has no ${name === "token" ? "tusd.contract_id" : `contracts.${name.replace("-", "_")}.id`} entry.`);
  }
  generate(name, contractId, path.join(sdkRoot, "src", "contracts", name));
}

console.log("generate-bindings: done.");
