'use client';

import { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useIsHydrated, useFocusTrap, useMediaQuery } from '../../../lib/hooks';
import MobileBlitz from '../mobile/MobileBlitz';
import { formatDate, formatCurrency, formatCompactKW } from '../../../lib/utils';
import { MapPin, Calendar, Users, Plus, ChevronRight, Tent, DollarSign, TrendingUp, Clock, CheckCircle, XCircle, AlertCircle, Search, Filter, Inbox, Loader2, Zap, UserPlus, UserCheck, ChevronDown, X } from 'lucide-react';
import { useToast } from '../../../lib/toast';
import { PaginationBar } from '../components/PaginationBar';

type BlitzStatus = 'upcoming' | 'active' | 'completed' | 'cancelled';
type TabKey = 'blitzes' | 'requests';
type SortKey = 'newest' | 'oldest' | 'deals' | 'kw' | 'name';

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
  type: 'create' | 'cancel';
  blitzId: string | null;
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
  upcoming:  { bg: '', text: '', dot: '', border: '' },
  active:    { bg: '', text: '', dot: '', border: '' },
  completed: { bg: '', text: '', dot: '', border: '' },
  cancelled: { bg: '', text: '', dot: '', border: '' },
};

const STATUS_INLINE: Record<BlitzStatus, { bg: string; color: string; dotBg: string; border: string }> = {
  upcoming:  { bg: 'rgba(77,159,255,0.12)', color: '#4d9fff', dotBg: '#4d9fff', border: '1px solid rgba(77,159,255,0.3)' },
  active:    { bg: 'rgba(0,224,122,0.12)',  color: '#00e07a', dotBg: '#00e07a', border: '1px solid rgba(0,224,122,0.3)' },
  completed: { bg: 'rgba(136,145,168,0.12)', color: '#8891a8', dotBg: '#8891a8', border: '1px solid rgba(136,145,168,0.3)' },
  cancelled: { bg: 'rgba(255,82,82,0.12)',  color: '#ff5252', dotBg: '#ff5252', border: '1px solid rgba(255,82,82,0.3)' },
};

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Newest First' },
  { key: 'oldest', label: 'Oldest First' },
  { key: 'deals', label: 'Most Deals' },
  { key: 'kw', label: 'Most kW' },
  { key: 'name', label: 'Name A\u2013Z' },
];

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

function getBlitzProgress(blitz: BlitzData): { dayNum: number; totalDays: number; pct: number } | null {
  if (blitz.status !== 'active') return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const start = new Date(blitz.startDate + 'T00:00:00');
  const end = new Date(blitz.endDate + 'T00:00:00');
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const dayNum = Math.max(1, Math.round((now.getTime() - start.getTime()) / 86400000) + 1);
  const pct = Math.min(100, Math.round((dayNum / totalDays) * 100));
  return { dayNum, totalDays, pct };
}

