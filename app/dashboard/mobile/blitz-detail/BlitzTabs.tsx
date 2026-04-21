'use client';

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
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar">
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className="min-h-[40px] px-4 py-1.5 text-sm font-semibold rounded-full whitespace-nowrap transition-colors shrink-0"
            style={{
              background: isActive ? 'var(--accent-emerald)' : 'transparent',
              color: isActive ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
              border: `1px solid ${isActive ? 'var(--accent-emerald)' : 'var(--m-border, var(--border-mobile))'}`,
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              boxShadow: isActive ? '0 0 12px rgba(0,229,160,0.35)' : 'none',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
