import { useState, useEffect } from 'react';

interface InlineBarProps {
  value: number;
  max: number;
  fillClass?: string;
  index?: number;
}

export function InlineBar({ value, max, fillClass = 'bg-[var(--accent-emerald-solid)]/70', index = 0 }: InlineBarProps) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setMounted(true); return; }
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="w-full h-3 rounded-full bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)] overflow-hidden">
      <div
        className={`h-full rounded-full ${fillClass}`}
        style={{
          width: mounted ? `${pct}%` : '0%',
          transition: mounted ? 'width 600ms cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
          transitionDelay: mounted ? `${index * 55}ms` : '0ms',
        }}
      />
    </div>
  );
}
