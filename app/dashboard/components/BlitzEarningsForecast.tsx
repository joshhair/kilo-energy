'use client';

/**
 * BlitzEarningsForecast — interactive "if you close X deals you'd earn Y"
 * card for blitz detail pages. Phase 2d.
 *
 * Visible to reps + sub-dealers (anyone with personal earnings). Hidden
 * for admin/PM views — they don't have personal earnings to forecast.
 *
 * The forecast uses the rep's historical avg commission per deal,
 * computed from their non-cancelled projects via blitz-forecast.ts.
 * For new reps with < 3 deals, falls back to a team-wide baseline so
 * the forecast doesn't render as $0 (demoralizing for new reps).
 *
 * UX: slider with deal count, big projected $ number, secondary copy
 * explaining the assumption. Slider range 1-15 to cover small to
 * large blitzes; defaults to 3 as a "modest reasonable" anchor.
 */

import { useMemo, useState } from 'react';
import { Target } from 'lucide-react';
import { useApp } from '../../../lib/context';
import { forecastBlitzEarnings } from '../../../lib/blitz-forecast';
import type { PipelineProject } from '../../../lib/aggregators';

interface Props {
  variant?: 'desktop' | 'mobile';
}

// Conservative fallback when the rep has < 3 deals. Calibrated against
// a typical Kilo deal commission ($1.5-3K for closer-only roles).
// Admin can tune via env later if it drifts too high or low.
const FALLBACK_AVG_PER_DEAL = 2500;

export function BlitzEarningsForecast({ variant = 'desktop' }: Props) {
  const { projects, effectiveRepId, effectiveRole } = useApp();
  const [dealCount, setDealCount] = useState(3);

  // Admin / PM don't have personal earnings on a blitz — they're viewing
  // it as oversight. Hide the forecast card for them.
  const showForecast =
    effectiveRole === 'rep'
    || effectiveRole === 'sub-dealer';

  const { forecast, avgPerDeal, usedFallback } = useMemo(
    () => forecastBlitzEarnings({
      projects: projects as unknown as PipelineProject[],
      repId: effectiveRepId,
      expectedDeals: dealCount,
      fallbackAvgPerDeal: FALLBACK_AVG_PER_DEAL,
    }),
    [projects, effectiveRepId, dealCount],
  );

  if (!showForecast) return null;

  const isMobile = variant === 'mobile';

  return (
    <div
      className={`rounded-2xl ${isMobile ? 'p-4 mb-4' : 'p-5 mb-6'}`}
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-4 h-4" style={{ color: 'var(--accent-emerald-text)' }} />
        <p
          className="tracking-widest uppercase text-[0.7rem] font-semibold"
          style={{ color: 'var(--accent-emerald-text)', letterSpacing: '0.12em' }}
        >
          Earnings Forecast
        </p>
      </div>

      <p
        className={`tabular-nums break-words ${isMobile ? 'text-3xl' : 'text-4xl'} font-bold`}
        style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)", color: 'var(--accent-emerald-text)', lineHeight: 1.1 }}
      >
        ${forecast.toLocaleString()}
      </p>
      <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
        if you close {dealCount} deal{dealCount === 1 ? '' : 's'} at this blitz
      </p>

      <div className="mt-4">
        <input
          type="range"
          min={1}
          max={15}
          step={1}
          value={dealCount}
          onChange={(e) => setDealCount(Number(e.target.value))}
          className="w-full cursor-pointer accent-[var(--accent-emerald-solid)]"
          aria-label="Deals to forecast"
        />
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>1 deal</span>
          <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-secondary)' }}>{dealCount}</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>15 deals</span>
        </div>
      </div>

      <p className="text-[11px] mt-3" style={{ color: 'var(--text-dim)' }}>
        Based on your {usedFallback ? 'team-wide avg' : 'historical avg'} of{' '}
        <span className="tabular-nums font-medium" style={{ color: 'var(--text-muted)' }}>
          ${avgPerDeal.toLocaleString()}
        </span>{' '}
        per deal.
        {usedFallback && ' Will refine as you close more deals.'}
      </p>
    </div>
  );
}