function BlitzCard({ blitz, currentUserId, isAdmin, onJoin, index = 0 }: { blitz: BlitzData; currentUserId: string | null; isAdmin: boolean; onJoin: (blitzId: string) => Promise<void>; index?: number }) {
  const [joining, setJoining] = useState(false);
  const router = useRouter();
  const style = STATUS_INLINE[blitz.status] ?? STATUS_INLINE.upcoming;
  const approvedParticipants = blitz.participants.filter((p) => p.joinStatus === 'approved').length;
  const totalCosts = blitz.costs.reduce((s, c) => s + c.amount, 0);
  const activeProjects = blitz.projects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold');
  const totalKW = activeProjects.reduce((s, p) => s + p.kWSize, 0);
  const totalDeals = activeProjects.length;
  const timingLabel = getBlitzTimingLabel(blitz);
  const progress = getBlitzProgress(blitz);
  const myParticipation = currentUserId ? blitz.participants.find((p) => p.user.id === currentUserId) : null;
  const isOwner = currentUserId === blitz.owner.id;
  const canJoin = !isAdmin && !isOwner && !myParticipation && (blitz.status === 'upcoming' || blitz.status === 'active');

  return (
    <Link href={`/dashboard/blitz/${blitz.id}`}>
      <div className={`group relative card-surface rounded-2xl p-5 overflow-hidden hover:border-[#272b35] hover:-translate-y-0.5 transition-all duration-200 hover:shadow-lg hover:shadow-black/20 cursor-pointer animate-slide-in-scale stagger-${Math.min(index, 6)}`}>
        {/* Status badge + timing */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{ background: style.bg, color: style.color, border: style.border }}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${blitz.status === 'active' ? 'animate-pulse' : ''}`} style={{ backgroundColor: style.dotBg }} />
              {blitz.status.charAt(0).toUpperCase() + blitz.status.slice(1)}
            </span>
            {timingLabel && (
              <span className="text-[11px] font-medium" style={{ color: '#8891a8' }}>{timingLabel}</span>
            )}
          </div>
          <ChevronRight className="w-4 h-4 text-[#525c72] group-hover:text-[#c2c8d8] transition-colors" />
        </div>

        {/* Name */}
        <h3 className="text-lg font-bold mb-1 group-hover:text-[#00c4f0] transition-colors" style={{ color: '#f0f2f7' }}>{blitz.name}</h3>

        {/* Location + dates */}
        <div className="flex flex-col gap-1 text-sm mb-4" style={{ color: '#c2c8d8' }}>
          {blitz.location && (
            <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{blitz.location}</span>
          )}
          <span className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            {formatDate(blitz.startDate)} — {formatDate(blitz.endDate)}
          </span>
        </div>

        {/* Progress bar for active blitzes */}
        {progress && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-[11px] mb-1" style={{ color: '#8891a8' }}>
              <span>Day {progress.dayNum} of {progress.totalDays}</span>
              <span>{progress.pct}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#272b35' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${progress.pct}%`, background: 'linear-gradient(90deg, #00e07a, #00c4f0)' }}
              />
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 pt-3" style={{ borderTop: '1px solid #272b35' }}>
          <div className="text-center">
            <p className="text-xs mb-0.5" style={{ color: '#8891a8' }}>Reps</p>
            <p className="text-sm font-bold" style={{ color: '#f0f2f7' }}>{approvedParticipants}</p>
          </div>
          <div className="text-center">
            <p className="text-xs mb-0.5" style={{ color: '#8891a8' }}>Deals</p>
            <p className="text-sm font-bold" style={{ color: '#f0f2f7' }}>{totalDeals}</p>
          </div>
          <div className="text-center">
            <p className="text-xs mb-0.5" style={{ color: '#8891a8' }}>kW</p>
            <p className="text-sm font-bold" style={{ color: '#f0f2f7' }}>{totalKW.toFixed(1)}</p>
          </div>
        </div>

        {/* Cost efficiency metrics — admin only, when costs exist */}
        {isAdmin && totalCosts > 0 && (
          <div className="mt-2 text-[11px]" style={{ color: '#8891a8' }}>
            Cost/Deal: ${totalDeals > 0 ? (totalCosts / totalDeals).toFixed(0) : '--'}
            {' | '}
            Cost/kW: ${totalKW > 0 ? (totalCosts / totalKW).toFixed(2) : '--'}
          </div>
        )}

        {/* Owner tag + join action */}
        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs" style={{ color: '#8891a8' }}>
            Led by <span role="link" tabIndex={0} onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/dashboard/users/${blitz.owner.id}`); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); router.push(`/dashboard/users/${blitz.owner.id}`); } }} className="cursor-pointer hover:text-[#00c4f0] transition-colors" style={{ color: '#c2c8d8' }}>{blitz.owner.firstName} {blitz.owner.lastName}</span>
          </div>
          {isOwner && (
            <span className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-900/30 text-[#00e07a] border border-[#00e07a]/20">
              <Tent className="w-3 h-3" /> Leading
            </span>
          )}
          {canJoin && (
            <button
              disabled={joining}
              onClick={async (e) => { e.preventDefault(); e.stopPropagation(); setJoining(true); try { await onJoin(blitz.id); } catch {} finally { setJoining(false); } }}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-[#00e07a]/20 text-[#00e07a] border border-[#00e07a]/30 rounded-lg hover:bg-[#00e07a]/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {joining ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />} {joining ? 'Joining...' : 'Join'}
            </button>
          )}
          {!isOwner && myParticipation && (
            <span className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg ${myParticipation.joinStatus === 'approved' ? 'bg-emerald-900/30 text-[#00e07a] border border-[#00e07a]/20' : 'bg-amber-900/30 text-amber-400 border border-amber-500/20'}`}>
              <UserCheck className="w-3 h-3" /> {myParticipation.joinStatus === 'approved' ? 'Joined' : 'Pending'}
            </span>
          )}
        </div>

        {/* Hover glow bar */}
        <div className="absolute bottom-0 left-0 right-0 h-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ background: 'linear-gradient(90deg, #00e07a, #00c4f0, #00e07a)' }} />
      </div>
    </Link>
  );
}

