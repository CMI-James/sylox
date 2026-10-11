// Node ESM loader hook (registered via `node --experimental-loader`)
// that throws if anything in the module graph being loaded tries to
// resolve a `node:*` built-in specifier (or its legacy un-prefixed
// form, e.g. "fs" instead of "node:fs"). Used by
// src/networks.test.ts's "touches no node:* built-in" test to prove
// that importing the package's own compiled dist/index.js never
// reaches for a Node built-in at runtime - the same failure mode a
// browser bundle (the web app in PR 2) or a published-package consumer
// with no Node built-ins available would hit.
//
// Deliberately NOT an allowlist of "known safe" specifiers: any
// node:* resolution at all is the exact thing PR #69's review flagged
// (node:fs/node:path/node:url, read at runtime) - so this hook is
// strict by construction, not tuned to this package's current import
// graph.
const NODE_BUILTIN_PATTERN = /^node:/;
const LEGACY_BUILTIN_NAMES = new Set([
  "fs",
  "path",
  "url",
  "os",
  "child_process",
  "crypto",
  "http",
  "https",
  "net",
  "tls",
  "stream",
  "buffer",
  "events",
  "util",
  "assert",
  "zlib",
  "readline",
  "worker_threads",
]);

export async function resolve(specifier, context, nextResolve) {
  if (NODE_BUILTIN_PATTERN.test(specifier) || LEGACY_BUILTIN_NAMES.has(specifier)) {
    throw new Error(
      `throw-on-node-builtin-loader: refused to resolve Node built-in "${specifier}" while importing @sylox/sdk's compiled output. This module graph must run in a browser-like environment with no Node built-ins available.`,
    );
  }
  return nextResolve(specifier, context);
}
