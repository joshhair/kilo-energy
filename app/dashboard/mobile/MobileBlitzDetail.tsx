'use client';

/* eslint-disable @typescript-eslint/no-explicit-any --
 * Mirror of desktop blitz/[id]/page.tsx — consumes the same
 * /api/blitzes/[id] response with dynamic shape. */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useIsHydrated } from '../../../lib/hooks';
import { formatDate } from '../../../lib/utils';
import { ArrowLeft, Pencil, Trash2, XCircle, Loader2, CalendarPlus, UserPlus, Megaphone, MapPin } from 'lucide-react';
import { mapsHref } from '../../../lib/maps';
import MobileBadge from './shared/MobileBadge';
import MobileBottomSheet from './shared/MobileBottomSheet';
import { deriveBlitzStatus } from '../../../lib/blitzStatus';
import { computeBlitzLeaderboard, computeBlitzKiloMargin, computeCostsByCategory } from '../../../lib/blitzComputed';
import { useToast } from '../../../lib/toast';
import BlitzTabs, { BlitzTabKey, BlitzTab } from './blitz-detail/BlitzTabs';
import BlitzDetailSkeleton from './blitz-detail/BlitzDetailSkeleton';
import { BlitzEarningsForecast } from '../components/BlitzEarningsForecast';
import BlitzOverview from './blitz-detail/BlitzOverview';
import BlitzParticipants from './blitz-detail/BlitzParticipants';
import BlitzDeals from './blitz-detail/BlitzDeals';
import BlitzCosts from './blitz-detail/BlitzCosts';
import BlitzProfitability from './blitz-detail/BlitzProfitability';
import BlitzLeaderboard from './blitz-detail/BlitzLeaderboard';
import BlitzEditSheet from './blitz-detail/BlitzEditSheet';
import BlitzProgressBar from './blitz-detail/BlitzProgressBar';
import BlitzMyStats from './blitz-detail/BlitzMyStats';
import BlitzAnnouncements from './blitz-detail/BlitzAnnouncements';