function CreateBlitzModal({ onClose, onCreated, userId, reps, isAdmin }: { onClose: () => void; onCreated: () => void; userId: string; reps: Array<{ id: string; name: string }>; isAdmin: boolean }) {
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
  const modalPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalPanelRef, true);

  const handleSubmit = async () => {
    setTouched(true);
    if (!name.trim() || !startDate || !endDate || new Date(endDate) < new Date(startDate)) return;
    setSaving(true);
    try {
      const res = await fetch('/api/blitzes', {
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
      if (!res.ok) throw new Error('Request failed');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-modal-backdrop" onClick={onClose}>
      <div ref={modalPanelRef} className="bg-[#161920] border border-[#272b35] rounded-2xl p-6 w-full max-w-lg shadow-2xl shadow-black/40 animate-modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2"><Tent className="w-5 h-5 text-[#00e07a]" /> New Blitz</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#c2c8d8] mb-1">Blitz Name *</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={`w-full bg-[#1d2028] border rounded-xl px-3 py-2 text-sm text-white focus:outline-none input-focus-glow transition-colors ${touched && !name.trim() ? 'border-red-500/60' : 'border-[#272b35]'}`} placeholder="e.g. Hunter's April 2026 Blitz" />
            {touched && !name.trim() && <p className="text-xs text-red-400 mt-1">Blitz name is required</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-[#c2c8d8] mb-1">Location / Market</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} className="w-full bg-[#1d2028] border border-[#272b35] rounded-xl px-3 py-2 text-sm text-white focus:outline-none input-focus-glow" placeholder="e.g. Austin, TX" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#c2c8d8] mb-1">Housing / Address</label>
            <input value={housing} onChange={(e) => setHousing(e.target.value)} className="w-full bg-[#1d2028] border border-[#272b35] rounded-xl px-3 py-2 text-sm text-white focus:outline-none input-focus-glow" placeholder="e.g. 123 Main St, Apt 4" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#c2c8d8] mb-1">Start Date *</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`w-full bg-[#1d2028] border rounded-xl px-3 py-2 text-sm text-white focus:outline-none input-focus-glow transition-colors ${touched && !startDate ? 'border-red-500/60' : 'border-[#272b35]'}`} />
              {touched && !startDate && <p className="text-xs text-red-400 mt-1">Required</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-[#c2c8d8] mb-1">End Date *</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={`w-full bg-[#1d2028] border rounded-xl px-3 py-2 text-sm text-white focus:outline-none input-focus-glow transition-colors ${touched && (!endDate || (startDate && new Date(endDate) < new Date(startDate))) ? 'border-red-500/60' : 'border-[#272b35]'}`} />
              {touched && !endDate && <p className="text-xs text-red-400 mt-1">Required</p>}
              {touched && endDate && startDate && new Date(endDate) < new Date(startDate) && <p className="text-xs text-red-400 mt-1">Must be after start date</p>}
            </div>
          </div>
          {isAdmin && (
            <div>
              <label className="block text-xs font-medium text-[#c2c8d8] mb-1">Blitz Leader</label>
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-full bg-[#1d2028] border border-[#272b35] rounded-xl px-3 py-2 text-sm text-white focus:outline-none input-focus-glow">
                <option value={userId}>Me</option>
                {reps.filter((r) => r.id !== userId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-[#c2c8d8] mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full bg-[#1d2028] border border-[#272b35] rounded-xl px-3 py-2 text-sm text-white focus:outline-none input-focus-glow resize-none" />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#c2c8d8] hover:text-white transition-colors">Cancel</button>
          <button onClick={handleSubmit} disabled={!name.trim() || !startDate || !endDate || saving} className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold bg-[#00e07a] text-black rounded-xl hover:bg-[#00e07a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {saving ? 'Creating...' : 'Create Blitz'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RequestBlitzModal({ onClose, onSubmitted, userId }: { onClose: () => void; onSubmitted: () => void; userId: string }) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [housing, setHousing] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [headcount, setHeadcount] = useState('');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const { toast } = useToast();
  const requestPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(requestPanelRef, true);

  const handleSubmit = async () => {
    setTouched(true);
    if (!name.trim() || !startDate || !endDate || new Date(endDate) < new Date(startDate)) return;
    setSaving(true);
    try {
      const res = await fetch('/api/blitz-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestedById: userId,
          name: name.trim(),
          location: location.trim(),
          startDate,
          endDate,
          housing: housing.trim(),
          notes: notes.trim(),
          expectedHeadcount: parseInt(headcount) || 0,
        }),
      });
      if (!res.ok) throw new Error('Request failed');
      toast('Blitz request submitted for approval');
      onSubmitted();
      onClose();
    } catch {
      toast('Failed to submit request', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-modal-backdrop" onClick={onClose}>
      <div ref={requestPanelRef} className="bg-[#161920] border border-[#272b35] rounded-2xl p-6 w-full max-w-lg shadow-2xl shadow-black/40 animate-modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2"><Tent className="w-5 h-5 text-amber-400" /> Request a Blitz</h2>
        <p className="text-sm text-[#8891a8] mb-4">Submit a request for admin approval. You'll be notified when it's reviewed.</p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#c2c8d8] mb-1">Blitz Name *</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={`w-full bg-[#1d2028] border rounded-xl px-3 py-2 text-sm text-white focus:outline-none input-focus-glow transition-colors ${touched && !name.trim() ? 'border-red-500/60' : 'border-[#272b35]'}`} placeholder="e.g. Austin Spring Blitz" />
            {touched && !name.trim() && <p className="text-xs text-red-400 mt-1">Name is required</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#c2c8d8] mb-1">Location</label>
              <input value={location} onChange={(e) => setLocation(e.target.value)} className="w-full bg-[#1d2028] border border-[#272b35] rounded-xl px-3 py-2 text-sm text-white focus:outline-none input-focus-glow" placeholder="e.g. Austin, TX" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#c2c8d8] mb-1">Expected Headcount</label>
              <input type="number" min="1" value={headcount} onChange={(e) => setHeadcount(e.target.value)} className="w-full bg-[#1d2028] border border-[#272b35] rounded-xl px-3 py-2 text-sm text-white focus:outline-none input-focus-glow" placeholder="e.g. 8" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#c2c8d8] mb-1">Start Date *</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`w-full bg-[#1d2028] border rounded-xl px-3 py-2 text-sm text-white focus:outline-none input-focus-glow transition-colors ${touched && !startDate ? 'border-red-500/60' : 'border-[#272b35]'}`} />
              {touched && !startDate && <p className="text-xs text-red-400 mt-1">Required</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-[#c2c8d8] mb-1">End Date *</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={`w-full bg-[#1d2028] border rounded-xl px-3 py-2 text-sm text-white focus:outline-none input-focus-glow transition-colors ${touched && (!endDate || (startDate && new Date(endDate) < new Date(startDate))) ? 'border-red-500/60' : 'border-[#272b35]'}`} />
              {touched && !endDate && <p className="text-xs text-red-400 mt-1">Required</p>}
              {touched && endDate && startDate && new Date(endDate) < new Date(startDate) && <p className="text-xs text-red-400 mt-1">Must be after start date</p>}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#c2c8d8] mb-1">Housing Preferences</label>
            <input value={housing} onChange={(e) => setHousing(e.target.value)} className="w-full bg-[#1d2028] border border-[#272b35] rounded-xl px-3 py-2 text-sm text-white focus:outline-none input-focus-glow" placeholder="e.g. Airbnb near downtown" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#c2c8d8] mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full bg-[#1d2028] border border-[#272b35] rounded-xl px-3 py-2 text-sm text-white focus:outline-none input-focus-glow resize-none" placeholder="Why this blitz, what's the opportunity..." />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#c2c8d8] hover:text-white transition-colors">Cancel</button>
          <button onClick={handleSubmit} disabled={!name.trim() || !startDate || !endDate || saving} className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold bg-amber-600 text-white rounded-xl hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Tent className="w-4 h-4" />}
            {saving ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BlitzPage() {
  return (
    <Suspense>
      <BlitzPageInner />
    </Suspense>
  );
}

function BlitzPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { currentRole, currentRepId, effectiveRole, effectiveRepId, reps } = useApp();
  const hydrated = useIsHydrated();
  const isAdmin = effectiveRole === 'admin';

  // URL-persisted state
  const initialTab = (searchParams.get('tab') ?? 'blitzes') as TabKey;
  const initialStatus = (searchParams.get('status') ?? 'all') as BlitzStatus | 'all';

  const [tab, setTabState] = useState<TabKey>(['blitzes', 'requests'].includes(initialTab) ? initialTab : 'blitzes');
  const [blitzes, setBlitzes] = useState<BlitzData[]>([]);
  const [requests, setRequests] = useState<BlitzRequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilterState] = useState<BlitzStatus | 'all'>(['all', 'upcoming', 'active', 'completed', 'cancelled'].includes(initialStatus) ? initialStatus : 'all');

  const setTab = (v: TabKey) => {
    setTabState(v);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', v);
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  const setStatusFilter = (v: BlitzStatus | 'all') => {
    setStatusFilterState(v);
    const params = new URLSearchParams(searchParams.toString());
    if (v !== 'all') params.set('status', v); else params.delete('status');
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('newest');
  const [processingRequest, setProcessingRequest] = useState<string | null>(null);
  const [userPerms, setUserPerms] = useState<{ canRequestBlitz: boolean; canCreateBlitz: boolean }>({ canRequestBlitz: false, canCreateBlitz: false });
  const [showRequestBlitz, setShowRequestBlitz] = useState(false);
  const { toast } = useToast();

  // Pagination state
  const [blitzPage, setBlitzPage] = useState(1);
  const [blitzPerPage, setBlitzPerPage] = useState(12);
  const [requestPage, setRequestPage] = useState(1);
  const [requestPerPage, setRequestPerPage] = useState(10);

  // Search ref + keyboard shortcut
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Admin tab sliding indicator
  const adminTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [adminTabIndicator, setAdminTabIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const idx = tab === 'blitzes' ? 0 : 1;
    const el = adminTabRefs.current[idx];
    if (el) setAdminTabIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [tab]);

  // Status filter sliding indicator
  const STATUS_FILTER_OPTIONS = ['all', 'active', 'upcoming', 'completed', 'cancelled'] as const;
  const statusTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [statusIndicator, setStatusIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const idx = STATUS_FILTER_OPTIONS.indexOf(statusFilter);
    const el = statusTabRefs.current[idx];
    if (el) setStatusIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [statusFilter]);

  const loadData = () => {
    Promise.all([
      fetch('/api/blitzes').then((r) => r.json()),
      fetch('/api/blitz-requests').then((r) => r.json()),
    ]).then(([b, r]) => {
      setBlitzes(Array.isArray(b) ? b : []);
      setRequests(Array.isArray(r) ? r : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { document.title = 'Blitz | Kilo Energy'; }, []);
  useEffect(() => { loadData(); }, [isAdmin]);

  // Fetch rep blitz permissions
  useEffect(() => {
    if (isAdmin || !effectiveRepId) return;
    fetch(`/api/users/${effectiveRepId}`).then((r) => r.json()).then((u) => {
      if (u) setUserPerms({ canRequestBlitz: u.canRequestBlitz ?? false, canCreateBlitz: u.canCreateBlitz ?? false });
    }).catch(() => {});
  }, [isAdmin, effectiveRepId]);

  // If a rep lands on ?tab=requests without canRequestBlitz (e.g. via shared link), redirect to blitzes
  useEffect(() => {
    if (!isAdmin && !userPerms.canRequestBlitz && tab === 'requests') {
      setTab('blitzes');
    }
  }, [isAdmin, userPerms.canRequestBlitz]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredBlitzes = useMemo(() => {
    let list = blitzes;
    if (statusFilter !== 'all') list = list.filter((b) => b.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((b) => b.name.toLowerCase().includes(q) || b.location.toLowerCase().includes(q));
    }
    return list;
  }, [blitzes, statusFilter, search, isAdmin, effectiveRepId]);

  // Sorted blitzes
  const sortedBlitzes = useMemo(() => {
    const sorted = [...filteredBlitzes];
    switch (sortBy) {
      case 'newest': sorted.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()); break;
      case 'oldest': sorted.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()); break;
      case 'deals': sorted.sort((a, b) => b.projects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold').length - a.projects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold').length); break;
      case 'kw': sorted.sort((a, b) => b.projects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold').reduce((s, p) => s + p.kWSize, 0) - a.projects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold').reduce((s, p) => s + p.kWSize, 0)); break;
      case 'name': sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
    }
    return sorted;
  }, [filteredBlitzes, sortBy]);

  // For reps: separate "My Blitzes" (participating/leading) from browseable ones
  const myBlitzes = useMemo(() => {
    if (isAdmin || !effectiveRepId) return [];
    return sortedBlitzes.filter((b) =>
      b.owner.id === effectiveRepId ||
      b.participants.some((p) => p.user.id === effectiveRepId && p.joinStatus === 'approved')
    );
  }, [sortedBlitzes, isAdmin, effectiveRepId]);

  const pendingBlitzes = useMemo(() => {
    if (isAdmin || !effectiveRepId) return [];
    return sortedBlitzes.filter((b) =>
      b.owner.id !== effectiveRepId &&
      b.participants.some((p) => p.user.id === effectiveRepId && p.joinStatus === 'pending')
    );
  }, [sortedBlitzes, isAdmin, effectiveRepId]);

  const browseBlitzes = useMemo(() => {
    if (isAdmin) return sortedBlitzes;
    if (!effectiveRepId) return sortedBlitzes;
    const myIds = new Set([...myBlitzes, ...pendingBlitzes].map((b) => b.id));
    return sortedBlitzes.filter((b) =>
      !myIds.has(b.id) && (b.status === 'upcoming' || b.status === 'active')
    );
  }, [sortedBlitzes, isAdmin, effectiveRepId, myBlitzes, pendingBlitzes]);

  // Reset pages when filters change
  useEffect(() => { setBlitzPage(1); }, [statusFilter, search, sortBy]);
  useEffect(() => { setRequestPage(1); }, []);

  // Paginated admin blitzes
  const adminBlitzTotal = sortedBlitzes.length;
  const adminBlitzPages = Math.max(1, Math.ceil(adminBlitzTotal / blitzPerPage));
  const adminBlitzStart = (blitzPage - 1) * blitzPerPage;
  const adminBlitzEnd = Math.min(adminBlitzStart + blitzPerPage, adminBlitzTotal);
  const paginatedAdminBlitzes = sortedBlitzes.slice(adminBlitzStart, adminBlitzEnd);

  // Paginated requests
  const requestTotal = requests.length;
  const requestPages = Math.max(1, Math.ceil(requestTotal / requestPerPage));
  const requestStart = (requestPage - 1) * requestPerPage;
  const requestEnd = Math.min(requestStart + requestPerPage, requestTotal);
  const paginatedRequests = requests.slice(requestStart, requestEnd);

  const pendingRequests = requests.filter((r) => r.status === 'pending');

  const handleApproveRequest = async (reqId: string) => {
    setProcessingRequest(reqId);
    try {
      const r = await fetch(`/api/blitz-requests/${reqId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      });
      if (!r.ok) { toast('Failed to approve request', 'error'); return; }
      toast('Request approved');
      loadData();
    } catch { toast('Failed to approve request', 'error'); }
    finally { setProcessingRequest(null); }
  };

  const handleDenyRequest = async (reqId: string) => {
    setProcessingRequest(reqId);
    try {
      const r = await fetch(`/api/blitz-requests/${reqId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'denied' }),
      });
      if (!r.ok) { toast('Failed to deny request', 'error'); return; }
      toast('Request denied');
      loadData();
    } catch { toast('Failed to deny request', 'error'); }
    finally { setProcessingRequest(null); }
  };

  const handleJoinBlitz = async (blitzId: string) => {
    if (!effectiveRepId) return;
    try {
      const res = await fetch(`/api/blitzes/${blitzId}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: effectiveRepId, joinStatus: 'pending' }),
      });
      if (!res.ok) {
        toast('Failed to join blitz — please try again', 'error');
      } else {
        toast('Join request sent!', 'success');
      }
      loadData();
    } catch {
      toast('Failed to join blitz — please try again', 'error');
      loadData();
    }
  };

  const isMobile = useMediaQuery('(max-width: 767px)');

  if (!hydrated) return <BlitzSkeleton />;

  if (isMobile) return <MobileBlitz />;

  // Summary stats
  const activeBlitzes = blitzes.filter((b) => b.status === 'active').length;
  const upcomingBlitzes = blitzes.filter((b) => b.status === 'upcoming').length;
  const totalDeals = blitzes.reduce((s, b) => s + b.projects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold').length, 0);
  const totalKW = blitzes.reduce((s, b) => s + b.projects.filter((p) => p.phase !== 'Cancelled' && p.phase !== 'On Hold').reduce((ps, p) => ps + p.kWSize, 0), 0);
  const totalCosts = isAdmin ? blitzes.reduce((s, b) => s + b.costs.reduce((cs, c) => cs + c.amount, 0), 0) : 0;

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight flex items-center gap-2.5" style={{ fontFamily: "'DM Serif Display', serif", color: '#f0f2f7', letterSpacing: '-0.03em' }}>
            <Tent className="w-7 h-7" style={{ color: '#00c4f0' }} /> Blitz
          </h1>
          <p className="text-sm mt-1" style={{ color: '#8891a8' }}>Manage blitzes, track participation and profitability</p>
        </div>
        <div className="flex items-center gap-2">
          {(isAdmin || userPerms.canCreateBlitz) && (
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #00e07a, #00c4f0)', color: '#000', boxShadow: '0 4px 14px rgba(0,224,122,0.25)' }}>
              <Plus className="w-4 h-4" /> New Blitz
            </button>
          )}
          {!isAdmin && !userPerms.canCreateBlitz && userPerms.canRequestBlitz && (
            <button onClick={() => setShowRequestBlitz(true)} className="flex items-center gap-2 px-4 py-2.5 bg-[#1d2028] text-[#c2c8d8] text-sm font-semibold rounded-xl border border-[#272b35] hover:bg-[#272b35] hover:text-white transition-colors">
              <Plus className="w-4 h-4" /> Request Blitz
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className={`grid grid-cols-2 ${isAdmin ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-4`}>
        <div className="card-surface card-surface-stat rounded-2xl p-5 transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-0" style={{ '--card-accent': '#00e07a' } as React.CSSProperties}>
          <div className="h-[2px] w-12 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 mb-3" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#c2c8d8] text-xs font-medium uppercase tracking-wider">Active</span>
            <CheckCircle className="w-4 h-4 text-[#00e07a]" />
          </div>
          <p className="stat-value text-3xl font-black tabular-nums tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: '#00e07a' }}>{activeBlitzes}</p>
        </div>
        <div className="card-surface card-surface-stat rounded-2xl p-5 transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-1" style={{ '--card-accent': '#00c4f0' } as React.CSSProperties}>
          <div className="h-[2px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#c2c8d8] text-xs font-medium uppercase tracking-wider">Upcoming</span>
            <Clock className="w-4 h-4 text-[#00e07a]" />
          </div>
          <p className="stat-value text-3xl font-black tabular-nums tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: '#4d9fff' }}>{upcomingBlitzes}</p>
        </div>
        <div className="card-surface card-surface-stat rounded-2xl p-5 transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-2" style={{ '--card-accent': '#a855f7' } as React.CSSProperties}>
          <div className="h-[2px] w-12 rounded-full bg-gradient-to-r from-purple-500 to-purple-400 mb-3" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#c2c8d8] text-xs font-medium uppercase tracking-wider">Deals</span>
            <TrendingUp className="w-4 h-4 text-purple-400" />
          </div>
          <p className="stat-value text-3xl font-black tabular-nums tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: '#f0f2f7' }}>{totalDeals}</p>
        </div>
        <div className="card-surface card-surface-stat rounded-2xl p-5 transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-3" style={{ '--card-accent': '#06b6d4' } as React.CSSProperties}>
          <div className="h-[2px] w-12 rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400 mb-3" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#c2c8d8] text-xs font-medium uppercase tracking-wider">Total kW</span>
            <Zap className="w-4 h-4 text-cyan-400" />
          </div>
          <p className="stat-value text-3xl font-black tabular-nums tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: '#f0f2f7' }}>{formatCompactKW(totalKW)}</p>
        </div>
        {isAdmin && (
          <div className="card-surface card-surface-stat rounded-2xl p-5 transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-4" style={{ '--card-accent': '#f59e0b' } as React.CSSProperties}>
            <div className="h-[2px] w-12 rounded-full bg-gradient-to-r from-amber-500 to-amber-400 mb-3" />
            <div className="flex items-center justify-between mb-3">
              <span className="text-[#c2c8d8] text-xs font-medium uppercase tracking-wider">Costs</span>
              <DollarSign className="w-4 h-4 text-amber-400" />
            </div>
            <p className="stat-value text-3xl font-black tabular-nums tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: '#ffb020' }}>{formatCurrency(totalCosts)}</p>
          </div>
        )}
      </div>

      {/* Tabs — Blitzes / Requests with sliding pill */}
      {(isAdmin || userPerms.canRequestBlitz) && (
        <div className="flex gap-1 rounded-xl p-1 w-fit" style={{ background: '#161920', border: '1px solid #272b35' }}>
          {(['blitzes', 'requests'] as TabKey[]).map((t, i) => (
            <button
              key={t}
              ref={(el) => { adminTabRefs.current[i] = el; }}
              onClick={() => setTab(t)}
              className="relative z-10 px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
              style={tab === t ? { background: '#00e07a', color: '#000' } : { color: '#c2c8d8' }}
            >
              {t === 'blitzes' ? `Blitzes (${sortedBlitzes.length})` : <>Requests {isAdmin && pendingRequests.length > 0 && <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold rounded-full px-1" style={{ background: '#ff5252', color: '#fff' }}>{pendingRequests.length}</span>}</>}
            </button>
          ))}
        </div>
      )}

      {tab === 'blitzes' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Search with keyboard shortcut */}
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8891a8]" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearch('');
                    searchRef.current?.blur();
                  }
                }}
                placeholder="Search blitzes...  /"
                className="w-full rounded-xl pl-9 pr-8 py-2 text-sm focus:outline-none input-focus-glow"
                style={{ background: '#1d2028', border: '1px solid #333849', color: '#f0f2f7' }}
              />
              {search && (
                <button onClick={() => { setSearch(''); searchRef.current?.focus(); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8891a8] hover:text-[#c2c8d8] transition-colors">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {search && (
              <span className="text-xs text-[#8891a8] bg-[#1d2028] px-2 py-0.5 rounded-full">{sortedBlitzes.length} result{sortedBlitzes.length !== 1 ? 's' : ''}</span>
            )}

            {/* Sort dropdown */}
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="appearance-none rounded-xl pl-3 pr-8 py-2 text-sm focus:outline-none input-focus-glow cursor-pointer transition-colors"
                style={{ background: '#1d2028', border: '1px solid #333849', color: '#c2c8d8' }}
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8891a8] pointer-events-none" />
            </div>

            {/* Status filter tabs with sliding pill */}
            <div className="flex gap-1 rounded-xl p-1 w-fit" style={{ background: '#161920', border: '1px solid #272b35' }}>
              {STATUS_FILTER_OPTIONS.map((s, i) => {
                const count = s === 'all' ? blitzes.length : blitzes.filter((b) => b.status === s).length;
                const isActive = statusFilter === s;
                return (
                  <button
                    key={s}
                    ref={(el) => { statusTabRefs.current[i] = el; }}
                    onClick={() => setStatusFilter(s)}
                    className="relative z-10 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                    style={isActive
                      ? { background: '#00e07a', color: '#000' }
                      : { background: '#1d2028', color: '#c2c8d8', border: '1px solid #333849' }
                    }
                  >
                    {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                    {count > 0 && <span className="ml-1" style={{ color: isActive ? 'rgba(0,0,0,0.6)' : '#525c72' }}>{count}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Blitz grid */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <div className="relative w-10 h-10">
                <div className="absolute inset-0 rounded-full border-2 border-[#272b35]/40" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 border-r-blue-500/60 animate-spin" />
              </div>
              <p className="text-sm text-[#8891a8] font-medium">Loading blitzes...</p>
            </div>
          ) : isAdmin ? (
            /* Admin sees all blitzes in one grid */
            paginatedAdminBlitzes.length === 0 && sortedBlitzes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 gap-3 rounded-xl" style={{ background: 'rgba(22,25,32,0.5)', border: '1px dashed #272b35' }}>
                <Tent className="w-16 h-16" style={{ color: '#525c72' }} />
                <div className="text-center">
                  <p className="text-lg font-semibold" style={{ color: '#f0f2f7' }}>No blitzes found</p>
                  <p className="text-sm mt-1" style={{ color: '#8891a8' }}>{search || statusFilter !== 'all' ? 'Try adjusting your filters' : 'Create your first blitz to get started'}</p>
                </div>
                {!search && statusFilter === 'all' && (
                  <button onClick={() => setShowCreate(true)} className="mt-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors" style={{ background: 'rgba(0,224,122,0.12)', color: '#00e07a', border: '1px solid rgba(0,224,122,0.3)' }}>
                    Create a Blitz
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {paginatedAdminBlitzes.map((b, i) => <BlitzCard key={b.id} blitz={b} currentUserId={effectiveRepId} isAdmin={isAdmin} onJoin={handleJoinBlitz} index={i} />)}
                </div>
                {adminBlitzTotal > blitzPerPage && (
                  <PaginationBar
                    totalResults={adminBlitzTotal}
                    startIdx={adminBlitzStart}
                    endIdx={adminBlitzEnd}
                    currentPage={blitzPage}
                    totalPages={adminBlitzPages}
                    rowsPerPage={blitzPerPage}
                    onPageChange={setBlitzPage}
                    onRowsPerPageChange={setBlitzPerPage}
                  />
                )}
              </>
            )
          ) : (
            /* Rep view: My Blitzes section + Browse section */
            <div className="space-y-8">
              {/* My Blitzes */}
              {myBlitzes.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-[#c2c8d8] uppercase tracking-wider mb-3 flex items-center gap-2">
                    <UserCheck className="w-4 h-4" /> My Blitzes
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {myBlitzes.map((b, i) => <BlitzCard key={b.id} blitz={b} currentUserId={effectiveRepId} isAdmin={false} onJoin={handleJoinBlitz} index={i} />)}
                  </div>
                </div>
              )}

              {/* Pending join requests */}
              {pendingBlitzes.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-[#c2c8d8] uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-400" /> Pending Approval
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {pendingBlitzes.map((b, i) => <BlitzCard key={b.id} blitz={b} currentUserId={effectiveRepId} isAdmin={false} onJoin={handleJoinBlitz} index={i} />)}
                  </div>
                </div>
              )}

              {/* Browse available */}
              {browseBlitzes.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-[#c2c8d8] uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Search className="w-4 h-4" /> Browse Available
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {browseBlitzes.map((b, i) => <BlitzCard key={b.id} blitz={b} currentUserId={effectiveRepId} isAdmin={false} onJoin={handleJoinBlitz} index={i} />)}
                  </div>
                </div>
              )}

              {myBlitzes.length === 0 && pendingBlitzes.length === 0 && browseBlitzes.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 gap-3 rounded-xl" style={{ background: 'rgba(22,25,32,0.5)', border: '1px dashed #272b35' }}>
                  <Tent className="w-16 h-16" style={{ color: '#525c72' }} />
                  <div className="text-center">
                    <p className="text-lg font-semibold" style={{ color: '#f0f2f7' }}>No blitzes available</p>
                    <p className="text-sm mt-1" style={{ color: '#8891a8' }}>{search || statusFilter !== 'all' ? 'Try adjusting your filters' : 'Check back soon for upcoming blitzes'}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'requests' && !isAdmin && userPerms.canRequestBlitz && (
        <div className="space-y-3">
          {requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 rounded-xl" style={{ background: 'rgba(22,25,32,0.5)', border: '1px dashed #272b35' }}>
              <Inbox className="w-14 h-14" style={{ color: '#525c72' }} />
              <div className="text-center">
                <p className="text-lg font-semibold" style={{ color: '#f0f2f7' }}>No requests submitted</p>
                <p className="text-sm mt-1" style={{ color: '#8891a8' }}>Your blitz requests will appear here after submission</p>
              </div>
            </div>
          ) : (
            requests.map((req) => (
              <div key={req.id} className="card-surface rounded-2xl p-5 transition-colors" style={{ background: '#161920', border: '1px solid #272b35' }}>
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {req.type === 'cancel' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-900/30 text-red-300 border border-red-500/20">Cancel Request</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-900/30 text-[#00c4f0] border border-[#00e07a]/20">New Blitz</span>
                      )}
                      <h3 className="text-base font-bold text-white truncate">{req.name}</h3>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-sm text-[#c2c8d8]">
                      {req.type !== 'cancel' && req.location && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 shrink-0" />{req.location}</span>}
                      {req.type !== 'cancel' && <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5 shrink-0" />{formatDate(req.startDate)} — {formatDate(req.endDate)}</span>}
                    </div>
                    {req.notes && <p className="text-sm text-[#8891a8] mt-2 line-clamp-2">{req.notes}</p>}
                  </div>
                  <span className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${req.status === 'approved' ? 'bg-emerald-900/30 text-emerald-300 border border-[#00e07a]/20' : req.status === 'denied' ? 'bg-red-900/30 text-red-300 border border-red-500/20' : 'bg-amber-900/30 text-amber-300 border border-amber-500/20'}`}>
                    {req.status === 'approved' ? <CheckCircle className="w-3 h-3" /> : req.status === 'denied' ? <XCircle className="w-3 h-3" /> : <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
                    {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'requests' && isAdmin && (
        <div className="space-y-3">
          {requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 rounded-xl" style={{ background: 'rgba(22,25,32,0.5)', border: '1px dashed #272b35' }}>
              <Inbox className="w-14 h-14" style={{ color: '#525c72' }} />
              <div className="text-center">
                <p className="text-lg font-semibold" style={{ color: '#f0f2f7' }}>No blitz requests</p>
                <p className="text-sm mt-1" style={{ color: '#8891a8' }}>Requests from reps will appear here for approval</p>
              </div>
            </div>
          ) : (
            <>
              {paginatedRequests.map((req) => (
                <div key={req.id} className="card-surface rounded-2xl p-5 transition-colors" style={{ background: '#161920', border: '1px solid #272b35' }}>
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {req.type === 'cancel' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-900/30 text-red-300 border border-red-500/20">Cancel Request</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-900/30 text-[#00c4f0] border border-[#00e07a]/20">New Blitz</span>
                        )}
                        <h3 className="text-base font-bold text-white truncate">{req.name}</h3>
                        {req.status === 'pending' && <span className="shrink-0 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-sm text-[#c2c8d8]">
                        {req.type !== 'cancel' && req.location && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 shrink-0" />{req.location}</span>}
                        {req.type !== 'cancel' && <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5 shrink-0" />{formatDate(req.startDate)} — {formatDate(req.endDate)}</span>}
                        {req.type !== 'cancel' && <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5 shrink-0" />{req.expectedHeadcount} expected</span>}
                      </div>
                      {req.notes && <p className="text-sm text-[#8891a8] mt-2 line-clamp-2">{req.notes}</p>}
                      <p className="text-xs text-[#525c72] mt-2">Requested by <span className="text-[#c2c8d8]">{req.requestedBy.firstName} {req.requestedBy.lastName}</span></p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {req.status === 'pending' ? (
                        <>
                          <button onClick={() => handleApproveRequest(req.id)} disabled={processingRequest === req.id} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#00e07a] text-black rounded-lg hover:bg-[#00e07a] disabled:opacity-50 transition-colors">
                            {processingRequest === req.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />} Approve
                          </button>
                          <button onClick={() => handleDenyRequest(req.id)} disabled={processingRequest === req.id} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-red-600/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-600/30 disabled:opacity-50 transition-colors">
                            <XCircle className="w-3 h-3" /> Deny
                          </button>
                        </>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${req.status === 'approved' ? 'bg-emerald-900/30 text-emerald-300 border border-[#00e07a]/20' : 'bg-red-900/30 text-red-300 border border-red-500/20'}`}>
                          {req.status === 'approved' ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {requestTotal > requestPerPage && (
                <PaginationBar
                  totalResults={requestTotal}
                  startIdx={requestStart}
                  endIdx={requestEnd}
                  currentPage={requestPage}
                  totalPages={requestPages}
                  rowsPerPage={requestPerPage}
                  onPageChange={setRequestPage}
                  onRowsPerPageChange={setRequestPerPage}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (isAdmin || !!(effectiveRepId ?? currentRepId)) && (
        <CreateBlitzModal
          onClose={() => setShowCreate(false)}
          onCreated={loadData}
          userId={effectiveRepId ?? currentRepId ?? ''}
          reps={reps}
          isAdmin={isAdmin}
        />
      )}

      {/* Request Blitz modal */}
      {showRequestBlitz && (
        <RequestBlitzModal
          onClose={() => setShowRequestBlitz(false)}
          onSubmitted={loadData}
          userId={effectiveRepId ?? ''}
        />
      )}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function BlitzSkeleton() {
  return (
    <div className="space-y-6 p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 bg-[#1d2028] rounded animate-skeleton" />
            <div className="h-8 w-24 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
          </div>
          <div className="h-3 w-64 bg-[#1d2028]/70 rounded animate-skeleton" style={{ animationDelay: '150ms' }} />
        </div>
        <div className="h-10 w-28 bg-[#1d2028] rounded-xl animate-skeleton" style={{ animationDelay: '100ms' }} />
      </div>

      {/* Stat cards row — 4 cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card-surface rounded-2xl p-5 space-y-3">
            <div className="h-[2px] w-12 bg-[#272b35] rounded-full animate-skeleton" style={{ animationDelay: `${i * 75}ms` }} />
            <div className="h-3 w-16 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: `${i * 75}ms` }} />
            <div className="h-8 w-20 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: `${i * 75 + 40}ms` }} />
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-[#161920] border border-[#333849] rounded-xl p-1 w-fit">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-9 w-24 bg-[#1d2028] rounded-lg animate-skeleton" style={{ animationDelay: `${i * 75}ms` }} />
        ))}
      </div>

      {/* Blitz card grid — 4 placeholders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => {
          const delay = i * 75;
          return (
            <div key={i} className="card-surface rounded-2xl p-5 space-y-4">
              {/* Title + badge row */}
              <div className="flex items-center justify-between">
                <div className="h-5 w-36 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
                <div className="h-5 w-16 bg-[#1d2028] rounded-full animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
              </div>
              {/* Location + dates */}
              <div className="space-y-2">
                <div className="h-3 w-44 bg-[#1d2028]/70 rounded animate-skeleton" style={{ animationDelay: `${delay + 40}ms` }} />
                <div className="h-3 w-32 bg-[#1d2028]/70 rounded animate-skeleton" style={{ animationDelay: `${delay + 80}ms` }} />
              </div>
              {/* Stats row */}
              <div className="flex gap-6">
                {[...Array(3)].map((_, si) => (
                  <div key={si} className="space-y-1">
                    <div className="h-4 w-8 bg-[#1d2028] rounded animate-skeleton" style={{ animationDelay: `${delay + si * 40}ms` }} />
                    <div className="h-3 w-12 bg-[#1d2028]/70 rounded animate-skeleton" style={{ animationDelay: `${delay + si * 40}ms` }} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
