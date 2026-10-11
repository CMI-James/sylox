// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card, type CardLinkComponent } from "./Card";

const FakeLink: CardLinkComponent = ({ href, children, ...props }) => (
  <a href={href} data-fake-link="true" {...props}>
    {children}
  </a>
);

describe("Card", () => {
  it("renders a div when href is omitted", () => {
    render(<Card data-testid="card">content</Card>);
    const card = screen.getByTestId("card");
    expect(card.tagName).toBe("DIV");
  });

  it("renders a plain <a> when href is set and no link component is passed", () => {
    render(<Card href="/asset/CFOO">content</Card>);
    const link = screen.getByRole("link", { name: "content" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/asset/CFOO");
    expect(link).not.toHaveAttribute("data-fake-link");
  });

  it("renders the given link component instead of <a> when `as` is passed, for client-side navigation", () => {
    render(
      <Card href="/asset/CFOO" as={FakeLink}>
        content
      </Card>,
    );
    const link = screen.getByRole("link", { name: "content" });
    expect(link).toHaveAttribute("href", "/asset/CFOO");
    expect(link).toHaveAttribute("data-fake-link", "true");
  });

  it("never renders `as` as a div's own prop when href is omitted", () => {
    const { container } = render(
      <Card as={FakeLink} data-testid="card">
        content
      </Card>,
    );
    const card = screen.getByTestId("card");
    expect(card.tagName).toBe("DIV");
    expect(container.querySelector("[data-fake-link]")).toBeNull();
  });
});
