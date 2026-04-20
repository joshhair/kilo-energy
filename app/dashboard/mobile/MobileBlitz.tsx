'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { formatDate } from '../../../lib/utils';
import { deriveBlitzStatus } from '../../../lib/blitzStatus';
import { Plus, Tent, Inbox, AlertCircle, UserPlus, UserCheck, Loader2 } from 'lucide-react';
import { useToast } from '../../../lib/toast';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
import MobileBadge from './shared/MobileBadge';
import MobileEmptyState from './shared/MobileEmptyState';
import MobileBottomSheet from './shared/MobileBottomSheet';

type BlitzStatus = 'upcoming' | 'active' | 'completed' | 'cancelled';

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
  projects: Array<{ id: string }>;
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
    const days = Math.ceil((start.getTime() - today.getTime()) / 86400000);
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
  const { effectiveRole, effectiveRepId, pmPermissions } = useApp();
  const { toast } = useToast();

  const isAdmin = effectiveRole === 'admin';
  const isPM = effectiveRole === 'project_manager';

  const [blitzes, setBlitzes] = useState<BlitzData[]>([]);
  const [requests, setRequests] = useState<BlitzRequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<BlitzStatus | 'all'>('all');
  const [tab, setTab] = useState<'blitzes' | 'requests'>('blitzes');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', location: '', startDate: '', endDate: '', notes: '' });
  const [userPerms, setUserPerms] = useState<{ canRequestBlitz: boolean; canCreateBlitz: boolean }>({
    canRequestBlitz: false,
    canCreateBlitz: false,
  });
  const [joiningBlitzId, setJoiningBlitzId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/blitzes').then((r) => r.json()),
      isAdmin ? fetch('/api/blitz-requests').then((r) => r.json()) : Promise.resolve([]),
    ])
      .then(([b, r]) => {
        const normalized = Array.isArray(b)
          ? b.map((blitz: BlitzData) => ({ ...blitz, status: deriveBlitzStatus(blitz) }))
          : [];
        setBlitzes(normalized);
        setRequests(r);
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

  const filteredBlitzes = useMemo(() => {
    let list = blitzes;
    if (statusFilter !== 'all') list = list.filter((b) => b.status === statusFilter);
    return [...list].sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
  }, [blitzes, statusFilter]);

  // PM access guard -- placed after all hooks
  if (isPM && pmPermissions && !pmPermissions.canAccessBlitz) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4">
        <MobilePageHeader title="Blitz" />
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <AlertCircle className="w-10 h-10" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }} />
          <p className="text-base font-medium" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Access Denied</p>
          <p className="text-base text-center max-w-[240px]" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
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
    Promise.all([
      fetch('/api/blitzes').then((r) => r.json()),
      isAdmin ? fetch('/api/blitz-requests').then((r) => r.json()) : Promise.resolve([]),
    ]).then(([b, r]) => {
      const normalized = Array.isArray(b)
        ? b.map((blitz: BlitzData) => ({ ...blitz, status: deriveBlitzStatus(blitz) }))
        : [];
      setBlitzes(normalized);
      setRequests(r);
    });
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
      loadData();
    } finally { setJoiningBlitzId(null); }
  };

  const handleCreateBlitz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim() || !createForm.startDate || !createForm.endDate) return;
    const isRequest = canRequest && !canCreate;
    const res = isRequest
      ? await fetch('/api/blitz-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'create',
            requestedById: effectiveRepId,
            name: createForm.name.trim(),
            location: createForm.location.trim(),
            startDate: createForm.startDate,
            endDate: createForm.endDate,
            notes: createForm.notes.trim(),
          }),
        })
      : await fetch('/api/blitzes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: createForm.name.trim(),
            location: createForm.location.trim(),
            startDate: createForm.startDate,
            endDate: createForm.endDate,
            notes: createForm.notes.trim(),
            createdById: effectiveRepId,
            ownerId: effectiveRepId,
          }),
        });
    if (res.ok) {
      toast(isRequest ? 'Blitz request submitted' : 'Blitz created');
      setShowCreate(false);
      setCreateForm({ name: '', location: '', startDate: '', endDate: '', notes: '' });
      loadData();
    } else {
      toast(isRequest ? 'Failed to submit request' : 'Failed to create blitz', 'error');
    }
  };

  const headerRight = canCreate ? (
    <button
      onClick={() => setShowCreate(true)}
      className="flex items-center justify-center w-10 h-10 rounded-2xl text-black active:opacity-80 transition-colors"
      style={{ background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))', boxShadow: '0 0 20px rgba(0,229,160,0.3)' }}
      aria-label="Create blitz"
    >
      <Plus className="w-5 h-5" />
    </button>
  ) : canRequest ? (
    <button
      onClick={() => setShowCreate(true)}
      className="flex items-center justify-center min-h-[48px] px-4 rounded-2xl text-base font-semibold active:opacity-80 transition-colors"
      style={{
        background: 'var(--m-card, var(--surface-mobile-card))',
        border: '1px solid var(--m-border, var(--border-mobile))',
        color: 'var(--m-text-muted, var(--text-mobile-muted))',
        fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
      }}
    >
      <Plus className="w-4 h-4 mr-1" /> Request
    </button>
  ) : null;

  if (loading) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4">
        <MobilePageHeader title="Blitz" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: 'var(--m-card, var(--surface-mobile-card))' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-24 space-y-4">
      <MobilePageHeader title="Blitz" right={headerRight} />

      {/* Status pills */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {STATUS_PILLS.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className="min-h-[48px] px-4 py-2 text-base font-semibold rounded-full whitespace-nowrap transition-colors"
            style={{
              background: statusFilter === s.value ? 'var(--accent-emerald)' : 'transparent',
              color: statusFilter === s.value ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Admin tabs: Blitzes / Requests */}
      {isAdmin && (
        <div className="flex gap-1 p-1 rounded-2xl" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
          <button
            onClick={() => setTab('blitzes')}
            className="flex-1 min-h-[48px] text-base font-semibold rounded-xl transition-colors"
            style={{
              background: tab === 'blitzes' ? 'var(--accent-emerald)' : 'transparent',
              color: tab === 'blitzes' ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            Blitzes
          </button>
          <button
            onClick={() => setTab('requests')}
            className="flex-1 min-h-[48px] text-base font-semibold rounded-xl transition-colors relative"
            style={{
              background: tab === 'requests' ? 'var(--accent-emerald)' : 'transparent',
              color: tab === 'requests' ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            Requests
            {pendingRequests.length > 0 && (
              <span
                className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center text-[10px] font-bold text-white rounded-full"
                style={{ background: 'var(--m-danger, var(--accent-danger))' }}
              >
                {pendingRequests.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Blitz cards */}
      {tab === 'blitzes' && (
        <>
          {filteredBlitzes.length === 0 ? (
            <MobileEmptyState icon={Tent} title="No blitzes found" subtitle="Try a different status filter" />
          ) : (
            <div key={statusFilter} className="space-y-3">
              {filteredBlitzes.map((blitz, index) => {
                const approvedCount = blitz.participants.filter((p) => p.joinStatus === 'approved').length;
                const dateLabel = blitzDateLabel(blitz.status, blitz.startDate, blitz.endDate);
                const details = [blitz.location, dateLabel, `${approvedCount} rep${approvedCount !== 1 ? 's' : ''}`]
                  .filter(Boolean)
                  .join(' \u00B7 ');
                const isOwner = blitz.owner?.id === effectiveRepId;
                const myParticipation = blitz.participants.find((p) => p.user.id === effectiveRepId);
                const canJoin = !isAdmin && !isOwner
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
                          <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{blitz.name}</p>
                          <p className="text-base mt-1" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{details}</p>
                        </div>
                        <MobileBadge value={STATUS_BADGE_MAP[blitz.status]} variant="status" />
                      </div>
                      {(canJoin || participationLabel || isOwner) && (
                        <div className="mt-3 flex items-center gap-2">
                          {isOwner && (
                            <span className="text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded" style={{ color: 'var(--accent-emerald)', background: 'rgba(0,229,160,0.12)' }}>Leader</span>
                          )}
                          {canJoin && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleJoinBlitz(blitz.id); }}
                              disabled={joining}
                              className="flex items-center gap-1.5 px-3 min-h-[36px] text-xs font-semibold rounded-lg disabled:opacity-40"
                              style={{ color: 'var(--accent-emerald)', border: '1px solid var(--accent-emerald)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                            >
                              {joining ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                              {joining ? 'Joining...' : 'Join'}
                            </button>
                          )}
                          {participationLabel && !canJoin && !isOwner && (
                            <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded" style={{
                              color: participationLabel === 'Joined' ? 'var(--accent-emerald)' : participationLabel === 'Declined' ? 'var(--m-danger, var(--accent-danger))' : '#f59e0b',
                              background: participationLabel === 'Joined' ? 'rgba(0,229,160,0.12)' : participationLabel === 'Declined' ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
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
              })}
            </div>
          )}
        </>
      )}

      {/* Requests tab */}
      {tab === 'requests' && isAdmin && (
        <>
          {pendingRequests.length === 0 ? (
            <MobileEmptyState icon={Inbox} title="No pending requests" />
          ) : (
            <div className="space-y-3">
              {pendingRequests.map((req) => (
                <MobileCard key={req.id} onTap={() => router.push('/dashboard/blitz?tab=requests')}>
                  <p className="text-base font-semibold text-white" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{req.name}</p>
                  <p className="text-base mt-1" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                    {req.type === 'create' ? 'New blitz request' : 'Cancel request'} by {req.requestedBy.firstName} {req.requestedBy.lastName}
                  </p>
                  <MobileBadge value="Pending" variant="status" />
                </MobileCard>
              ))}
            </div>
          )}
        </>
      )}
      {/* ── Create Blitz sheet ── */}
      <MobileBottomSheet open={showCreate} onClose={() => setShowCreate(false)} title={canRequest && !canCreate ? 'Request Blitz' : 'Create Blitz'}>
        <form onSubmit={handleCreateBlitz} className="px-5 space-y-4 pb-2">
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Name</label>
            <input
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Austin April Blitz"
              className="w-full min-h-[48px] rounded-xl px-3 text-base text-white focus:outline-none focus:ring-1"
              style={{
                background: 'var(--m-card, var(--surface-mobile-card))',
                border: '1px solid var(--m-border, var(--border-mobile))',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald)',
              } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Location</label>
            <input
              value={createForm.location}
              onChange={(e) => setCreateForm((f) => ({ ...f, location: e.target.value }))}
              placeholder="e.g. Austin, TX"
              className="w-full min-h-[48px] rounded-xl px-3 text-base text-white focus:outline-none focus:ring-1"
              style={{
                background: 'var(--m-card, var(--surface-mobile-card))',
                border: '1px solid var(--m-border, var(--border-mobile))',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald)',
              } as React.CSSProperties}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Start</label>
              <input
                type="date"
                value={createForm.startDate}
                onChange={(e) => setCreateForm((f) => ({ ...f, startDate: e.target.value }))}
                className="w-full min-h-[48px] rounded-xl px-3 text-base text-white focus:outline-none focus:ring-1"
                style={{
                  background: 'var(--m-card, var(--surface-mobile-card))',
                  border: '1px solid var(--m-border, var(--border-mobile))',
                  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  '--tw-ring-color': 'var(--accent-emerald)',
                } as React.CSSProperties}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>End</label>
              <input
                type="date"
                value={createForm.endDate}
                onChange={(e) => setCreateForm((f) => ({ ...f, endDate: e.target.value }))}
                className="w-full min-h-[48px] rounded-xl px-3 text-base text-white focus:outline-none focus:ring-1"
                style={{
                  background: 'var(--m-card, var(--surface-mobile-card))',
                  border: '1px solid var(--m-border, var(--border-mobile))',
                  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  '--tw-ring-color': 'var(--accent-emerald)',
                } as React.CSSProperties}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={!createForm.name.trim() || !createForm.startDate || !createForm.endDate}
            className="w-full min-h-[52px] rounded-2xl text-black text-base font-semibold active:opacity-80 disabled:opacity-40 transition-colors"
            style={{
              background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))',
              boxShadow: '0 0 20px rgba(0,229,160,0.3)',
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
