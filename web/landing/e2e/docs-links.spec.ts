import { test, expect } from "@playwright/test";

// Brief: "A test or CI step that checks every docs link on the page
// returns 200, so a renamed docs page breaks the build instead of the
// site." Rather than hard-coding the five docs.sylox.xyz URLs twice (once
// in content.ts, once here), this crawls the actually-rendered page for
// every href pointing at docs.sylox.xyz and fetches each one for real -
// so a future content.ts edit that typos or renames a docs path fails
// this test immediately, instead of silently shipping a 404.
//
// Real network fetches (not Playwright's page.goto, which would need its
// own browser context per URL) - this intentionally hits the real
// docs.sylox.xyz over HTTPS, the same site visitors land on, rather than
// a mock. That makes this test dependent on docs.sylox.xyz actually being
// up; see the brief's own "Docs links: timing" section for why that's
// accepted here.
test("every docs.sylox.xyz link on the page returns 200", async ({ page, request }) => {
  await page.goto("/");

  const docsHrefs = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
    const hrefs = anchors
      .map((a) => a.getAttribute("href") ?? "")
      .filter((href) => href.includes("docs.sylox.xyz"));
    return Array.from(new Set(hrefs));
  });

  // Fails loudly (not a silent pass) if a future edit removes every docs
  // link from the page - this test exists specifically to watch them.
  expect(docsHrefs.length).toBeGreaterThan(0);

  for (const href of docsHrefs) {
    const response = await request.get(href);
    expect(response.status(), `${href} should return 200`).toBe(200);
  }
});

// The brief's own fixed list, checked directly (not just "whatever happens
// to be linked on the page today") so a docs path the page doesn't
// currently link also gets caught if it's expected to exist.
const EXPECTED_DOCS_URLS = [
  "https://docs.sylox.xyz/docs",
  "https://docs.sylox.xyz/docs/concepts",
  "https://docs.sylox.xyz/docs/integration-guides",
  "https://docs.sylox.xyz/docs/sdk-reference",
  "https://docs.sylox.xyz/docs/contract-reference",
];

test("every docs URL from the brief returns 200 over HTTPS", async ({ request }) => {
  for (const url of EXPECTED_DOCS_URLS) {
    const response = await request.get(url);
    expect(response.status(), `${url} should return 200`).toBe(200);
  }
});
