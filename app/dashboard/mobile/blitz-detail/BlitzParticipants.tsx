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
      // Owner-initiated adds default to 'invited' — rep must confirm
      // attendance before they count as approved.
      const response = await fetch(`/api/blitzes/${blitzId}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedRepId, joinStatus: 'invited' }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        toast(err?.error || 'Failed to invite participant', 'error');
        return;
      }
      toast('Invitation sent');
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
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 min-h-[40px] rounded-full text-[13px] font-medium tracking-wide active:scale-[0.98] transition-all"
          style={{
            color: 'var(--accent-emerald-text)',
            background: 'transparent',
            border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 35%, transparent)',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          }}
        >
          <Plus className="w-3.5 h-3.5" /> Add participant
        </button>
      )}

      {participants.length === 0 ? (
        <MobileEmptyState icon={Users} title="No participants yet" subtitle="Add reps to this blitz" />
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
          {participants.map((p: any, i: number) => {
            const name = `${p.user.firstName} ${p.user.lastName}`;
            const stats = statsByUserId.get(p.user.id);
            const statusBadge = p.joinStatus === 'approved' ? 'Approved' : p.joinStatus === 'pending' ? 'Pending' : p.joinStatus === 'invited' ? 'Invited' : p.joinStatus === 'waitlist' ? 'Waitlist' : 'Denied';
            const isOwner = p.user.id === blitzOwnerId;
            // Attendance pills only render for non-owner approved
            // participants — the leader marks others, not themselves.
            const showAttendance = canManage && p.joinStatus === 'approved' && !isOwner;
            return (
              <div
                key={p.id}
                className="px-4 py-3 min-h-[56px]"
                style={{ borderTop: i > 0 ? '1px solid var(--border-subtle)' : undefined }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-base font-semibold text-[var(--text-primary)] line-clamp-2 break-words" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{name}</p>
                      {isOwner && (
                        <span className="text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded" style={{ color: 'var(--accent-emerald-text)', background: 'var(--accent-emerald-soft)' }}>Leader</span>
                      )}
                    </div>
                    {stats && p.joinStatus === 'approved' && (stats.deals > 0 || stats.kW > 0) && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
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
                      style={{ background: 'var(--accent-emerald-solid)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                    >
                      <Check className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button
                      disabled={processing.has(p.user.id)}
                      onClick={() => handleDecision(p.user.id, 'declined')}
                      className="flex-1 min-h-[40px] flex items-center justify-center gap-1.5 text-sm font-semibold rounded-lg disabled:opacity-40"
                      style={{ color: 'var(--accent-red-text)', border: '1px solid var(--accent-red-solid)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                    >
                      <X className="w-3.5 h-3.5" /> Decline
                    </button>
                  </div>
                )}

                {p.joinStatus === 'waitlist' && canManage && (
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      disabled={processing.has(p.user.id)}
                      onClick={() => handleDecision(p.user.id, 'approved')}
                      className="flex-1 min-h-[40px] flex items-center justify-center gap-1.5 text-sm font-semibold text-black rounded-lg disabled:opacity-40"
                      style={{ background: 'var(--accent-emerald-solid)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                    >
                      <Check className="w-3.5 h-3.5" /> Approve
                    </button>
                  </div>
                )}

                {p.joinStatus === 'invited' && canManage && (
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      disabled={processing.has(p.user.id)}
                      onClick={() => handleDecision(p.user.id, 'approved')}
                      className="flex-1 min-h-[40px] flex items-center justify-center gap-1.5 text-sm font-semibold text-black rounded-lg disabled:opacity-40"
                      style={{ background: 'var(--accent-emerald-solid)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
                    >
                      <Check className="w-3.5 h-3.5" /> Approve
                    </button>
                  </div>
                )}

                {/* Attendance select + Remove on one row. Was three pill
                    buttons in a flex-wrap — at 393px they wrapped raggedly
                    next to the trash icon ("bubbles are odd", Josh feedback
                    2026-06-11). A single native select can't wrap, matches
                    the desktop table's attendance control, and the empty
                    option replicates tap-to-clear. */}
                {(showAttendance || (canManage && !isOwner && p.joinStatus !== 'pending')) && (
                  <div className="flex items-center justify-between gap-2 mt-3">
                    {showAttendance ? (
                      <select
                        value={p.attendanceStatus ?? ''}
                        disabled={updatingAttendance.has(p.user.id)}
                        onChange={(e) => handleAttendance(p.user.id, e.target.value === '' ? null : (e.target.value as 'attended' | 'partial' | 'no-show'))}
                        aria-label={`Attendance for ${name}`}
                        className="flex-1 min-w-0 min-h-[40px] rounded-xl px-3 text-xs font-semibold outline-none appearance-none disabled:opacity-40"
                        style={{
                          color: p.attendanceStatus ? 'var(--accent-emerald-text)' : 'var(--text-muted)',
                          background: p.attendanceStatus ? 'var(--accent-emerald-soft)' : 'transparent',
                          border: `1px solid ${p.attendanceStatus ? 'color-mix(in srgb, var(--accent-emerald-solid) 55%, transparent)' : 'var(--border-subtle)'}`,
                          fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                        }}
                      >
                        <option value="">Attendance: not marked</option>
                        <option value="attended">Attended</option>
                        <option value="partial">Partial</option>
                        <option value="no-show">No-show</option>
                      </select>
                    ) : <span />}
                    {canManage && !isOwner && p.joinStatus !== 'pending' && (
                      <button
                        onClick={() => setRemoveTarget({ id: p.user.id, name })}
                        aria-label={`Remove ${name}`}
                        className="shrink-0 flex items-center justify-center active:opacity-60 transition-opacity"
                        style={{
                          width: 32, height: 32, borderRadius: 8,
                          color: 'var(--text-dim)',
                          background: 'transparent',
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
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
            className="w-full rounded-lg px-3 py-2 text-base text-[var(--text-primary)] min-h-[48px] focus:outline-none focus:ring-1"
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              '--tw-ring-color': 'var(--accent-emerald-solid)',
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
              background: 'var(--accent-emerald-solid)',
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
          <p className="text-base" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>This will remove them from the blitz. Deals where their co-participant is also no longer in the blitz will be unlinked.</p>
          <button
            onClick={() => removeTarget && handleRemove(removeTarget.id)}
            className="w-full flex items-center justify-center gap-1.5 min-h-[48px] text-base font-semibold text-[var(--text-primary)] rounded-lg transition-colors"
            style={{ background: 'var(--accent-red-solid)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            <Trash2 className="w-4 h-4" /> Remove
          </button>
        </div>
      </MobileBottomSheet>
    </div>
  );
}
