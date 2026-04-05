'use client';

export default function MobileStatCard({
  label,
  value,
  color = '#fff',
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--m-card, #0d1525)', border: '1px solid var(--m-border, #1a2840)' }}>
      <p className="text-2xl font-bold tabular-nums" style={{ color, fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{value}</p>
      <p className="text-base mt-1 tracking-wide uppercase" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)", fontSize: '0.7rem' }}>{label}</p>
    </div>
  );
}
