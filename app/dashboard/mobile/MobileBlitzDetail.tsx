'use client';

/* eslint-disable @typescript-eslint/no-explicit-any --
 * Mirror of desktop blitz/[id]/page.tsx — consumes the same
 * /api/blitzes/[id] response with dynamic shape. */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useIsHydrated } from '../../../lib/hooks';
import { formatDate } from '../../../lib/utils';
import { ArrowLeft } from 'lucide-react';
import MobileBadge from './shared/MobileBadge';
import { deriveBlitzStatus } from '../../../lib/blitzStatus';
import BlitzTabs, { BlitzTabKey, BlitzTab } from './blitz-detail/BlitzTabs';
import BlitzOverview from './blitz-detail/BlitzOverview';
import BlitzParticipants from './blitz-detail/BlitzParticipants';
import BlitzDeals from './blitz-detail/BlitzDeals';
import BlitzCosts from './blitz-detail/BlitzCosts';

const TAB_ORDER: BlitzTabKey[] = ['overview', 'participants', 'deals', 'costs'];

export default function MobileBlitzDetail({ blitzId }: { blitzId: string }) {
  const router = useRouter();
  const { effectiveRole, effectiveRepId, reps } = useApp();
  const hydrated = useIsHydrated();
  const isAdmin = effectiveRole === 'admin';

  const [blitz, setBlitz] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const prevTabRef = useRef<BlitzTabKey>('overview');
  const scrollPos = useRef<Partial<Record<BlitzTabKey, number>>>({});
  const [panelDir, setPanelDir] = useState<'right' | 'left'>('right');
  const [tab, setTab] = useState<BlitzTabKey>('overview');

  const handleTabChange = useCallback((next: BlitzTabKey) => {
    const prevIdx = TAB_ORDER.indexOf(prevTabRef.current);
    const nextIdx = TAB_ORDER.indexOf(next);
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
    () => new Set(participants.filter((p: any) => p.joinStatus === 'approved').map((p: any) => p.user.id)),
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
    () => approvedVisibleProjects.reduce((s: number, p: any) => s + p.kWSize, 0),
    [approvedVisibleProjects],
  );

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
    { key: 'participants', label: 'Participants' },
    { key: 'deals', label: 'Deals' },
    ...(isAdmin ? [{ key: 'costs' as BlitzTabKey, label: 'Costs' }] : []),
  ];

  return (
    <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">
      <button
        onClick={() => router.push('/dashboard/blitz')}
        className="flex items-center gap-1.5 text-base min-h-[48px]"
        style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
      >
        <ArrowLeft className="w-4 h-4" /> Blitz
      </button>

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
          <BlitzOverview
            participantCount={approvedParticipants.length}
            totalDeals={approvedVisibleProjects.length}
            totalKW={totalKW}
            notes={blitz.notes}
          />
        )}

        {tab === 'participants' && (
          <BlitzParticipants
            blitzId={blitzId}
            participants={blitz.participants ?? []}
            reps={reps}
            canManage={canManage}
            onRefresh={loadBlitz}
          />
        )}

        {tab === 'deals' && (
          <BlitzDeals projects={visibleProjects} />
        )}

        {tab === 'costs' && isAdmin && (
          <BlitzCosts
            blitzId={blitzId}
            costs={blitz.costs ?? []}
            onRefresh={loadBlitz}
          />
        )}
      </div>
    </div>
  );
}
