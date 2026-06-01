'use client';

import { useState, useEffect, useRef } from 'react';
import { type StatusBreakdown } from '../../../../lib/aggregators';

interface GradCardsProps {
  draftBreakdown: StatusBreakdown;
  pendingBreakdown: StatusBreakdown;
  paidBreakdown: StatusBreakdown;
  draftCount: number;
  combinedPendingCount: number;
  combinedPaidCount: number;
  combinedTotalPaid: number;
}

function renderBreakdownSubline(b: StatusBreakdown, pending: boolean): string {
  const parts: string[] = [];
  if (b.deal !== 0) {
    let dealStr = `Deals $${Math.abs(b.deal).toLocaleString()}`;
    if (b.deal < 0) dealStr = `Deals −$${Math.abs(b.deal).toLocaleString()}`;
    if (b.chargebacks !== 0) {
      dealStr += ` (−$${Math.abs(b.chargebacks).toLocaleString()} ${pending ? 'pending chargebacks' : 'chargebacks'})`;
    }
    parts.push(dealStr);
  }
  if (b.bonus !== 0) parts.push(`Bonus $${b.bonus.toLocaleString()}`);
  if (b.trainer !== 0) parts.push(`Trainer $${b.trainer.toLocaleString()}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

function useCountUp(target: number, duration = 600): number {
  const [display, setDisplay] = useState(target);
  // Mirror `display` into a ref so the animation can read its start value
  // without listing `display` as an effect dep (which would restart the
  // tween every frame). Ref reads/writes during render are safe here.
  const displayRef = useRef(display);
  displayRef.current = display;
  const reducedMotion = typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (reducedMotion) { setDisplay(target); return; }
    const start = performance.now();
    const from = displayRef.current; // capture at effect start
    let raf: number;
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3); // cubic ease-out
      setDisplay(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reducedMotion]);
  return display;
}

export function GradCards({
  draftBreakdown,
  pendingBreakdown,
  paidBreakdown,
  draftCount,
  combinedPendingCount,
  combinedPaidCount,
  combinedTotalPaid,
}: GradCardsProps) {
  const [hoveredCard, setHoveredCard] = useState<'draft' | 'pending' | 'paid' | null>(null);
  const animatedDraft = useCountUp(draftBreakdown.total);
  const animatedPending = useCountUp(pendingBreakdown.total);
  const animatedPaid = useCountUp(combinedTotalPaid);

  const cardStyle = (key: 'draft' | 'pending' | 'paid', accent: string) => ({
    transform: hoveredCard === key ? 'translateY(-2px)' : 'none',
    boxShadow: hoveredCard === key ? `0 8px 24px color-mix(in srgb, ${accent} 18%, transparent)` : 'none',
    transition: 'transform 200ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 200ms ease',
  });

  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
      {/* Draft */}
      <div
        style={{
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-blue-solid) 10%, var(--surface-card)) 0%, var(--surface-card) 100%)',
          border: '1px solid color-mix(in srgb, var(--accent-blue-solid) 19%, transparent)',
          borderRadius: 14,
          padding: '18px 22px',
          flex: 1,
          ...cardStyle('draft', 'var(--accent-blue-solid)'),
        }}
        onMouseEnter={() => setHoveredCard('draft')}
        onMouseLeave={() => setHoveredCard(null)}
      >
        <p style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'color-mix(in srgb, var(--accent-blue-solid) 73%, transparent)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, marginBottom: 6 }}>Draft</p>
        <p style={{ fontFamily: "'DM Serif Display',serif", fontSize: 32, color: 'var(--accent-blue-display)', letterSpacing: '-0.03em', textShadow: '0 0 20px color-mix(in srgb, var(--accent-blue-solid) 25%, transparent)' }}>${animatedDraft.toLocaleString()}</p>
        <p style={{ color: 'color-mix(in srgb, var(--accent-blue-solid) 55%, transparent)', fontSize: 11, fontFamily: "'DM Sans',sans-serif", marginTop: 4 }}>{renderBreakdownSubline(draftBreakdown, true)}</p>
        <p style={{ color: 'color-mix(in srgb, var(--accent-blue-solid) 40%, transparent)', fontSize: 11, fontFamily: "'DM Sans',sans-serif", marginTop: 2 }}>{draftCount} entries · all types</p>
      </div>
      {/* Pending */}
      <div
        style={{
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-amber-solid) 10%, var(--surface-card)) 0%, var(--surface-card) 100%)',
          border: '1px solid color-mix(in srgb, var(--accent-amber-solid) 19%, transparent)',
          borderRadius: 14,
          padding: '18px 22px',
          flex: 1,
          ...cardStyle('pending', 'var(--accent-amber-solid)'),
        }}
        onMouseEnter={() => setHoveredCard('pending')}
        onMouseLeave={() => setHoveredCard(null)}
      >
        <p style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'color-mix(in srgb, var(--accent-amber-solid) 73%, transparent)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, marginBottom: 6 }}>Pending</p>
        <p style={{ fontFamily: "'DM Serif Display',serif", fontSize: 32, color: 'var(--accent-amber-display)', letterSpacing: '-0.03em', textShadow: '0 0 20px color-mix(in srgb, var(--accent-amber-solid) 25%, transparent)' }}>${animatedPending.toLocaleString()}</p>
        <p style={{ color: 'color-mix(in srgb, var(--accent-amber-solid) 55%, transparent)', fontSize: 11, fontFamily: "'DM Sans',sans-serif", marginTop: 4 }}>{renderBreakdownSubline(pendingBreakdown, true)}</p>
        <p style={{ color: 'color-mix(in srgb, var(--accent-amber-solid) 40%, transparent)', fontSize: 11, fontFamily: "'DM Sans',sans-serif", marginTop: 2 }}>{combinedPendingCount} entries · all types</p>
      </div>
      {/* Total Paid */}
      <div
        style={{
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-emerald-solid) 10%, var(--surface-card)) 0%, var(--surface-card) 100%)',
          border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 19%, transparent)',
          borderRadius: 14,
          padding: '18px 22px',
          flex: 1,
          ...cardStyle('paid', 'var(--accent-emerald-solid)'),
        }}
        onMouseEnter={() => setHoveredCard('paid')}
        onMouseLeave={() => setHoveredCard(null)}
      >
        <p style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'color-mix(in srgb, var(--accent-emerald-solid) 73%, transparent)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, marginBottom: 6 }}>Total Paid</p>
        <p style={{ fontFamily: "'DM Serif Display',serif", fontSize: 32, color: 'var(--accent-emerald-display)', letterSpacing: '-0.03em', textShadow: '0 0 20px var(--accent-emerald-glow)' }}>${animatedPaid.toLocaleString()}</p>
        <p style={{ color: 'color-mix(in srgb, var(--accent-emerald-solid) 55%, transparent)', fontSize: 11, fontFamily: "'DM Sans',sans-serif", marginTop: 4 }}>{renderBreakdownSubline(paidBreakdown, false)}</p>
        <p style={{ color: 'var(--accent-emerald-glow)', fontSize: 11, fontFamily: "'DM Sans',sans-serif", marginTop: 2 }}>{combinedPaidCount} entries · all types</p>
      </div>
    </div>
  );
}
