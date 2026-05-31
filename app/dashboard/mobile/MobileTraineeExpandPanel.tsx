'use client';

import { fmt$ } from '../../../lib/utils';

export default function MobileTraineeExpandPanel({
  isOpen,
  tiers,
  activeTierIndex,
  consumedDeals,
  earningsFromTrainee,
}: {
  isOpen: boolean;
  tiers: Array<{ upToDeal: number | null; ratePerW: number }>;
  activeTierIndex: number;
  consumedDeals: number;
  earningsFromTrainee: number;
}) {
  const prevThreshold = activeTierIndex > 0
    ? (tiers[activeTierIndex - 1].upToDeal ?? 0) : 0;
  const nextThreshold = tiers[activeTierIndex]?.upToDeal ?? null;
  const range = nextThreshold === null ? 1 : Math.max(1, nextThreshold - prevThreshold);
  const pct = nextThreshold === null ? 100 : Math.min(100, ((consumedDeals - prevThreshold) / range) * 100);

  return (
    <div className="px-4 pb-3" aria-hidden={!isOpen || undefined}>
      <div className="mb-3 pt-1 motion-safe:animate-[fadeUpIn_240ms_cubic-bezier(0.16,1,0.3,1)_both]" style={{ animationDelay: '0ms' }}>
        <div className="flex justify-between text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-dim)' }}>
          <span>{consumedDeals} deals</span>
          <span>{nextThreshold === null ? 'Max tier reached' : `${nextThreshold} to advance`}</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
          <div
            className="h-full rounded-full animate-progress-grow"
            style={{ width: `${pct}%`, transformOrigin: 'left', animationDelay: '60ms', background: 'var(--accent-emerald-solid)' }}
          />
        </div>
      </div>
      <div className="flex justify-between items-center mb-2 text-base motion-safe:animate-[fadeUpIn_240ms_cubic-bezier(0.16,1,0.3,1)_both]" style={{ animationDelay: '80ms', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
        <span className="font-semibold uppercase tracking-widest text-[11px]" style={{ color: 'var(--text-dim)' }}>Earned from Trainee</span>
        <span className="font-bold tabular-nums" style={{ color: 'var(--accent-emerald-display)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(earningsFromTrainee)}</span>
      </div>
      <table className="w-full text-base motion-safe:animate-[fadeUpIn_240ms_cubic-bezier(0.16,1,0.3,1)_both]" style={{ animationDelay: '140ms', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
        <thead>
          <tr style={{ color: 'var(--text-dim)' }}>
            <th className="text-left py-1 font-semibold uppercase tracking-widest">Tier</th>
            <th className="text-left py-1 font-semibold uppercase tracking-widest">Deal Range</th>
            <th className="text-right py-1 font-semibold uppercase tracking-widest">Rate</th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((tier, i) => {
            const isActive = i === activeTierIndex;
            const prevEnd = i > 0 ? (tiers[i - 1].upToDeal ?? 0) : 0;
            const rangeLabel = tier.upToDeal === null
              ? `${prevEnd + 1}+ deals`
              : `${i === 0 ? 0 : prevEnd + 1} – ${tier.upToDeal} deals`;
            return (
              <tr
                key={i}
                className="motion-safe:animate-[fadeSlideIn_200ms_cubic-bezier(0.16,1,0.3,1)_both]"
                style={{ animationDelay: `${200 + i * 55}ms`, color: isActive ? 'var(--accent-amber-text)' : 'var(--text-muted)' }}
              >
                <td className="py-1 font-semibold">
                  Tier {i + 1}
                  {isActive && (
                    <span
                      className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide leading-none"
                      style={{ background: 'color-mix(in srgb, var(--accent-amber-solid) 15%, transparent)', color: 'var(--accent-amber-text)', border: '1px solid color-mix(in srgb, var(--accent-amber-solid) 25%, transparent)' }}
                    >ACTIVE</span>
                  )}
                </td>
                <td className="py-1">{rangeLabel}</td>
                <td className="py-1 text-right tabular-nums font-bold" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                  ${tier.ratePerW.toFixed(2)}/W
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
