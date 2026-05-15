'use client';

/**
 * UpcomingBlitzBanner — surfaces the soonest upcoming blitz on the
 * rep's dashboard so reps stop missing blitzes they should know about.
 *
 * Visibility:
 *  - Renders when there's an upcoming or active blitz starting within
 *    the next 7 days that the viewer can see (per the loosened blitz
 *    visibility from Phase 2b — all internal reps can discover blitzes).
 *  - Auto-hides if no qualifying blitz exists.
 *
 * Progressive priority: visual weight ramps up as the blitz approaches:
 *  - 4-7 days out: subtle accent border, medium type
 *  - 1-3 days out: stronger accent, slightly bolder copy
 *  - Day-of / active: strongest accent + pulsing dot
 *
 * State branches:
 *  - Viewer is approved participant → "see you Friday" tone + View link
 *  - Viewer is pending → "request pending" amber tone
 *  - Viewer is not yet on it → FOMO "X reps going — join them?"
 *
 * The banner is the discovery surface. Tapping any state navigates to
 * the blitz detail page where the per-page FOMO banner from Phase 2b
 * handles the Request flow.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarPlus, Flame } from 'lucide-react';
import { useApp } from '../../../lib/context';

interface UpcomingBlitzSummary {
  id: string;
  name: string;
  location: string | null;
  housing: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  status: string;
  participants: Array<{ joinStatus: string; user: { id: string } }>;
  owner?: { id: string; firstName?: string | null } | null;
}

/** Days from now until the blitz starts. Negative if already started. */
function daysUntil(startDate: string, now: Date = new Date()): number {
  const [y, m, d] = startDate.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** Priority tier drives visual weight. Higher = more urgent. */
type Priority = 'low' | 'medium' | 'high' | 'active';
function getPriority(blitz: UpcomingBlitzSummary, now: Date = new Date()): Priority {
  if (blitz.status === 'active') return 'active';
  const dleft = daysUntil(blitz.startDate, now);
  if (dleft <= 1) return 'active'; // imminent
  if (dleft <= 3) return 'high';
  if (dleft <= 7) return 'medium';
  return 'low';
}

/** Pick the single most-relevant blitz to surface — the soonest upcoming
 *  one starting within 7 days, OR an active blitz happening now. */
function pickBannerBlitz(
  blitzes: UpcomingBlitzSummary[],
  now: Date = new Date(),
): UpcomingBlitzSummary | null {
  const candidates = blitzes.filter((b) => {
    if (b.status === 'cancelled' || b.status === 'completed') return false;
    if (b.status === 'active') return true;
    const dleft = daysUntil(b.startDate, now);
    return dleft >= 0 && dleft <= 7;
  });
  if (candidates.length === 0) return null;
  // Sort by start date ascending — soonest first
  candidates.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return candidates[0];
}

export function UpcomingBlitzBanner({ variant = 'desktop' }: { variant?: 'desktop' | 'mobile' }) {
  const { effectiveRepId } = useApp();
  const [blitzes, setBlitzes] = useState<UpcomingBlitzSummary[] | null>(null);

  useEffect(() => {
    // Lightweight fetch — re-uses the existing /api/blitzes endpoint
    // which already scopes to the viewer. We only need name/dates/
    // participants/status to render the banner; the per-blitz detail
    // page loads the full payload on demand when they tap through.
    let cancelled = false;
    fetch('/api/blitzes')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        if (cancelled) return;
        if (Array.isArray(data)) setBlitzes(data as UpcomingBlitzSummary[]);
        else setBlitzes([]);
      })
      .catch(() => {
        if (!cancelled) setBlitzes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const blitz = useMemo(() => (blitzes ? pickBannerBlitz(blitzes) : null), [blitzes]);

  // Don't render anything while loading or if there's no qualifying blitz.
  // Banner-as-empty-state is a worse UX than banner-not-there.
  if (!blitz) return null;

  const priority = getPriority(blitz);
  const dleft = daysUntil(blitz.startDate);
  const isActive = blitz.status === 'active' || dleft <= 0;

  const viewerParticipant = blitz.participants.find((p) => p.user.id === effectiveRepId);
  const viewerJoinStatus = viewerParticipant?.joinStatus ?? null;
  const approvedCount = blitz.participants.filter((p) => p.joinStatus === 'approved').length;

  // Visual weight by priority. Accent intensity steps up as the blitz
  // approaches; active / day-of gets a pulsing dot.
  const accentMix = priority === 'active' ? 18 : priority === 'high' ? 14 : priority === 'medium' ? 10 : 8;
  const borderMix = priority === 'active' ? 50 : priority === 'high' ? 40 : priority === 'medium' ? 30 : 22;
  const bg = `color-mix(in srgb, var(--accent-emerald-solid) ${accentMix}%, var(--surface-card))`;
  const border = `color-mix(in srgb, var(--accent-emerald-solid) ${borderMix}%, transparent)`;

  // Copy adapts to participation status.
  const primaryCopy = (() => {
    if (isActive) return `${blitz.name} is live`;
    if (dleft === 0) return `${blitz.name} starts today`;
    if (dleft === 1) return `${blitz.name} starts tomorrow`;
    return `${blitz.name} starts in ${dleft} days`;
  })();
  const secondaryCopy = (() => {
    if (viewerJoinStatus === 'approved') {
      return blitz.location ? `You're in · ${blitz.location}` : `You're in`;
    }
    if (viewerJoinStatus === 'pending') {
      return `Your request is pending ${blitz.owner?.firstName ?? 'the owner'}'s approval`;
    }
    // Not on it yet — FOMO copy
    if (approvedCount === 0) return 'Be the first to join';
    return `${approvedCount} rep${approvedCount === 1 ? '' : 's'} going — join them?`;
  })();
  const ctaCopy = viewerJoinStatus === 'approved'
    ? 'View blitz'
    : viewerJoinStatus === 'pending'
      ? 'View'
      : 'Request to join →';

  const isMobile = variant === 'mobile';

  return (
    <Link
      href={`/dashboard/blitz/${blitz.id}`}
      className={`block rounded-2xl transition-all active:scale-[0.98] ${isMobile ? 'p-4 mb-4' : 'p-5 mb-6'}`}
      style={{
        background: bg,
        border: `1px solid ${border}`,
        textDecoration: 'none',
      }}
      aria-label={`${primaryCopy} — ${secondaryCopy}`}
    >
      <div className={`flex items-start justify-between gap-3 ${isMobile ? 'flex-col' : 'flex-col sm:flex-row sm:items-center'}`}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {priority === 'active' ? (
              <span className="relative inline-flex items-center justify-center w-2 h-2">
                <span className="absolute inset-0 rounded-full bg-[var(--accent-emerald-solid)] animate-ping opacity-75" />
                <span className="relative inline-block w-2 h-2 rounded-full bg-[var(--accent-emerald-solid)]" />
              </span>
            ) : priority === 'high' ? (
              <Flame className="w-3.5 h-3.5 text-[var(--accent-emerald-text)]" />
            ) : (
              <CalendarPlus className="w-3.5 h-3.5 text-[var(--accent-emerald-text)]" />
            )}
            <span
              className="tracking-widest uppercase text-[0.7rem] font-semibold"
              style={{ color: 'var(--accent-emerald-text)', letterSpacing: '0.12em' }}
            >
              {priority === 'active' ? 'Active Blitz' : 'Upcoming Blitz'}
            </span>
          </div>
          <p
            className={`font-semibold text-[var(--text-primary)] ${isMobile ? 'text-base' : 'text-lg'}`}
            style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            {primaryCopy}
          </p>
          <p
            className={`text-[var(--text-secondary)] mt-0.5 ${isMobile ? 'text-sm' : 'text-sm'}`}
            style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            {secondaryCopy}
          </p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1 text-sm font-semibold whitespace-nowrap ${isMobile ? 'mt-1' : ''}`}
          style={{ color: 'var(--accent-emerald-text)' }}
        >
          {ctaCopy}
        </span>
      </div>
    </Link>
  );
}
