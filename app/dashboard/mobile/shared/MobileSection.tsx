'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapse } from '../../components/Collapse';

export default function MobileSection({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
  count,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  count?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // A single toggle source of truth. Non-collapsible sections pin
  // `open` to true via the render path, so the Collapse wrapper below
  // is a no-op for them (transition-on-mount only).
  const expanded = !collapsible || open;

  const headerContent = (
    <div className="flex items-center gap-2">
      <h2 className="tracking-widest uppercase" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)", fontSize: '0.75rem', fontWeight: 500 }}>{title}</h2>
      {count !== undefined && (
        <span className="px-2 py-0.5 rounded-full text-base" style={{ background: 'var(--accent-emerald-soft)', color: 'var(--accent-emerald-solid)', fontSize: '0.7rem', fontWeight: 600 }}>{count}</span>
      )}
    </div>
  );

  return (
    <div>
      {collapsible ? (
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="w-full flex items-center justify-between mb-3 min-h-[48px]"
        >
          {headerContent}
          {/* Single rotating chevron — smoother than swapping glyphs. */}
          <ChevronDown
            className="w-5 h-5 motion-safe:transition-transform"
            style={{
              color: 'var(--text-dim)',
              transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
              transitionDuration: '220ms',
              transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          />
        </button>
      ) : (
        <div className="flex items-center gap-2 mb-3">
          {headerContent}
        </div>
      )}
      <Collapse open={expanded}>{children}</Collapse>
    </div>
  );
}
