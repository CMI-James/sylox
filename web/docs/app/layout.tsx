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
      data-theme="dark"
      className={`${inter.variable} ${spaceMono.variable} ${bigShoulders.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
