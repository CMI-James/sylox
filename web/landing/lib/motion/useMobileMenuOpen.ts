"use client";

const EVENT_NAME = "sylox:mobile-menu-toggle";

/**
 * Tiny cross-component signal so the hero's WebGL canvas can unmount
 * while the mobile nav menu is open. Needed because the menu and the
 * hero are DOM siblings (Header and SimpleHero don't share a parent
 * that could hold this as normal lifted state), and because a WebGL
 * canvas can paint above a CSS z-index/isolation stacking context on
 * some browsers — the only fully reliable fix is to stop rendering it,
 * not just cover it.
 *
 * The matching listener hook (useMobileMenuOpen) was removed as dead
 * code (PR #80 follow-up): the WebGL canvas it was meant to unmount
 * (AntigravityField) isn't mounted anywhere in the live tree, so nothing
 * currently listens for this event. This dispatcher is kept since
 * Header.tsx still calls it, and re-adding a listener hook later is a
 * cheap, obvious addition if that canvas comes back.
 */
export function setMobileMenuOpen(isOpen: boolean) {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: isOpen }));
}
