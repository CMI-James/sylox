import Image from "next/image";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

// Same mark, same sizing convention as web/app's DashboardShell.tsx
// and web/landing's Header.tsx (width/height set the artwork's real
// 1315:1139 aspect ratio; h-6 w-auto sizes by height only so a future
// swap of the source art can't get squashed by a mismatched fixed
// box). Sized smaller here than those two (h-[3em]/h-10) since
// Fumadocs' own nav title slot sits inline with plain text at a much
// smaller scale, not a standalone header row.
function Logo() {
  return (
    <Image src="/brand/sylox-mark.webp" alt="" width={1315} height={1139} className="h-6 w-auto" priority aria-hidden="true" />
  );
}

// Shared nav/sidebar chrome config, read by both app/docs/layout.tsx
// and (once a docs home page exists) any top-level layout. Kept as a
// plain function per Fumadocs' own convention, not a constant, so it
// can later read request-scoped data (e.g. locale) without a shape
// change at call sites.
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <Logo />
          Sylox Docs
        </>
      ),
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
