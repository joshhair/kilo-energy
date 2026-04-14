'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useIsHydrated } from '../../../lib/hooks';
import { formatDate, formatCurrency, formatCompactKW } from '../../../lib/utils';
import { ArrowLeft, Plus, Trash2, FolderKanban, Users, DollarSign, Loader2 } from 'lucide-react';
import MobileBadge from './shared/MobileBadge';
import MobileSection from './shared/MobileSection';
import MobileListItem from './shared/MobileListItem';
import MobileEmptyState from './shared/MobileEmptyState';
import MobileBottomSheet from './shared/MobileBottomSheet';
import { useToast } from '../../../lib/toast';

const COST_CATEGORIES = ['housing', 'travel', 'gas', 'meals', 'incentives', 'swag', 'other'] as const;

const STATUS_BADGE_MAP: Record<string, string> = {
  upcoming: 'Upcoming',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

type TabKey = 'overview' | 'participants' | 'deals' | 'costs';

export default function MobileBlitzDetail({ blitzId }: { blitzId: string }) {
  const router = useRouter();
  const { effectiveRole, effectiveRepId, reps } = useApp();
  const hydrated = useIsHydrated();
  const isAdmin = effectiveRole === 'admin';
  const { toast } = useToast();

  const [blitz, setBlitz] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('overview');

  // Participant management
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [selectedRepId, setSelectedRepId] = useState('');
  const [addingParticipant, setAddingParticipant] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);

  // Cost form
  const [showAddCost, setShowAddCost] = useState(false);
  const [costCategory, setCostCategory] = useState<string>('housing');
  const [costAmount, setCostAmount] = useState('');
  const [costDesc, setCostDesc] = useState('');
  const [costDate, setCostDate] = useState(new Date().toISOString().split('T')[0]);
  const [addingCost, setAddingCost] = useState(false);

  const loadBlitz = useCallback(() => {
    fetch(`/api/blitzes/${blitzId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { router.push('/dashboard/blitz'); return; }
        setBlitz(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [blitzId, router]);

  useEffect(() => { loadBlitz(); }, [loadBlitz]);

  const isOwner = !isAdmin && effectiveRepId != null && blitz?.owner?.id === effectiveRepId;
  const canManage = isAdmin || isOwner;

  const approvedParticipants = blitz?.participants?.filter((p: any) => p.joinStatus === 'approved') ?? [];

  const visibleProjects = useMemo(() => {
    if (!blitz?.projects) return [];
    if (isAdmin || isOwner) return blitz.projects.filter((p: any) => p.phase !== 'Cancelled' && p.phase !== 'On Hold');
    return blitz.projects.filter((p: any) => (p.closer?.id === effectiveRepId || p.setter?.id === effectiveRepId) && p.phase !== 'Cancelled' && p.phase !== 'On Hold');
  }, [blitz?.projects, isAdmin, isOwner, effectiveRepId]);

  const totalDeals = visibleProjects.length;
  const totalKW = visibleProjects.reduce((s: number, p: any) => s + p.kWSize, 0);
  const totalCosts = blitz?.costs?.reduce((s: number, c: any) => s + c.amount, 0) ?? 0;

  const availableReps = useMemo(() => {
    if (!blitz?.participants) return reps;
    const participantIds = new Set(blitz.participants.map((p: any) => p.user.id));
    return reps.filter((r) => r.active && !participantIds.has(r.id));
  }, [reps, blitz?.participants]);

  const handleAddParticipant = async () => {
    if (!selectedRepId) return;
    setAddingParticipant(true);
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
      setShowAddParticipant(false);
      setSelectedRepId('');
      loadBlitz();
    } finally { setAddingParticipant(false); }
  };

  const handleRemoveParticipant = async (userId: string) => {
    const response = await fetch(`/api/blitzes/${blitzId}/participants?userId=${userId}`, { method: 'DELETE' });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      toast(err?.error || 'Failed to remove participant', 'error');
      return;
    }
    toast('Participant removed');
    setRemoveTarget(null);
    loadBlitz();
  };

  const handleAddCost = async () => {
    if (!costAmount || parseFloat(costAmount) <= 0) return;
    setAddingCost(true);
    try {
      await fetch(`/api/blitzes/${blitzId}/costs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: costCategory, amount: parseFloat(costAmount), description: costDesc.trim(), date: costDate }),
      });
      toast('Cost added');
      setCostAmount('');
      setCostDesc('');
      setShowAddCost(false);
      loadBlitz();
    } finally { setAddingCost(false); }
  };

  const handleDeleteCost = async (costId: string) => {
    await fetch(`/api/blitzes/${blitzId}/costs?costId=${costId}`, { method: 'DELETE' });
    toast('Cost removed');
    loadBlitz();
  };

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
  const badgeVariantValue = STATUS_BADGE_MAP[blitz.status] ?? 'Draft';

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'participants', label: 'Participants' },
    { key: 'deals', label: 'Deals' },
    ...(isAdmin ? [{ key: 'costs' as TabKey, label: 'Costs' }] : []),
  ];

  return (
    <div className="px-5 pt-4 pb-24 space-y-4 animate-mobile-slide-in">
      {/* Back button */}
      <button
        onClick={() => router.push('/dashboard/blitz')}
        className="flex items-center gap-1.5 text-base min-h-[48px]"
        style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
      >
        <ArrowLeft className="w-4 h-4" /> Blitz
      </button>

      {/* Header */}
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

      {/* Tab bar */}
      <div className="flex" style={{ borderBottom: '1px solid var(--m-border, var(--border-mobile))' }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex-1 text-center text-base font-medium min-h-[48px] transition-colors"
            style={{
              color: tab === t.key ? 'var(--accent-emerald)' : 'var(--m-text-muted, var(--text-mobile-muted))',
              borderBottom: tab === t.key ? '2px solid var(--accent-emerald)' : '2px solid transparent',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
            <span className="text-lg font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{approvedParticipants.length}</span> participant{approvedParticipants.length !== 1 ? 's' : ''}
            {' \u00B7 '}
            <span className="text-lg font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{totalDeals}</span> deal{totalDeals !== 1 ? 's' : ''}
            {' \u00B7 '}
            <span className="text-lg font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{formatCompactKW(totalKW)}</span>
          </p>

          {blitz.notes && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Notes</p>
              <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{blitz.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Participants ── */}
      {tab === 'participants' && (
        <div className="space-y-4">
          {canManage && (
            <button
              onClick={() => setShowAddParticipant(true)}
              className="flex items-center gap-1.5 text-base font-semibold min-h-[48px]"
              style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
            >
              <Plus className="w-4 h-4" /> Add Participant
            </button>
          )}

          {blitz.participants?.length === 0 ? (
            <MobileEmptyState icon={Users} title="No participants yet" subtitle="Add reps to this blitz" />
          ) : (
            <div className="rounded-2xl divide-y" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', borderColor: 'var(--m-border, var(--border-mobile))' }}>
              {blitz.participants.map((p: any) => {
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

          {/* Add Participant bottom sheet */}
          <MobileBottomSheet open={showAddParticipant} onClose={() => setShowAddParticipant(false)} title="Add Participant">
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
                onClick={handleAddParticipant}
                disabled={!selectedRepId || addingParticipant}
                className="w-full flex items-center justify-center gap-1.5 min-h-[48px] text-base font-semibold text-black rounded-lg disabled:opacity-40 transition-colors"
                style={{
                  background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))',
                  boxShadow: '0 0 20px rgba(0,229,160,0.3)',
                  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                }}
              >
                {addingParticipant ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {addingParticipant ? 'Adding...' : 'Add'}
              </button>
            </div>
          </MobileBottomSheet>

          {/* Remove Participant bottom sheet */}
          <MobileBottomSheet open={!!removeTarget} onClose={() => setRemoveTarget(null)} title={removeTarget ? `Remove ${removeTarget.name}?` : undefined}>
            <div className="px-5 space-y-4">
              <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>This will remove them from the blitz. They can be re-added later.</p>
              <button
                onClick={() => removeTarget && handleRemoveParticipant(removeTarget.id)}
                className="w-full flex items-center justify-center gap-1.5 min-h-[48px] text-base font-semibold text-white rounded-lg transition-colors"
                style={{ background: 'var(--m-danger, var(--accent-danger))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
              >
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>
          </MobileBottomSheet>
        </div>
      )}

      {/* ── Deals ── */}
      {tab === 'deals' && (
        <div className="space-y-4">
          {visibleProjects.length === 0 ? (
            <MobileEmptyState icon={FolderKanban} title="No deals yet" subtitle="Deals attributed to this blitz will appear here" />
          ) : (
            <div className="rounded-2xl divide-y" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', borderColor: 'var(--m-border, var(--border-mobile))' }}>
              {visibleProjects.map((p: any) => (
                <MobileListItem
                  key={p.id}
                  title={p.customerName}
                  subtitle={`${p.kWSize.toFixed(1)} kW`}
                  right={<MobileBadge value={p.phase} variant="phase" />}
                  onTap={() => router.push(`/dashboard/projects/${p.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Costs (admin only) ── */}
      {tab === 'costs' && isAdmin && (
        <div className="space-y-4">
          <button
            onClick={() => setShowAddCost(true)}
            className="flex items-center gap-1.5 text-base font-semibold min-h-[48px]"
            style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            <Plus className="w-4 h-4" /> Add Cost
          </button>

          {blitz.costs?.length === 0 ? (
            <MobileEmptyState icon={DollarSign} title="No costs recorded" subtitle="Track blitz expenses here" />
          ) : (
            <div>
              {blitz.costs.map((c: any) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between min-h-[48px] py-3 last:border-b-0"
                  style={{ borderBottom: '1px solid var(--m-border, var(--border-mobile))' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold capitalize" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{c.category}</span>
                      {c.description && (
                        <span className="text-base truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>&middot; {c.description}</span>
                      )}
                    </div>
                    <p className="text-base mt-0.5" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{formatDate(c.date)}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <span className="text-lg font-bold text-white tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{formatCurrency(c.amount)}</span>
                    <button
                      onClick={() => handleDeleteCost(c.id)}
                      className="p-2 active:opacity-70 min-w-[44px] min-h-[44px] flex items-center justify-center"
                      style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-3">
                <span className="text-base font-semibold" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Total</span>
                <span className="text-lg font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{formatCurrency(totalCosts)}</span>
              </div>
            </div>
          )}

          {/* Add Cost bottom sheet */}
          <MobileBottomSheet open={showAddCost} onClose={() => setShowAddCost(false)} title="Add Cost">
            <div className="px-5 space-y-4">
              <div>
                <label className="block text-xs mb-1 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Category</label>
                <select
                  value={costCategory}
                  onChange={(e) => setCostCategory(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-base text-white min-h-[48px] focus:outline-none focus:ring-1"
                  style={{
                    background: 'var(--m-card, var(--surface-mobile-card))',
                    border: '1px solid var(--m-border, var(--border-mobile))',
                    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                    '--tw-ring-color': 'var(--accent-emerald)',
                  } as React.CSSProperties}
                >
                  {COST_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Amount</label>
                <input
                  type="number"
                  value={costAmount}
                  onChange={(e) => setCostAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg px-3 py-2 text-base text-white min-h-[48px] focus:outline-none focus:ring-1"
                  style={{
                    background: 'var(--m-card, var(--surface-mobile-card))',
                    border: '1px solid var(--m-border, var(--border-mobile))',
                    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                    '--tw-ring-color': 'var(--accent-emerald)',
                  } as React.CSSProperties}
                />
              </div>
              <div>
                <label className="block text-xs mb-1 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Description</label>
                <input
                  value={costDesc}
                  onChange={(e) => setCostDesc(e.target.value)}
                  placeholder="Optional"
                  className="w-full rounded-lg px-3 py-2 text-base text-white min-h-[48px] focus:outline-none focus:ring-1"
                  style={{
                    background: 'var(--m-card, var(--surface-mobile-card))',
                    border: '1px solid var(--m-border, var(--border-mobile))',
                    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                    '--tw-ring-color': 'var(--accent-emerald)',
                  } as React.CSSProperties}
                />
              </div>
              <div>
                <label className="block text-xs mb-1 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Date</label>
                <input
                  type="date"
                  value={costDate}
                  onChange={(e) => setCostDate(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-base text-white min-h-[48px] focus:outline-none focus:ring-1"
                  style={{
                    background: 'var(--m-card, var(--surface-mobile-card))',
                    border: '1px solid var(--m-border, var(--border-mobile))',
                    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                    '--tw-ring-color': 'var(--accent-emerald)',
                  } as React.CSSProperties}
                />
              </div>
              <button
                onClick={handleAddCost}
                disabled={addingCost || !costAmount}
                className="w-full flex items-center justify-center gap-1.5 min-h-[48px] text-base font-semibold text-black rounded-lg disabled:opacity-40 transition-colors"
                style={{
                  background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))',
                  boxShadow: '0 0 20px rgba(0,229,160,0.3)',
                  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                }}
              >
                {addingCost ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {addingCost ? 'Adding...' : 'Add Cost'}
              </button>
            </div>
          </MobileBottomSheet>
        </div>
      )}
    </div>
  );
}
