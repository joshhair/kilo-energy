'use client';

/* eslint-disable @typescript-eslint/no-explicit-any --
 * Mirror of desktop blitz/[id]/page.tsx — consumes the same
 * /api/blitzes/[id] response with dynamic shape. */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useIsHydrated } from '../../../lib/hooks';
import { formatDate, formatCurrency, formatCompactKW } from '../../../lib/utils';
import { ArrowLeft, Pencil, Trash2, XCircle, Loader2 } from 'lucide-react';
import MobileBadge from './shared/MobileBadge';
import MobileBottomSheet from './shared/MobileBottomSheet';
import { deriveBlitzStatus } from '../../../lib/blitzStatus';
import { computeBlitzLeaderboard, computeBlitzKiloMargin, computeCostsByCategory } from '../../../lib/blitzComputed';
import { useToast } from '../../../lib/toast';
import BlitzTabs, { BlitzTabKey, BlitzTab } from './blitz-detail/BlitzTabs';
import BlitzOverview from './blitz-detail/BlitzOverview';
import BlitzParticipants from './blitz-detail/BlitzParticipants';
import BlitzDeals from './blitz-detail/BlitzDeals';
import BlitzCosts from './blitz-detail/BlitzCosts';
import BlitzProfitability from './blitz-detail/BlitzProfitability';
import BlitzLeaderboard from './blitz-detail/BlitzLeaderboard';
import BlitzEditSheet from './blitz-detail/BlitzEditSheet';

const TAB_ORDER_BASE: BlitzTabKey[] = ['overview', 'participants', 'deals', 'costs', 'profitability'];

