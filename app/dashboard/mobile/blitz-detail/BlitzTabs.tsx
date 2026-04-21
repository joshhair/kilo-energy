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

export default function BlitzTabs({ tabs, active, onChange }: Props) {
  const activeIndex = tabs.findIndex((t) => t.key === active);
  return (
    <div className="grid relative" style={{
      gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
      borderBottom: '1px solid var(--m-border, var(--border-mobile))',
    }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className="text-center text-xs font-semibold min-h-[48px] px-1 transition-colors truncate"
          style={{
            color: active === t.key ? 'var(--accent-emerald)' : 'var(--m-text-muted, var(--text-mobile-muted))',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          }}
        >
          {t.label}
        </button>
      ))}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: '2px',
          width: `calc(100% / ${tabs.length})`,
          background: 'var(--accent-emerald)',
          transform: `translateX(calc(${activeIndex} * 100%))`,
          transition: 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1)',
          borderRadius: '1px 1px 0 0',
          boxShadow: '0 0 8px rgba(0,229,160,0.5)',
        }}
      />
    </div>
  );
}
