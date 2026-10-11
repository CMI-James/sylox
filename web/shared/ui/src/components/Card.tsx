import type { AnchorHTMLAttributes, ComponentType, HTMLAttributes } from "react";

/** The minimal shape a link component needs to stand in for `<a>` here - matches next/link's own props closely enough that passing `Link` directly from web/app just works. */
export type CardLinkComponent = ComponentType<
  { href: string; className?: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">
>;

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Renders as a link instead of a div, for the whole-card-as-link pattern. */
  href?: string;
  /**
   * The component to render when `href` is set - defaults to a plain
   * `<a>`. web/shared/ui has no framework router to import, so a
   * consumer that wants client-side navigation (web/app's Explorer
   * and Events rows both do - a full page reload wipes WalletContext)
   * passes its own router's Link component here instead.
   */
  as?: CardLinkComponent;
}

const CARD_CLASS =
  "rounded-sm border border-cement-grey/30 p-6 transition-colors hover:border-risk-crimson/50";

/**
 * The hairline card: a 1px border that strengthens to Risk Crimson on
 * hover, the whole card as a single click target when used as a link
 * (DESIGN_NOTES.md: "Hairline card borders that strengthen on hover,
 * with the whole card as a single click target"). No background fill,
 * no shadow — depth comes from the border alone, per house-rule.
 *
 * First real extraction of this pattern (the landing page's own
 * bordered boxes - WhoItsFor's bento cells, Faq's divider rows - are
 * each structurally different enough that none of them were safe to
 * force into one shared component during the design-system PR; this is
 * the first consumer with a plain "isolated bordered box" shape).
 */
export function Card({ href, as, className = "", ...props }: CardProps) {
  if (href) {
    const { children, ...anchorProps } = props as Omit<CardProps, "href" | "as"> &
      AnchorHTMLAttributes<HTMLAnchorElement>;
    const LinkComponent = as ?? "a";
    return (
      <LinkComponent href={href} className={`block ${CARD_CLASS} ${className}`} {...anchorProps}>
        {children}
      </LinkComponent>
    );
  }
  return <div className={`${CARD_CLASS} ${className}`} {...props} />;
}
