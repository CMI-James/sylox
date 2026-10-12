"use client";

import { Fragment, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { faq } from "@/content";
import { useScrollReveal } from "@/lib/motion/useScrollReveal";
import { Eyebrow } from "@sylox/ui/components";

// Renders `answer` as plain text, except each `answerLinks` entry's exact
// `text` substring becomes a link - keeps the brief's copy word-for-word
// (no "Read more" bolted on) while still making "Sylox SDK" and "the
// integration guides" real links into the docs site.
function renderAnswer(answer: string, answerLinks?: { text: string; href: string }[]) {
  if (!answerLinks || answerLinks.length === 0) return answer;

  let remaining = answer;
  const nodes: React.ReactNode[] = [];
  for (const { text, href } of answerLinks) {
    const index = remaining.indexOf(text);
    if (index === -1) {
      nodes.push(remaining);
      remaining = "";
      continue;
    }
    nodes.push(remaining.slice(0, index));
    nodes.push(
      <a href={href} className="underline underline-offset-2 hover:text-slate-black">
        {text}
      </a>,
    );
    remaining = remaining.slice(index + text.length);
  }
  nodes.push(remaining);

  return nodes.map((node, index) => <Fragment key={index}>{node}</Fragment>);
}

export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useScrollReveal(containerRef);

  return (
    <section
      id="faq"
      data-theme="light"
      className="bg-silo-oatmeal px-6 py-24 md:px-16 md:py-32"
    >
      <div ref={containerRef} className="mx-auto max-w-3xl">
        <Eyebrow tone="graphite" data-reveal>{faq.eyebrow}</Eyebrow>
        <h2 data-reveal className="mt-4 font-display text-4xl leading-[0.95] tracking-tight text-slate-black md:text-6xl">
          Questions, answered plainly.
        </h2>

        <div className="mt-16 divide-y divide-cement-grey/30 border-y border-cement-grey/30">
          {faq.items.map((item, index) => {
            const isOpen = openIndex === index;
            return (
              <div key={item.question} data-reveal>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 py-6 text-left"
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${index}`}
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                >
                  <span className="text-lg font-medium text-slate-black md:text-xl">
                    {item.question}
                  </span>
                  <ChevronDown
                    className={`h-6 w-6 shrink-0 text-anchor-graphite transition-transform duration-200 ${
                      isOpen ? "rotate-180 text-risk-crimson" : ""
                    }`}
                    aria-hidden="true"
                  />
                </button>
                <div
                  id={`faq-answer-${index}`}
                  className="grid transition-[grid-template-rows] duration-300 ease-out"
                  style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                >
                  <div className="overflow-hidden">
                    <p className="max-w-xl pb-6 text-sm leading-relaxed text-anchor-graphite md:text-base">
                      {renderAnswer(item.answer, item.answerLinks)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
