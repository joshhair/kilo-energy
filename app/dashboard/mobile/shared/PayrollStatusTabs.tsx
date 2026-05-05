'use client';
type StatusTab = 'Draft' | 'Pending' | 'Paid';
const TABS: StatusTab[] = ['Draft', 'Pending', 'Paid'];
export default function PayrollStatusTabs({ value, onChange }: { value: StatusTab; onChange: (t: StatusTab) => void }) {
  const idx = TABS.indexOf(value);
  return (
    <div className="relative flex" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      {TABS.map((tab) => (
        <button key={tab} onClick={() => onChange(tab)}
          className="flex-1 min-h-[48px] text-base font-semibold touch-manipulation"
          style={{ color: value === tab ? 'var(--text-primary)' : 'var(--text-muted)', transition: 'color 200ms ease', background: 'transparent', border: 'none', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
          {tab}
        </button>
      ))}
      {/* Shared sliding underline — translate instead of per-button border-bottom */}
      <span aria-hidden className="absolute bottom-0 left-0 pointer-events-none"
        style={{ height: '2px', width: 'calc(100% / 3)', background: 'var(--accent-emerald-solid)', transform: `translateX(calc(${idx} * 100%))`, transition: 'transform 240ms cubic-bezier(0.16, 1, 0.3, 1)', willChange: 'transform' }} />
    </div>
  );
}
