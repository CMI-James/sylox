import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("home page accessibility", () => {
  test("has no automatically detectable a11y violations", async ({ page }) => {
    // Without this, the scan race against useScrollReveal.ts's GSAP
    // ScrollTrigger animations: most [data-reveal] elements start at
    // opacity:0 until scrolled into view, so whether axe catches them
    // settled or still fading in - and therefore whether a real
    // color-contrast failure gets reported at all - depends on exactly
    // when analyze() runs relative to each element's reveal. Confirmed
    // directly: an unscoped scan here failed intermittently (axe caught
    // elements mid-fade) and passed when it ran before any reveal fired,
    // for the same unchanged page.
    //
    // reducedMotion: "reduce" sidesteps the race rather than racing it:
    // useScrollReveal.ts has its own reduced-motion branch that skips
    // GSAP/ScrollTrigger entirely and sets every [data-reveal] element to
    // its final opacity:1/transform:none synchronously on mount - the
    // same settled state a full scroll-through would eventually reach,
    // but deterministic and immediate instead of timing-dependent.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("exposes exactly one h1", async ({ page }) => {
    await page.goto("/");
    const h1Count = await page.locator("h1").count();
    expect(h1Count).toBe(1);
  });
});
