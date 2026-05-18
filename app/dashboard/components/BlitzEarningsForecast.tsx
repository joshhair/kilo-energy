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

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useApp } from '../../../lib/context';
import { forecastBlitzEarnings } from '../../../lib/blitz-forecast';
import { useToast } from '../../../lib/toast';
import type { PipelineProject } from '../../../lib/aggregators';

interface Props {
  variant?: 'desktop' | 'mobile';
  // Phase 3a: when provided, the slider doubles as a "set my goal" affordance.
  // The current goal lights up the slider; changing the value enables a
  // Save button that PATCHes the participant's targetDeals. Without these
  // props the component stays a pure forecast (back-compat).
  blitzId?: string;
  currentTarget?: number | null;
  viewerUserId?: string;
  onTargetSaved?: () => void;
}

// Conservative fallback when the rep has < 3 deals. Calibrated against
// a typical Kilo deal commission ($1.5-3K for closer-only roles).
// Admin can tune via env later if it drifts too high or low.
const FALLBACK_AVG_PER_DEAL = 2500;

export function BlitzEarningsForecast({ variant = 'desktop', blitzId, currentTarget, viewerUserId, onTargetSaved }: Props) {
  const { projects, effectiveRepId, effectiveRole } = useApp();
  const { toast } = useToast();
  // Default the slider to the current goal if one exists, else 3.
  const initialDeals = currentTarget && currentTarget > 0 ? Math.min(15, Math.max(1, currentTarget)) : 3;
  const [dealCount, setDealCount] = useState(initialDeals);
  const [saving, setSaving] = useState(false);

  // When the participant's saved goal changes (e.g., another tab saved it,
  // or the parent reloaded the blitz), re-sync the slider.
  useEffect(() => {
    if (currentTarget && currentTarget > 0) setDealCount(Math.min(15, Math.max(1, currentTarget)));
  }, [currentTarget]);

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
      className={`card-surface rounded-2xl border-l-2 ${isMobile ? 'p-5 mb-4' : 'p-5 mb-6'}`}
      style={{
        borderLeftColor: 'color-mix(in srgb, var(--accent-emerald-solid) 45%, transparent)',
      }}
    >
      <p
        className="tracking-[0.22em] uppercase mb-2"
        style={{
          fontSize: '10px',
          fontWeight: 600,
          color: 'var(--accent-emerald-text)',
          fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
        }}
      >
        Earnings forecast
      </p>

      <p
        className="tabular-nums break-words leading-none"
        style={{
          fontFamily: "var(--m-font-display, 'DM Serif Display', serif)",
          fontSize: isMobile ? '2.5rem' : '3rem',
          color: 'var(--text-primary)',
        }}
      >
        ${forecast.toLocaleString()}
      </p>
      <p className="text-sm mt-2" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
        if you close {dealCount} deal{dealCount === 1 ? '' : 's'} at this blitz
      </p>

      <div className="mt-5">
        <input
          type="range"
          min={1}
          max={15}
          step={1}
          value={dealCount}
          onChange={(e) => setDealCount(Number(e.target.value))}
          className="w-full cursor-pointer accent-[var(--accent-emerald-text)]"
          aria-label="Deals to forecast"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>1 deal</span>
          <span
            className="text-[13px] tabular-nums"
            style={{
              color: 'var(--accent-emerald-text)',
              fontFamily: "var(--m-font-display, 'DM Serif Display', serif)",
            }}
          >{dealCount}</span>
          <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>15 deals</span>
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

      {/* Phase 3a — "Set as goal" affordance. Only renders when wired to a
          blitz + viewer participant. Saves dealCount as targetDeals; the
          leaderboard then shows X/goal progress alongside deals. */}
      {blitzId && viewerUserId && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
            {currentTarget && currentTarget > 0
              ? <>Your goal: <span className="font-semibold tabular-nums" style={{ color: 'var(--text-secondary)' }}>{currentTarget} deal{currentTarget === 1 ? '' : 's'}</span></>
              : 'No goal set yet.'}
          </p>
          {dealCount !== (currentTarget ?? -1) && (
            <button
              onClick={async () => {
                setSaving(true);
                try {
                  const r = await fetch(`/api/blitzes/${blitzId}/participants`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: viewerUserId, targetDeals: dealCount }),
                  });
                  if (!r.ok) { toast('Could not save goal', 'error'); return; }
                  toast('Goal saved');
                  onTargetSaved?.();
                } catch {
                  toast('Network error saving goal', 'error');
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors disabled:opacity-50"
              style={{
                background: 'color-mix(in srgb, var(--accent-emerald-solid) 14%, transparent)',
                color: 'var(--accent-emerald-text)',
                border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 32%, transparent)',
              }}
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              {currentTarget && currentTarget > 0 ? 'Update goal' : 'Set as goal'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
