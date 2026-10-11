import { defineDocs } from "fumadocs-mdx/macro";
import { loader } from "fumadocs-core/source";

// fumadocs-mdx's macro API (createMDX()'s default in next.config.ts
// compiles this inline, no separate source.config.ts / generated
// .source directory needed - see Fumadocs' own Next.js manual
// installation guide).
const docs = defineDocs({
  dir: "content/docs",
});

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});
