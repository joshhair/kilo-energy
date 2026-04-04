'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { formatDate } from '../../../lib/utils';
import { Plus, Tent, MapPin, Calendar, Users, Inbox, AlertCircle } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
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

const STATUS_BADGE_CLS: Record<BlitzStatus, string> = {
  upcoming: 'bg-blue-900/30 text-blue-300 border-blue-700/30',
  active: 'bg-emerald-900/30 text-emerald-300 border-emerald-700/30',
  completed: 'bg-slate-800/50 text-slate-400 border-slate-600/30',
  cancelled: 'bg-red-900/30 text-red-300 border-red-700/30',
};

const STATUS_DOT_CLS: Record<BlitzStatus, string> = {
  upcoming: 'bg-blue-400',
  active: 'bg-emerald-400 animate-pulse',
  completed: 'bg-slate-500',
  cancelled: 'bg-red-400',
};

export default function MobileBlitz() {
  const router = useRouter();
  const { currentRole, effectiveRole, effectiveRepId, reps, pmPermissions } = useApp();

  const isAdmin = effectiveRole === 'admin';
  const isPM = effectiveRole === 'project_manager';

  const [blitzes, setBlitzes] = useState<BlitzData[]>([]);
  const [requests, setRequests] = useState<BlitzRequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<BlitzStatus | 'all'>('all');
  const [tab, setTab] = useState<'blitzes' | 'requests'>('blitzes');
  const [userPerms, setUserPerms] = useState<{ canRequestBlitz: boolean; canCreateBlitz: boolean }>({ canRequestBlitz: false, canCreateBlitz: false });

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
    // Sort newest first
    return [...list].sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
  }, [blitzes, statusFilter]);

  // PM access guard — placed after all hooks
  if (isPM && pmPermissions && !pmPermissions.canAccessBlitz) {
    return (
      <div className="px-5 pt-3 pb-24 space-y-8">
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

  // Determine the right-side header action
  const headerRight = canCreate ? (
    <button
      onClick={() => router.push('/dashboard/blitz?create=true')}
      className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-600 text-white active:bg-blue-700 transition-colors"
      aria-label="Create blitz"
    >
      <Plus className="w-5 h-5" />
    </button>
  ) : canRequest ? (
    <button
      onClick={() => router.push('/dashboard/blitz?request=true')}
      className="flex items-center justify-center min-h-[44px] px-4 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 text-xs font-semibold active:bg-slate-700 transition-colors"
    >
      <Plus className="w-4 h-4 mr-1" /> Request
    </button>
  ) : null;

  if (loading) {
    return (
      <div className="px-5 pt-3 pb-24 space-y-8">
        <MobilePageHeader title="Blitz" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-800/40 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-3 pb-24 space-y-8">
      <MobilePageHeader title="Blitz" right={headerRight} />

      {/* Status filter pills */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {STATUS_PILLS.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className={`min-h-[36px] px-4 py-1.5 text-sm font-semibold rounded-full border whitespace-nowrap transition-colors ${
              statusFilter === s.value
                ? 'bg-blue-600/20 text-blue-400 border-blue-500/30 shadow-sm shadow-blue-500/20'
                : 'bg-slate-800/40 text-slate-400 border-slate-700/30 active:bg-slate-700/50'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Admin tabs: Blitzes / Requests */}
      {isAdmin && pendingRequests.length > 0 && (
        <div className="flex gap-1 mb-4 p-1 bg-slate-800/40 rounded-xl">
          <button
            onClick={() => setTab('blitzes')}
            className={`flex-1 min-h-[36px] text-xs font-semibold rounded-lg transition-colors ${
              tab === 'blitzes' ? 'bg-slate-700 text-white' : 'text-slate-400 active:text-white'
            }`}
          >
            Blitzes
          </button>
          <button
            onClick={() => setTab('requests')}
            className={`flex-1 min-h-[36px] text-xs font-semibold rounded-lg transition-colors relative ${
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
            <div className="space-y-4">
              {filteredBlitzes.map((blitz) => {
                const approvedCount = blitz.participants.filter((p) => p.joinStatus === 'approved').length;
                return (
                  <MobileCard key={blitz.id} onTap={() => router.push(`/dashboard/blitz/${blitz.id}`)} accent={blitz.status === 'upcoming' ? 'blue' : undefined}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="font-semibold text-white text-base truncate flex-1">{blitz.name}</p>
                      <span className={`inline-flex items-center gap-1.5 min-h-[28px] px-3 py-1 text-[11px] font-semibold rounded-full border shrink-0 ${STATUS_BADGE_CLS[blitz.status]}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT_CLS[blitz.status]}`} />
                        {blitz.status.charAt(0).toUpperCase() + blitz.status.slice(1)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                      {blitz.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />{blitz.location}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDate(blitz.startDate)} — {formatDate(blitz.endDate)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />{approvedCount} rep{approvedCount !== 1 ? 's' : ''}
                      </span>
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
            <div className="space-y-4">
              {pendingRequests.map((req) => (
                <MobileCard key={req.id} onTap={() => router.push(`/dashboard/blitz?tab=requests`)} accent="amber">
                  <p className="font-semibold text-white text-base">{req.name}</p>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {req.type === 'create' ? 'New blitz request' : 'Cancel request'} by {req.requestedBy.firstName} {req.requestedBy.lastName}
                  </p>
                  <span className="inline-flex items-center mt-2 min-h-[28px] px-3 py-1 text-[11px] font-semibold rounded-full border bg-amber-900/40 text-amber-300 border-amber-700/30">
                    Pending
                  </span>
                </MobileCard>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
