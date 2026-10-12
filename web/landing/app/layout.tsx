import type { Metadata } from "next";
import { inter, spaceMono, bigShoulders } from "@sylox/ui/fonts";
import { MotionBootstrap } from "@/lib/motion/MotionBootstrap";
import "@sylox/ui/tokens.css";
import "./globals.css";

const siteUrl = "https://sylox.xyz";
// Matches the new hero (brief: "Update <title>, the meta description and
// the Open Graph text to match the new hero"). Title uses a colon, not an
// em dash, per the repo's no-em-dash rule (the previous title used one;
// replaced here since this line is being touched anyway).
const title = "Sylox: Know your issuer before it fails.";
const description =
  "Sylox scores anchor issued assets on Stellar in public. If the issuer behind one breaks, cover written against it pays from collateral that's already locked.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: "Sylox",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceMono.variable} ${bigShoulders.variable}`}
    >
      <body>
        <MotionBootstrap />
        {children}
      </body>
    </html>
  );
}
