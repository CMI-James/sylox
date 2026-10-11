import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// jsdom (25.0.1, this project's pin) installs its OWN Uint8Array
// constructor as the ambient global, a different realm's class from
// Node's native one (long-standing jsdom bug, jsdom/jsdom#2524) - even
// though both print as "Uint8Array" and behave identically, `x
// instanceof Uint8Array` is false for a Uint8Array Node's own code
// produced (confirmed directly: a plain `Buffer.from(...)`, never
// touched by jsdom, already fails `instanceof globalThis.Uint8Array`
// here). @stellar/stellar-sdk (17.2.1, this app's pin as of the SDK
// upgrade - issue #37) encodes XDR strings/symbols via
// `new TextEncoder().encode(...)`, whose output Node's own TextEncoder
// correctly returns as a native Uint8Array - which then fails every
// `instanceof Uint8Array` check the SDK's own encode path makes
// against jsdom's DIFFERENT global, breaking `.toXdr()`/`.toXDR()` on
// any string/symbol-carrying ScVal (e.g. a contract event's topic)
// under this test environment specifically; plain Node, and SDK calls
// that only ever touch u64/bytes/numeric ScVals, are unaffected.
// Fixed by overriding the global Uint8Array with the one Node's own
// Buffer already proves is the native realm's real class (restores
// jsdom and Node to a single shared Uint8Array identity, the same
// fix jest-fixed-jsdom applies for the equivalent Jest problem) -
// re-pointing jsdom's own prototype chain instead does NOT work, since
// it can't retroactively change what realm an already-constructed
// TextEncoder output belongs to.
globalThis.Uint8Array = Object.getPrototypeOf(Buffer.prototype).constructor;

// No real Next.js App Router context exists in these component tests,
// so usePathname() (used by components/DashboardShell.tsx to mark the
// active nav item) would otherwise return null and make every page
// test fail just for rendering the shell, not for whatever that test
// actually checks. Defaults to "/" (Explorer); a test that cares about
// a different active route overrides this mock itself.
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return { ...actual, usePathname: () => "/" };
});

// jsdom doesn't implement matchMedia. Stubbed here for any component
// that reads prefers-reduced-motion directly off window.matchMedia
// (see web/landing/vitest.setup.ts, which added this after a real
// test failure from its absence).
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
