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
        {/* RootProvider's own dark-mode toggle is next-themes under the
            hood, which writes to the `class` attribute by default - but
            every Sylox theme token (@sylox/ui/tokens.css) switches on
            [data-theme="dark"|"light"], not a class, matching the rest
            of the product (web/app, web/landing). `attribute:
            "data-theme"` makes next-themes manage that exact attribute
            on <html> instead, so clicking the sun/moon toggle actually
            flips the real tokens - defaultTheme "dark" replaces the old
            hardcoded static data-theme="dark" above, which never
            updated when the toggle was clicked. */}
        <RootProvider theme={{ attribute: "data-theme", defaultTheme: "dark" }}>{children}</RootProvider>
      </body>
    </html>
  );
}