export default function MobileBlitzDetail({ blitzId }: { blitzId: string }) {
  const router = useRouter();
  const { effectiveRole, effectiveRepId, reps, installerPricingVersions, productCatalogProducts, solarTechProducts } = useApp();
  const hydrated = useIsHydrated();
  const isAdmin = effectiveRole === 'admin';
  const { toast } = useToast();

  const [blitz, setBlitz] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const prevTabRef = useRef<BlitzTabKey>('overview');
  const scrollPos = useRef<Partial<Record<BlitzTabKey, number>>>({});
  const [panelDir, setPanelDir] = useState<'right' | 'left'>('right');
  const [tab, setTab] = useState<BlitzTabKey>('overview');

  const [canRequestBlitz, setCanRequestBlitz] = useState(false);

  useEffect(() => {
    if (isAdmin || !effectiveRepId) return;
    fetch(`/api/users/${effectiveRepId}`).then((r) => r.json()).then((u) => {
      setCanRequestBlitz(u.canRequestBlitz ?? false);
    }).catch(() => {});
  }, [effectiveRepId, isAdmin]);

  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showCancelRequest, setShowCancelRequest] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);

  const handleTabChange = useCallback((next: BlitzTabKey) => {
    const prevIdx = TAB_ORDER_BASE.indexOf(prevTabRef.current);
    const nextIdx = TAB_ORDER_BASE.indexOf(next);
    setPanelDir(nextIdx >= prevIdx ? 'right' : 'left');
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
    () => approvedVisibleProjects
      .filter((p: any) => approvedParticipantIds.has(p.closer?.id) || (p.additionalClosers ?? []).some((cc: any) => approvedParticipantIds.has(cc.userId)))
      .reduce((s: number, p: any) => s + (p.kWSize ?? 0), 0),
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
    } finally { setSubmittingAction(false); }
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
    } finally { setSubmittingAction(false); }
  };

  if (!hydrated || loading) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">
        <div className="h-6 w-24 rounded animate-pulse" style={{ background: 'var(--m-card, var(--surface-mobile-card))' }} />
        <div className="h-8 w-48 rounded animate-pulse" style={{ background: 'var(--m-card, var(--surface-mobile-card))' }} />
        <div className="h-4 w-32 rounded animate-pulse" style={{ background: 'var(--m-card, var(--surface-mobile-card))', opacity: 0.6 }} />
      </div>
    );
  }

  if (!blitz) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">
        <button
          onClick={() => router.push('/dashboard/blitz')}
          className="flex items-center gap-1.5 text-base min-h-[48px]"
          style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
        >
          <ArrowLeft className="w-4 h-4" /> Blitz
        </button>
        <p className="text-base text-center" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Blitz not found.</p>
      </div>
    );
  }

  const statusLabel = blitz.status.charAt(0).toUpperCase() + blitz.status.slice(1);

  const tabs: BlitzTab[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'participants', label: 'Reps' },
    { key: 'deals', label: 'Deals' },
    ...(isAdmin ? [{ key: 'costs' as BlitzTabKey, label: 'Costs' }] : []),
    ...(isAdmin ? [{ key: 'profitability' as BlitzTabKey, label: 'Profit' }] : []),
  ];

  const blitzActive = blitz.status === 'upcoming' || blitz.status === 'active';
  const canCancelRequest = canRequestBlitz && blitzActive && (isOwner || blitz.createdById === effectiveRepId);

  return (
    <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push('/dashboard/blitz')}
          className="flex items-center gap-1.5 text-base min-h-[48px]"
          style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
        >
          <ArrowLeft className="w-4 h-4" /> Blitz
        </button>
        <div className="flex items-center gap-3">
          {canManage && (
            <button
              onClick={() => setShowEdit(true)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Edit blitz"
              style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          {canCancelRequest && (
            <button
              onClick={() => setShowCancelRequest(true)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Request cancellation"
              style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}
            >
              <XCircle className="w-4 h-4" />
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setShowDelete(true)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Delete blitz"
              style={{ color: 'var(--m-danger, var(--accent-danger))' }}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div>
        <h1 className="text-xl font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{blitz.name}</h1>
        <div className="mt-1.5">
          <MobileBadge value={statusLabel} variant="status" />
        </div>
        <p className="text-base mt-1" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
          {blitz.location && <>{blitz.location} &middot; </>}
          {formatDate(blitz.startDate)} &ndash; {formatDate(blitz.endDate)}
        </p>
      </div>

      <BlitzTabs tabs={tabs} active={tab} onChange={handleTabChange} />

      <div key={tab} className={panelDir === 'right' ? 'animate-panel-right' : 'animate-panel-left'}>
        {tab === 'overview' && (
          <div className="space-y-4">
            <BlitzOverview
              participantCount={approvedParticipants.length}
              totalDeals={approvedVisibleProjects.length}
              totalKW={totalKW}
              notes={blitz.notes}
            />
            {!isAdmin && effectiveRepId && visibleProjects.length > 0 && (() => {
              const myPay = visibleProjects.reduce((s: number, p: any) => {
                const ccEntry = (p.additionalClosers ?? []).find((cc: any) => cc.userId === effectiveRepId);
                const csEntry = (p.additionalSetters ?? []).find((cs: any) => cs.userId === effectiveRepId);
                return s + (p.closer?.id === effectiveRepId
                  ? (p.setter?.id === effectiveRepId
                    ? (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0) + (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0)
                    : (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0))
                  : (p.setter?.id === effectiveRepId
                    ? (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0)
                    : (ccEntry ? (ccEntry.m1Amount ?? 0) + (ccEntry.m2Amount ?? 0) + (ccEntry.m3Amount ?? 0)
                      : (csEntry ? (csEntry.m1Amount ?? 0) + (csEntry.m2Amount ?? 0) + (csEntry.m3Amount ?? 0) : 0))));
              }, 0);
              const myKW = visibleProjects.reduce((s: number, p: any) => {
                const isAdditionalCloser = (p.additionalClosers ?? []).some((cc: any) => cc.userId === effectiveRepId);
                return s + (p.closer?.id === effectiveRepId || isAdditionalCloser ? p.kWSize : 0);
              }, 0);
              return (
                <div className="rounded-xl p-4 border-l-2 border-l-blue-500/60" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
                  <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Your Blitz Summary</p>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-xl font-bold text-white leading-none" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{visibleProjects.length}</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Deal{visibleProjects.length !== 1 ? 's' : ''} Attributed</p>
                    </div>
                    <div>
                      <p className="text-xl font-bold text-white leading-none" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{formatCompactKW(myKW)}</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>kW Sold</p>
                    </div>
                    <div>
                      <p className="text-xl font-bold leading-none" style={{ color: 'var(--accent-green)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{formatCurrency(myPay)}</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>My Pay</p>
                    </div>
                  </div>
                </div>
              );
            })()}
            <BlitzLeaderboard entries={leaderboard} showPayout={true} />
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
          <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
            This permanently removes the blitz, all participant records, and all tracked costs. Deals stay; they&apos;ll just unlink. Cannot be undone.
          </p>
          <button
            onClick={handleDelete}
            disabled={submittingAction}
            className="w-full flex items-center justify-center gap-1.5 min-h-[48px] text-base font-semibold text-white rounded-lg transition-colors disabled:opacity-40"
            style={{ background: 'var(--m-danger, var(--accent-danger))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            {submittingAction ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {submittingAction ? 'Deleting...' : 'Delete blitz'}
          </button>
        </div>
      </MobileBottomSheet>

      <MobileBottomSheet open={showCancelRequest} onClose={() => { setShowCancelRequest(false); setCancelReason(''); }} title="Request Cancellation">
        <div className="px-5 space-y-4">
          <p className="text-sm" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
            Submits a cancellation request to admin. The blitz stays active until an admin reviews.
          </p>
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            rows={3}
            placeholder="Reason for cancellation"
            className="w-full rounded-lg px-3 py-2 text-base text-white min-h-[80px] resize-none focus:outline-none focus:ring-1"
            style={{
              background: 'var(--m-card, var(--surface-mobile-card))',
              border: '1px solid var(--m-border, var(--border-mobile))',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              '--tw-ring-color': 'var(--accent-emerald)',
            } as React.CSSProperties}
          />
          <button
            onClick={handleCancelRequest}
            disabled={submittingAction}
            className="w-full min-h-[48px] text-base font-semibold rounded-lg transition-colors disabled:opacity-40"
            style={{ color: 'var(--m-danger, var(--accent-danger))', border: '1px solid var(--m-danger, var(--accent-danger))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            {submittingAction ? 'Submitting...' : 'Submit request'}
          </button>
        </div>
      </MobileBottomSheet>
    </div>
  );
}
