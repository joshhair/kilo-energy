'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useApp } from '../../../lib/context';
import { useIsHydrated } from '../../../lib/hooks';
import { formatDate, formatCurrency } from '../../../lib/utils';
import { MapPin, Calendar, Users, Plus, ChevronRight, Tent, DollarSign, TrendingUp, Clock, CheckCircle, XCircle, AlertCircle, Search, Filter, Inbox, Loader2, Zap, UserPlus, UserCheck } from 'lucide-react';
import { useToast } from '../../../lib/toast';

type BlitzStatus = 'upcoming' | 'active' | 'completed' | 'cancelled';
type TabKey = 'blitzes' | 'requests';

interface BlitzData {
  id: string;
  name: string;
  location: string;
  housing: string;
  startDate: string;
  endDate: string;
  notes: string;
  status: BlitzStatus;
  createdBy: { id: string; firstName: string; lastName: string };
  owner: { id: string; firstName: string; lastName: string };
  participants: Array<{
    id: string;
    joinStatus: string;
    attendanceStatus: string | null;
    user: { id: string; firstName: string; lastName: string };
  }>;
  costs: Array<{ id: string; category: string; amount: number; description: string; date: string }>;
  projects: Array<{ id: string; customerName: string; kWSize: number; netPPW: number; m1Amount: number; m2Amount: number; phase: string }>;
}

interface BlitzRequestData {
  id: string;
  name: string;
  location: string;
  startDate: string;
  endDate: string;
  housing: string;
  notes: string;
  expectedHeadcount: number;
  status: string;
  adminNotes: string | null;
  requestedBy: { id: string; firstName: string; lastName: string };
}

const STATUS_STYLES: Record<BlitzStatus, { bg: string; text: string; dot: string; border: string }> = {
  upcoming:  { bg: 'bg-blue-900/30',    text: 'text-blue-300',    dot: 'bg-blue-400',    border: 'border-blue-700/30' },
  active:    { bg: 'bg-emerald-900/30',  text: 'text-emerald-300', dot: 'bg-emerald-400', border: 'border-emerald-700/30' },
  completed: { bg: 'bg-zinc-800/50',     text: 'text-zinc-400',    dot: 'bg-zinc-500',    border: 'border-zinc-600/30' },
  cancelled: { bg: 'bg-red-900/30',      text: 'text-red-300',     dot: 'bg-red-400',     border: 'border-red-700/30' },
};

function getBlitzTimingLabel(blitz: BlitzData): string | null {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const start = new Date(blitz.startDate + 'T00:00:00');
  const end = new Date(blitz.endDate + 'T00:00:00');
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);

  if (blitz.status === 'upcoming') {
    const daysUntil = Math.round((start.getTime() - now.getTime()) / 86400000);
    if (daysUntil <= 0) return 'Starts today';
    if (daysUntil === 1) return 'Starts tomorrow';
    return `Starts in ${daysUntil}d`;
  }
  if (blitz.status === 'active') {
    const dayNum = Math.max(1, Math.round((now.getTime() - start.getTime()) / 86400000) + 1);
    return `Day ${dayNum} of ${totalDays}`;
  }
  if (blitz.status === 'completed') {
    return `${totalDays} days`;
  }
  return null;
}

