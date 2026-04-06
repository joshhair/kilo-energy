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
    <div className="rounded-xl p-3 min-w-0 overflow-hidden" style={{ background: 'var(--m-card, #0d1525)', border: '1px solid var(--m-border, #1a2840)' }}>
      <p
        className="font-bold tabular-nums break-words leading-tight"
        style={{
          color,
          fontFamily: "var(--m-font-display, 'DM Serif Display', serif)",
          // Responsive clamp — scales with viewport so 3-col grids on 320-400px
          // phones don't overflow for mid/large money values.
          fontSize: 'clamp(1rem, 5vw, 1.75rem)',
        }}
      >
        {value}
      </p>
      <p
        className="mt-1.5 tracking-wide uppercase truncate"
        style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)", fontSize: '0.7rem' }}
      >
        {label}
      </p>
    </div>
  );
}
