// Shared helper for the doc-example-typecheck mechanism (PR 4's brief:
// "every code example must typecheck in CI against the real SDK, so
// the docs can't drift from the code").
//
// How it works, end to end:
//   1. Every ```ts code block this PR added to content/docs/*.mdx that
//      talks about the real @sylox/sdk API is ALSO written, verbatim,
//      as a named, exported snippet in a sibling file under
//      content-examples/*.examples.ts (one real TypeScript module per
//      .mdx page), between a `// START <name>` / `// END <name>`
//      comment pair.
//   2. Those content-examples/*.examples.ts files import the real
//      @sylox/sdk and are themselves ordinary workspace TypeScript -
//      web/docs/tsconfig.json's own "include" already covers every
//      **/*.ts file in this workspace, so `npm run typecheck -w
//      web/docs` (already a required CI step, .github/workflows/
//      ci.yml's `docs` job) type-checks them for free, with zero new
//      CI wiring. A code example that calls a method that doesn't
//      exist on the real SDK fails that tsc run exactly like any other
//      type error in this workspace would.
//   3. scripts/check-doc-examples.test.ts (run by `npm test -w
//      web/docs`, also already a required CI step) reads each named
//      snippet back out of its .examples.ts file with
//      extractSnippet() below, and asserts it appears verbatim inside
//      the matching fenced ```ts block in the .mdx page. This is the
//      half that stops the two copies silently drifting apart: without
//      it, nothing would stop someone editing the .mdx prose's code
//      block without updating (or re-checking) the typechecked
//      .examples.ts copy, or vice versa.
//
// Together, (2) gives a real failure signal tied to the actual SDK
// surface, and (3) guarantees that signal actually covers what the
// published page shows, not just a copy of it that quietly went stale.
import { readFileSync } from "node:fs";

/**
 * Extracts the exact text between a `// START <name>` line and the
 * next `// END <name>` line (both lines themselves excluded) from
 * `source`. Throws if the named markers aren't found, so a typo in a
 * marker name fails loudly instead of silently matching nothing.
 */
export function extractSnippet(source, name) {
  const startMarker = `// START ${name}`;
  const endMarker = `// END ${name}`;
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(`doc-examples: could not find "${startMarker}"`);
  }
  const bodyStart = source.indexOf("\n", startIdx) + 1;
  const endIdx = source.indexOf(endMarker, bodyStart);
  if (endIdx === -1) {
    throw new Error(`doc-examples: could not find "${endMarker}" after "${startMarker}"`);
  }
  return source.slice(bodyStart, endIdx).replace(/\n$/, "");
}

/** Reads `path` relative to the repo convention used throughout this script (UTF-8 text). */
export function readText(path) {
  return readFileSync(path, "utf8");
}

/**
 * Finds every fenced ```ts ... ``` code block in MDX `source`, in
 * order, and returns their inner text (fence lines excluded).
 */
export function extractTsFences(source) {
  const fences = [];
  const pattern = /```ts\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    fences.push(match[1].replace(/\n$/, ""));
  }
  return fences;
}