function BlitzCard({ blitz, currentUserId, isAdmin, onJoin }: { blitz: BlitzData; currentUserId: string | null; isAdmin: boolean; onJoin: (blitzId: string) => void }) {
  const style = STATUS_STYLES[blitz.status] ?? STATUS_STYLES.upcoming;
  const approvedParticipants = blitz.participants.filter((p) => p.joinStatus === 'approved').length;
  const totalCosts = blitz.costs.reduce((s, c) => s + c.amount, 0);
  const totalKW = blitz.projects.reduce((s, p) => s + p.kWSize, 0);
  const totalDeals = blitz.projects.length;
  const timingLabel = getBlitzTimingLabel(blitz);
  const myParticipation = currentUserId ? blitz.participants.find((p) => p.user.id === currentUserId) : null;
  const canJoin = !isAdmin && !myParticipation && (blitz.status === 'upcoming' || blitz.status === 'active');

  return (
    <Link href={`/dashboard/blitz/${blitz.id}`}>
      <div className="group relative bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 overflow-hidden hover:border-zinc-600 hover:-translate-y-0.5 transition-all duration-200 hover:shadow-lg hover:shadow-black/20 cursor-pointer">
        {/* Status badge + timing */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${style.bg} ${style.text} ${style.border}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${style.dot} ${blitz.status === 'active' ? 'animate-pulse' : ''}`} />
              {blitz.status.charAt(0).toUpperCase() + blitz.status.slice(1)}
            </span>
            {timingLabel && (
              <span className="text-[11px] font-medium text-zinc-500">{timingLabel}</span>
            )}
          </div>
          <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
        </div>

        {/* Name */}
        <h3 className="text-lg font-bold text-white mb-1 group-hover:text-blue-300 transition-colors">{blitz.name}</h3>

        {/* Location + dates */}
        <div className="flex flex-col gap-1 text-sm text-zinc-400 mb-4">
          {blitz.location && (
            <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{blitz.location}</span>
          )}
          <span className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            {formatDate(blitz.startDate)} — {formatDate(blitz.endDate)}
          </span>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 pt-3 border-t border-zinc-800">
          <div className="text-center">
            <p className="text-xs text-zinc-500 mb-0.5">Reps</p>
            <p className="text-sm font-bold text-white">{approvedParticipants}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-zinc-500 mb-0.5">Deals</p>
            <p className="text-sm font-bold text-white">{totalDeals}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-zinc-500 mb-0.5">kW</p>
            <p className="text-sm font-bold text-white">{totalKW.toFixed(1)}</p>
          </div>
        </div>

        {/* Owner tag + join action */}
        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs text-zinc-500">
            Led by <span className="text-zinc-300">{blitz.owner.firstName} {blitz.owner.lastName}</span>
          </div>
          {canJoin && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onJoin(blitz.id); }}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-600/30 transition-colors"
            >
              <UserPlus className="w-3 h-3" /> Join
            </button>
          )}
          {myParticipation && (
            <span className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg ${myParticipation.joinStatus === 'approved' ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-500/20' : 'bg-amber-900/30 text-amber-400 border border-amber-500/20'}`}>
              <UserCheck className="w-3 h-3" /> {myParticipation.joinStatus === 'approved' ? 'Joined' : 'Pending'}
            </span>
          )}
        </div>

        {/* Hover glow bar */}
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-blue-400 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      </div>
    </Link>
  );
}

