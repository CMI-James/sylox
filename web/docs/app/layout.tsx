import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RootProvider } from "fumadocs-ui/provider/next";
import { inter, spaceMono, bigShoulders } from "@sylox/ui/fonts";
import "@sylox/ui/tokens.css";
import "./global.css";

export const metadata: Metadata = {
  title: "Sylox Docs",
  description: "Testnet. Documentation for the Sylox protocol - contracts, SDK, and integration guides.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceMono.variable} ${bigShoulders.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        {/* next-themes needs to drive BOTH attributes at once, not just
            one:
            - "data-theme" is what every Sylox token
              (@sylox/ui/tokens.css) switches on, matching the rest of
              the product (web/app, web/landing) - this alone was the
              original dark-mode fix (the toggle previously wrote to
              `class` by default, which nothing here reads, so it
              visibly did nothing).
            - "class" (the literal "dark"/"light" string on <html>) is
              what Fumadocs' OWN compiled CSS keys off internally, in
              two places that have nothing to do with the --color-fd-*
              tokens above: its Tailwind `dark:` variant itself is
              defined as `@variant dark (&:where(.dark, .dark *))`
              (fumadocs-ui/css/lib/base.css), and its shipped
              syntax-highlighting CSS for code blocks
              (fumadocs-ui/css/lib/shiki.css) switches the Shiki
              dual-theme tokens (--shiki-light/--shiki-dark) via a
              plain `.dark` selector, not an attribute one. With only
              "data-theme" set, `.dark` is never applied, so every
              `dark:`-prefixed class anywhere in Fumadocs' own
              component output - and every code block's own syntax
              colors - stays permanently stuck on its light-mode
              value, regardless of which theme is actually active
              (confirmed directly by reading both files in
              node_modules). Passing `attribute: ["class",
              "data-theme"]` makes next-themes set both from the same
              toggle, so Sylox's own tokens and Fumadocs' internal
              dark: machinery agree on which theme is active. */}
        <RootProvider theme={{ attribute: ["class", "data-theme"], defaultTheme: "dark" }}>{children}</RootProvider>
      </body>
    </html>
  );
}
