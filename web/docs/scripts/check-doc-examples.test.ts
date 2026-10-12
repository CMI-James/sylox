import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractSnippet, extractTsFences } from "./doc-examples.mjs";

// This suite is the drift-check half of PR 4's code-example-typecheck
// mechanism (see doc-examples.mjs's own top-of-file doc comment for
// the full picture). The OTHER half - that content-examples/*.examples.ts
// actually compiles against the real @sylox/sdk - needs no test of its
// own: those files are real .ts under this workspace's tsconfig.json,
// so `npm run typecheck -w web/docs` already checks them on every CI
// run. What this suite adds is the guarantee that what's typechecked
// is ALSO, verbatim, what the published page shows - so the two copies
// can never silently drift apart.
const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mdx(name: string): string {
  return readFileSync(path.join(docsRoot, "content", "docs", name), "utf8");
}

function examples(name: string): string {
  return readFileSync(path.join(docsRoot, "content-examples", name), "utf8");
}

// Each entry: the .mdx page, its .examples.ts sibling, and every named
// snippet that page's prose embeds. Adding a new code example to a
// page means adding its name here too - a snippet present in the
// .examples.ts file but never listed (and therefore never checked
// against the page) would defeat the whole point of this suite, so
// each .examples.ts file's own exports are cross-checked against this
// list below as well (see "every exported snippet is checked").
const PAGES: Array<{ mdxFile: string; examplesFile: string; snippets: string[] }> = [
  {
    mdxFile: "integration-guides.mdx",
    examplesFile: "integration-guides.examples.ts",
    snippets: [
      "show-issuer-risk",
      "check-before-buying",
      "read-definitions",
      "watch-for-events",
      "propose-and-challenge",
    ],
  },
  {
    mdxFile: "sdk-reference.mdx",
    examplesFile: "sdk-reference.examples.ts",
    snippets: [
      "construct",
      "read-only-construct",
      "read-oracle",
      "read-events",
      "write-propose",
      "write-finalize-prepare-confirm",
      "error-shape",
      "cache-adapter",
      "default-cache-adapter",
    ],
  },
];

describe("doc code examples match their typechecked source", () => {
  for (const { mdxFile, examplesFile, snippets } of PAGES) {
    describe(mdxFile, () => {
      const pageSource = mdx(mdxFile);
      const exampleSource = examples(examplesFile);
      const fences = extractTsFences(pageSource);

      it(`has at least one fenced ts code block per expected snippet (${snippets.length} expected, found ${fences.length})`, () => {
        expect(fences.length).toBeGreaterThanOrEqual(snippets.length);
      });

      for (const name of snippets) {
        it(`"${name}" appears verbatim in a \`\`\`ts block on the page`, () => {
          const snippet = extractSnippet(exampleSource, name);
          const matchingFence = fences.find((fence) => fence.includes(snippet));
          expect(
            matchingFence,
            `No \`\`\`ts block in ${mdxFile} contains the "${name}" snippet from ${examplesFile}. ` +
              `Either the page's code block drifted from the typechecked source, or the marker name is wrong.\n\n` +
              `Expected snippet:\n${snippet}`,
          ).toBeDefined();
        });
      }
    });
  }
});

describe("every exported snippet is checked", () => {
  // Guards the suite itself: a snippet added to an .examples.ts file
  // (a new `// START x` / `// END x` pair) but never added to this
  // test's own PAGES list above would compile under tsc (so CI's
  // typecheck step would still pass) but would never actually be
  // cross-checked against the published page - silently defeating the
  // point of this mechanism. Counting `// START ` markers directly
  // (not exported identifiers) catches that: every marker must have a
  // matching entry in PAGES's snippets list for its file.
  for (const { examplesFile, snippets } of PAGES) {
    it(`${examplesFile}'s own START markers are all listed in PAGES`, () => {
      const source = examples(examplesFile);
      const starts = Array.from(source.matchAll(/\/\/ START (\S+)/g)).map((m) => m[1]);
      expect(new Set(starts)).toEqual(new Set(snippets));
    });
  }
});
