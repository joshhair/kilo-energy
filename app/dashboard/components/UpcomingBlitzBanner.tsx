'use client';

/**
 * UpcomingBlitzBanner — surfaces the soonest upcoming blitz on the
 * rep's dashboard so reps stop missing blitzes they should know about.
 *
 * Visibility:
 *  - Renders when there's an upcoming or active blitz starting within
 *    the next 7 days that the viewer can see (per the loosened blitz
 *    visibility from Phase 2b — all internal reps can discover blitzes).
 *  - ALSO renders any blitz the viewer is INVITED to, regardless of how
 *    far out — the rep needs to confirm so the leader can plan housing.
 *  - Auto-hides if no qualifying blitz exists.
 *
 * State branches:
 *  - Viewer is invited (owner added them, awaiting confirm)
 *    → Accept / Decline buttons inline; no card-nav.
 *  - Viewer is approved → "see you Friday" tone + View link
 *  - Viewer is pending (self-request) → "request pending" copy
 *  - Viewer is not on it → FOMO copy + Request CTA
 *
 * Premium visual: card-surface + left-edge emerald stripe instead of
 * a saturated tinted background — matches My Pay / dashboard cards.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarPlus, Flame, Check, X, Loader2 } from 'lucide-react';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import { deriveBlitzStatus } from '../../../lib/blitzStatus';

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

/** Pick the single most-relevant blitz to surface — invited blitzes
 *  always win (rep is blocking the leader's planning), otherwise the
 *  soonest upcoming-within-7-days OR currently active blitz. */
