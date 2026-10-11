import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ["@sylox/ui"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// fumadocs-mdx is ESM-only; createMDX() wires its own webpack/turbopack
// loader + macro plugin (fumadocs-mdx/macro, used directly in
// lib/source.ts - see that file) for .mdx files under content/docs.
// Doesn't need a .mjs config file the way Fumadocs' own install guide
// shows it: this repo's existing Next configs (web/app, web/landing)
// are already .ts under "module": "esnext" / "moduleResolution":
// "bundler", which resolves fumadocs-mdx/next's ESM export the same
// way a real .mjs file would.
const withMDX = createMDX();

export default withMDX(nextConfig);
