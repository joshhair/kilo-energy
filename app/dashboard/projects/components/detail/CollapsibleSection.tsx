'use client';

/**
 * CollapsibleSection — desktop project-page section wrapper with a
 * tappable header (title + chevron) that expands to reveal children.
 *
 * Mirrors the mobile MobileSection pattern (app/dashboard/mobile/shared/
 * MobileSection.tsx) but with desktop styling. Both share the Collapse
 * primitive at app/dashboard/components/Collapse.tsx for the height
 * animation, so motion-reduced users get instant toggles in either form
 * factor.
 *
 * Default closed — keeps the project page clean and lets the user
 * progressively disclose. Pass `defaultOpen` to override per-section.
 *
 * Surface-agnostic: this component is JUST a header + Collapse wrapper.
 * Children supply their own card-surface styling. That avoids the
 * nested-card visual when wrapping components that already render as
 * card-surface (HandoffStatusCard, InstallerFiles, etc.).
 */

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapse } from '../../../components/Collapse';

export function CollapsibleSection({
  title,
  defaultOpen = false,
  badge,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  /** Optional small pill rendered next to the title (count, status, etc.). */
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-1 py-2 mb-2 hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-[var(--text-primary)] font-semibold text-base truncate">{title}</h2>
          {badge}
        </div>
        <ChevronDown
          className="w-4 h-4 shrink-0 motion-safe:transition-transform"
          style={{
            color: 'var(--text-muted)',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            transitionDuration: '220ms',
            transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </button>
      <Collapse open={open}>{children}</Collapse>
    </div>
  );
}
