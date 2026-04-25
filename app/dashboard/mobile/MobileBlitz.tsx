'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { formatDate, formatCurrency, formatCompactKWValue } from '../../../lib/utils';
import { deriveBlitzStatus } from '../../../lib/blitzStatus';
import { Plus, Tent, Inbox, AlertCircle, UserPlus, UserCheck, Loader2, Search, CheckCircle, XCircle } from 'lucide-react';
import { useToast } from '../../../lib/toast';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
import MobileBadge from './shared/MobileBadge';
import MobileEmptyState from './shared/MobileEmptyState';
import MobileBottomSheet from './shared/MobileBottomSheet';

type BlitzStatus = 'upcoming' | 'active' | 'completed' | 'cancelled';
type SortKey = 'newest' | 'oldest' | 'deals' | 'kw' | 'name';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'deals', label: 'Most Deals' },
  { key: 'kw', label: 'Most kW' },
  { key: 'name', label: 'Name A–Z' },
];

interface BlitzData {
  id: string;
  name: string;
  location: string;
  startDate: string;
  endDate: string;
  status: BlitzStatus;
  owner: { id: string; firstName: string; lastName: string };
  participants: Array<{
    id: string;
    joinStatus: string;
    user: { id: string; firstName: string; lastName: string };
  }>;
  projects: Array<{
    id: string;
    phase: string;
    kWSize: number;
    closer?: { id: string } | null;
    setter?: { id: string } | null;
    additionalClosers?: Array<{ userId: string }>;
    additionalSetters?: Array<{ userId: string }>;
  }>;
  costs: Array<{ amount: number }>;
}

interface BlitzRequestData {
  id: string;
  type: 'create' | 'cancel';
  name: string;
  status: string;
  requestedBy: { id: string; firstName: string; lastName: string };
}

