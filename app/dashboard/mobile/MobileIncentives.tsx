'use client';

import { useMemo, useRef, useState } from 'react';
import { useApp } from '../../../lib/context';
import {
  computeIncentiveProgress,
  formatIncentiveMetric,
  Incentive,
} from '../../../lib/data';
import { useToast } from '../../../lib/toast';
import { Trophy, Plus, Zap, Square, CheckSquare, Archive, Download } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileSection from './shared/MobileSection';
import MobileEmptyState from './shared/MobileEmptyState';
import IncentiveCard from './shared/IncentiveCard';
import CreateIncentiveSheet from './shared/CreateIncentiveSheet';
import EditIncentiveSheet from './shared/EditIncentiveSheet';

// ─── Helpers ────────────────────────────────────────────────────────────────

function isExpired(endDate: string | null): boolean {
  if (!endDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = endDate.split('-').map(Number);
  const end = new Date(y, m - 1, d);
  return end < today;
}

function isEndingSoon(endDate: string | null): boolean {
  if (!endDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = endDate.split('-').map(Number);
  const end = new Date(y, m - 1, d);
  if (end < today) return false;
  const diff = (end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  return diff <= 7;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function MobileIncentives() {
  const {
    effectiveRole,
    effectiveRepId,
    incentives,
    setIncentives,
    projects,
    payrollEntries,
    reps,
  } = useApp();
  const { toast } = useToast();

  const isAdmin = effectiveRole === 'admin';
  const [showCreate, setShowCreate] = useState(false);
  const [editingIncentive, setEditingIncentive] = useState<Incentive | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'expired' | 'ending_soon'>('all');
  const [sort, setSort] = useState<'newest' | 'progress' | 'ending_soonest'>('newest');
  const [listVersion, setListVersion] = useState(0);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const [fulfillingKeys, setFulfillingKeys] = useState<Set<string>>(new Set());
  const [listFading, setListFading] = useState(false);
  const listFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pending Rewards — admin-only. Milestones where progress crossed the
  // threshold but admin hasn't yet flipped achieved=true. Parity with
  // the desktop incentives page.
  //
  // Hook order rule: this useMemo must run on EVERY render, including
  // when the PM guard below returns early. Placing it above the early
  // return keeps the hook ordering stable — React counts hook calls by
  // position, and a conditional hook triggers "called conditionally"
  // rules-of-hooks violations.
  const pendingRewards = useMemo(() => {
    if (!isAdmin) return [] as { incentive: Incentive; milestone: Incentive['milestones'][number]; progress: number }[];
    const items: { incentive: Incentive; milestone: Incentive['milestones'][number]; progress: number }[] = [];
    for (const inc of incentives) {
      if (!inc.active || isExpired(inc.endDate)) continue;
      const progress = computeIncentiveProgress(inc, projects, payrollEntries);
      for (const ms of inc.milestones) {
        if (progress >= ms.threshold && !ms.achieved) {
          items.push({ incentive: inc, milestone: ms, progress });
        }
      }
    }
    return items;
  }, [isAdmin, incentives, projects, payrollEntries]);

  // PM guard — rendered AFTER hooks so hook ordering stays stable.
  if (effectiveRole === 'project_manager') {
    return (
      <div className="px-5 pt-4 pb-28 space-y-4">
        <MobilePageHeader title="Incentives" />
        <MobileEmptyState
          icon={Trophy}
          title="Access Denied"
          subtitle="You don't have permission to view this page."
        />
      </div>
    );
  }

  // Visible incentives: admin sees all, rep sees active company + their personal
  const visible = isAdmin
    ? incentives
    : incentives.filter(
        (inc) => inc.active && (inc.type === 'company' || (effectiveRepId != null && inc.targetRepId === effectiveRepId))
      );

  const triggerListSwitch = (action: () => void) => {
    if (listFadeTimer.current) clearTimeout(listFadeTimer.current);
    setListFading(true);
    listFadeTimer.current = setTimeout(() => {
      action();
      setListFading(false);
      listFadeTimer.current = null;
    }, 140);
  };

  const filterAndSort = (list: Incentive[]): Incentive[] => {
    let filtered = list;
    if (filter === 'active') filtered = list.filter((i) => !isExpired(i.endDate) && i.active);
    else if (filter === 'ending_soon') filtered = list.filter((i) => isEndingSoon(i.endDate));
    else if (filter === 'expired') filtered = list.filter((i) => isExpired(i.endDate));
    const sorted = [...filtered];
    if (sort === 'newest') {
      sorted.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
    } else if (sort === 'progress') {
      sorted.sort((a, b) => {
        const pA = computeIncentiveProgress(a, projects, payrollEntries);
        const pB = computeIncentiveProgress(b, projects, payrollEntries);
        const maxA = a.milestones.length ? Math.max(...a.milestones.map(m => m.threshold)) : 1;
        const maxB = b.milestones.length ? Math.max(...b.milestones.map(m => m.threshold)) : 1;
        return (pB / maxB) - (pA / maxA);
      });
    } else if (sort === 'ending_soonest') {
      sorted.sort((a, b) => {
        if (!a.endDate && !b.endDate) return 0;
        if (!a.endDate) return 1;
        if (!b.endDate) return -1;
        return a.endDate.localeCompare(b.endDate);
      });
    }
    return sorted;
  };

  const clearSelection = () => { setSelectMode(false); setSelectedIds(new Set()); };
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const expiredActiveCount = visible.filter((i) => isExpired(i.endDate) && i.active).length;

  const handleBulkArchiveExpired = () => {
    const count = expiredActiveCount;
    setConfirmAction({
      title: 'Archive all expired?',
      message: `Deactivate ${count} expired incentive${count !== 1 ? 's' : ''}?`,
      onConfirm: () => {
        const expired = incentives.filter((i) => isExpired(i.endDate) && i.active);
        setIncentives((prev) => prev.map((i) => (isExpired(i.endDate) && i.active ? { ...i, active: false } : i)));
        Promise.all(expired.map((i) =>
          fetch(`/api/incentives/${i.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false }) })
            .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return true; })
            .catch(() => { toast('Failed to archive some incentives', 'error'); setIncentives((prev) => prev.map((x) => x.id === i.id ? { ...x, active: true } : x)); return false; })
        )).then((results) => { const succeeded = results.filter(Boolean).length; if (succeeded > 0) toast(`${succeeded} incentive${succeeded !== 1 ? 's' : ''} archived`); });
        setConfirmAction(null);
      },
    });
  };

  const handleBulkDeactivate = () => {
    const count = selectedIds.size;
    setConfirmAction({
      title: 'Deactivate selected?',
      message: `Deactivate ${count} incentive${count !== 1 ? 's' : ''}?`,
      onConfirm: () => {
        const ids = Array.from(selectedIds);
        const origStates = new Map(incentives.filter((i) => selectedIds.has(i.id)).map((i) => [i.id, i.active]));
        setIncentives((prev) => prev.map((i) => (selectedIds.has(i.id) ? { ...i, active: false } : i)));
        Promise.all(ids.map((id) =>
          fetch(`/api/incentives/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false }) })
            .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return true; })
            .catch(() => { toast('Failed to deactivate some incentives', 'error'); setIncentives((prev) => prev.map((i) => i.id === id ? { ...i, active: origStates.get(id) ?? i.active } : i)); return false; })
        )).then((results) => { const succeeded = results.filter(Boolean).length; if (succeeded > 0) toast(`${succeeded} incentive${succeeded !== 1 ? 's' : ''} deactivated`); });
        clearSelection();
        setConfirmAction(null);
      },
    });
  };

  const handleBulkDelete = () => {
    const count = selectedIds.size;
    setConfirmAction({
      title: 'Delete selected?',
      message: `Permanently delete ${count} incentive${count !== 1 ? 's' : ''}? This cannot be undone.`,
      onConfirm: () => {
        const ids = Array.from(selectedIds);
        const deletedItems = incentives.filter((i) => selectedIds.has(i.id));
        setIncentives((prev) => prev.filter((i) => !selectedIds.has(i.id)));
        Promise.allSettled(ids.map((id) =>
          fetch(`/api/incentives/${id}`, { method: 'DELETE' })
            .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return id; })
        )).then((results) => {
          const failedIds = new Set(ids.filter((_, i) => results[i].status === 'rejected'));
          if (failedIds.size > 0) { toast('Failed to delete some incentives', 'error'); setIncentives((prev) => [...prev, ...deletedItems.filter((i) => failedIds.has(i.id))]); }
          const succeeded = results.filter((r) => r.status === 'fulfilled').length;
          if (succeeded > 0) toast(`${succeeded} incentive${succeeded !== 1 ? 's' : ''} deleted`);
        });
        clearSelection();
        setConfirmAction(null);
      },
    });
  };

  const activeIncentives = filter === 'all' ? filterAndSort(visible.filter((i) => !isExpired(i.endDate))) : [];
  const expiredIncentives = filter === 'all' ? filterAndSort(visible.filter((i) => isExpired(i.endDate))) : [];
  const filteredList = filter !== 'all' ? filterAndSort(visible) : [];

  const markMilestoneFulfilled = (incId: string, milestoneId: string, achieved = true) => {
    // Optimistic — matches the desktop page handler pattern. Toggles achieved
    // locally, then PATCHes the incentive with the updated milestones list.
    const target = incentives.find((i) => i.id === incId);
    if (!target) return;
    const prev = target.milestones;
    const next = target.milestones.map((m) => m.id === milestoneId ? { ...m, achieved } : m);
    setIncentives((list) => list.map((i) => i.id === incId ? { ...i, milestones: next } : i));
    fetch(`/api/incentives/${incId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        milestones: next.map((m) => ({ ...(m.id ? { id: m.id } : {}), threshold: m.threshold, reward: m.reward, achieved: m.achieved })),
      }),
    })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast(achieved ? 'Reward marked fulfilled' : 'Reward unmarked', 'success'); })
      .catch(() => { setIncentives((list) => list.map((i) => i.id === incId ? { ...i, milestones: prev } : i)); toast('Failed to update', 'error'); });
  };

  const handleToggleActive = (inc: Incentive) => {
    const next = !inc.active;
    setIncentives((prev) => prev.map((i) => i.id === inc.id ? { ...i, active: next } : i));
    fetch(`/api/incentives/${inc.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: next }) })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast(next ? 'Incentive activated' : 'Incentive deactivated'); })
      .catch(() => { setIncentives((prev) => prev.map((i) => i.id === inc.id ? { ...i, active: inc.active } : i)); toast('Failed to update incentive', 'error'); });
  };

  const handleDelete = (inc: Incentive) => {
    setConfirmAction({
      title: 'Delete incentive?',
      message: `Permanently delete "${inc.title}"? This cannot be undone.`,
      onConfirm: () => {
        setIncentives((prev) => prev.filter((i) => i.id !== inc.id));
        fetch(`/api/incentives/${inc.id}`, { method: 'DELETE' })
          .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast('Incentive deleted'); })
          .catch(() => { setIncentives((prev) => [...prev, inc]); toast('Failed to delete incentive', 'error'); });
        setConfirmAction(null);
      },
    });
  };

  const handleDuplicate = async (source: Incentive) => {
    try {
      const res = await fetch('/api/incentives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${source.title} (copy)`,
          description: source.description,
          type: source.type,
          metric: source.metric,
          period: source.period,
          startDate: source.startDate,
          endDate: source.endDate,
          targetRepId: source.targetRepId,
          active: true,
          milestones: source.milestones.map((m) => ({ threshold: m.threshold, reward: m.reward })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created: Incentive = await res.json();
      setIncentives((prev) => [...prev, { ...source, id: created.id, milestones: created.milestones }]);
      toast('Incentive duplicated', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to duplicate incentive', 'error');
    }
  };

  const handleEditSave = async (updated: Incentive) => {
    const prev = incentives.find((i) => i.id === updated.id);
    setIncentives((list) => list.map((i) => i.id === updated.id ? updated : i));
    try {
      const res = await fetch(`/api/incentives/${updated.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: updated.title,
          description: updated.description,
          active: updated.active,
          endDate: updated.endDate,
          metric: updated.metric,
          period: updated.period,
          startDate: updated.startDate,
          type: updated.type,
          targetRepId: updated.targetRepId,
          milestones: updated.milestones.map((m) => ({ ...(m.id ? { id: m.id } : {}), threshold: m.threshold, reward: m.reward, achieved: m.achieved })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved: Incentive = await res.json();
      setIncentives((list) => list.map((i) => i.id === updated.id ? { ...i, milestones: saved.milestones } : i));
      setEditingIncentive(null);
      toast('Incentive updated', 'success');
    } catch (err) {
      if (prev) setIncentives((list) => list.map((i) => i.id === updated.id ? prev : i));
      toast(err instanceof Error ? err.message : 'Failed to save incentive', 'error');
    }
  };

  return (
    <div className="px-5 pt-4 pb-28 space-y-4">
      <MobilePageHeader
        title="Incentives"
        right={isAdmin ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const escape = (val: string) => `"${val.replace(/"/g, '""')}"`;
                const toCSV = (headers: string[], rows: string[][]) =>
                  [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
                const rows: string[][] = incentives.map((inc) => {
                  const progress = computeIncentiveProgress(inc, projects, payrollEntries);
                  const maxThreshold = inc.milestones.length > 0 ? Math.max(...inc.milestones.map((m) => m.threshold)) : 0;
                  const pctComplete = maxThreshold > 0 ? Math.min(100, Math.round((progress / maxThreshold) * 100)) : 0;
                  const milestonesAchieved = inc.milestones.filter((m) => m.achieved).length;
                  const status = isExpired(inc.endDate) ? 'Expired' : isEndingSoon(inc.endDate) ? 'Ending Soon' : 'Active';
                  return [
                    inc.title,
                    inc.type === 'company' ? 'Company' : 'Personal',
                    inc.metric,
                    inc.period,
                    inc.startDate || '',
                    inc.endDate || '',
                    status,
                    String(progress),
                    String(maxThreshold),
                    String(pctComplete),
                    String(milestonesAchieved),
                    String(inc.milestones.length),
                  ];
                });
                const csv = toCSV(
                  ['Title', 'Type', 'Metric', 'Period', 'Start Date', 'End Date', 'Status', 'Progress Value', 'Max Threshold', '% Complete', 'Milestones Achieved', 'Total Milestones'],
                  rows,
                );
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const _d = new Date(); const _ds = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`;
                a.href = url; a.download = `kilo_incentives_${_ds}.csv`; a.click();
                URL.revokeObjectURL(url);
                toast('Incentives CSV exported', 'info');
              }}
              aria-label="Export CSV"
              className="w-10 h-10 rounded-full flex items-center justify-center active:scale-[0.92] transition-transform"
              style={{
                background: 'color-mix(in srgb, var(--accent-cyan-solid) 14%, var(--surface-card))',
                border: '1px solid color-mix(in srgb, var(--accent-cyan-solid) 32%, transparent)',
              }}
            >
              <Download className="w-4 h-4" style={{ color: 'var(--accent-cyan-text)' }} />
            </button>
            <button
              onClick={() => setShowCreate(true)}
              aria-label="Add incentive"
              className="w-10 h-10 rounded-full flex items-center justify-center active:scale-[0.92] transition-transform"
              style={{
                background: 'color-mix(in srgb, var(--accent-emerald-solid) 14%, var(--surface-card))',
                border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 32%, transparent)',
              }}
            >
              <Plus className="w-5 h-5" style={{ color: 'var(--accent-emerald-text)' }} />
            </button>
          </div>
        ) : undefined}
      />

      {/* Filter / Sort / Select toolbar */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <select
            value={filter}
            onChange={(e) => triggerListSwitch(() => { setFilter(e.target.value as typeof filter); clearSelection(); setListVersion(v => v + 1); })}
            className="flex-1 px-3 py-2 rounded-lg text-sm focus:outline-none"
            style={{ background: 'var(--m-surface, var(--surface))', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="ending_soon">Ending Soon</option>
          </select>
          <select
            value={sort}
            onChange={(e) => triggerListSwitch(() => { setSort(e.target.value as typeof sort); clearSelection(); setListVersion(v => v + 1); })}
            className="flex-1 px-3 py-2 rounded-lg text-sm focus:outline-none"
            style={{ background: 'var(--m-surface, var(--surface))', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
          >
            <option value="newest">Newest</option>
            <option value="progress">Progress %</option>
            <option value="ending_soonest">Ending Soonest</option>
          </select>
          {isAdmin && (
            <button
              onClick={() => { if (selectMode) clearSelection(); else setSelectMode(true); }}
              className="flex items-center justify-center w-10 shrink-0 rounded-lg"
              style={selectMode
                ? { background: 'color-mix(in srgb, var(--accent-cyan-solid) 15%, transparent)', color: 'var(--accent-cyan-text)', border: '1px solid color-mix(in srgb, var(--accent-cyan-solid) 30%, transparent)' }
                : { background: 'var(--m-surface, var(--surface))', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }
              }
            >
              {selectMode ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            </button>
          )}
        </div>
        {isAdmin && expiredActiveCount > 0 && (
          <button
            onClick={handleBulkArchiveExpired}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
            style={{ background: 'color-mix(in srgb, var(--accent-amber-solid) 10%, transparent)', color: 'var(--accent-amber, #f5a623)', border: '1px solid color-mix(in srgb, var(--accent-amber-solid) 25%, transparent)' }}
          >
            <Archive className="w-3.5 h-3.5" />
            Archive All Expired ({expiredActiveCount})
          </button>
        )}
        {isAdmin && selectMode && selectedIds.size > 0 && (
          <div className="flex items-center gap-2 animate-fade-in-up">
            <span className="flex-1 text-xs" style={{ color: 'var(--text-muted)' }}>{selectedIds.size} selected</span>
            <button
              onClick={handleBulkDeactivate}
              className="px-3 py-2 rounded-lg text-xs font-semibold"
              style={{ background: 'color-mix(in srgb, var(--accent-amber-solid) 10%, transparent)', color: 'var(--accent-amber, #f5a623)', border: '1px solid color-mix(in srgb, var(--accent-amber-solid) 25%, transparent)' }}
            >
              Deactivate
            </button>
            <button
              onClick={handleBulkDelete}
              className="px-3 py-2 rounded-lg text-xs font-semibold"
              style={{ background: 'color-mix(in srgb, var(--accent-red-solid) 10%, transparent)', color: 'var(--accent-red-text)', border: '1px solid color-mix(in srgb, var(--accent-red-solid) 25%, transparent)' }}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      <div className={`incentives-list-transition${listFading ? ' is-fading' : ''}`}>
      {/* Pending Rewards (admin only) — milestones whose progress crossed
          the threshold but haven't been marked achieved yet. One-tap
          "Mark Fulfilled" matches the desktop page. */}
      {isAdmin && pendingRewards.length > 0 && (
        <MobileSection title="Pending Rewards" count={pendingRewards.length} collapsible defaultOpen>
          <div className="space-y-2">
            {pendingRewards.map(({ incentive, milestone }, idx) => {
              const rowKey = `${incentive.id}-${milestone.id}`;
              const isFulfilling = fulfillingKeys.has(rowKey);
              return (
                <div
                  key={rowKey}
                  className="animate-fade-in-up"
                  style={{
                    animationDelay: `${idx * 60}ms`,
                    transition: 'opacity 280ms ease-out, transform 280ms cubic-bezier(0.16, 1, 0.3, 1)',
                    opacity: isFulfilling ? 0 : 1,
                    transform: isFulfilling ? 'scale(0.95)' : 'scale(1)',
                    pointerEvents: isFulfilling ? 'none' : undefined,
                  }}
                >
                  <div className="rounded-2xl px-4 py-3" style={{ background: 'color-mix(in srgb, var(--accent-amber-solid) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber-solid) 22%, transparent)' }}>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--accent-amber-solid) 20%, transparent)' }}>
                          <Zap className="w-4 h-4" style={{ color: 'var(--accent-amber-text)' }} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2 break-words">{incentive.title}</p>
                          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                            At {formatIncentiveMetric(incentive.metric, milestone.threshold)}
                            <span style={{ color: 'var(--accent-amber-text)' }}> · {milestone.reward}</span>
                          </p>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setFulfillingKeys(prev => new Set([...prev, rowKey]));
                        markMilestoneFulfilled(incentive.id, milestone.id);
                      }}
                      className="w-full min-h-[44px] rounded-lg text-xs font-semibold touch-manipulation motion-safe:transition-transform motion-safe:duration-[120ms] motion-safe:ease-out active:scale-[0.96]"
                      style={{ background: 'var(--accent-emerald-soft)', color: 'var(--accent-emerald-text)' }}
                    >
                      Mark Fulfilled
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </MobileSection>
      )}

      {/* Filtered list (when filter is not 'all') */}
      {filter !== 'all' && (
        <MobileSection title={filter === 'active' ? 'Active' : filter === 'expired' ? 'Expired' : 'Ending Soon'} count={filteredList.length}>
          {filteredList.length === 0 ? (
            <MobileEmptyState icon={Trophy} title="No incentives match this filter" subtitle="Try a different filter." />
          ) : (
            <div className="space-y-3">
              {filteredList.map((inc, idx) => (
                <div
                  key={`${inc.id}-${listVersion}`}
                  className="animate-fade-in-up"
                  style={{ animationDelay: `${idx * 45}ms` }}
                >
                  <IncentiveCard incentive={inc} projects={projects} payrollEntries={payrollEntries} reps={reps} expired={isExpired(inc.endDate)} endingSoon={isEndingSoon(inc.endDate)} isAdmin={isAdmin} onEdit={() => setEditingIncentive(inc)} onDuplicate={() => handleDuplicate(inc)} onToggleActive={() => handleToggleActive(inc)} onDelete={() => handleDelete(inc)} selectMode={selectMode} selected={selectedIds.has(inc.id)} onToggleSelect={toggleSelect} />
                </div>
              ))}
            </div>
          )}
        </MobileSection>
      )}

      {/* Active Incentives (filter === 'all') */}
      {filter === 'all' && (
        <MobileSection title="Active Incentives" count={activeIncentives.length}>
          {activeIncentives.length === 0 ? (
            <MobileEmptyState
              icon={Trophy}
              title="No active incentives"
              subtitle="Check back later for new challenges."
            />
          ) : (
            <div className="space-y-3">
              {activeIncentives.map((inc, idx) => (
                <div
                  key={`${inc.id}-${listVersion}`}
                  className="animate-fade-in-up"
                  style={{ animationDelay: `${idx * 45}ms` }}
                >
                  <IncentiveCard incentive={inc} projects={projects} payrollEntries={payrollEntries} reps={reps} endingSoon={isEndingSoon(inc.endDate)} isAdmin={isAdmin} onEdit={() => setEditingIncentive(inc)} onDuplicate={() => handleDuplicate(inc)} onToggleActive={() => handleToggleActive(inc)} onDelete={() => handleDelete(inc)} selectMode={selectMode} selected={selectedIds.has(inc.id)} onToggleSelect={toggleSelect} />
                </div>
              ))}
            </div>
          )}
        </MobileSection>
      )}

      {/* Expired / Past Incentives (filter === 'all') */}
      {filter === 'all' && expiredIncentives.length > 0 && (
        <MobileSection title="Past Incentives" count={expiredIncentives.length} collapsible defaultOpen={false}>
          <div className="space-y-3">
            {expiredIncentives.map((inc, idx) => (
              <div
                key={`${inc.id}-${listVersion}`}
                className="animate-fade-in-up"
                style={{ animationDelay: `${idx * 45}ms` }}
              >
                <IncentiveCard incentive={inc} projects={projects} payrollEntries={payrollEntries} reps={reps} expired endingSoon={false} isAdmin={isAdmin} onEdit={() => setEditingIncentive(inc)} onDuplicate={() => handleDuplicate(inc)} onToggleActive={() => handleToggleActive(inc)} onDelete={() => handleDelete(inc)} selectMode={selectMode} selected={selectedIds.has(inc.id)} onToggleSelect={toggleSelect} />
              </div>
            ))}
          </div>
        </MobileSection>
      )}
      </div>

      {/* Admin: edit-incentive bottom sheet */}
      {isAdmin && editingIncentive && (
        <EditIncentiveSheet
          open={!!editingIncentive}
          incentive={editingIncentive}
          onClose={() => setEditingIncentive(null)}
          reps={reps}
          onSaved={handleEditSave}
          onError={(msg) => toast(msg, 'error')}
        />
      )}

      {/* Confirm dialog for bulk operations */}
      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        title={confirmAction?.title ?? ''}
        message={confirmAction?.message ?? ''}
        onConfirm={confirmAction?.onConfirm ?? (() => {})}
      />

      {/* Admin: create-incentive bottom sheet */}
      {isAdmin && (
        <CreateIncentiveSheet
          open={showCreate}
          onClose={() => setShowCreate(false)}
          reps={reps}
          onCreated={(created) => {
            setIncentives((prev) => [...prev, created]);
            toast('Incentive created', 'success');
            setShowCreate(false);
          }}
          onError={(msg) => toast(msg, 'error')}
        />
      )}
    </div>
  );
}
