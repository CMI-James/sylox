import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * web/app, web/landing and web/docs each commit their own real copy of
 * this mark (not a symlink - breaks on Windows checkouts and some
 * build platforms, see web/app's own sylox-mark.test.ts history) and
 * NOT a build-time copy step either (adds a predev/prebuild script
 * every app would need to remember to run, not just a production
 * build). A plain byte-for-byte check here is the actual guard
 * against this copy silently drifting from the other two - it fails
 * loudly the moment someone edits one copy and forgets the others,
 * rather than shipping three different logos unnoticed.
 */
describe("sylox-mark.webp", () => {
  it("is byte-identical to web/landing's copy of the same mark", () => {
    const docsCopy = readFileSync(path.join(__dirname, "sylox-mark.webp"));
    const landingCopy = readFileSync(path.join(__dirname, "../../../landing/public/brand/sylox-mark.webp"));

    const docsHash = createHash("sha256").update(docsCopy).digest("hex");
    const landingHash = createHash("sha256").update(landingCopy).digest("hex");

    expect(docsHash).toBe(landingHash);
  });
});
