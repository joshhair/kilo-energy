'use client';

export default function MobileStatCard({
  label,
  value,
  color = 'var(--text-primary)',
  eyebrow = false,
}: {
  label: string;
  value: string | number;
  /**
   * Numeral color. Ignored when `eyebrow` is true — eyebrow variant always
   * paints the numeral with `var(--text-primary)` to match the Revenue
   * hero card vocabulary (label carries the accent, not the digit).
   */
  color?: string;
  /**
   * Premium variant: label rendered ABOVE the numeral as a 10px uppercase
   * 0.22em emerald-text eyebrow, mirroring the Revenue hero card. Numeral
   * is forced to `var(--text-primary)` so the four tiles read as one
   * coherent family rather than a rainbow gauntlet.
   */
  eyebrow?: boolean;
}) {
  if (eyebrow) {
    return (
      <div className="rounded-xl p-4 min-w-0 overflow-hidden" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
        <p
          className="uppercase truncate"
          style={{
            color: 'var(--accent-emerald-text)',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '0.22em',
            margin: 0,
          }}
        >
          {label}
        </p>
        <p
          className="mt-2 tabular-nums break-words leading-tight"
          style={{
            color: 'var(--text-primary)',
            fontFamily: "var(--m-font-display, 'DM Serif Display', serif)",
            fontSize: 'clamp(1.5rem, 6.2vw, 2rem)',
          }}
        >
          {value}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-3 min-w-0 overflow-hidden" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
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
        style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)", fontSize: '0.75rem' }}
      >
        {label}
      </p>
    </div>
  );
}
