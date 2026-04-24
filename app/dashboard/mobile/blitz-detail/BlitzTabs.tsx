'use client';

import { useRef, useEffect, useLayoutEffect, useState } from 'react';

export type BlitzTabKey = 'overview' | 'participants' | 'deals' | 'costs' | 'profitability';

export interface BlitzTab {
  key: BlitzTabKey;
  label: string;
}

interface Props {
  tabs: BlitzTab[];
  active: BlitzTabKey;
  onChange: (key: BlitzTabKey) => void;
}

// Pill-style tab bar — matches the status-filter pill pattern on
// MobileBlitz (and other mobile surfaces). Each tab is a rounded-full
// chip: active = emerald fill with black text, inactive = transparent
// with muted text. Horizontal scroll handles any overflow on very narrow
// screens without text truncation; the `no-scrollbar` utility hides the
// scrollbar chrome so it stays clean.
export default function BlitzTabs({ tabs, active, onChange }: Props) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const idx = tabs.findIndex(t => t.key === active);
    const el = tabRefs.current[idx];
    if (!el) return;
    setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [active, tabs]);

  useEffect(() => {
    const activeIndex = tabs.findIndex(t => t.key === active);
    const el = tabRefs.current[activeIndex];
    if (el) {
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: prefersReduced ? 'instant' : 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [active, tabs]);

  return (
    <div
      className="sticky z-20 -mx-5 px-5 pt-2"
      style={{
        top: 0,
        background: 'rgba(8, 12, 24, 0.88)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderBottom: '1px solid var(--m-border, var(--border-mobile))',
        paddingBottom: '8px',
      }}
    >
    <div className="relative flex gap-2 overflow-x-auto no-scrollbar">
      {indicator && (
        <span
          aria-hidden
          className="blitz-detail-tab-indicator absolute inset-y-0 rounded-full pointer-events-none"
          style={{
            left: indicator.left,
            width: indicator.width,
            background: 'var(--accent-emerald)',
            boxShadow: '0 0 12px rgba(0,229,160,0.35)',
          }}
        />
      )}
      {tabs.map((t, index) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            ref={(el) => { tabRefs.current[index] = el; }}
            onClick={() => onChange(t.key)}
            className="relative min-h-[40px] px-4 py-1.5 text-sm font-semibold rounded-full whitespace-nowrap shrink-0 z-10"
            style={{
              background: 'transparent',
              border: 'none',
              color: isActive ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
              transition: 'color 200ms ease',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
    </div>
  );
}
