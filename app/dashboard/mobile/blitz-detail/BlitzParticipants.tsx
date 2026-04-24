'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo, useState } from 'react';
import { Plus, Trash2, Users, Loader2, Check, X } from 'lucide-react';
import MobileBadge from '../shared/MobileBadge';
import MobileEmptyState from '../shared/MobileEmptyState';
import MobileBottomSheet from '../shared/MobileBottomSheet';
import { useToast } from '../../../../lib/toast';
import { sortForSelection } from '../../../../lib/sorting';
import type { LeaderboardEntry } from '../../../../lib/blitzComputed';

interface Rep { id: string; name: string }

interface Props {
  blitzId: string;
  blitzOwnerId?: string;
  participants: any[];
  reps: Rep[];
  canManage: boolean;
  leaderboard: LeaderboardEntry[];
  onRefresh: () => void;
}

export default function BlitzParticipants({ blitzId, blitzOwnerId, participants, reps, canManage, leaderboard, onRefresh }: Props) {
  const { toast } = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [selectedRepId, setSelectedRepId] = useState('');
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [updatingAttendance, setUpdatingAttendance] = useState<Set<string>>(new Set());

  const statsByUserId = useMemo(() => {
    const m = new Map<string, { deals: number; kW: number }>();
    for (const e of leaderboard) m.set(e.userId, { deals: e.deals, kW: e.kW });
    return m;
  }, [leaderboard]);

  const availableReps = useMemo(() => {
    const participantIds = new Set(participants.filter((p: any) => p.joinStatus !== 'declined').map((p: any) => p.user.id));
    return sortForSelection(reps.filter((r) => !participantIds.has(r.id)));
  }, [reps, participants]);

  const handleAdd = async () => {
    if (!selectedRepId) return;
    setAdding(true);
    try {
      const response = await fetch(`/api/blitzes/${blitzId}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedRepId, joinStatus: 'approved' }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        toast(err?.error || 'Failed to add participant', 'error');
        return;
      }
      toast('Participant added');
      setShowAdd(false);
      setSelectedRepId('');
      onRefresh();
    } finally { setAdding(false); }
  };

  const handleRemove = async (userId: string) => {
    const response = await fetch(`/api/blitzes/${blitzId}/participants?userId=${userId}`, { method: 'DELETE' });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      toast(err?.error || 'Failed to remove participant', 'error');
      return;
    }
    toast('Participant removed');
    setRemoveTarget(null);
    onRefresh();
  };

  const handleDecision = async (userId: string, joinStatus: 'approved' | 'declined') => {
    setProcessing((s) => new Set(s).add(userId));
    try {
      const r = await fetch(`/api/blitzes/${blitzId}/participants`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, joinStatus }),
      });
      if (r.ok) { toast(joinStatus === 'approved' ? 'Approved' : 'Declined'); onRefresh(); }
      else toast(`Failed to ${joinStatus === 'approved' ? 'approve' : 'decline'}`, 'error');
    } catch { toast('Network error', 'error'); } finally {
      setProcessing((s) => { const n = new Set(s); n.delete(userId); return n; });
    }
  };

  const handleAttendance = async (userId: string, attendanceStatus: string | null) => {
    setUpdatingAttendance((s) => new Set(s).add(userId));
    try {
      const r = await fetch(`/api/blitzes/${blitzId}/participants`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, attendanceStatus }),
      });
      if (r.ok) { onRefresh(); } else toast('Failed to update attendance', 'error');
    } finally {
      setUpdatingAttendance((s) => { const n = new Set(s); n.delete(userId); return n; });
    }
  };

  return (
    <div className="space-y-4">
      {canManage && (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 text-base font-semibold min-h-[48px]"
          style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
        >
          <Plus className="w-4 h-4" /> Add Participant
        </button>
      )}

      {participants.length === 0 ? (
        <MobileEmptyState icon={Users} title="No participants yet" subtitle="Add reps to this blitz" />
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
          {participants.map((p: any, i: number) => {
            const name = `${p.user.firstName} ${p.user.lastName}`;
            const stats = statsByUserId.get(p.user.id);
            const statusBadge = p.joinStatus === 'approved' ? 'Approved' : p.joinStatus === 'pending' ? 'Pending' : 'Denied';
            const isOwner = p.user.id === blitzOwnerId;
            const showAttendance = canManage && p.joinStatus === 'approved';
            return (
              <div
                key={p.id}
                className="px-4 py-3 min-h-[56px]"
                style={{ borderTop: i > 0 ? '1px solid var(--m-border, var(--border-mobile))' : undefined }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{name}</p>
                      {isOwner && (
                        <span className="text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded" style={{ color: 'var(--accent-emerald)', background: 'rgba(0,229,160,0.12)' }}>Leader</span>
                      )}
                    </div>
                    {stats && p.joinStatus === 'approved' && (stats.deals > 0 || stats.kW > 0) && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                        {stats.deals} deal{stats.deals !== 1 ? 's' : ''} · {stats.kW.toFixed(1)} kW
                      </p>
                    )}
                  </div>
                  <MobileBadge value={statusBadge} variant="status" />
                </div>

                {p.joinStatus === 'pending' && canManage && (
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      disabled={processing.has(p.user.id)}
                      onClick={() => handleDecision(p.user.id, 'approved')}
                      className="flex-1 min-h-[40px] flex items-center justify-center gap-1.5 text-sm font-semibold text-black rounded-lg disabled:opacity-40"
                      style={{ background: 'var(--accent-emerald)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                    >
                      <Check className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button
                      disabled={processing.has(p.user.id)}
                      onClick={() => handleDecision(p.user.id, 'declined')}
                      className="flex-1 min-h-[40px] flex items-center justify-center gap-1.5 text-sm font-semibold rounded-lg disabled:opacity-40"
                      style={{ color: 'var(--m-danger, var(--accent-danger))', border: '1px solid var(--m-danger, var(--accent-danger))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                    >
                      <X className="w-3.5 h-3.5" /> Decline
                    </button>
                  </div>
                )}

                {showAttendance && (
                  <div className="flex items-center gap-2 mt-3">
                    {(['attended', 'partial', 'no-show'] as const).map((s) => {
                      const active = (p.attendanceStatus ?? '') === s;
                      return (
                        <button
                          key={s}
                          disabled={updatingAttendance.has(p.user.id)}
                          onClick={() => handleAttendance(p.user.id, active ? null : s)}
                          className="flex-1 min-h-[36px] text-xs font-semibold rounded-lg transition-colors disabled:opacity-40 px-2"
                          style={{
                            color: active ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
                            background: active ? 'var(--accent-emerald)' : 'transparent',
                            border: `1px solid ${active ? 'var(--accent-emerald)' : 'var(--m-border, var(--border-mobile))'}`,
                            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                          }}
                        >
                          {s === 'no-show' ? 'No-show' : s.charAt(0).toUpperCase() + s.slice(1)}
                        </button>
                      );
                    })}
                  </div>
                )}

                {canManage && !isOwner && p.joinStatus !== 'pending' && (
                  <button
                    onClick={() => setRemoveTarget({ id: p.user.id, name })}
                    className="mt-3 text-xs font-semibold flex items-center gap-1 min-h-[32px]"
                    style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                  >
                    <Trash2 className="w-3 h-3" /> Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <MobileBottomSheet open={showAdd} onClose={() => setShowAdd(false)} title="Add Participant">
        <div className="px-5 space-y-4">
          <select
            value={selectedRepId}
            onChange={(e) => setSelectedRepId(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-base text-white min-h-[48px] focus:outline-none focus:ring-1"
            style={{
              background: 'var(--m-card, var(--surface-mobile-card))',
              border: '1px solid var(--m-border, var(--border-mobile))',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              '--tw-ring-color': 'var(--accent-emerald)',
            } as React.CSSProperties}
          >
            <option value="">Select a rep...</option>
            {availableReps.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={!selectedRepId || adding}
            className="w-full flex items-center justify-center gap-1.5 min-h-[48px] text-base font-semibold text-black rounded-lg disabled:opacity-40 transition-colors"
            style={{
              background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))',
              boxShadow: '0 0 20px rgba(0,229,160,0.3)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {adding ? 'Adding...' : 'Add'}
          </button>
        </div>
      </MobileBottomSheet>

      <MobileBottomSheet open={!!removeTarget} onClose={() => setRemoveTarget(null)} title={removeTarget ? `Remove ${removeTarget.name}?` : undefined}>
        <div className="px-5 space-y-4">
          <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>This will remove them from the blitz. Deals where their co-participant is also no longer in the blitz will be unlinked.</p>
          <button
            onClick={() => removeTarget && handleRemove(removeTarget.id)}
            className="w-full flex items-center justify-center gap-1.5 min-h-[48px] text-base font-semibold text-white rounded-lg transition-colors"
            style={{ background: 'var(--m-danger, var(--accent-danger))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            <Trash2 className="w-4 h-4" /> Remove
          </button>
        </div>
      </MobileBottomSheet>
    </div>
  );
}