const STATUS_PILLS: { value: BlitzStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_BADGE_MAP: Record<BlitzStatus, string> = {
  upcoming: 'Upcoming',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function blitzDateLabel(status: BlitzStatus, startDate: string, endDate: string): string {
  if (status === 'completed' || status === 'cancelled') {
    return `${formatDate(startDate)} – ${formatDate(endDate)}`;
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (status === 'upcoming') {
    const start = new Date(startDate); start.setHours(0, 0, 0, 0);
    const days = Math.round((start.getTime() - today.getTime()) / 86400000);
    if (days <= 0) return 'Starts today';
    if (days === 1) return 'Starts tomorrow';
    if (days <= 7) return `Starts in ${days} days`;
    return formatDate(startDate);
  }
  // active
  const end = new Date(endDate); end.setHours(0, 0, 0, 0);
  const days = Math.ceil((end.getTime() - today.getTime()) / 86400000);
  if (days <= 0) return 'Ended today';
  if (days === 1) return 'Last day';
  if (days <= 3) return `${days} days left`;
  return formatDate(endDate);
}

export default function MobileBlitz() {
  const router = useRouter();
  const { effectiveRole, effectiveRepId, pmPermissions, reps } = useApp();
  const { toast } = useToast();

  const isAdmin = effectiveRole === 'admin';
  const isPM = effectiveRole === 'project_manager';

  const [blitzes, setBlitzes] = useState<BlitzData[]>([]);
  const [requests, setRequests] = useState<BlitzRequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<BlitzStatus | 'all'>('all');
  const [tab, setTab] = useState<'blitzes' | 'requests'>('blitzes');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', location: '', housing: '', startDate: '', endDate: '', notes: '', headcount: '', ownerId: '' });
  const [userPerms, setUserPerms] = useState<{ canRequestBlitz: boolean; canCreateBlitz: boolean }>({
    canRequestBlitz: false,
    canCreateBlitz: false,
  });
  const [joiningBlitzId, setJoiningBlitzId] = useState<string | null>(null);
  const [processingRequest, setProcessingRequest] = useState<Set<string>>(new Set());
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('newest');

  useEffect(() => {
    Promise.all([
      fetch('/api/blitzes').then((r) => r.json()),
      fetch('/api/blitz-requests').then((r) => r.json()),
    ])
      .then(([b, r]) => {
        const normalized = Array.isArray(b)
          ? b.map((blitz: BlitzData) => ({ ...blitz, status: deriveBlitzStatus(blitz) }))
          : [];
        setBlitzes(normalized);
        setRequests(Array.isArray(r) ? r : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [isAdmin]);

  // Fetch rep permissions
  useEffect(() => {
    if (isAdmin || !effectiveRepId) return;
    fetch(`/api/users/${effectiveRepId}`)
      .then((r) => r.json())
      .then((u) => {
        if (u) setUserPerms({ canRequestBlitz: u.canRequestBlitz ?? false, canCreateBlitz: u.canCreateBlitz ?? false });
      })
      .catch(() => {});
  }, [isAdmin, effectiveRepId]);

  const myBlitzes = useMemo(() => {
    if (isAdmin || !effectiveRepId) return [] as BlitzData[];
    return blitzes.filter((b) =>
      b.owner.id === effectiveRepId ||
      b.participants.some((p) => p.user.id === effectiveRepId && p.joinStatus === 'approved')
    );
  }, [blitzes, isAdmin, effectiveRepId]);

  const pendingBlitzes = useMemo(() => {
    if (isAdmin || !effectiveRepId) return [] as BlitzData[];
    return blitzes.filter((b) =>
      b.owner.id !== effectiveRepId &&
      b.participants.some((p) => p.user.id === effectiveRepId && p.joinStatus === 'pending')
    );
  }, [blitzes, isAdmin, effectiveRepId]);

  const filteredBlitzes = useMemo(() => {
    let list = blitzes;
    if (statusFilter !== 'all') list = list.filter((b) => b.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((b) => b.name.toLowerCase().includes(q) || b.location.toLowerCase().includes(q));
    }
    const blitzDeals = (b: BlitzData) => {
      const approvedIds = new Set(b.participants.filter((p) => p.joinStatus === 'approved').map((p) => p.user.id));
      const active = b.projects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold');
      return (isAdmin || effectiveRepId === b.owner.id)
        ? active.filter((p) => approvedIds.has(p.closer?.id ?? '') || approvedIds.has(p.setter?.id ?? '')
            || p.additionalClosers?.some((ac) => approvedIds.has(ac.userId))
            || p.additionalSetters?.some((as) => approvedIds.has(as.userId)))
        : active.filter((p) => p.closer?.id === effectiveRepId || p.setter?.id === effectiveRepId
            || p.additionalClosers?.some((ac) => ac.userId === effectiveRepId)
            || p.additionalSetters?.some((as) => as.userId === effectiveRepId));
    };
    return [...list].sort((a, b) => {
      if (sortKey === 'newest') return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
      if (sortKey === 'oldest') return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
      if (sortKey === 'deals') return blitzDeals(b).length - blitzDeals(a).length;
      if (sortKey === 'kw') {
        const kwSum = (blitz: BlitzData) => {
          const approvedIds = new Set(blitz.participants.filter((p) => p.joinStatus === 'approved').map((p) => p.user.id));
          return blitzDeals(blitz).reduce((s, p) => {
            const closerApproved = p.closer?.id && approvedIds.has(p.closer.id);
            const anyAdditionalCloserApproved = p.additionalClosers?.some((ac) => approvedIds.has(ac.userId));
            return s + (closerApproved || anyAdditionalCloserApproved ? p.kWSize : 0);
          }, 0);
        };
        return kwSum(b) - kwSum(a);
      }
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      return 0;
    });
  }, [blitzes, statusFilter, search, sortKey, isAdmin, effectiveRepId]);

  const activeBlitzes = useMemo(() => blitzes.filter((b) => b.status === 'active').length, [blitzes]);
  const upcomingBlitzes = useMemo(() => blitzes.filter((b) => b.status === 'upcoming').length, [blitzes]);
  const summaryTotalDeals = useMemo(() => blitzes.filter((b) => b.status === 'active' || b.status === 'upcoming').reduce((s, b) => {
    const approvedIds = new Set(b.participants.filter((p) => p.joinStatus === 'approved').map((p) => p.user.id));
    return s + b.projects.filter((p) =>
      p.phase !== 'Cancelled' && p.phase !== 'On Hold' &&
      (isAdmin || b.owner.id === effectiveRepId
        ? approvedIds.has(p.closer?.id ?? '') || approvedIds.has(p.setter?.id ?? '')
            || p.additionalClosers?.some((ac) => approvedIds.has(ac.userId))
            || p.additionalSetters?.some((as) => approvedIds.has(as.userId))
        : p.closer?.id === effectiveRepId || p.setter?.id === effectiveRepId
          || p.additionalClosers?.some((ac) => ac.userId === effectiveRepId)
          || p.additionalSetters?.some((as) => as.userId === effectiveRepId))
    ).length;
  }, 0), [blitzes, isAdmin, effectiveRepId]);
  const summaryTotalKW = useMemo(() => blitzes.filter((b) => b.status === 'active' || b.status === 'upcoming').reduce((s, b) => {
    const approvedIds = new Set(b.participants.filter((p) => p.joinStatus === 'approved').map((p) => p.user.id));
    const visibleProjects = b.projects.filter((p) =>
      p.phase !== 'Cancelled' && p.phase !== 'On Hold' &&
      (isAdmin || b.owner.id === effectiveRepId
        ? approvedIds.has(p.closer?.id ?? '') || approvedIds.has(p.setter?.id ?? '')
            || p.additionalClosers?.some((ac) => approvedIds.has(ac.userId))
            || p.additionalSetters?.some((as) => approvedIds.has(as.userId))
        : p.closer?.id === effectiveRepId || p.setter?.id === effectiveRepId
          || p.additionalClosers?.some((ac) => ac.userId === effectiveRepId)
          || p.additionalSetters?.some((as) => as.userId === effectiveRepId))
    );
    return s + visibleProjects.reduce((ps, p) => {
      const closerApproved = p.closer?.id && approvedIds.has(p.closer.id);
      const anyAdditionalCloserApproved = p.additionalClosers?.some((ac: { userId: string }) => approvedIds.has(ac.userId));
      return ps + (closerApproved || anyAdditionalCloserApproved ? p.kWSize : 0);
    }, 0);
  }, 0), [blitzes, isAdmin, effectiveRepId]);
  const summaryTotalCosts = useMemo(() => isAdmin ? blitzes.reduce((s, b) => s + b.costs.reduce((cs, c) => cs + c.amount, 0), 0) : 0, [blitzes, isAdmin]);

  // PM access guard -- placed after all hooks
  if (isPM && pmPermissions && !pmPermissions.canAccessBlitz) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4">
        <MobilePageHeader title="Blitz" />
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <AlertCircle className="w-10 h-10" style={{ color: 'var(--text-muted)' }} />
          <p className="text-base font-medium" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Access Denied</p>
          <p className="text-base text-center max-w-[240px]" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
            You don&apos;t have permission to access Blitz. Contact an admin to request access.
          </p>
        </div>
      </div>
    );
  }

  const pendingRequests = requests.filter((r) => r.status === 'pending');

  const canCreate = isAdmin || userPerms.canCreateBlitz;
  const canRequest = !isAdmin && !userPerms.canCreateBlitz && userPerms.canRequestBlitz;

  // Header right action
  const loadData = () => {
    return Promise.all([
      fetch('/api/blitzes').then((r) => r.json()),
      fetch('/api/blitz-requests').then((r) => r.json()),
    ]).then(([b, r]) => {
      const normalized = Array.isArray(b)
        ? b.map((blitz: BlitzData) => ({ ...blitz, status: deriveBlitzStatus(blitz) }))
        : [];
      setBlitzes(normalized);
      setRequests(Array.isArray(r) ? r : []);
    });
  };

  const handleApproveRequest = async (reqId: string) => {
    setProcessingRequest((prev) => new Set(prev).add(reqId));
    try {
      const r = await fetch(`/api/blitz-requests/${reqId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      });
      if (!r.ok) { toast('Failed to approve request', 'error'); return; }
      toast('Request approved');
      await loadData();
    } catch { toast('Failed to approve request', 'error'); }
    finally { setProcessingRequest((prev) => { const s = new Set(prev); s.delete(reqId); return s; }); }
  };

  const handleDenyRequest = async (reqId: string) => {
    setProcessingRequest((prev) => new Set(prev).add(reqId));
    try {
      const r = await fetch(`/api/blitz-requests/${reqId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'denied' }),
      });
      if (!r.ok) { toast('Failed to deny request', 'error'); return; }
      toast('Request denied');
      await loadData();
    } catch { toast('Failed to deny request', 'error'); }
    finally { setProcessingRequest((prev) => { const s = new Set(prev); s.delete(reqId); return s; }); }
  };

  const handleJoinBlitz = async (blitzId: string) => {
    if (!effectiveRepId) return;
    setJoiningBlitzId(blitzId);
    try {
      const res = await fetch(`/api/blitzes/${blitzId}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: effectiveRepId, joinStatus: 'pending' }),
      });
      if (!res.ok) { toast('Failed to join blitz', 'error'); return; }
      toast('Join request sent');
      await loadData();
    } catch { toast('Failed to join blitz — please try again', 'error'); }
    finally { setJoiningBlitzId(null); }
  };

  const handleCreateBlitz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim() || !createForm.startDate || !createForm.endDate) return;
    if (new Date(createForm.endDate) < new Date(createForm.startDate)) { toast('End date must be on or after start date', 'error'); return; }
    if (submittingCreate) return;
    setSubmittingCreate(true);
    const isRequest = canRequest && !canCreate;
    try {
      const res = isRequest
        ? await fetch('/api/blitz-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'create',
              requestedById: effectiveRepId,
              name: createForm.name.trim(),
              location: createForm.location.trim(),
              housing: createForm.housing.trim(),
              startDate: createForm.startDate,
              endDate: createForm.endDate,
              notes: createForm.notes.trim(),
              expectedHeadcount: parseInt(createForm.headcount) || 0,
            }),
          })
        : await fetch('/api/blitzes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: createForm.name.trim(),
              location: createForm.location.trim(),
              housing: createForm.housing.trim(),
              startDate: createForm.startDate,
              endDate: createForm.endDate,
              notes: createForm.notes.trim(),
              createdById: effectiveRepId,
              ownerId: createForm.ownerId || effectiveRepId,
            }),
          });
      if (res.ok) {
        toast(isRequest ? 'Blitz request submitted' : 'Blitz created');
        setShowCreate(false);
        setCreateForm({ name: '', location: '', housing: '', startDate: '', endDate: '', notes: '', headcount: '', ownerId: '' });
        await loadData();
      } else {
        toast(isRequest ? 'Failed to submit request' : 'Failed to create blitz', 'error');
      }
    } finally {
      setSubmittingCreate(false);
    }
  };

  const headerRight = canCreate ? (
    <button
      onClick={() => setShowCreate(true)}
      className="flex items-center justify-center w-10 h-10 rounded-2xl text-black active:opacity-80 transition-colors"
      style={{ background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))', boxShadow: '0 0 20px var(--accent-emerald-glow)' }}
      aria-label="Create blitz"
    >
      <Plus className="w-5 h-5" />
    </button>
  ) : canRequest ? (
    <button
      onClick={() => setShowCreate(true)}
      className="flex items-center justify-center min-h-[48px] px-4 rounded-2xl text-base font-semibold active:opacity-80 transition-colors"
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-muted)',
        fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
      }}
    >
      <Plus className="w-4 h-4 mr-1" /> Request
    </button>
  ) : null;

  const renderBlitzCard = (blitz: BlitzData, index: number) => {
    const approvedCount = blitz.participants.filter((p) => p.joinStatus === 'approved').length;
    const dateLabel = blitzDateLabel(blitz.status, blitz.startDate, blitz.endDate);
    const details = [blitz.location, dateLabel, `${approvedCount} rep${approvedCount !== 1 ? 's' : ''}`]
      .filter(Boolean)
      .join(' \u00B7 ');
    const totalCosts = blitz.costs.reduce((s, c) => s + c.amount, 0);
    const approvedIds = new Set(blitz.participants.filter((p) => p.joinStatus === 'approved').map((p) => p.user.id));
    const activeProjects = blitz.projects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold');
    const isBlitzOwner = blitz.owner?.id === effectiveRepId;
    const blitzProjects = (isAdmin || isBlitzOwner)
      ? activeProjects.filter((p) =>
          approvedIds.has(p.closer?.id ?? '')
          || approvedIds.has(p.setter?.id ?? '')
          || p.additionalClosers?.some((ac) => approvedIds.has(ac.userId))
          || p.additionalSetters?.some((as) => approvedIds.has(as.userId))
        )
      : activeProjects.filter((p) =>
          p.closer?.id === effectiveRepId
          || p.setter?.id === effectiveRepId
          || p.additionalClosers?.some((ac) => ac.userId === effectiveRepId)
          || p.additionalSetters?.some((as) => as.userId === effectiveRepId)
        );
    const totalDeals = blitzProjects.length;
    const totalKW = blitzProjects.reduce((s, p) => {
      const closerApproved = p.closer?.id && approvedIds.has(p.closer.id);
      const anyAdditionalCloserApproved = p.additionalClosers?.some((ac) => approvedIds.has(ac.userId));
      return s + (closerApproved || anyAdditionalCloserApproved ? p.kWSize : 0);
    }, 0);
    const myParticipation = blitz.participants.find((p) => p.user.id === effectiveRepId);
    const canJoin = !isAdmin && !isBlitzOwner
      && (!myParticipation || myParticipation.joinStatus === 'declined')
      && (blitz.status === 'upcoming' || blitz.status === 'active');
    const participationLabel = myParticipation
      ? myParticipation.joinStatus === 'approved' ? 'Joined'
        : myParticipation.joinStatus === 'declined' ? 'Declined'
        : 'Pending'
      : null;
    const joining = joiningBlitzId === blitz.id;

    return (
      <div
        key={blitz.id}
        style={{
          animation: 'blitzCardIn 280ms cubic-bezier(0.16, 1, 0.3, 1) both',
          animationDelay: `${index * 40}ms`,
        }}
      >
        <MobileCard onTap={() => router.push(`/dashboard/blitz/${blitz.id}`)}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold text-[var(--text-primary)] truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{blitz.name}</p>
              <p className="text-base mt-1" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{details}</p>
              {isAdmin && totalCosts > 0 && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                  Cost/Deal: ${totalDeals > 0 ? (totalCosts / totalDeals).toFixed(0) : '--'}
                  {' \u00B7 '}
                  Cost/kW: ${totalKW > 0 ? (totalCosts / totalKW).toFixed(2) : '--'}
                </p>
              )}
            </div>
            <MobileBadge value={STATUS_BADGE_MAP[blitz.status]} variant="status" />
          </div>
          {(canJoin || participationLabel || isBlitzOwner) && (
            <div className="mt-3 flex items-center gap-2">
              {isBlitzOwner && (
                <span className="text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded" style={{ color: 'var(--accent-emerald-text)', background: 'var(--accent-emerald-soft)' }}>Leader</span>
              )}
              {canJoin && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleJoinBlitz(blitz.id); }}
                  disabled={joining}
                  className="flex items-center gap-1.5 px-3 min-h-[36px] text-xs font-semibold rounded-lg disabled:opacity-40"
                  style={{ color: 'var(--accent-emerald-text)', border: '1px solid var(--accent-emerald-solid)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                >
                  {joining ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                  {joining ? 'Joining...' : 'Join'}
                </button>
              )}
              {participationLabel && !canJoin && !isBlitzOwner && (
                <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded" style={{
                  color: participationLabel === 'Joined' ? 'var(--accent-emerald-solid)' : participationLabel === 'Declined' ? 'var(--accent-red-solid)' : '#f59e0b',
                  background: participationLabel === 'Joined' ? 'var(--accent-emerald-soft)' : participationLabel === 'Declined' ? 'var(--accent-red-soft)' : 'var(--accent-amber-soft)',
                  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                }}>
                  <UserCheck className="w-3 h-3" /> {participationLabel}
                </span>
              )}
            </div>
          )}
        </MobileCard>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4">
        <MobilePageHeader title="Blitz" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: 'var(--surface-card)' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-24 space-y-4">
      <MobilePageHeader title="Blitz" right={headerRight} />

      {/* Summary stat cards */}
      <div className={`grid gap-3 [&>*]:min-w-0 ${isAdmin ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <div className="rounded-2xl p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Active</p>
          <p className="text-2xl font-black tabular-nums" style={{ color: 'var(--accent-emerald-text)', fontFamily: "'DM Serif Display', serif" }}>{activeBlitzes}</p>
        </div>
        <div className="rounded-2xl p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Upcoming</p>
          <p className="text-2xl font-black tabular-nums" style={{ color: 'var(--accent-cyan-text)', fontFamily: "'DM Serif Display', serif" }}>{upcomingBlitzes}</p>
        </div>
        <div className="rounded-2xl p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Deals</p>
          <p className="text-2xl font-black tabular-nums" style={{ color: 'var(--text-primary, #fff)', fontFamily: "'DM Serif Display', serif" }}>{summaryTotalDeals}</p>
        </div>
        <div className="rounded-2xl p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Total kW</p>
          <p className="text-2xl font-black tabular-nums whitespace-nowrap" style={{ color: 'var(--text-primary, #fff)', fontFamily: "'DM Serif Display', serif" }}>{formatCompactKWValue(summaryTotalKW)}</p>
        </div>
        {isAdmin && (
          <div className="rounded-2xl p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Costs</p>
            <p className="text-2xl font-black tabular-nums" style={{ color: 'var(--accent-amber-text)', fontFamily: "'DM Serif Display', serif" }}>{formatCurrency(summaryTotalCosts)}</p>
          </div>
        )}
      </div>

      {/* Status pills */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {STATUS_PILLS.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className="min-h-[48px] px-4 py-2 text-base font-semibold rounded-full whitespace-nowrap active:scale-[0.91]"
            style={{
              background: statusFilter === s.value ? 'var(--accent-emerald-solid)' : 'transparent',
              color: statusFilter === s.value ? '#000' : 'var(--text-muted)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              transform: statusFilter === s.value ? 'scale(1.05)' : 'scale(1)',
              transition: 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1), background-color 150ms ease, color 150ms ease',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Search + Sort */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search blitzes…"
            className="w-full min-h-[44px] rounded-xl pl-9 pr-3 text-base text-[var(--text-primary)] focus:outline-none focus:ring-1"
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              '--tw-ring-color': 'var(--accent-emerald-solid)',
            } as React.CSSProperties}
          />
        </div>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="min-h-[44px] rounded-xl px-3 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1"
          style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            '--tw-ring-color': 'var(--accent-emerald-solid)',
          } as React.CSSProperties}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Admin tabs: Blitzes / Requests */}
      {(isAdmin || userPerms.canRequestBlitz) && (
        <div className="relative flex gap-1 p-1 rounded-2xl" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
          <div
            className="blitz-tab-indicator absolute top-1 bottom-1 rounded-xl pointer-events-none"
            style={{
              left: 4,
              width: 'calc(50% - 6px)',
              background: 'var(--accent-emerald-solid)',
              transform: tab === 'requests' ? 'translateX(calc(100% + 4px))' : 'translateX(0)',
            }}
          />
          <button
            onClick={() => setTab('blitzes')}
            className="relative flex-1 min-h-[48px] text-base font-semibold rounded-xl z-10"
            style={{ background: 'transparent', color: tab === 'blitzes' ? '#000' : 'var(--text-muted)', transition: 'color 180ms ease', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            Blitzes
          </button>
          <button
            onClick={() => setTab('requests')}
            className="relative flex-1 min-h-[48px] text-base font-semibold rounded-xl z-10"
            style={{ background: 'transparent', color: tab === 'requests' ? '#000' : 'var(--text-muted)', transition: 'color 180ms ease', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            Requests
            {pendingRequests.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center text-[10px] font-bold text-[var(--text-primary)] rounded-full" style={{ background: 'var(--accent-red-solid)' }}>
                {pendingRequests.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Blitz cards */}
      {tab === 'blitzes' && (
        <div key="blitzes" style={{ animation: 'fadeIn 160ms ease both' }}>
          {filteredBlitzes.length === 0 ? (
            <MobileEmptyState icon={Tent} title="No blitzes found" subtitle="Try a different filter or search" />
          ) : !isAdmin && effectiveRepId ? (
            // Rep segmented view
            (() => {
              const myIds = new Set([...myBlitzes, ...pendingBlitzes].map((b) => b.id));
              const myFiltered = filteredBlitzes.filter((b) => myBlitzes.some((m) => m.id === b.id));
              const pendingFiltered = filteredBlitzes.filter((b) => pendingBlitzes.some((p) => p.id === b.id));
              const browseFiltered = filteredBlitzes.filter((b) => !myIds.has(b.id));
              const sectionLabelStyle = {
                color: 'var(--text-muted)',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              };
              return (
                <div
                  key={statusFilter}
                  className="space-y-5"
                  style={{ animation: 'fadeIn 160ms ease both' }}
                >
                  {myFiltered.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest mb-2 px-1" style={sectionLabelStyle}>My Blitzes</p>
                      <div className="space-y-3">
                        {myFiltered.map((blitz, index) => renderBlitzCard(blitz, index))}
                      </div>
                    </div>
                  )}
                  {pendingFiltered.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest mb-2 px-1" style={sectionLabelStyle}>Pending Approval</p>
                      <div className="space-y-3">
                        {pendingFiltered.map((blitz, index) => renderBlitzCard(blitz, index))}
                      </div>
                    </div>
                  )}
                  {browseFiltered.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest mb-2 px-1" style={sectionLabelStyle}>Browse Available</p>
                      <div className="space-y-3">
                        {browseFiltered.map((blitz, index) => renderBlitzCard(blitz, index))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()
          ) : (
            <div key={statusFilter} className="space-y-3">
              {filteredBlitzes.map((blitz, index) => renderBlitzCard(blitz, index))}
            </div>
          )}
        </div>
      )}

      {/* Requests tab — admin: see all requests */}
      {tab === 'requests' && isAdmin && (
        <div key="requests-admin" style={{ animation: 'fadeIn 160ms ease both' }}>
          {requests.length === 0 ? (
            <MobileEmptyState icon={Inbox} title="No blitz requests" />
          ) : (
            <div className="space-y-3">
              {requests.map((req) => (
                <MobileCard key={req.id}>
                  <p className="text-base font-semibold text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{req.name}</p>
                  <p className="text-base mt-1" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                    {req.type === 'create' ? 'New blitz request' : 'Cancel request'} by {req.requestedBy.firstName} {req.requestedBy.lastName}
                  </p>
                  <div className="flex items-center gap-2 mt-3">
                    {req.status === 'pending' ? (
                      <>
                        <button
                          onClick={() => handleApproveRequest(req.id)}
                          disabled={processingRequest.has(req.id)}
                          className="flex items-center gap-1.5 px-3 min-h-[36px] text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
                          style={{ background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))', color: 'var(--surface-page)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                        >
                          {processingRequest.has(req.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />} Approve
                        </button>
                        <button
                          onClick={() => handleDenyRequest(req.id)}
                          disabled={processingRequest.has(req.id)}
                          className="flex items-center gap-1.5 px-3 min-h-[36px] text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
                          style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                        >
                          <XCircle className="w-3 h-3" /> Deny
                        </button>
                      </>
                    ) : (
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${req.status === 'approved' ? 'bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald-text)] border border-[var(--accent-emerald-solid)]/20' : 'bg-[var(--accent-red-soft)] text-[var(--accent-red-text)] border border-red-500/20'}`} style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                        {req.status === 'approved' ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                      </span>
                    )}
                  </div>
                </MobileCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Requests tab — rep: see own submissions */}
      {tab === 'requests' && !isAdmin && userPerms.canRequestBlitz && (
        <div key="requests-rep" style={{ animation: 'fadeIn 160ms ease both' }}>
          {requests.filter((r) => r.requestedBy.id === effectiveRepId).length === 0 ? (
            <MobileEmptyState icon={Inbox} title="No requests submitted" />
          ) : (
            <div className="space-y-3">
              {requests.filter((r) => r.requestedBy.id === effectiveRepId).map((req) => (
                <MobileCard key={req.id}>
                  <p className="text-base font-semibold text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{req.name}</p>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                    {req.type === 'create' ? 'New blitz request' : 'Cancel request'}
                  </p>
                  <MobileBadge
                    value={req.status === 'approved' ? 'Approved' : req.status === 'denied' ? 'Denied' : 'Pending'}
                    variant="status"
                  />
                </MobileCard>
              ))}
            </div>
          )}
        </div>
      )}
      {/* ── Create Blitz sheet ── */}
      <MobileBottomSheet open={showCreate} onClose={() => setShowCreate(false)} title={canRequest && !canCreate ? 'Request Blitz' : 'Create Blitz'}>
        <form onSubmit={handleCreateBlitz} className="px-5 space-y-4 pb-2">
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Name</label>
            <input
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Austin April Blitz"
              className="w-full min-h-[48px] rounded-xl px-3 text-base text-[var(--text-primary)] focus:outline-none focus:ring-1"
              style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border-subtle)',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald-solid)',
              } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Location</label>
            <input
              value={createForm.location}
              onChange={(e) => setCreateForm((f) => ({ ...f, location: e.target.value }))}
              placeholder="e.g. Austin, TX"
              className="w-full min-h-[48px] rounded-xl px-3 text-base text-[var(--text-primary)] focus:outline-none focus:ring-1"
              style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border-subtle)',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald-solid)',
              } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Housing / Address</label>
            <input
              value={createForm.housing}
              onChange={(e) => setCreateForm((f) => ({ ...f, housing: e.target.value }))}
              placeholder="e.g. 123 Main St, Apt 4"
              className="w-full min-h-[48px] rounded-xl px-3 text-base text-[var(--text-primary)] focus:outline-none focus:ring-1"
              style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border-subtle)',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald-solid)',
              } as React.CSSProperties}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Start</label>
              <input
                type="date"
                value={createForm.startDate}
                onChange={(e) => setCreateForm((f) => ({ ...f, startDate: e.target.value }))}
                className="w-full min-h-[48px] rounded-xl px-3 text-base text-[var(--text-primary)] focus:outline-none focus:ring-1"
                style={{
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  '--tw-ring-color': 'var(--accent-emerald-solid)',
                } as React.CSSProperties}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>End</label>
              <input
                type="date"
                value={createForm.endDate}
                onChange={(e) => setCreateForm((f) => ({ ...f, endDate: e.target.value }))}
                className="w-full min-h-[48px] rounded-xl px-3 text-base text-[var(--text-primary)] focus:outline-none focus:ring-1"
                style={{
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  '--tw-ring-color': 'var(--accent-emerald-solid)',
                } as React.CSSProperties}
              />
            </div>
          </div>
          {isAdmin && (
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Blitz Leader</label>
              <select
                value={createForm.ownerId || effectiveRepId || ''}
                onChange={(e) => setCreateForm((f) => ({ ...f, ownerId: e.target.value }))}
                className="w-full min-h-[48px] rounded-xl px-3 text-base text-[var(--text-primary)] focus:outline-none focus:ring-1"
                style={{
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  '--tw-ring-color': 'var(--accent-emerald-solid)',
                } as React.CSSProperties}
              >
                <option value={effectiveRepId || ''}>Me</option>
                {reps.filter((r) => r.id !== effectiveRepId && r.active).map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Notes</label>
            <textarea
              value={createForm.notes}
              onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              className="w-full rounded-xl px-3 py-2 text-base text-[var(--text-primary)] focus:outline-none focus:ring-1 resize-none"
              style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border-subtle)',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald-solid)',
              } as React.CSSProperties}
            />
          </div>
          {canRequest && !canCreate && (
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Expected Headcount</label>
              <input
                type="number"
                min="1"
                value={createForm.headcount}
                onChange={(e) => setCreateForm((f) => ({ ...f, headcount: e.target.value }))}
                placeholder="e.g. 8"
                className="w-full min-h-[48px] rounded-xl px-3 text-base text-[var(--text-primary)] focus:outline-none focus:ring-1"
                style={{
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  '--tw-ring-color': 'var(--accent-emerald-solid)',
                } as React.CSSProperties}
              />
            </div>
          )}
          <button
            type="submit"
            disabled={submittingCreate || !createForm.name.trim() || !createForm.startDate || !createForm.endDate}
            className="w-full min-h-[52px] rounded-2xl text-black text-base font-semibold active:opacity-80 disabled:opacity-40 transition-colors"
            style={{
              background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))',
              boxShadow: '0 0 20px var(--accent-emerald-glow)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            {canRequest && !canCreate ? 'Submit Request' : 'Create Blitz'}
          </button>
        </form>
      </MobileBottomSheet>
    </div>
  );
}
