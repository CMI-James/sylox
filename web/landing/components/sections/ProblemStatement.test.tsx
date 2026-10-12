import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProblemStatement } from "./ProblemStatement";
import { problem } from "@/content";

// useScrollReveal dynamically imports gsap/ScrollTrigger on every mount,
// unconditionally (not gated by IntersectionObserver). The real packages
// still resolve fine under jsdom, but their Promise can settle after a
// test's render tree is torn down, which Vitest reports as an unhandled
// rejection ("environment was torn down") even though every assertion
// below passes. Mocking both modules keeps this suite testing render
// output (what it's actually for) without depending on a real animation
// library or a teardown race.
vi.mock("gsap", () => ({
  default: { registerPlugin: vi.fn(), set: vi.fn(), to: vi.fn() },
}));
vi.mock("gsap/ScrollTrigger", () => ({
  ScrollTrigger: { create: vi.fn(() => ({ kill: vi.fn() })) },
}));

describe("ProblemStatement", () => {
  it("renders every paragraph in content.ts's problem.paragraphs list, in order, word for word", () => {
    render(<ProblemStatement />);

    const paragraphs = screen.getAllByText(
      (_, element) =>
        element?.tagName === "P" &&
        problem.paragraphs.includes(element.textContent ?? ""),
    );

    // One rendered <p> per content paragraph: nothing merged, nothing split.
    expect(paragraphs).toHaveLength(problem.paragraphs.length);

    // Exact text, exact order, word for word, no regrouping.
    const renderedTexts = paragraphs.map((p) => p.textContent);
    expect(renderedTexts).toEqual(problem.paragraphs);
  });

  it("renders the five beats from the brief as five separate paragraphs", () => {
    render(<ProblemStatement />);

    expect(problem.paragraphs).toHaveLength(5);
    for (const beat of problem.paragraphs) {
      expect(screen.getByText(beat)).toBeInTheDocument();
    }
  });

  it("renders the section eyebrow and heading", () => {
    render(<ProblemStatement />);

    expect(screen.getByText(problem.eyebrow)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: problem.heading }),
    ).toBeInTheDocument();
  });
});
