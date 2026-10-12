import { source } from "@/lib/source";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/mdx";
import type { Metadata } from "next";
import { createRelativeLink } from "fumadocs-ui/mdx";

// Fumadocs' own TOC extraction (fumadocs-core's remarkHeading) walks
// every heading depth with no built-in cutoff - on the generated
// contract reference, that put ~35 individual function/type headings
// into the sidebar TOC at the same depth as their own "Functions"/
// "Types" section headers, turning it into an undifferentiated wall
// of entries. Every page here uses at most `### ` (depth 3) for real
// page structure; anything deeper is detail-level (an individual
// generated function/type), so capping here keeps the TOC to actual
// navigation rather than a full outline.
const MAX_TOC_DEPTH = 3;

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const toc = page.data.toc.filter((item) => item.depth <= MAX_TOC_DEPTH);

  return (
    <DocsPage
      toc={toc}
      full={page.data.full}
      // "clerk" style: plain text TOC entries with a connecting line
      // marking the active section, matching the rest of this
      // product's own restrained visual language better than
      // Fumadocs' default pill/card-styled TOC items (which, combined
      // with the generated contract reference's own deep heading
      // list before the depth cap above, read as a wall of badges).
      tableOfContent={{ style: "clerk" }}
      tableOfContentPopover={{ style: "clerk" }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