function pickBannerBlitz(
  blitzes: UpcomingBlitzSummary[],
  viewerId: string | null,
  now: Date = new Date(),
): UpcomingBlitzSummary | null {
  // Always derive status from dates rather than trusting the DB field —
  // /api/blitzes returns the raw stored status, which can lag if a blitz
  // ended without a manual status update (e.g. endDate in the past but
  // status still says 'active'). deriveBlitzStatus computes the truthful
  // state from startDate/endDate.
  const isExcluded = (b: UpcomingBlitzSummary): boolean => {
    const derived = deriveBlitzStatus(b);
    return derived === 'cancelled' || derived === 'completed';
  };
  const invited = blitzes.filter((b) => {
    if (isExcluded(b)) return false;
    return b.participants.some((p) => p.user.id === viewerId && p.joinStatus === 'invited');
  });
  if (invited.length > 0) {
    invited.sort((a, b) => a.startDate.localeCompare(b.startDate));
    return invited[0];
  }
  const candidates = blitzes.filter((b) => {
    if (isExcluded(b)) return false;
    const derived = deriveBlitzStatus(b);
    if (derived === 'active') return true;
    const dleft = daysUntil(b.startDate, now);
    return dleft >= 0 && dleft <= 7;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return candidates[0];
}

export function UpcomingBlitzBanner({ variant = 'desktop' }: { variant?: 'desktop' | 'mobile' }) {
  const { effectiveRepId } = useApp();
  const { toast } = useToast();
  const [blitzes, setBlitzes] = useState<UpcomingBlitzSummary[] | null>(null);
  const [responding, setResponding] = useState<null | 'approved' | 'declined'>(null);

  const reload = () => {
    fetch('/api/blitzes')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        if (Array.isArray(data)) setBlitzes(data as UpcomingBlitzSummary[]);
        else setBlitzes([]);
      })
      .catch(() => setBlitzes([]));
  };

  useEffect(() => {
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
    return () => { cancelled = true; };
  }, []);

  const blitz = useMemo(
    () => (blitzes ? pickBannerBlitz(blitzes, effectiveRepId) : null),
    [blitzes, effectiveRepId],
  );

  if (!blitz) return null;

  const priority = getPriority(blitz);
  const dleft = daysUntil(blitz.startDate);
  const isActive = blitz.status === 'active' || dleft <= 0;

  const viewerParticipant = blitz.participants.find((p) => p.user.id === effectiveRepId);
  const viewerJoinStatus = viewerParticipant?.joinStatus ?? null;
  const approvedCount = blitz.participants.filter((p) => p.joinStatus === 'approved').length;
  const isInvited = viewerJoinStatus === 'invited';

  // Left-edge emerald stripe instead of saturated background — matches the
  // premium My Pay / dashboard pattern. Stripe intensity ramps up by
  // priority so an active/imminent blitz still feels urgent without
  // shouting.
  const stripeMix = isInvited ? 55 : priority === 'active' ? 50 : priority === 'high' ? 40 : priority === 'medium' ? 32 : 24;
  const stripe = `color-mix(in srgb, var(--accent-emerald-solid) ${stripeMix}%, transparent)`;

  const eyebrowCopy = isInvited
    ? 'Blitz invitation'
    : priority === 'active'
      ? 'Active blitz'
      : 'Upcoming blitz';

  const primaryCopy = (() => {
    if (isInvited) {
      const ownerName = blitz.owner?.firstName ?? 'A leader';
      return `${ownerName} invited you to ${blitz.name}`;
    }
    if (isActive) return `${blitz.name} is live`;
    if (dleft === 0) return `${blitz.name} starts today`;
    if (dleft === 1) return `${blitz.name} starts tomorrow`;
    return `${blitz.name} starts in ${dleft} days`;
  })();

  const secondaryCopy = (() => {
    if (isInvited) {
      const when = dleft === 0 ? 'today' : dleft === 1 ? 'tomorrow' : dleft > 0 ? `in ${dleft} days` : `${Math.abs(dleft)} days ago`;
      return blitz.location ? `Starts ${when} · ${blitz.location}` : `Starts ${when}`;
    }
    if (viewerJoinStatus === 'approved') {
      return blitz.location ? `You're in · ${blitz.location}` : `You're in`;
    }
    if (viewerJoinStatus === 'pending') {
      return `Your request is pending ${blitz.owner?.firstName ?? 'the owner'}'s approval`;
    }
    if (viewerJoinStatus === 'waitlist') {
      return `You're on the waitlist`;
    }
    if (approvedCount === 0) return 'Be the first to join';
    return `${approvedCount} rep${approvedCount === 1 ? '' : 's'} going — join them?`;
  })();

  const ctaCopy = viewerJoinStatus === 'approved'
    ? 'View blitz'
    : viewerJoinStatus === 'pending' || viewerJoinStatus === 'waitlist'
      ? 'View'
      : 'Request to join →';

  const isMobile = variant === 'mobile';

  const handleRespond = async (joinStatus: 'approved' | 'declined') => {
    if (!effectiveRepId || responding) return;
    setResponding(joinStatus);
    try {
      const r = await fetch(`/api/blitzes/${blitz.id}/participants`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: effectiveRepId, joinStatus }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        toast(body.error || 'Could not save response', 'error');
        return;
      }
      toast(joinStatus === 'approved' ? `You're in — see you at ${blitz.name}!` : 'Declined');
      reload();
    } catch {
      toast('Network error', 'error');
    } finally {
      setResponding(null);
    }
  };

  // ───── Invited branch — inline Accept / Decline, no card-link ─────
  if (isInvited) {
    return (
      <div
        className={`card-surface rounded-2xl border-l-2 ${isMobile ? 'p-4 mb-4' : 'p-5 mb-6'}`}
        style={{ borderLeftColor: stripe }}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <CalendarPlus className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald-text)' }} />
          <span
            className="tracking-[0.22em] uppercase text-[10px] font-semibold"
            style={{ color: 'var(--accent-emerald-text)' }}
          >
            {eyebrowCopy}
          </span>
        </div>
        <p
          className={`leading-tight text-[var(--text-primary)] ${isMobile ? 'text-lg' : 'text-xl'}`}
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          {primaryCopy}
        </p>
        <p
          className="text-sm mt-1.5"
          style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
        >
          {secondaryCopy}
        </p>
        <div className="flex items-center gap-2.5 mt-4">
          <button
            onClick={() => handleRespond('approved')}
            disabled={responding !== null}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-[13px] font-semibold tracking-wide transition-opacity active:opacity-80 disabled:opacity-50"
            style={{
              background: 'var(--accent-emerald-solid)',
              color: 'var(--text-on-accent)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            {responding === 'approved' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            I&apos;m in
          </button>
          <button
            onClick={() => handleRespond('declined')}
            disabled={responding !== null}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium transition-opacity active:opacity-80 disabled:opacity-50"
            style={{
              color: 'var(--text-muted)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            {responding === 'declined' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
            Pass
          </button>
          <Link
            href={`/dashboard/blitz/${blitz.id}`}
            className="ml-auto text-[13px] transition-opacity hover:opacity-80"
            style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            Details →
          </Link>
        </div>
      </div>
    );
  }

  // ───── Default branch — premium card-link variant ─────
  return (
    <Link
      href={`/dashboard/blitz/${blitz.id}`}
      className={`card-surface block rounded-2xl border-l-2 transition-all active:scale-[0.99] ${isMobile ? 'p-4 mb-4' : 'p-5 mb-6'}`}
      style={{ borderLeftColor: stripe, textDecoration: 'none' }}
      aria-label={`${primaryCopy} — ${secondaryCopy}`}
    >
      <div className={`flex items-start justify-between gap-3 ${isMobile ? 'flex-col' : 'flex-col sm:flex-row sm:items-center'}`}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            {priority === 'active' ? (
              <span className="relative inline-flex items-center justify-center w-2 h-2">
                <span className="absolute inset-0 rounded-full bg-[var(--accent-emerald-solid)] animate-ping opacity-75" />
                <span className="relative inline-block w-2 h-2 rounded-full bg-[var(--accent-emerald-solid)]" />
              </span>
            ) : priority === 'high' ? (
              <Flame className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald-text)' }} />
            ) : (
              <CalendarPlus className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald-text)' }} />
            )}
            <span
              className="tracking-[0.22em] uppercase text-[10px] font-semibold"
              style={{ color: 'var(--accent-emerald-text)' }}
            >
              {eyebrowCopy}
            </span>
          </div>
          <p
            className={`leading-tight text-[var(--text-primary)] ${isMobile ? 'text-lg' : 'text-xl'}`}
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            {primaryCopy}
          </p>
          <p
            className="text-sm mt-1.5"
            style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            {secondaryCopy}
          </p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1 text-[13px] font-semibold whitespace-nowrap ${isMobile ? 'mt-2' : ''}`}
          style={{ color: 'var(--accent-emerald-text)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
        >
          {ctaCopy}
        </span>
      </div>
    </Link>
  );
}
