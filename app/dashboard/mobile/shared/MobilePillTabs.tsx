'use client';

interface MobilePillTabsProps {
  items: Array<{ id: string; label: string }>;
  activeId: string;
  onChange: (id: string) => void;
}

export default function MobilePillTabs({ items, activeId, onChange }: MobilePillTabsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
      {items.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className="px-3 py-1.5 rounded-xl text-sm font-medium whitespace-nowrap min-h-[44px] active:scale-[0.93] motion-safe:transition-transform motion-safe:duration-100"
          style={{
            background: activeId === id ? 'rgba(0,229,160,0.15)' : 'var(--m-card, var(--surface-mobile-card))',
            color: activeId === id ? 'var(--accent-emerald)' : 'var(--m-text-muted, var(--text-mobile-muted))',
            border: `1px solid ${activeId === id ? 'rgba(0,229,160,0.3)' : 'var(--m-border, var(--border-mobile))'}`,
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            transition: 'background 180ms ease, color 180ms ease, border-color 180ms ease',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
