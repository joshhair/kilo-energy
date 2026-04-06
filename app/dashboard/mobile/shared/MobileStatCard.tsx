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
          // Responsive clamp with a readable floor — 1.25rem (20px) is the
          // minimum so money values stay legible on narrow (320-360px)
          // phones. Pair with fmtCompact$ at the caller for wide values.
          fontSize: 'clamp(1.25rem, 5.5vw, 1.75rem)',
        }}
      >
        {value}
      </p>
      <p
        className="mt-1.5 tracking-wide uppercase truncate"
        style={{ color: 'var(--m-text-muted, #8899aa)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)", fontSize: '0.75rem' }}
      >
        {label}
      </p>
    </div>
  );
}
