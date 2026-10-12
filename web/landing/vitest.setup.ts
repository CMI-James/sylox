import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement matchMedia; several components read
// prefers-reduced-motion directly off window.matchMedia (not via a
// hook that could be mocked per-test), so this needs a global stub.
// Default to "no match" (matches: false) for every query, i.e. the
// same as a real browser with no reduced-motion preference set.
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

// jsdom doesn't implement IntersectionObserver either; useInViewport
// (ProblemStatement's video pause/play, and anything else that mounts it)
// constructs one directly in an effect, so any test that renders such a
// component needs this stubbed globally. Never reports an intersection
// (isIntersecting stays false via the default state) — tests that need to
// simulate scrolling into view trigger that through the component's own
// props/state instead of this stub.
if (typeof window !== "undefined" && !("IntersectionObserver" in window)) {
  class MockIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe = () => {};
    unobserve = () => {};
    disconnect = () => {};
    takeRecords = (): IntersectionObserverEntry[] => [];
  }

  (globalThis as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    MockIntersectionObserver;
}
