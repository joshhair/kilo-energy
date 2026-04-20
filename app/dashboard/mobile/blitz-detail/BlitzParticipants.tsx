'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo, useState } from 'react';
import { Plus, Trash2, Users, Loader2 } from 'lucide-react';
import MobileBadge from '../shared/MobileBadge';
import MobileListItem from '../shared/MobileListItem';
import MobileEmptyState from '../shared/MobileEmptyState';
import MobileBottomSheet from '../shared/MobileBottomSheet';
import { useToast } from '../../../../lib/toast';
import { sortForSelection } from '../../../../lib/sorting';

interface Rep { id: string; name: string }

interface Props {
  blitzId: string;
  participants: any[];
  reps: Rep[];
  canManage: boolean;
  onRefresh: () => void;
}

export default function BlitzParticipants({ blitzId, participants, reps, canManage, onRefresh }: Props) {
  const { toast } = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [selectedRepId, setSelectedRepId] = useState('');
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);

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
        <div className="rounded-2xl divide-y" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', borderColor: 'var(--m-border, var(--border-mobile))' }}>
          {participants.map((p: any) => {
            const name = `${p.user.firstName} ${p.user.lastName}`;
            const statusBadge = p.joinStatus === 'approved' ? 'Approved' : p.joinStatus === 'pending' ? 'Pending' : 'Denied';
            return (
              <MobileListItem
                key={p.id}
                title={name}
                right={<MobileBadge value={statusBadge} variant="status" />}
                onTap={canManage ? () => setRemoveTarget({ id: p.user.id, name }) : undefined}
              />
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
          <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>This will remove them from the blitz. They can be re-added later.</p>
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