export default function MobileBlitzDetail({ blitzId }: { blitzId: string }) {
  const router = useRouter();
  const { effectiveRole, effectiveRepId, reps, installerPricingVersions, productCatalogProducts, solarTechProducts } = useApp();
  const hydrated = useIsHydrated();
  const isAdmin = effectiveRole === 'admin';
  const isPM = effectiveRole === 'project_manager';
  const { toast } = useToast();

  const [blitz, setBlitz] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const prevTabRef = useRef<BlitzTabKey>('overview');
  const scrollPos = useRef<Partial<Record<BlitzTabKey, number>>>({});
  const [tab, setTab] = useState<BlitzTabKey>('overview');

  const [canRequestBlitz, setCanRequestBlitz] = useState(false);

  useEffect(() => {
    if (isAdmin || !effectiveRepId) return;
    fetch(`/api/users/${effectiveRepId}`).then((r) => r.json()).then((u) => {
      setCanRequestBlitz(u.canRequestBlitz ?? false);
    }).catch((err) => {
      console.warn('[MobileBlitzDetail] perm load failed:', err instanceof Error ? err.message : err);
    });
  }, [effectiveRepId, isAdmin]);

  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showCancelRequest, setShowCancelRequest] = useState(false);
  // Phase 3c — mobile broadcast composer.
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);

  const handleTabChange = useCallback((next: BlitzTabKey) => {
    scrollPos.current[prevTabRef.current] = window.scrollY;
    window.scrollTo({ top: 0, behavior: 'instant' });
    prevTabRef.current = next;
    setTab(next);
  }, []);

  const loadBlitz = useCallback(() => {
    fetch(`/api/blitzes/${blitzId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { router.push('/dashboard/blitz'); return; }
        setBlitz({ ...data, status: deriveBlitzStatus(data) });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [blitzId, router]);

  useEffect(() => { loadBlitz(); }, [loadBlitz]);

  useEffect(() => {
    const saved = scrollPos.current[tab];
    if (saved) {
      const id = requestAnimationFrame(() => window.scrollTo({ top: saved, behavior: 'instant' }));
      return () => cancelAnimationFrame(id);
    }
  }, [tab]);

  const isOwner = !isAdmin && effectiveRepId != null && blitz?.owner?.id === effectiveRepId;
  const canManage = isAdmin || isOwner;

  // Viewer's own participant record — drives FOMO banner for
  // non-participants (Phase 2b roster transparency on mobile).
  const viewerParticipant = useMemo(
    () => (blitz?.participants ?? []).find((p: any) => p.user?.id === effectiveRepId) ?? null,
    [blitz?.participants, effectiveRepId],
  );
  const viewerJoinStatus: 'approved' | 'pending' | 'declined' | 'waitlist' | 'invited' | null = viewerParticipant?.joinStatus ?? null;
  const canShowFomoBanner =
    blitz != null
    && !canManage
    && !isPM
    && (viewerJoinStatus === null || viewerJoinStatus === 'declined')
    && (blitz.status === 'upcoming' || blitz.status === 'active');
  const [requestingJoin, setRequestingJoin] = useState(false);
  const handleJoinRequest = async () => {
    if (!blitz || !effectiveRepId || requestingJoin) return;
    setRequestingJoin(true);
    try {
      const res = await fetch(`/api/blitzes/${blitz.id}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: effectiveRepId }),
      });
      if (res.ok) {
        toast('Request sent to blitz owner', 'success');
        loadBlitz();
      } else {
        const err = await res.json().catch(() => ({}));
        toast(err.error || 'Failed to request', 'error');
      }
    } catch {
      toast('Network error', 'error');
    } finally {
      setRequestingJoin(false);
    }
  };
  const [respondingInvite, setRespondingInvite] = useState<'accept' | 'decline' | null>(null);
  const handleInviteResponse = async (action: 'accept' | 'decline') => {
    if (!blitz || !effectiveRepId || respondingInvite) return;
    setRespondingInvite(action);
    try {
      const res = await fetch(`/api/blitzes/${blitz.id}/participants`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: effectiveRepId, joinStatus: action === 'accept' ? 'approved' : 'declined' }),
      });
      if (res.ok) {
        if (action === 'accept') {
          const data = await res.json().catch(() => ({}));
          toast(data.joinStatus === 'waitlist' ? "You've been added to the waitlist" : 'Invitation accepted');
        } else {
          toast('Invitation declined');
        }
        loadBlitz();
      } else {
        const err = await res.json().catch(() => ({}));
        toast(err.error || 'Failed to respond', 'error');
      }
    } catch {
      toast('Network error', 'error');
    } finally {
      setRespondingInvite(null);
    }
  };

  const projects = useMemo<any[]>(() => blitz?.projects ?? [], [blitz]);
  const participants = useMemo<any[]>(() => blitz?.participants ?? [], [blitz]);
  const costs = useMemo<any[]>(() => blitz?.costs ?? [], [blitz]);

  const approvedParticipants = useMemo(
    () => participants.filter((p: any) => p.joinStatus === 'approved'),
    [participants],
  );

  const visibleProjects = useMemo(() => {
    if (isAdmin || isOwner) return projects.filter((p: any) => p.phase !== 'Cancelled' && p.phase !== 'On Hold');
    return projects.filter((p: any) => (
      p.closer?.id === effectiveRepId ||
      p.setter?.id === effectiveRepId ||
      p.additionalClosers?.some((c: any) => c.userId === effectiveRepId) ||
      p.additionalSetters?.some((s: any) => s.userId === effectiveRepId)
    ) && p.phase !== 'Cancelled' && p.phase !== 'On Hold');
  }, [projects, isAdmin, isOwner, effectiveRepId]);

  const approvedParticipantIds = useMemo(
    () => new Set<string>(participants.filter((p: any) => p.joinStatus === 'approved').map((p: any) => p.user.id)),
    [participants],
  );

  const approvedVisibleProjects = useMemo(
    () => (isAdmin || isOwner)
      ? visibleProjects.filter((p: any) =>
          approvedParticipantIds.has(p.closer?.id) ||
          approvedParticipantIds.has(p.setter?.id) ||
          (p.additionalClosers ?? []).some((cc: any) => approvedParticipantIds.has(cc.userId)) ||
          (p.additionalSetters ?? []).some((cs: any) => approvedParticipantIds.has(cs.userId)))
      : visibleProjects,
    [visibleProjects, isAdmin, isOwner, approvedParticipantIds],
  );

  const totalKW = useMemo(
    () => approvedVisibleProjects.reduce((s: number, p: any) => {
      const closerApproved = p.closer?.id && approvedParticipantIds.has(p.closer.id);
      const anyAdditionalCloserApproved = (p.additionalClosers ?? []).some((cc: any) => approvedParticipantIds.has(cc.userId));
      return s + (closerApproved || anyAdditionalCloserApproved ? (p.kWSize ?? 0) : 0);
    }, 0),
    [approvedVisibleProjects, approvedParticipantIds],
  );

  const leaderboard = useMemo(() => computeBlitzLeaderboard(blitz), [blitz]);
  const totalCosts = useMemo(() => costs.reduce((s: number, c: any) => s + c.amount, 0), [costs]);
  const costsByCategory = useMemo(() => computeCostsByCategory(blitz), [blitz]);
  const kiloMargin = useMemo(
    () => computeBlitzKiloMargin(approvedVisibleProjects, approvedParticipantIds, { solarTechProducts, productCatalogProducts, installerPricingVersions }),
    [approvedVisibleProjects, approvedParticipantIds, solarTechProducts, productCatalogProducts, installerPricingVersions],
  );

  const handleDelete = async () => {
    setSubmittingAction(true);
    try {
      const r = await fetch(`/api/blitzes/${blitzId}`, { method: 'DELETE' });
      if (!r.ok) { toast('Failed to delete blitz', 'error'); return; }
      toast('Blitz deleted');
      router.push('/dashboard/blitz');
    } catch { toast('Failed to delete blitz', 'error'); }
    finally { setSubmittingAction(false); }
  };

  const handleCancelRequest = async () => {
    setSubmittingAction(true);
    try {
      const r = await fetch('/api/blitz-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'cancel',
          requestedById: effectiveRepId,
          blitzId,
          name: blitz?.name ?? '',
          notes: cancelReason.trim() || 'No reason provided',
          startDate: blitz?.startDate ?? '',
          endDate: blitz?.endDate ?? '',
        }),
      });
      if (!r.ok) { toast('Failed to submit cancellation request', 'error'); return; }
      toast('Cancellation requested');
      setShowCancelRequest(false);
      setCancelReason('');
      loadBlitz();
    } catch { toast('Failed to submit cancellation request', 'error'); }
    finally { setSubmittingAction(false); }
  };

  if (!hydrated || loading) return <BlitzDetailSkeleton />;

  if (!blitz) {
    return (
      <div className="px-5 pt-4 pb-28 space-y-4 animate-mobile-slide-in">
        <button
          onClick={() => router.push('/dashboard/blitz')}
          className="flex items-center gap-1.5 text-base min-h-[48px]"
          style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
        >
          <ArrowLeft className="w-4 h-4" /> Blitz
        </button>
        <p className="text-base text-center" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Blitz not found.</p>
      </div>
    );
  }

  const statusLabel = blitz.status.charAt(0).toUpperCase() + blitz.status.slice(1);

  // Surface pending join requests on the Reps tab so the leader doesn't
  // have to open it to discover them. canManage gates this since reps
  // can't act on pending rows anyway.
  const pendingParticipantCount = canManage
    ? (blitz?.participants?.filter((p: any) => ['pending', 'invited', 'waitlist'].includes(p.joinStatus)).length ?? 0)
    : 0;

  const tabs: BlitzTab[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'participants', label: 'Reps', pendingBadge: pendingParticipantCount },
    { key: 'deals', label: 'Deals' },
    ...(isAdmin ? [{ key: 'costs' as BlitzTabKey, label: 'Costs' }] : []),
    ...(isAdmin ? [{ key: 'profitability' as BlitzTabKey, label: 'Profit' }] : []),
  ];

  const blitzActive = blitz.status === 'upcoming' || blitz.status === 'active';
  const canCancelRequest = canRequestBlitz && blitzActive && (isOwner || blitz.createdById === effectiveRepId);

  return (
    <div className="px-5 pt-4 pb-28 space-y-4 animate-mobile-slide-in">
      <button
        onClick={() => router.push('/dashboard/blitz')}
        className="flex items-center gap-1.5 text-base min-h-[48px]"
        style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
      >
        <ArrowLeft className="w-4 h-4" /> Blitz
      </button>

      <div>
        <h1 className="text-xl font-bold text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{blitz.name}</h1>
        <div className="mt-1.5">
          <MobileBadge value={statusLabel} variant="status" />
        </div>
        <p className="text-base mt-1" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
          {blitz.location && (() => {
            // Clickable location (Josh's blitz feedback): housing + city
            // give the precise pin; Apple Maps on Apple UAs, Google else.
            const href = mapsHref([blitz.housing, blitz.location]);
            return href ? (
              <>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline underline-offset-2 decoration-[var(--accent-emerald-solid)]/50 text-[var(--accent-emerald-text)] min-h-[44px] -my-2.5 py-2.5"
                >
                  <MapPin className="w-3.5 h-3.5" aria-hidden />
                  {blitz.location}
                </a>
                {' '}&middot;{' '}
              </>
            ) : (
              <>{blitz.location} &middot; </>
            );
          })()}
          {formatDate(blitz.startDate)} &ndash; {formatDate(blitz.endDate)}
        </p>

        {/* Refined utility row — calendar export sits beside the
            management actions as a quiet text link, not a chunky pill.
            Shared scale + middot dividers match the premium feel of My
            Pay / dashboard. Add to calendar is always visible; the
            management actions render per-role. */}
        {/* Premium utility row: left-aligned text-link actions, right-
            aligned icon-only Delete (admin). All fit on one row at
            phone widths because labels are tight and middot dividers
            collapse when items are missing. No wrap. */}
        <div className="flex items-center justify-between gap-3 mt-3 text-[12px]" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
          <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
            <a
              href={`/api/blitzes/${blitz.id}/ics`}
              download
              className="inline-flex items-center gap-1 active:opacity-70 transition-opacity whitespace-nowrap"
              style={{ color: 'var(--text-secondary)', WebkitTapHighlightColor: 'transparent' }}
              aria-label="Add this blitz to your calendar"
            >
              <CalendarPlus className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
              Calendar
            </a>
            {canManage && (
              <>
                <span aria-hidden style={{ color: 'var(--border-subtle)' }}>·</span>
                <button
                  onClick={() => setShowEdit(true)}
                  className="inline-flex items-center gap-1 active:opacity-70 transition-opacity whitespace-nowrap"
                  style={{ color: 'var(--text-secondary)', WebkitTapHighlightColor: 'transparent' }}
                >
                  <Pencil className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /> Edit
                </button>
              </>
            )}
            {canManage && (blitz.status === 'upcoming' || blitz.status === 'active') && (
              <>
                <span aria-hidden style={{ color: 'var(--border-subtle)' }}>·</span>
                <button
                  onClick={() => { setBroadcastMessage(''); setShowBroadcast(true); }}
                  className="inline-flex items-center gap-1 active:opacity-70 transition-opacity whitespace-nowrap"
                  style={{ color: 'var(--text-secondary)', WebkitTapHighlightColor: 'transparent' }}
                >
                  <Megaphone className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /> Broadcast
                </button>
              </>
            )}
            {canCancelRequest && (
              <>
                <span aria-hidden style={{ color: 'var(--border-subtle)' }}>·</span>
                <button
                  onClick={() => setShowCancelRequest(true)}
                  className="inline-flex items-center gap-1 active:opacity-70 transition-opacity whitespace-nowrap"
                  style={{ color: 'var(--text-muted)', WebkitTapHighlightColor: 'transparent' }}
                >
                  <XCircle className="w-3.5 h-3.5" /> Cancel
                </button>
              </>
            )}
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowDelete(true)}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg active:opacity-70 transition-opacity shrink-0"
              style={{
                color: 'var(--accent-red-text)',
                opacity: 0.7,
                WebkitTapHighlightColor: 'transparent',
              }}
              aria-label="Delete blitz"
              title="Delete blitz"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* FOMO banner — Phase 2b roster transparency on mobile. Premium
          card-surface treatment matches My Pay / dashboard: subtle
          left-edge emerald stripe instead of a saturated tint, refined
          serif headline, ghost-outlined CTA. */}
      {canShowFomoBanner && (
        <div
          className="card-surface rounded-2xl p-5 border-l-2"
          style={{ borderLeftColor: 'color-mix(in srgb, var(--accent-emerald-solid) 45%, transparent)' }}
        >
          <p
            className="text-[10px] uppercase tracking-[0.22em] mb-1.5"
            style={{ color: 'var(--accent-emerald-text)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            {approvedParticipants.length > 0
              ? `${approvedParticipants.length} rep${approvedParticipants.length === 1 ? '' : 's'} going`
              : 'Open spot'}
          </p>
          <p
            className="text-xl leading-tight text-[var(--text-primary)]"
            style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}
          >
            {approvedParticipants.length > 0 ? 'Join the crew?' : 'Be the first in.'}
          </p>
          <p className="text-sm mt-1.5" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
            {viewerJoinStatus === 'declined'
              ? 'You opted out earlier — send another request anytime.'
              : `${blitz?.owner?.firstName ?? 'The owner'} approves the roster.`}
          </p>
          <button
            onClick={handleJoinRequest}
            disabled={requestingJoin}
            className="mt-4 inline-flex items-center justify-center gap-2 min-h-[40px] px-5 rounded-full text-[13px] font-semibold tracking-wide active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'transparent',
              color: 'var(--accent-emerald-text)',
              border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 55%, transparent)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {requestingJoin ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Requesting…</>
            ) : viewerJoinStatus === 'declined' ? (
              <><UserPlus className="w-3.5 h-3.5" /> Re-request to join</>
            ) : (
              <><UserPlus className="w-3.5 h-3.5" /> Request to join</>
            )}
          </button>
        </div>
      )}
      {!canManage && !isPM && viewerJoinStatus === 'pending' && (
        <div
          className="rounded-2xl p-3"
          style={{
            background: 'color-mix(in srgb, var(--accent-amber-solid) 6%, var(--surface-card))',
            border: '1px solid color-mix(in srgb, var(--accent-amber-solid) 24%, transparent)',
          }}
        >
          <p className="text-sm" style={{ color: 'var(--accent-amber-text)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
            Your request to join is pending {blitz?.owner?.firstName ?? 'the owner'}&apos;s approval.
          </p>
        </div>
      )}
      {!canManage && !isPM && viewerJoinStatus === 'waitlist' && (
        <div
          className="rounded-2xl p-3"
          style={{
            background: 'color-mix(in srgb, var(--accent-cyan-solid) 6%, var(--surface-card))',
            border: '1px solid color-mix(in srgb, var(--accent-cyan-solid) 24%, transparent)',
          }}
        >
          <p className="text-sm" style={{ color: 'var(--accent-cyan-text)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
            You&apos;re on the waitlist. {blitz?.owner?.firstName ?? 'The owner'} will promote you if a spot opens.
          </p>
        </div>
      )}
      {/* Invited state — owner/admin sent an explicit invite; rep must
          accept or decline. */}
      {!canManage && !isPM && viewerJoinStatus === 'invited' && (
        <div
          className="rounded-2xl p-3 flex items-center justify-between gap-3"
          style={{
            background: 'color-mix(in srgb, var(--accent-blue-solid) 6%, var(--surface-card))',
            border: '1px solid color-mix(in srgb, var(--accent-blue-solid) 24%, transparent)',
          }}
        >
          <p className="text-sm" style={{ color: 'var(--accent-blue-text)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
            {blitz?.owner?.firstName ?? 'The owner'} invited you. Accept or decline?
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleInviteResponse('accept')}
              disabled={respondingInvite !== null}
              className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg"
              style={{
                background: 'color-mix(in srgb, var(--accent-emerald-solid) 12%, transparent)',
                color: 'var(--accent-emerald-text)',
                border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 40%, transparent)',
              }}
            >
              {respondingInvite === 'accept' ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> Accepting…</>
              ) : (
                <><UserPlus className="w-3 h-3" /> Accept</>
              )}
            </button>
            <button
              onClick={() => handleInviteResponse('decline')}
              disabled={respondingInvite !== null}
              className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg"
              style={{
                background: 'color-mix(in srgb, var(--accent-red-solid) 10%, transparent)',
                color: 'var(--accent-red-text)',
                border: '1px solid color-mix(in srgb, var(--accent-red-solid) 35%, transparent)',
              }}
            >
              {respondingInvite === 'decline' ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> Declining…</>
              ) : (
                <><XCircle className="w-3 h-3" /> Decline</>
              )}
            </button>
          </div>
        </div>
      )}

      <BlitzTabs tabs={tabs} active={tab} onChange={handleTabChange} />

      {/* Opacity-only tab transition (Josh: "blitz tabs are jenky") — the
          old directional slide animated transform on a full-height panel
          that remounts per tab; per-tab scroll restore makes the slide
          fight the scroll jump. Fade is cheap and calm. */}
      <div key={tab} className="animate-fade-in">
        {tab === 'overview' && (
          <div className="space-y-4">
            {/* Announcements first — the durable broadcast history (Codex
                design round): reps land on Overview and see news without
                digging. Server gates visibility to the roster; canSee comes
                from the API. */}
            {blitz.canSeeAnnouncements && (
              <BlitzAnnouncements
                blitzId={blitz.id}
                announcements={blitz.announcements ?? []}
                total={blitz.announcementsTotal ?? 0}
                canManage={canManage}
                canBroadcast={canManage && (blitz.status === 'upcoming' || blitz.status === 'active')}
                onBroadcast={() => setShowBroadcast(true)}
              />
            )}
            {blitz.status === 'upcoming' && (
              <BlitzEarningsForecast
                variant="mobile"
                blitzId={viewerJoinStatus === 'approved' ? blitz.id : undefined}
                viewerUserId={viewerJoinStatus === 'approved' ? effectiveRepId ?? undefined : undefined}
                currentTarget={viewerParticipant?.targetDeals ?? null}
                onTargetSaved={loadBlitz}
              />
            )}
            <BlitzOverview
              participantCount={approvedParticipants.length}
              totalDeals={approvedVisibleProjects.length}
              totalKW={totalKW}
              notes={blitz.notes}
              isAdmin={isAdmin}
              netProfit={kiloMargin - totalCosts}
            />
            {!isAdmin && effectiveRepId && visibleProjects.length > 0 && <BlitzMyStats visibleProjects={visibleProjects} effectiveRepId={effectiveRepId} />}
            {/* Admins + the blitz owner see everyone's payouts (running a
                contest, paying it out). Regular reps see ranks/kW/deals
                only — never other reps' commission. */}
            {(blitz.status === 'active' || blitz.status === 'completed') && leaderboard.length > 0 && (
              <BlitzLeaderboard
                  key={leaderboard.map(e => `${e.userId}:${e.deals}:${e.kW.toFixed(1)}`).join('|')}
                  entries={leaderboard}
                  showPayout={isAdmin || isOwner}
                />
            )}

            {/* Progress bar */}
            {(blitz.status === 'active' || blitz.status === 'completed') && (
              <BlitzProgressBar startDate={blitz.startDate} endDate={blitz.endDate} status={blitz.status} />
            )}

            {/* Details card */}
            {(() => {
              const startMs = new Date(blitz.startDate + 'T00:00:00').getTime();
              const endMs = new Date(blitz.endDate + 'T00:00:00').getTime();
              const totalDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);
              return (
                <div className="rounded-2xl p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
                  <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Details</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Leader</span>
                      <span className="font-medium text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{blitz.owner.firstName} {blitz.owner.lastName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Duration</span>
                      <span className="text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{totalDays} days</span>
                    </div>
                    {blitz.location && (
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Location</span>
                        {(() => {
                          const href = mapsHref([blitz.location]);
                          return href ? (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="text-right underline underline-offset-2 decoration-[var(--accent-emerald-solid)]/50 text-[var(--accent-emerald-text)]" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{blitz.location}</a>
                          ) : (
                            <span className="text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{blitz.location}</span>
                          );
                        })()}
                      </div>
                    )}
                    {blitz.housing && (
                      <div className="flex justify-between gap-3">
                        <span className="shrink-0" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Housing</span>
                        {(() => {
                          const href = mapsHref([blitz.housing, blitz.location]);
                          return href ? (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="text-right underline underline-offset-2 decoration-[var(--accent-emerald-solid)]/50 text-[var(--accent-emerald-text)]" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{blitz.housing}</a>
                          ) : (
                            <span className="text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{blitz.housing}</span>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Team avatar preview */}
            {approvedParticipants.length > 0 && (
              <div className="rounded-2xl p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Team</p>
                  <button onClick={() => handleTabChange('participants')} className="text-xs font-medium" style={{ color: 'var(--accent-emerald-text)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>View all</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {approvedParticipants.slice(0, 8).map((p: any) => (
                    <div key={p.user.id} className="flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: 'var(--surface-pressed)', border: '1px solid var(--border-subtle)' }}>
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'color-mix(in srgb, var(--accent-emerald-solid) 20%, transparent)', color: 'var(--accent-emerald-text)', border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 30%, transparent)' }}>
                        {(p.user.firstName?.[0] ?? '').toUpperCase()}{(p.user.lastName?.[0] ?? '').toUpperCase()}
                      </div>
                      <span className="text-xs text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{p.user.firstName}</span>
                    </div>
                  ))}
                  {approvedParticipants.length > 8 && (
                    <div className="flex items-center px-2.5 py-1 text-xs" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>+{approvedParticipants.length - 8} more</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'participants' && (
          <BlitzParticipants
            blitzId={blitzId}
            blitzOwnerId={blitz.owner?.id}
            participants={participants}
            reps={reps}
            canManage={canManage}
            leaderboard={leaderboard}
            onRefresh={loadBlitz}
          />
        )}

        {tab === 'deals' && (
          <BlitzDeals
            projects={approvedVisibleProjects}
            approvedParticipantIds={approvedParticipantIds}
            showPayout={isAdmin}
            isAdmin={isAdmin}
            isOwner={isOwner}
            effectiveRepId={effectiveRepId}
          />
        )}

        {tab === 'costs' && isAdmin && (
          <BlitzCosts blitzId={blitzId} costs={costs} onRefresh={loadBlitz} />
        )}

        {tab === 'profitability' && isAdmin && (
          <BlitzProfitability
            approvedVisibleProjects={approvedVisibleProjects}
            approvedParticipantIds={approvedParticipantIds}
            approvedParticipants={approvedParticipants}
            leaderboard={leaderboard}
            totalCosts={totalCosts}
            kiloMargin={kiloMargin}
            costsByCategory={costsByCategory}
            solarTechProducts={solarTechProducts}
            productCatalogProducts={productCatalogProducts}
            installerPricingVersions={installerPricingVersions}
          />
        )}
      </div>

      <BlitzEditSheet
        open={showEdit}
        onClose={() => setShowEdit(false)}
        onSaved={loadBlitz}
        blitz={blitz}
        isAdmin={isAdmin}
        reps={reps}
      />

      <MobileBottomSheet open={showDelete} onClose={() => setShowDelete(false)} title="Delete Blitz?">
        <div className="px-5 space-y-4">
          <p className="text-base" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
            This permanently removes the blitz, all participant records, and all tracked costs. Deals stay; they&apos;ll just unlink. Cannot be undone.
          </p>
          <button
            onClick={handleDelete}
            disabled={submittingAction}
            className="w-full flex items-center justify-center gap-1.5 min-h-[48px] text-base font-semibold text-[var(--text-primary)] rounded-lg transition-colors disabled:opacity-40"
            style={{ background: 'var(--accent-red-solid)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            {submittingAction ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {submittingAction ? 'Deleting...' : 'Delete blitz'}
          </button>
        </div>
      </MobileBottomSheet>

      <MobileBottomSheet open={showCancelRequest} onClose={() => { setShowCancelRequest(false); setCancelReason(''); }} title="Request Cancellation">
        <div className="px-5 space-y-4">
          <p className="text-sm" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
            Submits a cancellation request to admin. The blitz stays active until an admin reviews.
          </p>
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            rows={3}
            placeholder="Reason for cancellation"
            className="w-full rounded-lg px-3 py-2 text-base text-[var(--text-primary)] min-h-[80px] resize-none focus:outline-none focus:ring-1"
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              '--tw-ring-color': 'var(--accent-emerald-solid)',
            } as React.CSSProperties}
          />
          <button
            onClick={handleCancelRequest}
            disabled={submittingAction}
            className="w-full min-h-[48px] text-base font-semibold rounded-lg transition-colors disabled:opacity-40"
            style={{ color: 'var(--accent-red-text)', border: '1px solid var(--accent-red-solid)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            {submittingAction ? 'Submitting...' : 'Submit request'}
          </button>
        </div>
      </MobileBottomSheet>

      {/* Phase 3c — Mobile broadcast composer. Owner/admin sends a message
          that fans out to every approved participant via notify(). */}
      <MobileBottomSheet open={showBroadcast} onClose={() => setShowBroadcast(false)} title="Broadcast to participants">
        <div className="px-5 space-y-4 pb-4">
          <p className="text-sm" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
            Sends an email to every approved participant on &quot;{blitz.name}&quot;. Reps with email notifications off won&apos;t receive it.
          </p>
          <textarea
            value={broadcastMessage}
            onChange={(e) => setBroadcastMessage(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="Kickoff is 7am at the house. Bring your A-game."
            className="w-full rounded-lg px-3 py-2 text-base text-[var(--text-primary)] min-h-[120px] resize-none focus:outline-none focus:ring-1"
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              '--tw-ring-color': 'var(--accent-emerald-solid)',
            } as React.CSSProperties}
          />
          <p className="text-[10px] text-right tabular-nums" style={{ color: 'var(--text-dim)' }}>{broadcastMessage.length} / 2000</p>
          <button
            onClick={async () => {
              if (!broadcastMessage.trim() || broadcasting) return;
              setBroadcasting(true);
              try {
                const r = await fetch(`/api/blitzes/${blitzId}/broadcast`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ message: broadcastMessage.trim() }),
                });
                if (!r.ok) {
                  const data = await r.json().catch(() => ({}));
                  toast(data.error ?? 'Broadcast failed', 'error');
                  return;
                }
                const data = await r.json();
                toast(`Broadcast sent to ${data.recipientsOk} rep${data.recipientsOk === 1 ? '' : 's'}.`);
                setShowBroadcast(false);
                setBroadcastMessage('');
                // Refresh so the new announcement appears in the Overview card.
                loadBlitz();
              } catch {
                toast('Network error sending broadcast', 'error');
              } finally {
                setBroadcasting(false);
              }
            }}
            disabled={broadcasting || broadcastMessage.trim().length === 0}
            className="w-full min-h-[48px] text-base font-semibold rounded-lg transition-colors disabled:opacity-40"
            style={{
              background: 'var(--accent-emerald-solid)',
              color: 'var(--text-on-accent)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            {broadcasting ? 'Sending…' : 'Send broadcast'}
          </button>
        </div>
      </MobileBottomSheet>
    </div>
  );
}
