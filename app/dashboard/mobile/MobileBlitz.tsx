'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { formatDate } from '../../../lib/utils';
import { Plus, Tent, Inbox, AlertCircle } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
import MobileBadge from './shared/MobileBadge';
import MobileEmptyState from './shared/MobileEmptyState';

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

export default function MobileBlitz() {
  const router = useRouter();
  const { effectiveRole, effectiveRepId, pmPermissions } = useApp();

  const isAdmin = effectiveRole === 'admin';
  const isPM = effectiveRole === 'project_manager';

  const [blitzes, setBlitzes] = useState<BlitzData[]>([]);
  const [requests, setRequests] = useState<BlitzRequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<BlitzStatus | 'all'>('all');
  const [tab, setTab] = useState<'blitzes' | 'requests'>('blitzes');
  const [userPerms, setUserPerms] = useState<{ canRequestBlitz: boolean; canCreateBlitz: boolean }>({
    canRequestBlitz: false,
    canCreateBlitz: false,
  });

  useEffect(() => {
    Promise.all([
      fetch('/api/blitzes').then((r) => r.json()),
      isAdmin ? fetch('/api/blitz-requests').then((r) => r.json()) : Promise.resolve([]),
    ])
      .then(([b, r]) => {
        setBlitzes(b);
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
      <div className="px-5 pt-4 pb-28 space-y-8">
        <MobilePageHeader title="Blitz" />
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <AlertCircle className="w-10 h-10 text-slate-600" />
          <p className="text-sm font-medium text-slate-400">Access Denied</p>
          <p className="text-xs text-slate-600 text-center max-w-[240px]">
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
  const headerRight = canCreate ? (
    <button
      onClick={() => router.push('/dashboard/blitz?create=true')}
      className="flex items-center justify-center w-10 h-10 rounded-2xl bg-blue-600 text-white active:bg-blue-700 transition-colors"
      aria-label="Create blitz"
    >
      <Plus className="w-5 h-5" />
    </button>
  ) : canRequest ? (
    <button
      onClick={() => router.push('/dashboard/blitz?request=true')}
      className="flex items-center justify-center min-h-[48px] px-4 rounded-2xl bg-slate-800/40 text-slate-300 text-xs font-semibold active:bg-slate-700 transition-colors"
    >
      <Plus className="w-4 h-4 mr-1" /> Request
    </button>
  ) : null;

  if (loading) {
    return (
      <div className="px-5 pt-4 pb-28 space-y-8">
        <MobilePageHeader title="Blitz" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-slate-800/40 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-28 space-y-8">
      <MobilePageHeader title="Blitz" right={headerRight} />

      {/* Status pills */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {STATUS_PILLS.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className={`min-h-[48px] px-4 py-2 text-sm font-semibold rounded-full whitespace-nowrap transition-colors ${
              statusFilter === s.value
                ? 'bg-blue-600 text-white'
                : 'text-slate-400'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Admin tabs: Blitzes / Requests */}
      {isAdmin && pendingRequests.length > 0 && (
        <div className="flex gap-1 p-1 bg-slate-800/40 rounded-2xl">
          <button
            onClick={() => setTab('blitzes')}
            className={`flex-1 min-h-[48px] text-sm font-semibold rounded-xl transition-colors ${
              tab === 'blitzes' ? 'bg-slate-700 text-white' : 'text-slate-400 active:text-white'
            }`}
          >
            Blitzes
          </button>
          <button
            onClick={() => setTab('requests')}
            className={`flex-1 min-h-[48px] text-sm font-semibold rounded-xl transition-colors relative ${
              tab === 'requests' ? 'bg-slate-700 text-white' : 'text-slate-400 active:text-white'
            }`}
          >
            Requests
            <span className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center text-[10px] font-bold bg-red-500 text-white rounded-full">
              {pendingRequests.length}
            </span>
          </button>
        </div>
      )}

      {/* Blitz cards */}
      {tab === 'blitzes' && (
        <>
          {filteredBlitzes.length === 0 ? (
            <MobileEmptyState icon={Tent} title="No blitzes found" subtitle="Try a different status filter" />
          ) : (
            <div className="space-y-3">
              {filteredBlitzes.map((blitz) => {
                const approvedCount = blitz.participants.filter((p) => p.joinStatus === 'approved').length;
                const dateRange = `${formatDate(blitz.startDate)} - ${formatDate(blitz.endDate)}`;
                const details = [blitz.location, dateRange, `${approvedCount} rep${approvedCount !== 1 ? 's' : ''}`]
                  .filter(Boolean)
                  .join(' \u00B7 ');

                return (
                  <MobileCard key={blitz.id} onTap={() => router.push(`/dashboard/blitz/${blitz.id}`)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-semibold text-white truncate">{blitz.name}</p>
                        <p className="text-sm text-slate-500 mt-1">{details}</p>
                      </div>
                      <MobileBadge value={STATUS_BADGE_MAP[blitz.status]} variant="status" />
                    </div>
                  </MobileCard>
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
                  <p className="text-base font-semibold text-white">{req.name}</p>
                  <p className="text-sm text-slate-500 mt-1">
                    {req.type === 'create' ? 'New blitz request' : 'Cancel request'} by {req.requestedBy.firstName} {req.requestedBy.lastName}
                  </p>
                  <MobileBadge value="Pending" variant="status" />
                </MobileCard>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
