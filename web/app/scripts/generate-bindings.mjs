#!/usr/bin/env node
// Regenerates lib/contracts/<name>/ for every contract in
// deployments/testnet.json. Contract IDs are never hardcoded in app
// code; this script (and the generated clients it produces) is the
// one place that reads them, straight from the deployment record.
//
// GENERATOR: `stellar contract bindings typescript` (stellar-cli's own
// native command) is deprecated as of stellar-cli 28.1.0 - the version
// this repo pins for actual contract DEPLOYMENT (deploy/deploy.sh) and
// keeps pinning here, unchanged. Deprecated or not, that native
// command only ever emits bindings targeting @stellar/stellar-sdk
// ^16.0.1, regardless of which stellar-cli version runs it - bumping
// the CLI pin would not have produced SDK-17-shaped bindings (see
// issue #37 / this PR's own description for the full reasoning).
//
// The actual SDK-17 generator is `stellar-js generate`, a binary
// bundled INSIDE @stellar/stellar-sdk itself starting at 17.2.0 (it
// implements the CLI's own plugin convention: an executable named
// `stellar-*` on PATH, which `stellar contract bindings typescript`
// will eventually delegate to once the CLI drops its native
// implementation). Invoked here via `npx --no-install stellar-js`, so
// it always resolves the exact @stellar/stellar-sdk version this
// package.json pins (17.2.1) - no separate download, no separate
// version check needed: npm's own exact pin + lockfile is the real
// enforcement, the same way @stellar/freighter-api is pinned exactly
// for an identical "only one copy, no silent drift" reason.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const appRoot = path.resolve(__dirname, "..");

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
// explicit .js extension (`from "./types.js"`), correct per Node's own
// ESM resolution rules once compiled, and something TypeScript's
// "bundler" moduleResolution (this project's tsconfig.json) already
// resolves straight through to the real .ts file - but Turbopack
// (Next.js's bundler here) does not yet implement that same
// extension-aliasing webpack has long had; a confirmed, currently-open
// Turbopack limitation, not a bug in the generated bindings
// themselves. Stripped here, in the one place these files are
// produced, rather than hand-edited post-generation (which the next
// regeneration would silently undo).
const JS_EXTENSION_IMPORT = /((?:from|import)\s+['"])(\.\.?\/[^'"]+)\.js(['"])/g;

function stripJsExtensionsFromRelativeImports(outDir) {
  for (const entry of readdirSync(path.join(outDir, "src"))) {
    if (!entry.endsWith(".ts")) continue;
    const filePath = path.join(outDir, "src", entry);
    const source = readFileSync(filePath, "utf8");
    const fixed = source.replace(JS_EXTENSION_IMPORT, "$1$2$3");
    if (fixed !== source) writeFileSync(filePath, fixed);
  }
}

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
    { stdio: "inherit", cwd: appRoot },
  );
  stripJsExtensionsFromRelativeImports(outDir);
}

const deployment = loadDeployment();

const targets = {
  "risk-oracle": deployment.contracts?.risk_oracle?.id,
  "event-registry": deployment.contracts?.event_registry?.id,
  // Every Stellar Asset Contract shares the same SEP-41 interface, so
  // bindings generated once from any one of them (TUSD's, here) work
  // as a client for any asset address at runtime - exactly like
  // risk-oracle.ts/event-registry.ts already construct a Client with a
  // runtime contractId from the one set of generated bindings. See
  // lib/contracts/token.ts, the shared client built from this.
  token: deployment.tusd?.contract_id,
};

for (const [name, contractId] of Object.entries(targets)) {
  if (!contractId) {
    die(`deployments/testnet.json has no ${name === "token" ? "tusd.contract_id" : `contracts.${name.replace("-", "_")}.id`} entry.`);
  }
  generate(name, contractId, path.join(appRoot, "lib", "contracts", name));
}

console.log("generate-bindings: done.");
