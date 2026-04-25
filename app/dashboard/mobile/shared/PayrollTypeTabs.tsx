'use client';
type TypeTab = 'Deal' | 'Bonus' | 'Trainer';
const TABS: TypeTab[] = ['Deal', 'Bonus', 'Trainer'];
export default function PayrollTypeTabs({ value, onChange }: { value: TypeTab; onChange: (t: TypeTab) => void }) {
  const idx = TABS.indexOf(value);
  return (
    <div className="relative flex rounded-xl overflow-hidden" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
      <span aria-hidden className="absolute inset-y-0 rounded-xl pointer-events-none" style={{ width: 'calc(100% / 3)', background: 'var(--accent-emerald-solid)', transform: `translateX(calc(${idx} * 100%))`, transition: 'transform 240ms cubic-bezier(0.16, 1, 0.3, 1)', willChange: 'transform' }} />
      {TABS.map((t) => (
        <button key={t} type="button" onClick={() => onChange(t)}
          className="relative flex-1 z-10 min-h-[44px] text-sm font-semibold touch-manipulation"
          style={{ color: value === t ? 'var(--text-on-accent)' : 'var(--text-muted)', transition: 'color 200ms ease', background: 'transparent', border: 'none', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
          {t}
        </button>
      ))}
    </div>
  );
}