function CreateBlitzModal({ onClose, onCreated, userId, reps }: { onClose: () => void; onCreated: () => void; userId: string; reps: Array<{ id: string; name: string }> }) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [housing, setHousing] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [ownerId, setOwnerId] = useState(userId);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    setTouched(true);
    if (!name.trim() || !startDate || !endDate) return;
    setSaving(true);
    try {
      await fetch('/api/blitzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          location: location.trim(),
          housing: housing.trim(),
          startDate,
          endDate,
          notes: notes.trim(),
          createdById: userId,
          ownerId,
        }),
      });
      toast('Blitz created');
      onCreated();
      onClose();
    } catch {
      toast('Failed to create blitz', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2"><Tent className="w-5 h-5 text-blue-400" /> New Blitz</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Blitz Name *</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={`w-full bg-zinc-800 border rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-colors ${touched && !name.trim() ? 'border-red-500/60' : 'border-zinc-700'}`} placeholder="e.g. Hunter's April 2026 Blitz" />
            {touched && !name.trim() && <p className="text-xs text-red-400 mt-1">Blitz name is required</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Location / Market</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" placeholder="e.g. Austin, TX" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Housing / Address</label>
            <input value={housing} onChange={(e) => setHousing(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" placeholder="e.g. 123 Main St, Apt 4" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Start Date *</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`w-full bg-zinc-800 border rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-colors ${touched && !startDate ? 'border-red-500/60' : 'border-zinc-700'}`} />
              {touched && !startDate && <p className="text-xs text-red-400 mt-1">Required</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">End Date *</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={`w-full bg-zinc-800 border rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-colors ${touched && !endDate ? 'border-red-500/60' : 'border-zinc-700'}`} />
              {touched && !endDate && <p className="text-xs text-red-400 mt-1">Required</p>}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Blitz Leader</label>
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
              <option value={userId}>Me</option>
              {reps.filter((r) => r.id !== userId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none" />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
          <button onClick={handleSubmit} disabled={!name.trim() || !startDate || !endDate || saving} className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {saving ? 'Creating...' : 'Create Blitz'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BlitzPage() {
  const { currentRole, currentRepId, reps } = useApp();
  const hydrated = useIsHydrated();
  const isAdmin = currentRole === 'admin';

  const [tab, setTab] = useState<TabKey>('blitzes');
  const [blitzes, setBlitzes] = useState<BlitzData[]>([]);
  const [requests, setRequests] = useState<BlitzRequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<BlitzStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [processingRequest, setProcessingRequest] = useState<string | null>(null);
  const { toast } = useToast();

  const loadData = () => {
    Promise.all([
      fetch('/api/blitzes').then((r) => r.json()),
      isAdmin ? fetch('/api/blitz-requests').then((r) => r.json()) : Promise.resolve([]),
    ]).then(([b, r]) => {
      setBlitzes(b);
      setRequests(r);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, [isAdmin]);

  const filteredBlitzes = useMemo(() => {
    let list = blitzes;
    if (statusFilter !== 'all') list = list.filter((b) => b.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((b) => b.name.toLowerCase().includes(q) || b.location.toLowerCase().includes(q));
    }
    // For reps, only show blitzes they're participating in or upcoming ones
    if (!isAdmin && currentRepId) {
      list = list.filter((b) =>
        b.status === 'upcoming' || b.status === 'active' ||
        b.participants.some((p) => p.user.id === currentRepId)
      );
    }
    return list;
  }, [blitzes, statusFilter, search, isAdmin, currentRepId]);

  const pendingRequests = requests.filter((r) => r.status === 'pending');

  const handleApproveRequest = async (reqId: string) => {
    setProcessingRequest(reqId);
    try {
      await fetch(`/api/blitz-requests/${reqId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      });
      toast('Request approved');
      loadData();
    } finally { setProcessingRequest(null); }
  };

  const handleDenyRequest = async (reqId: string) => {
    setProcessingRequest(reqId);
    try {
      await fetch(`/api/blitz-requests/${reqId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'denied' }),
      });
      toast('Request denied');
      loadData();
    } finally { setProcessingRequest(null); }
  };

  const handleJoinBlitz = async (blitzId: string) => {
    if (!currentRepId) return;
    try {
      await fetch(`/api/blitzes/${blitzId}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentRepId, joinStatus: 'pending' }),
      });
      toast('Join request sent');
      loadData();
    } catch {
      toast('Failed to join blitz', 'error');
    }
  };

  if (!hydrated) return null;

  // Summary stats
  const activeBlitzes = blitzes.filter((b) => b.status === 'active').length;
  const upcomingBlitzes = blitzes.filter((b) => b.status === 'upcoming').length;
  const totalDeals = blitzes.reduce((s, b) => s + b.projects.length, 0);
  const totalKW = blitzes.reduce((s, b) => s + b.projects.reduce((ps, p) => ps + p.kWSize, 0), 0);
  const totalCosts = isAdmin ? blitzes.reduce((s, b) => s + b.costs.reduce((cs, c) => cs + c.amount, 0), 0) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
            <Tent className="w-7 h-7 text-blue-400" /> Blitz
          </h1>
          <p className="text-sm text-zinc-500 mt-1">Manage blitzes, track participation and profitability</p>
        </div>
        {(isAdmin) && (
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-500 transition-colors shadow-lg shadow-blue-600/20">
            <Plus className="w-4 h-4" /> New Blitz
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className={`grid grid-cols-2 ${isAdmin ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-4`}>
        <div className="bg-zinc-900/80 border border-zinc-800 border-l-2 border-l-emerald-500/60 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-1 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Active</p>
          <p className="text-2xl font-bold text-emerald-400">{activeBlitzes}</p>
        </div>
        <div className="bg-zinc-900/80 border border-zinc-800 border-l-2 border-l-blue-500/60 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-1 flex items-center gap-1"><Clock className="w-3 h-3" /> Upcoming</p>
          <p className="text-2xl font-bold text-blue-400">{upcomingBlitzes}</p>
        </div>
        <div className="bg-zinc-900/80 border border-zinc-800 border-l-2 border-l-purple-500/60 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-1 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Deals</p>
          <p className="text-2xl font-bold text-white">{totalDeals}</p>
        </div>
        <div className="bg-zinc-900/80 border border-zinc-800 border-l-2 border-l-cyan-500/60 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-1 flex items-center gap-1"><Zap className="w-3 h-3" /> Total kW</p>
          <p className="text-2xl font-bold text-white">{totalKW.toFixed(1)}</p>
        </div>
        {isAdmin && (
          <div className="bg-zinc-900/80 border border-zinc-800 border-l-2 border-l-amber-500/60 rounded-xl p-4">
            <p className="text-xs text-zinc-500 mb-1 flex items-center gap-1"><DollarSign className="w-3 h-3" /> Costs</p>
            <p className="text-2xl font-bold text-amber-400">{formatCurrency(totalCosts)}</p>
          </div>
        )}
      </div>

      {/* Tabs */}
      {isAdmin && (
        <div className="flex gap-0.5 border-b border-zinc-800/50">
          <button onClick={() => setTab('blitzes')} className={`relative px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${tab === 'blitzes' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
            Blitzes ({filteredBlitzes.length})
            {tab === 'blitzes' && <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-blue-500 rounded-full" />}
          </button>
          <button onClick={() => setTab('requests')} className={`relative px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${tab === 'requests' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
            Requests {pendingRequests.length > 0 && <span className="ml-1 inline-flex items-center justify-center w-4.5 h-4.5 text-[10px] font-bold bg-red-500 text-white rounded-full px-1">{pendingRequests.length}</span>}
            {tab === 'requests' && <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-blue-500 rounded-full" />}
          </button>
        </div>
      )}

      {tab === 'blitzes' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search blitzes..." className="w-full bg-zinc-900/80 border border-zinc-800 rounded-lg pl-9 pr-8 py-2 text-sm text-white placeholder-zinc-600 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors">
                  <XCircle className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex gap-1 flex-wrap">
              {(['all', 'upcoming', 'active', 'completed', 'cancelled'] as const).map((s) => {
                const count = s === 'all' ? blitzes.length : blitzes.filter((b) => b.status === s).length;
                return (
                  <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${statusFilter === s ? 'bg-zinc-800 border-zinc-600 text-white' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>
                    {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                    {count > 0 && <span className="ml-1 text-zinc-600">{count}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Blitz grid */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <div className="relative w-10 h-10">
                <div className="absolute inset-0 rounded-full border-2 border-zinc-700/40" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 border-r-blue-500/60 animate-spin" />
              </div>
              <p className="text-sm text-zinc-500 font-medium">Loading blitzes...</p>
            </div>
          ) : filteredBlitzes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 rounded-xl bg-zinc-900/30 border border-dashed border-zinc-800">
              <Tent className="w-16 h-16 text-zinc-600" />
              <div className="text-center">
                <p className="text-lg font-semibold text-white">No blitzes found</p>
                <p className="text-sm text-zinc-500 mt-1">{search || statusFilter !== 'all' ? 'Try adjusting your filters' : 'Create your first blitz to get started'}</p>
              </div>
              {isAdmin && !search && statusFilter === 'all' && (
                <button onClick={() => setShowCreate(true)} className="mt-2 px-4 py-2 text-sm font-semibold bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-600/30 transition-colors">
                  Create a Blitz
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredBlitzes.map((b) => <BlitzCard key={b.id} blitz={b} currentUserId={currentRepId} isAdmin={isAdmin} onJoin={handleJoinBlitz} />)}
            </div>
          )}
        </>
      )}

      {tab === 'requests' && isAdmin && (
        <div className="space-y-3">
          {requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 rounded-xl bg-zinc-900/30 border border-dashed border-zinc-800">
              <Inbox className="w-14 h-14 text-zinc-600" />
              <div className="text-center">
                <p className="text-lg font-semibold text-white">No blitz requests</p>
                <p className="text-sm text-zinc-500 mt-1">Requests from reps will appear here for approval</p>
              </div>
            </div>
          ) : (
            requests.map((req) => (
              <div key={req.id} className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white truncate">{req.name}</h3>
                      {req.status === 'pending' && <span className="shrink-0 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-sm text-zinc-400">
                      {req.location && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 shrink-0" />{req.location}</span>}
                      <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5 shrink-0" />{formatDate(req.startDate)} — {formatDate(req.endDate)}</span>
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5 shrink-0" />{req.expectedHeadcount} expected</span>
                    </div>
                    {req.notes && <p className="text-sm text-zinc-500 mt-2 line-clamp-2">{req.notes}</p>}
                    <p className="text-xs text-zinc-600 mt-2">Requested by <span className="text-zinc-400">{req.requestedBy.firstName} {req.requestedBy.lastName}</span></p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {req.status === 'pending' ? (
                      <>
                        <button onClick={() => handleApproveRequest(req.id)} disabled={processingRequest === req.id} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors">
                          {processingRequest === req.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />} Approve
                        </button>
                        <button onClick={() => handleDenyRequest(req.id)} disabled={processingRequest === req.id} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-red-600/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-600/30 disabled:opacity-50 transition-colors">
                          <XCircle className="w-3 h-3" /> Deny
                        </button>
                      </>
                    ) : (
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${req.status === 'approved' ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-500/20' : 'bg-red-900/30 text-red-300 border border-red-500/20'}`}>
                        {req.status === 'approved' ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateBlitzModal
          onClose={() => setShowCreate(false)}
          onCreated={loadData}
          userId={currentRepId ?? 'admin2'}
          reps={reps}
        />
      )}
    </div>
  );
}
