'use client';

/**
 * Collapse — smooth height animation for arbitrary children.
 *
 * Uses the `grid-template-rows: 0fr → 1fr` trick (widely supported in
 * Chrome, Safari, and Firefox since 2024). Pure CSS transition — no JS
 * height measurement, no max-height hacks, no content-dependent
 * timing. The grid row resolves to `auto` when open and collapses to
 * zero when closed, and the browser interpolates smoothly.
 *
 * Why this over max-height: max-height requires a hardcoded upper
 * bound and interpolates linearly over that range, so short content
 * snaps fast and tall content crawls slow. grid-rows interpolates to
 * the actual rendered height for free.
 *
 * Honors prefers-reduced-motion — users with that set get an instant
 * toggle, no transition.
 */

import { ReactNode } from 'react';

export function Collapse({
  open,
  children,
  durationMs = 220,
  easing = 'cubic-bezier(0.16, 1, 0.3, 1)',
}: {
  open: boolean;
  children: ReactNode;
  durationMs?: number;
  easing?: string;
}) {
  return (
    <div
      aria-hidden={!open}
      className="motion-safe:transition-[grid-template-rows,opacity]"
      style={{
        display: 'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        opacity: open ? 1 : 0,
        transitionDuration: `${durationMs}ms`,
        transitionTimingFunction: easing,
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      <div style={{ overflow: 'hidden', minHeight: 0 }}>
        {children}
      </div>
    </div>
  );
}
