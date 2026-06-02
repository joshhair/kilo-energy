'use client';
import { type StatusBreakdown } from '../../../../lib/aggregators';

/** Compact currency for narrow mobile cards. The 3-up summary grid
 *  on a phone leaves ~80px of content width per tile, so anything
 *  with 4-digit-plus dollars + cents truncates ("$5,118.04" → "$5,11…").
 *  Tiered formatting:
 *    ≥ $1M  → $1.83M (1–2 sig figs)
 *    ≥ $10K → $15K
 *    ≥ $1K  → $5,118 (drop cents — cents are noise at the summary level)
 *    < $1K  → $128 (full precision)
 *  Full untruncated value stays available via the title= tooltip. */
export function compactCurrency(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs).toLocaleString()}`;
  return `${sign}$${abs.toLocaleString()}`;
}

export function SummaryCard({ label, total, tone, breakdown, pending = false, isActive = false, mountDelay = 0 }: {
  label: string;
  total: number;
  tone: string;
  breakdown: StatusBreakdown;
  pending?: boolean;
  isActive?: boolean;
  mountDelay?: number;
}) {
  const fmtBreakdown = (n: number) => {
    const abs = Math.abs(n);
    const sign = n < 0 ? '−' : '';
    return `${sign}${compactCurrency(abs)}`;
  };
  const lines: string[] = [];
  if (breakdown.deal !== 0) {
    let line = `Deals ${fmtBreakdown(breakdown.deal)}`;
    if (breakdown.chargebacks !== 0) {
      line += ` (−${compactCurrency(Math.abs(breakdown.chargebacks))} ${pending ? 'pending cb' : 'cb'})`;
    }
    lines.push(line);
  }
  if (breakdown.bonus !== 0) lines.push(`Bonus ${fmtBreakdown(breakdown.bonus)}`);
  if (breakdown.trainer !== 0) lines.push(`Trainer ${fmtBreakdown(breakdown.trainer)}`);

  return (
    <div
      className="summary-card-in rounded-2xl p-3 min-w-0 overflow-hidden relative"
      style={{
        animationDelay: `${mountDelay}ms`,
        background: 'var(--surface-card)',
        border: `1px solid ${isActive ? `color-mix(in srgb, ${tone} 28%, var(--border-subtle))` : 'var(--border-subtle)'}`,
        transition: 'border-color 220ms ease',
      }}
    >
      {isActive && (
        <div
          className="accent-bar-scale absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl"
          style={{ background: tone, transformOrigin: 'left' }}
        />
      )}
      <p className="text-[10px] uppercase tracking-widest font-semibold truncate" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{label}</p>
      <p
        className="text-base font-bold tabular-nums mt-1 leading-none truncate"
        title={`$${total.toLocaleString()}`}
        style={{ color: tone, fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}
      >
        {compactCurrency(total)}
      </p>
      <div className="mt-2 space-y-0.5">
        {lines.length === 0
          ? <p className="text-[10px]" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>—</p>
          : lines.map((l) => (
              <p key={l} className="text-[10px] truncate" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{l}</p>
            ))}
      </div>
    </div>
  );
}
