'use client';

export type BlitzTabKey = 'overview' | 'participants' | 'deals' | 'costs';

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
  return (
    <div className="flex gap-1" style={{ borderBottom: '1px solid var(--m-border, var(--border-mobile))' }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className="flex-1 text-center text-sm font-semibold min-h-[48px] px-2 transition-colors"
          style={{
            color: active === t.key ? 'var(--accent-emerald)' : 'var(--m-text-muted, var(--text-mobile-muted))',
            borderBottom: active === t.key ? '2px solid var(--accent-emerald)' : '2px solid transparent',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
