'use client';

import { useRef, useEffect, useLayoutEffect, useState } from 'react';

interface MobilePillTabsProps {
  items: Array<{ id: string; label: string }>;
  activeId: string;
  onChange: (id: string) => void;
}

export default function MobilePillTabs({ items, activeId, onChange }: MobilePillTabsProps) {
  const pillRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const idx = items.findIndex(item => item.id === activeId);
    const el = pillRefs.current[idx];
    if (!el) return;
    setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [activeId, items]);

  useEffect(() => {
    const activeIndex = items.findIndex(item => item.id === activeId);
    const el = pillRefs.current[activeIndex];
    if (el) {
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: prefersReduced ? 'instant' : 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeId, items]);

  return (
    <div className="relative flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
      {indicator && (
        <span
          aria-hidden
          className="mobile-pill-tab-indicator absolute inset-y-0 rounded-xl pointer-events-none"
          style={{
            left: indicator.left,
            width: indicator.width,
            background: 'var(--accent-emerald)',
            boxShadow: '0 0 12px rgba(0,229,160,0.35)',
          }}
        />
      )}
      {items.map(({ id, label }, index) => (
        <button
          key={id}
          ref={(el) => { pillRefs.current[index] = el; }}
          onClick={() => onChange(id)}
          className="relative px-3 py-1.5 rounded-xl text-sm font-medium whitespace-nowrap min-h-[44px] z-10 active:scale-[0.93] motion-safe:transition-transform motion-safe:duration-100"
          style={{
            background: 'transparent',
            border: 'none',
            color: activeId === id ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
            transition: 'color 200ms ease',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
