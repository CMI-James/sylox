import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

// Shared nav/sidebar chrome config, read by both app/docs/layout.tsx
// and (once a docs home page exists) any top-level layout. Kept as a
// plain function per Fumadocs' own convention, not a constant, so it
// can later read request-scoped data (e.g. locale) without a shape
// change at call sites.
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "Sylox Docs",
    },
    links: [
      {
        text: "App",
        url: "https://app.sylox.xyz",
      },
      {
        text: "Website",
        url: "https://sylox.xyz",
      },
    ],
  };
}
