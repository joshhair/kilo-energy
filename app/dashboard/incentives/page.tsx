'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useApp } from '../../../lib/context';
import { useIsHydrated, useMediaQuery } from '../../../lib/hooks';
import MobileIncentives from '../mobile/MobileIncentives';
import { formatDate } from '../../../lib/utils';
import {
  computeIncentiveProgress,
  formatIncentiveMetric,
  Incentive,
  IncentiveMilestone,
  IncentiveMetric,
  IncentivePeriod,
  IncentiveType,
} from '../../../lib/data';
import { Trophy, Plus, Trash2, X, ChevronDown, ChevronUp, CheckCircle, Clock, AlertTriangle, Pencil, Target, Calendar, Archive, Gift, Zap, Copy, Square, CheckSquare, Download } from 'lucide-react';
import { useToast } from '../../../lib/toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { SearchableSelect } from '../components/SearchableSelect';
import { Breadcrumb } from '../components/Breadcrumb';

// ─── Incentive Templates ──────────────────────────────────────────────────────

interface IncentiveTemplate {
  label: string;
  title: string;
  description: string;
  metric: IncentiveMetric;
  period: IncentivePeriod;
  milestones: { threshold: string; reward: string }[];
}

const INCENTIVE_TEMPLATES: IncentiveTemplate[] = [
  {
    label: 'Monthly Deal Sprint',
    title: 'Monthly Deal Sprint',
    description: 'Close as many deals as possible this month to unlock bonuses',
    metric: 'deals',
    period: 'month',
    milestones: [
      { threshold: '5', reward: '$150 Bonus' },
      { threshold: '10', reward: '$400 Bonus' },
      { threshold: '15', reward: '$750 Bonus + Team Dinner' },
    ],
  },
  {
    label: 'Quarterly kW Target',
    title: 'Quarterly kW Target',
    description: 'Hit kW installation targets this quarter for escalating rewards',
    metric: 'kw',
    period: 'quarter',
    milestones: [
      { threshold: '50', reward: '$300 Bonus' },
      { threshold: '100', reward: '$750 Bonus' },
      { threshold: '150', reward: '$1,500 Bonus + PTO Day' },
    ],
  },
  {
    label: 'Annual Revenue Goal',
    title: 'Annual Revenue Goal',
    description: 'Drive total revenue this year to unlock milestone rewards',
    metric: 'revenue',
    period: 'year',
    milestones: [
      { threshold: '250000', reward: '$1,000 Bonus' },
      { threshold: '500000', reward: '$3,000 Bonus' },
      { threshold: '1000000', reward: '$7,500 Bonus + Trip' },
    ],
  },
  {
    label: 'Commission Milestone',
    title: 'Commission Milestone',
    description: 'Earn commission payouts to unlock bonus tiers',
    metric: 'commission',
    period: 'quarter',
    milestones: [
      { threshold: '5000', reward: '$200 Spiff' },
      { threshold: '15000', reward: '$600 Spiff' },
      { threshold: '30000', reward: '$1,500 Spiff + Award' },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const QUARTERS = [
  { value: 'Q1', label: 'Q1 (Jan - Mar)', startMonth: 0, endMonth: 2 },
  { value: 'Q2', label: 'Q2 (Apr - Jun)', startMonth: 3, endMonth: 5 },
  { value: 'Q3', label: 'Q3 (Jul - Sep)', startMonth: 6, endMonth: 8 },
  { value: 'Q4', label: 'Q4 (Oct - Dec)', startMonth: 9, endMonth: 11 },
];

function getLastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function computeDatesForPeriod(period: IncentivePeriod, year: number, month: number, quarter: string): { startDate: string; endDate: string | null } {
  if (period === 'alltime') return { startDate: '', endDate: null };
  if (period === 'month') {
    const lastDay = getLastDayOfMonth(year, month);
    return {
      startDate: `${year}-${String(month + 1).padStart(2, '0')}-01`,
      endDate: `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    };
  }
  if (period === 'quarter') {
    const q = QUARTERS.find((qq) => qq.value === quarter) ?? QUARTERS[0];
    const lastDay = getLastDayOfMonth(year, q.endMonth);
    return {
      startDate: `${year}-${String(q.startMonth + 1).padStart(2, '0')}-01`,
      endDate: `${year}-${String(q.endMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    };
  }
  // year
  return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
}

function getPeriodDisplayLabel(incentive: Incentive): string {
  const { period, startDate, endDate } = incentive;
  if (period === 'alltime') return 'All Time';
  if (!startDate) return '';
  const [y, m] = startDate.split('-').map(Number);
  if (period === 'month') return `${MONTHS[m - 1]} ${y}`;
  if (period === 'quarter') {
    const q = QUARTERS.find((qq) => qq.startMonth === m - 1);
    return q ? `${q.value} ${y}` : `${y}`;
  }
  return `${y}`;
}

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
  if (end < today) return false; // already expired
  const diff = (end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  return diff <= 7;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IncentivesPage() {
  const { currentRole, effectiveRole, currentRepId, effectiveRepId, incentives, setIncentives, projects, payrollEntries, reps } = useApp();
  const { toast } = useToast();
  const isHydrated = useIsHydrated();
  useEffect(() => { document.title = 'Incentives | Kilo Energy'; }, []);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const [incentiveFilter, setIncentiveFilter] = useState('all');
  const [incentiveSort, setIncentiveSort] = useState('newest');
  const [editingIncentiveId, setEditingIncentiveId] = useState<string | null>(null);
  const [pendingRewardsOpen, setPendingRewardsOpen] = useState(true);
  const [pastIncentivesOpen, setPastIncentivesOpen] = useState(false);
  const [duplicatingIncentive, setDuplicatingIncentive] = useState<Incentive | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Track which milestones have already triggered a toast to avoid repeats.
  // The `didInitializeToasts` ref silences the FIRST effect run so we don't
  // spam a toast for every already-crossed milestone when the page first
  // mounts. The synthetic dataset has many incentives where progress is
  // already past the threshold but ms.achieved=false, which was firing a
  // toast per milestone on every tab visit. Now the first run just seeds
  // the "seen" set without announcing anything, and subsequent runs toast
  // only for crossings that happen during the user's live session.
  const notifiedMilestonesRef = useRef<Set<string>>(new Set());
  const didInitializeToastsRef = useRef(false);

  const isAdmin = effectiveRole === 'admin';

  // Rep sees: company-wide + their personal incentives
  const visible = useMemo(() =>
    isAdmin
      ? incentives
      : incentives.filter(
          (inc) => inc.active && (inc.type === 'company' || (effectiveRepId != null && inc.targetRepId === effectiveRepId))
        ),

  [incentives, isAdmin, effectiveRepId]);

  // ── Split active vs expired (past) incentives ──
  const activeVisible = useMemo(() => visible.filter((i) => !isExpired(i.endDate)), [visible]);
  const expiredVisible = useMemo(() => visible.filter((i) => isExpired(i.endDate)), [visible]);

  // ── Feature 4: Toast on milestone reached ──
  // Only fires for milestones that cross their threshold AFTER the page
  // is already loaded. On first mount we silently seed the "seen" set
  // with every already-crossed milestone so the user isn't greeted by
  // a torrent of historical achievements on every tab visit.
  useEffect(() => {
    if (!isHydrated) return;
    const isFirstRun = !didInitializeToastsRef.current;
    for (const inc of visible) {
      const progress = computeIncentiveProgress(inc, projects, payrollEntries);
      for (const ms of inc.milestones) {
        const key = `${inc.id}::${ms.threshold}`;
        if (progress >= ms.threshold && !ms.achieved && !notifiedMilestonesRef.current.has(key)) {
          notifiedMilestonesRef.current.add(key);
          if (!isFirstRun) {
            toast(`Milestone unlocked: ${ms.reward}!`, 'success');
          }
        }
      }
    }
    didInitializeToastsRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, projects, payrollEntries, isHydrated]);

  // ── Pending rewards: milestones where progress >= threshold but not achieved (admin only) ──
  const pendingRewards = useMemo(() => {
    if (!isAdmin) return [];
    const items: { incentive: Incentive; milestone: IncentiveMilestone; progress: number }[] = [];
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
   
  }, [incentives, projects, payrollEntries, isAdmin]);

  const nextDeadline = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let soonest: string | null = null;
    const deadlineBase =
      incentiveFilter === 'ending_soon' ? visible.filter((i) => isEndingSoon(i.endDate)) :
      incentiveFilter === 'expired'     ? visible.filter((i) => isExpired(i.endDate)) :
      incentiveFilter === 'active'      ? activeVisible.filter((i) => i.active) :
                                          activeVisible.filter((i) => i.active);
    for (const inc of deadlineBase) {
      if (!inc.endDate) continue;
      const [y, m, d] = inc.endDate.split('-').map(Number);
      const end = new Date(y, m - 1, d);
      if (end >= today && (!soonest || inc.endDate < soonest)) soonest = inc.endDate;
    }
    return soonest;
  }, [activeVisible, visible, incentiveFilter]);

  const isMobile = useMediaQuery('(max-width: 767px)');
  // Mobile / PM / hydration dispatches are deferred until after all
  // hooks below to satisfy rules-of-hooks.

  const handleDelete = (id: string) => {
    setConfirmAction({
      title: 'Delete incentive?',
      message: 'This cannot be undone.',
      onConfirm: () => {
        let removed: typeof incentives[0] | undefined;
        let removedIndex = -1;
        setIncentives((prev) => {
          removedIndex = prev.findIndex((i) => i.id === id);
          removed = prev[removedIndex];
          return prev.filter((i) => i.id !== id);
        });
        fetch(`/api/incentives/${id}`, { method: 'DELETE' })
          .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); toast('Incentive deleted'); })
          .catch((err) => {
            console.error(err);
            if (removed) setIncentives((prev) => {
              const next = [...prev];
              next.splice(removedIndex, 0, removed!);
              return next;
            });
            toast('Failed to delete incentive', 'error');
          });
        setConfirmAction(null);
      },
    });
  };

  const handleToggleActive = (id: string) => {
    let newActive: boolean | undefined;
    let originalActive: boolean | undefined;
    setIncentives((prev) =>
      prev.map((i) => {
        if (i.id === id) {
          originalActive = i.active;
          newActive = !i.active;
          return { ...i, active: newActive };
        }
        return i;
      })
    );
    if (newActive !== undefined) {
      fetch(`/api/incentives/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: newActive }),
      }).then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); })
        .catch((err) => {
          console.error(err);
          if (originalActive !== undefined) {
            setIncentives((prev) => prev.map((i) => i.id === id ? { ...i, active: originalActive! } : i));
          }
          toast('Failed to update incentive', 'error');
        });
    }
  };

  const handleMilestoneAchieved = (incId: string, milestoneId: string, achieved: boolean) => {
    const targetInc = incentives.find((inc) => inc.id === incId);
    if (!targetInc) return;
    const updatedMilestones = targetInc.milestones.map((m) =>
      m.id === milestoneId ? { ...m, achieved } : m
    );
    setIncentives((prev) =>
      prev.map((inc) => {
        if (inc.id !== incId) return inc;
        const freshMilestones = inc.milestones.map((m) =>
          m.id === milestoneId ? { ...m, achieved } : m
        );
        return { ...inc, milestones: freshMilestones };
      })
    );
    // Persist milestone change
    if (updatedMilestones.length === 0) return;
    const previousMilestones = updatedMilestones.map((m) =>
      m.id === milestoneId ? { ...m, achieved: !achieved } : m
    );
    fetch(`/api/incentives/${incId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestones: updatedMilestones }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const saved = await res.json();
        setIncentives((prev) =>
          prev.map((inc) => (inc.id === incId ? { ...inc, milestones: saved.milestones } : inc))
        );
        if (achieved) toast('Milestone marked as achieved!', 'success');
      })
      .catch((err) => {
        console.error(err);
        setIncentives((prev) =>
          prev.map((inc) => (inc.id === incId ? { ...inc, milestones: previousMilestones } : inc))
        );
        toast('Failed to persist milestone update', 'error');
      });
  };

  // ── Edit handler ──
  const editingIncentive = editingIncentiveId ? incentives.find((i) => i.id === editingIncentiveId) ?? null : null;

  const handleEditSave = (updated: Incentive) => {
    const previousIncentive = incentives.find((i) => i.id === updated.id);
    setIncentives((prev) =>
      prev.map((i) => (i.id === updated.id ? updated : i))
    );
    fetch(`/api/incentives/${updated.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: updated.title, description: updated.description, active: updated.active, endDate: updated.endDate, metric: updated.metric, period: updated.period, startDate: updated.startDate, type: updated.type, targetRepId: updated.targetRepId, milestones: updated.milestones.map((m: any) => ({ ...(m.id ? { id: m.id } : {}), threshold: m.threshold, reward: m.reward, achieved: m.achieved })) }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = await res.json();
      setIncentives((prev) =>
        prev.map((i) => (i.id === updated.id ? { ...i, milestones: saved.milestones } : i))
      );
      setEditingIncentiveId(null);
      toast('Incentive updated', 'success');
    }).catch((err) => {
      console.error(err);
      if (previousIncentive) {
        setIncentives((prev) =>
          prev.map((i) => (i.id === updated.id ? previousIncentive : i))
        );
      }
      toast('Failed to save incentive changes', 'error');
    });
  };

  // ── Duplicate handler ──
  const handleDuplicate = (id: string) => {
    const source = incentives.find((i) => i.id === id);
    if (!source) return;
    setDuplicatingIncentive(source);
  };

  const handleDuplicateCreate = async (inc: Incentive) => {
    setDuplicatingIncentive(null);
    try {
      const res = await fetch('/api/incentives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: inc.title, description: inc.description, type: inc.type, metric: inc.metric, period: inc.period, startDate: inc.startDate, endDate: inc.endDate, targetRepId: inc.targetRepId, active: inc.active, milestones: inc.milestones.map((m: any) => ({ threshold: m.threshold, reward: m.reward })) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = await res.json();
      setIncentives((prev) => [...prev, { ...inc, id: created.id, milestones: created.milestones }]);
      toast('Incentive duplicated', 'success');
    } catch (err) {
      console.error(err);
      toast('Failed to save duplicated incentive', 'error');
    }
  };

  // ── Bulk select helpers ──
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  // Clear selection when filter or sort changes to prevent bulk-actions on hidden incentives.
  useEffect(() => { clearSelection(); }, [incentiveFilter, incentiveSort]);  

  // ── Bulk archive expired ──
  const expiredActiveCount = useMemo(() => visible.filter((i) => isExpired(i.endDate) && i.active).length, [visible]);

  const handleBulkArchiveExpired = () => {
    const count = expiredActiveCount;
    setConfirmAction({
      title: 'Archive all expired?',
      message: `Deactivate ${count} expired incentive${count !== 1 ? 's' : ''}?`,
      onConfirm: () => {
        const expired = incentives.filter((i) => isExpired(i.endDate) && i.active);
        const originalStates = new Map(expired.map((i) => [i.id, i.active]));
        setIncentives((prev) =>
          prev.map((i) => (isExpired(i.endDate) && i.active ? { ...i, active: false } : i))
        );
        Promise.all(expired.map((i) => fetch(`/api/incentives/${i.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false }) })
          .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return true; })
          .catch((err) => { console.error(err); toast('Failed to archive some incentives', 'error'); setIncentives((prev) => prev.map((x) => x.id === i.id ? { ...x, active: originalStates.get(i.id) ?? x.active } : x)); return false; })))
          .then((results) => { const succeeded = results.filter(Boolean).length; if (succeeded > 0) toast(`${succeeded} expired incentive${succeeded !== 1 ? 's' : ''} archived`, 'info'); });
        setConfirmAction(null);
      },
    });
  };

  // ── Bulk deactivate / delete selected ──
  const handleBulkDeactivate = () => {
    const count = selectedIds.size;
    setConfirmAction({
      title: 'Deactivate selected?',
      message: `Deactivate ${count} incentive${count !== 1 ? 's' : ''}?`,
      onConfirm: () => {
        const ids = Array.from(selectedIds);
        const originalStates = new Map(incentives.filter((i) => selectedIds.has(i.id)).map((i) => [i.id, i.active]));
        setIncentives((prev) =>
          prev.map((i) => (selectedIds.has(i.id) ? { ...i, active: false } : i))
        );
        Promise.all(ids.map((id) => fetch(`/api/incentives/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false }) })
          .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return true; })
          .catch((err) => { console.error(err); toast('Failed to deactivate some incentives', 'error'); setIncentives((prev) => prev.map((i) => i.id === id ? { ...i, active: originalStates.get(id) ?? i.active } : i)); return false; })))
          .then((results) => { const succeeded = results.filter(Boolean).length; if (succeeded > 0) toast(`${succeeded} incentive${succeeded !== 1 ? 's' : ''} deactivated`, 'info'); });
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
        Promise.allSettled(ids.map((id) => fetch(`/api/incentives/${id}`, { method: 'DELETE' })
          .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return id; })))
          .then((results) => {
            const succeededIds = new Set(ids.filter((_, i) => results[i].status === 'fulfilled'));
            const failedIds = new Set(ids.filter((_, i) => results[i].status === 'rejected'));
            if (failedIds.size > 0) {
              toast('Failed to delete some incentives', 'error');
              const itemsToRestore = deletedItems.filter((i) => failedIds.has(i.id));
              setIncentives((prev) => [...prev, ...itemsToRestore]);
            }
            const succeeded = results.filter((r) => r.status === 'fulfilled').length;
            if (succeeded > 0) toast(`${succeeded} incentive${succeeded !== 1 ? 's' : ''} deleted`);
          });
        clearSelection();
        setConfirmAction(null);
      },
    });
  };

  // ── Filter & sort helper ──
  const filterAndSort = (list: Incentive[]): Incentive[] => {
    let filtered = list;
    if (incentiveFilter === 'active') filtered = list.filter((i) => !isExpired(i.endDate) && i.active);
    else if (incentiveFilter === 'ending_soon') filtered = list.filter((i) => isEndingSoon(i.endDate));
    else if (incentiveFilter === 'expired') filtered = list.filter((i) => isExpired(i.endDate));

    const sorted = [...filtered];
    if (incentiveSort === 'newest') {
      sorted.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
    } else if (incentiveSort === 'progress') {
      sorted.sort((a, b) => {
        const pA = computeIncentiveProgress(a, projects, payrollEntries);
        const pB = computeIncentiveProgress(b, projects, payrollEntries);
        const maxA = a.milestones.length ? Math.max(...a.milestones.map(m => m.threshold)) : 1;
        const maxB = b.milestones.length ? Math.max(...b.milestones.map(m => m.threshold)) : 1;
        return (pB / maxB) - (pA / maxA);
      });
    } else if (incentiveSort === 'ending_soonest') {
      sorted.sort((a, b) => {
        if (!a.endDate && !b.endDate) return 0;
        if (!a.endDate) return 1;
        if (!b.endDate) return -1;
        return a.endDate.localeCompare(b.endDate);
      });
    }
    return sorted;
  };

  // ── Summary stats ──
  const statsFiltered: Incentive[] =
    incentiveFilter === 'ending_soon' ? visible.filter((i) => isEndingSoon(i.endDate)) :
    incentiveFilter === 'expired'     ? visible.filter((i) => isExpired(i.endDate)) :
    incentiveFilter === 'active'      ? activeVisible.filter((i) => i.active) :
                                        visible;
  const activeIncentives = statsFiltered;
  const totalMilestones = activeIncentives.reduce((sum, i) => sum + i.milestones.length, 0);
  const achievedMilestones = activeIncentives.reduce((sum, i) => sum + i.milestones.filter((m) => m.achieved).length, 0);

  // ── Filter/Sort toolbar (reusable for both sections) ──
  const filterSortToolbar = (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4 xl:mb-6 xl:border-b xl:border-[var(--border)] xl:pb-4 flex-wrap">
      <div className="w-full sm:w-40">
        <SearchableSelect
          value={incentiveFilter}
          onChange={setIncentiveFilter}
          searchable={false}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'expired', label: 'Expired' },
            { value: 'ending_soon', label: 'Ending Soon' },
          ]}
        />
      </div>
      <div className="w-full sm:w-44">
        <SearchableSelect
          value={incentiveSort}
          onChange={setIncentiveSort}
          searchable={false}
          options={[
            { value: 'newest', label: 'Newest' },
            { value: 'progress', label: 'Progress %' },
            { value: 'ending_soonest', label: 'Ending Soonest' },
          ]}
        />
      </div>
      {isAdmin && expiredActiveCount > 0 && (
        <button
          onClick={handleBulkArchiveExpired}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium transition-colors bg-amber-900/30 text-amber-400 border border-amber-500/30 hover:bg-amber-900/50 whitespace-nowrap"
        >
          <Archive className="w-3.5 h-3.5" />
          Archive All Expired ({expiredActiveCount})
        </button>
      )}
      {isAdmin && (
        <button
          onClick={() => { if (selectMode) clearSelection(); else setSelectMode(true); }}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium transition-colors whitespace-nowrap"
          style={selectMode
            ? { background: 'rgba(0,196,240,0.15)', color: 'var(--accent-cyan)', border: '1px solid rgba(0,196,240,0.3)' }
            : { background: 'var(--surface-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }
          }
        >
          {selectMode ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
          {selectMode ? 'Cancel Select' : 'Select'}
        </button>
      )}
    </div>
  );

  // ── Role / viewport dispatches (after all hooks — rules-of-hooks) ─────────
  if (!isHydrated) return <IncentivesSkeleton />;
  if (isMobile) return <MobileIncentives />;
  if (effectiveRole === 'project_manager') {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <p className="text-[var(--text-muted)] text-sm">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 animate-fade-in-up">
      <Breadcrumb items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Incentives' }]} />
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="h-[3px] w-12 rounded-full mb-3" style={{ background: 'linear-gradient(90deg, var(--accent-green), var(--accent-cyan))' }} />
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(0,224,122,0.15)' }}>
              <Trophy className="w-5 h-5" style={{ color: 'var(--accent-green)' }} />
            </div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>Incentives</h1>
          </div>
          <p className="text-[var(--text-secondary)] text-sm font-medium ml-12 tracking-wide">
            {isAdmin ? 'Create and manage team goals and rewards' : 'Track your active goals and milestone rewards'}
          </p>
        </div>
        {isAdmin && (
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
                a.href = url; a.download = `kilo_incentives_${new Date().toISOString().split('T')[0]}.csv`; a.click();
                URL.revokeObjectURL(url);
                toast('Incentives CSV exported', 'info');
              }}
              className="flex items-center gap-2 font-medium px-3 py-2.5 rounded-xl text-sm transition-all"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
              title="Export CSV"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 font-medium px-4 py-2.5 rounded-xl text-sm transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, var(--accent-green), var(--accent-cyan))', color: '#050d18', boxShadow: '0 4px 14px rgba(0,224,122,0.25)' }}
            >
              <Plus className="w-4 h-4" />
              New Incentive
            </button>
          </div>
        )}
      </div>

      {/* Summary Stats Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div
          className="card-surface card-surface-stat rounded-2xl p-5 transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-1"
          style={{ '--card-accent': 'rgba(59,130,246,0.08)' } as React.CSSProperties}
        >
          <div className="h-[2px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
          <div className="flex items-center justify-between mb-1">
            <span className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider">{incentiveFilter === 'expired' ? 'Expired Incentives' : incentiveFilter === 'ending_soon' ? 'Ending Soon' : 'Active Incentives'}</span>
            <Trophy className="w-4 h-4 text-[var(--accent-green)] shrink-0" />
          </div>
          <p className="stat-value text-3xl font-black tabular-nums tracking-tight animate-count-up" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--accent-blue)' }}>
            {activeIncentives.length}
          </p>
        </div>

        <div
          className="card-surface card-surface-stat rounded-2xl p-5 transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-2"
          style={{ '--card-accent': 'rgba(16,185,129,0.08)' } as React.CSSProperties}
        >
          <div className="h-[2px] w-12 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 mb-3" />
          <div className="flex items-center justify-between mb-1">
            <span className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider">Milestones Achieved</span>
            <Target className="w-4 h-4 text-[var(--accent-green)] shrink-0" />
          </div>
          <p className="stat-value text-3xl font-black tabular-nums tracking-tight animate-count-up" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--accent-green)' }}>
            {achievedMilestones} <span className="text-base font-medium text-[var(--text-muted)]">of {totalMilestones}</span>
          </p>
        </div>

        <div
          className="card-surface card-surface-stat rounded-2xl p-5 transition-all duration-200 hover:translate-y-[-2px] animate-slide-in-scale stagger-3"
          style={{ '--card-accent': 'rgba(234,179,8,0.08)' } as React.CSSProperties}
        >
          <div className="h-[2px] w-12 rounded-full bg-gradient-to-r from-yellow-500 to-yellow-400 mb-3" />
          <div className="flex items-center justify-between mb-1">
            <span className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider">Next Deadline</span>
            <Calendar className="w-4 h-4 text-yellow-400 shrink-0" />
          </div>
          <p className="stat-value text-2xl font-black tabular-nums tracking-tight animate-count-up" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--accent-amber)' }}>
            {nextDeadline ? formatDate(nextDeadline) : <span className="text-[var(--text-muted)] text-lg">None</span>}
          </p>
        </div>
      </div>

      {filterSortToolbar}

      {/* Company-wide section */}
      {(() => {
        const company = filterAndSort((incentiveFilter === 'expired' ? visible : activeVisible).filter((i) => i.type === 'company'));
        return (
          <div className="mb-8">
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
              Company-Wide
            </h2>
            {company.length === 0 ? (
              <EmptyState message={incentiveFilter !== 'all' ? 'No company-wide incentives match this filter' : 'No company-wide incentives yet'} subtitle={incentiveFilter !== 'all' ? 'Try a different filter to see more incentives' : 'Company incentives apply to all reps — create one to boost team performance'} />
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {company.map((inc, index) => (
                  <IncentiveCard
                    key={inc.id}
                    cardIndex={index}
                    incentive={inc}
                    progress={computeIncentiveProgress(inc, projects, payrollEntries)}
                    isAdmin={isAdmin}
                    onDelete={handleDelete}
                    onToggle={handleToggleActive}
                    onMilestoneAchieved={handleMilestoneAchieved}
                    onEdit={(id) => setEditingIncentiveId(id)}
                    onDuplicate={handleDuplicate}
                    selectMode={selectMode}
                    selected={selectedIds.has(inc.id)}
                    onToggleSelect={toggleSelect}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Personal section */}
      {(() => {
        const personal = filterAndSort((incentiveFilter === 'expired' ? visible : activeVisible).filter((i) => i.type === 'personal'));
        return (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
              {isAdmin ? 'Personal Goals' : 'Your Personal Goals'}
            </h2>
            {personal.length === 0 ? (
              <EmptyState message={incentiveFilter !== 'all' ? 'No personal incentives match this filter' : isAdmin ? 'No personal incentives created yet' : 'No personal goals assigned to you yet'} subtitle={incentiveFilter !== 'all' ? 'Try a different filter to see more incentives' : isAdmin ? 'Assign personal goals to individual reps to track their milestones' : 'Your admin will assign personal goals when they are ready'} />
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {personal.map((inc, index) => (
                  <IncentiveCard
                    key={inc.id}
                    cardIndex={index}
                    incentive={inc}
                    progress={computeIncentiveProgress(inc, projects, payrollEntries)}
                    isAdmin={isAdmin}
                    onDelete={handleDelete}
                    onToggle={handleToggleActive}
                    onMilestoneAchieved={handleMilestoneAchieved}
                    onEdit={(id) => setEditingIncentiveId(id)}
                    onDuplicate={handleDuplicate}
                    selectMode={selectMode}
                    selected={selectedIds.has(inc.id)}
                    onToggleSelect={toggleSelect}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Pending Rewards section (admin only) */}
      {isAdmin && pendingRewards.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setPendingRewardsOpen((v) => !v)}
            className="flex items-center gap-2 mb-4 group"
          >
            <Gift className="w-4 h-4 text-amber-400" />
            <h2 className="text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider group-hover:text-[var(--text-secondary)] transition-colors">
              Pending Rewards
            </h2>
            <span className="text-xs bg-amber-900/40 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full font-medium">
              {pendingRewards.length}
            </span>
            {pendingRewardsOpen ? <ChevronUp className="w-3.5 h-3.5 text-[var(--text-muted)]" /> : <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
          </button>
          {pendingRewardsOpen && (
            <div className="space-y-2">
              {pendingRewards.map(({ incentive, milestone }) => (
                <div
                  key={`${incentive.id}-${milestone.id}`}
                  className="flex items-center justify-between rounded-xl px-4 py-3 border border-amber-500/20 bg-amber-900/5 card-surface"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-amber-500/20">
                      <Zap className="w-4 h-4 text-amber-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-white text-sm font-semibold truncate">{incentive.title}</p>
                      <p className="text-[var(--text-secondary)] text-xs">
                        At {formatIncentiveMetric(incentive.metric, milestone.threshold)} — <span className="text-amber-400">{milestone.reward}</span>
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleMilestoneAchieved(incentive.id, milestone.id, true)}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors bg-emerald-900/50 text-[var(--accent-green)] hover:bg-emerald-800/60 flex-shrink-0 ml-3"
                  >
                    Mark Fulfilled
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Past Incentives (expired archive) */}
      {expiredVisible.length > 0 && incentiveFilter === 'all' && (
        <div className="mt-8">
          <button
            onClick={() => setPastIncentivesOpen((v) => !v)}
            className="flex items-center gap-2 mb-4 group"
          >
            <Archive className="w-4 h-4 text-[var(--text-muted)]" />
            <h2 className="text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider group-hover:text-[var(--text-secondary)] transition-colors">
              Past Incentives
            </h2>
            <span className="text-xs bg-[var(--border)] text-[var(--text-secondary)] px-2 py-0.5 rounded-full font-medium">
              {expiredVisible.length}
            </span>
            {pastIncentivesOpen ? <ChevronUp className="w-3.5 h-3.5 text-[var(--text-muted)]" /> : <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
          </button>
          {pastIncentivesOpen && (
            <div className="grid gap-3">
              {filterAndSort(expiredVisible).map((inc) => {
                const progress = computeIncentiveProgress(inc, projects, payrollEntries);
                const maxThreshold = inc.milestones.length ? Math.max(...inc.milestones.map(m => m.threshold)) : 1;
                const pct = Math.min(100, (progress / maxThreshold) * 100);
                return (
                  <div
                    key={inc.id}
                    className="relative rounded-2xl border border-[var(--border)]/40 card-surface overflow-hidden opacity-70 hover:opacity-90 transition-opacity"
                  >
                    <div className="flex items-center justify-between px-5 py-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-[var(--text-dim)] flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[var(--text-secondary)] font-semibold">{inc.title}</p>
                            <span className="text-xs bg-red-900/40 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Expired
                            </span>
                          </div>
                          <p className="text-[var(--text-muted)] text-xs mt-0.5">{inc.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                        <div className="flex items-center gap-2.5">
                          <span className={`text-sm font-bold tabular-nums ${pct >= 100 ? 'text-[var(--accent-green)]' : 'text-[var(--text-secondary)]'}`}>
                            {Math.round(pct)}% final
                          </span>
                        </div>
                        {isAdmin && (
                          <button
                            onClick={() => handleDelete(inc.id)}
                            className="text-[var(--text-dim)] hover:text-red-400 transition-colors p-1"
                            title="Delete from archive"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateIncentiveModal
          onClose={() => setShowCreate(false)}
          onCreate={async (inc) => {
            setShowCreate(false);
            try {
              const res = await fetch('/api/incentives', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: inc.title, description: inc.description, type: inc.type, metric: inc.metric, period: inc.period, startDate: inc.startDate, endDate: inc.endDate, targetRepId: inc.targetRepId, active: inc.active, milestones: inc.milestones.map((m: any) => ({ threshold: m.threshold, reward: m.reward })) }),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const created = await res.json();
              setIncentives((prev) => [...prev, { ...inc, id: created.id, milestones: created.milestones }]);
              toast('Incentive created successfully', 'success');
            } catch (err) {
              console.error(err);
              toast('Failed to save new incentive', 'error');
            }
          }}
        />
      )}

      {/* Edit modal */}
      {editingIncentive && (
        <CreateIncentiveModal
          onClose={() => setEditingIncentiveId(null)}
          onCreate={handleEditSave}
          editIncentive={editingIncentive}
        />
      )}

      {/* Duplicate modal */}
      {duplicatingIncentive && (
        <CreateIncentiveModal
          onClose={() => setDuplicatingIncentive(null)}
          onCreate={handleDuplicateCreate}
          duplicateSource={duplicatingIncentive}
        />
      )}

      {/* Floating bulk-action toolbar */}
      {selectMode && selectedIds.size > 0 && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 backdrop-blur-xl bg-[var(--surface)]/80 border border-[var(--border)]/50 rounded-2xl px-6 py-3 shadow-2xl shadow-black/40 animate-float-toolbar-in"
          role="toolbar"
          aria-label="Batch actions for selected incentives"
        >
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 bg-[var(--accent-green)]/15 border border-[var(--accent-green)]/25 text-sm px-3 py-1 rounded-lg whitespace-nowrap select-none">
              <span className="text-white font-bold tabular-nums">{selectedIds.size}</span>
              <span className="text-[var(--accent-green)] font-medium">selected</span>
            </span>
            <div className="h-5 w-px bg-[var(--border)]/80 flex-shrink-0" />
            <button
              onClick={handleBulkDeactivate}
              className="flex items-center gap-1.5 text-white font-semibold px-4 py-1.5 rounded-xl text-sm bg-amber-600 hover:bg-amber-500 shadow-lg shadow-amber-500/20 active:scale-[0.97] transition-all whitespace-nowrap"
            >
              <Archive className="w-3.5 h-3.5" /> Deactivate
            </button>
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-1.5 text-white font-semibold px-4 py-1.5 rounded-xl text-sm bg-red-600 hover:bg-red-500 shadow-lg shadow-red-500/20 active:scale-[0.97] transition-all whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
            <div className="h-5 w-px bg-[var(--border)]/80 flex-shrink-0" />
            <button
              onClick={clearSelection}
              className="text-[var(--text-secondary)] hover:text-white text-sm font-medium transition-colors whitespace-nowrap"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => confirmAction?.onConfirm()}
        title={confirmAction?.title ?? ''}
        message={confirmAction?.message ?? ''}
        confirmLabel="Confirm"
        danger
      />
    </div>
  );
}

// ─── Incentive Card ───────────────────────────────────────────────────────────

function IncentiveCard({
  incentive,
  progress,
  isAdmin,
  cardIndex,
  onDelete,
  onToggle,
  onMilestoneAchieved,
  onEdit,
  onDuplicate,
  selectMode,
  selected,
  onToggleSelect,
}: {
  incentive: Incentive;
  progress: number;
  isAdmin: boolean;
  cardIndex: number;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
  onMilestoneAchieved: (incId: string, milestoneId: string, achieved: boolean) => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const { reps } = useApp();
  const [expanded, setExpanded] = useState(false);
  const maxThreshold = incentive.milestones.length ? Math.max(...incentive.milestones.map(m => m.threshold)) : 1;
  const pct = Math.min(100, (progress / maxThreshold) * 100);

  const rep = incentive.targetRepId ? reps.find((r) => r.id === incentive.targetRepId) : null;
  const expired = isExpired(incentive.endDate);
  const endingSoon = !expired && isEndingSoon(incentive.endDate);
  const periodDisplay = getPeriodDisplayLabel(incentive);

  const metricLabel: Record<IncentiveMetric, string> = {
    deals: 'deals',
    kw: 'kW',
    commission: 'commission paid',
    revenue: 'revenue',
  };

  const periodLabel: Record<string, string> = {
    month: 'Monthly',
    quarter: 'Quarterly',
    year: 'Annual',
    alltime: 'All Time',
  };

  return (
    <div
      className={`relative rounded-2xl border overflow-hidden transition-all duration-200 hover:translate-y-[-2px] hover:shadow-lg hover:shadow-[var(--accent-green)]/5 active:scale-[0.98] active:shadow-none after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-[var(--accent-green)]/30 after:to-transparent after:opacity-0 hover:after:opacity-100 after:transition-opacity animate-slide-in-scale stagger-${Math.min(cardIndex, 6)} ${!incentive.active ? 'opacity-50' : ''}`}
      style={{ borderColor: incentive.type === 'company' ? 'rgba(77,159,255,0.3)' : 'rgba(180,125,255,0.3)', background: 'var(--surface)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {selectMode && isAdmin && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelect(incentive.id); }}
              className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--accent-green)] transition-colors"
            >
              {selected ? <CheckSquare className="w-4 h-4 text-[var(--accent-green)]" /> : <Square className="w-4 h-4" />}
            </button>
          )}
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: incentive.type === 'company' ? 'var(--accent-blue)' : '#b47dff' }}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-white font-semibold">{incentive.title}</p>
              {periodDisplay && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--surface-card)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>
                  {periodDisplay}
                </span>
              )}
              {expired && (
                <span className="text-xs bg-red-900/40 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Expired
                </span>
              )}
              {endingSoon && (
                <span className="text-xs bg-amber-900/40 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Ending Soon
                </span>
              )}
              {!incentive.active && (
                <span className="text-xs bg-[var(--border)] text-[var(--text-secondary)] px-2 py-0.5 rounded-full">Inactive</span>
              )}
              {rep && (
                <span className="text-xs bg-amber-900/40 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full">
                  {rep.name}
                </span>
              )}
            </div>
            <p className="text-[var(--text-secondary)] text-xs mt-0.5">{incentive.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-4">
          {/* Collapsed progress indicator */}
          {!expanded && (
            <div className="flex items-center gap-2.5">
              <div className="w-24 xl:w-36 h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: pct >= 100
                      ? 'linear-gradient(90deg, var(--accent-green), #00d4c8)'
                      : 'linear-gradient(90deg, var(--accent-green), var(--accent-cyan))',
                  }}
                />
              </div>
              <span className="text-xs font-bold tabular-nums min-w-[2.5rem] xl:min-w-[3.5rem] text-right" style={{ color: pct >= 100 ? 'var(--accent-green)' : 'var(--accent-cyan)' }}>
                {Math.round(pct)}%
              </span>
              <span className="hidden xl:inline text-[10px] text-[var(--text-dim)] tabular-nums">
                {formatIncentiveMetric(incentive.metric, progress)}
              </span>
            </div>
          )}
          {isAdmin && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(incentive.id); }}
                className="text-[var(--text-dim)] hover:text-[var(--accent-green)] transition-colors p-1"
                title="Edit incentive"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDuplicate(incentive.id); }}
                className="text-[var(--text-dim)] hover:text-[var(--accent-green)] transition-colors p-1"
                title="Duplicate incentive"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onToggle(incentive.id); }}
                className="text-xs text-[var(--text-muted)] hover:text-white bg-[var(--surface-card)] hover:bg-[var(--border)] px-2.5 py-1 rounded-lg transition-colors"
              >
                {incentive.active ? 'Deactivate' : 'Activate'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(incentive.id); }}
                className="text-[var(--text-dim)] hover:text-red-400 transition-colors p-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-[var(--text-muted)]" /> : <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />}
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-5">
          {/* Progress bar — prominent */}
          <div className="mb-5">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-[var(--text-secondary)]">
                Progress: <span className="text-white font-semibold">{formatIncentiveMetric(incentive.metric, progress)}</span>
                {' '}/ {formatIncentiveMetric(incentive.metric, maxThreshold)} {metricLabel[incentive.metric]}
              </span>
              <span className="font-bold text-base tabular-nums" style={{ color: pct >= 100 ? 'var(--accent-green)' : 'var(--accent-cyan)' }}>{Math.round(pct)}%</span>
            </div>
            <div className="relative h-3.5">
              <div className="absolute inset-0 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                <div
                  className="h-full rounded-full animate-progress-grow animate-progress-shimmer"
                  style={{
                    width: `${pct}%`,
                    background: pct >= 100
                      ? 'linear-gradient(90deg, var(--accent-green), #00d4c8)'
                      : 'linear-gradient(90deg, var(--accent-green), var(--accent-cyan))',
                    animationDelay: `${cardIndex * 120}ms`,
                  }}
                />
              </div>
              {/* Milestone tick markers (outside overflow-hidden so they render) */}
              {incentive.milestones.map((ms) => {
                const tickPct = Math.min(100, (ms.threshold / maxThreshold) * 100);
                return (
                  <div
                    key={ms.id}
                    className="absolute top-0 h-full w-0.5 rounded-full"
                    style={{
                      left: `${tickPct}%`,
                      backgroundColor: ms.achieved ? 'var(--accent-green)' : 'var(--text-muted)',
                    }}
                  />
                );
              })}
            </div>
            {/* Milestone threshold labels below bar */}
            <div className="relative h-4 mt-0.5">
              {incentive.milestones.map((ms) => {
                const tickPct = Math.min(100, (ms.threshold / maxThreshold) * 100);
                return (
                  <span
                    key={ms.id}
                    className="absolute text-[9px] font-medium tabular-nums -translate-x-1/2"
                    style={{ color: ms.achieved ? 'var(--accent-green)' : 'var(--text-muted)', left: `${tickPct}%` }}
                  >
                    {formatIncentiveMetric(incentive.metric, ms.threshold)}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Milestones */}
          <div className="space-y-2">
            {incentive.milestones.map((milestone) => {
              const hit = progress >= milestone.threshold;
              return (
                <div
                  key={milestone.id}
                  className={`flex items-center justify-between rounded-xl px-4 py-3 ${milestone.achieved ? 'animate-milestone-achieve' : ''}`}
                  style={{
                    border: milestone.achieved
                      ? '1px solid rgba(0,224,122,0.3)'
                      : hit
                      ? '1px solid rgba(255,176,32,0.3)'
                      : '1px solid rgba(39,43,53,0.5)',
                    background: milestone.achieved
                      ? 'rgba(0,224,122,0.06)'
                      : hit
                      ? 'rgba(255,176,32,0.06)'
                      : 'rgba(29,32,40,0.3)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{
                        background: milestone.achieved ? 'rgba(0,224,122,0.2)' : hit ? 'rgba(255,176,32,0.2)' : 'rgba(136,145,168,0.15)',
                      }}
                    >
                      {milestone.achieved ? (
                        <CheckCircle className="w-4 h-4 animate-milestone-check-pop" style={{ color: 'var(--accent-green)' }} />
                      ) : (
                        <Trophy className="w-3.5 h-3.5" style={{ color: hit ? 'var(--accent-amber)' : 'var(--text-muted)' }} />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: milestone.achieved ? 'var(--accent-green)' : hit ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        {milestone.reward}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        At {formatIncentiveMetric(incentive.metric, milestone.threshold)}
                      </p>
                    </div>
                  </div>
                  {isAdmin && hit && (
                    <button
                      onClick={() => onMilestoneAchieved(incentive.id, milestone.id, !milestone.achieved)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                        milestone.achieved
                          ? 'bg-[var(--border)] text-[var(--text-secondary)] hover:text-red-400'
                          : 'bg-emerald-900/50 text-[var(--accent-green)] hover:bg-emerald-800/60'
                      }`}
                    >
                      {milestone.achieved ? 'Undo' : 'Mark Achieved'}
                    </button>
                  )}
                  {!isAdmin && milestone.achieved && (
                    <span className="text-[var(--accent-green)] text-xs font-semibold">Achieved</span>
                  )}
                  {!isAdmin && !milestone.achieved && hit && (
                    <span className="text-[var(--accent-green)] text-xs font-semibold">Unlocked!</span>
                  )}
                </div>
              );
            })}
          </div>

          {incentive.endDate && (
            <p className="text-xs mt-3" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>
              Period: {formatDate(incentive.startDate)} — {formatDate(incentive.endDate)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Create Modal ─────────────────────────────────────────────────────────────

function CreateIncentiveModal({
  onClose,
  onCreate,
  editIncentive,
  duplicateSource,
}: {
  onClose: () => void;
  onCreate: (inc: Incentive) => void;
  editIncentive?: Incentive | null;
  duplicateSource?: Incentive | null;
}) {
  const { reps } = useApp();
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const currentQuarter = QUARTERS[Math.floor(currentMonth / 3)].value;

  // duplicateSource takes precedence for pre-filling, but it creates a NEW incentive (not edit)
  const sourceIncentive = editIncentive ?? duplicateSource ?? null;
  const isEdit = !!editIncentive;
  const isDuplicate = !!duplicateSource;

  // Derive initial date selector values from sourceIncentive if present
  const initYear = sourceIncentive?.startDate ? parseInt(sourceIncentive.startDate.split('-')[0]) : currentYear;
  const initMonth = sourceIncentive?.startDate ? parseInt(sourceIncentive.startDate.split('-')[1]) - 1 : currentMonth;
  const initQuarter = sourceIncentive?.period === 'quarter' && sourceIncentive.startDate
    ? (QUARTERS.find((q) => q.startMonth === parseInt(sourceIncentive.startDate.split('-')[1]) - 1)?.value ?? currentQuarter)
    : currentQuarter;

  const [form, setForm] = useState({
    title: isDuplicate ? `${sourceIncentive?.title ?? ''} (Copy)` : (sourceIncentive?.title ?? ''),
    description: sourceIncentive?.description ?? '',
    type: (sourceIncentive?.type ?? 'company') as IncentiveType,
    metric: (sourceIncentive?.metric ?? 'deals') as IncentiveMetric,
    period: (sourceIncentive?.period ?? 'month') as IncentivePeriod,
    targetRepId: sourceIncentive?.targetRepId ?? '',
    selectedYear: initYear,
    selectedMonth: initMonth,
    selectedQuarter: initQuarter,
  });
  const [milestones, setMilestones] = useState<{ threshold: string; reward: string; existingId?: string; existingAchieved?: boolean }[]>(
    sourceIncentive
      ? sourceIncentive.milestones.map((m) => ({
          threshold: String(m.threshold),
          reward: m.reward,
          // In duplicate mode, don't carry over the original ID (new incentive gets new IDs)
          existingId: isDuplicate ? undefined : m.id,
          // In duplicate mode, reset achieved; in edit mode, preserve
          existingAchieved: isDuplicate ? false : m.achieved,
        }))
      : [{ threshold: '', reward: '' }]
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const upd = (field: string, val: string | number) => {
    setForm((p) => ({ ...p, [field]: val }));
    if (submitted) setErrors((prev) => { const next = { ...prev }; delete next[field]; return next; });
  };

  const addMilestone = () => setMilestones((p) => [...p, { threshold: '', reward: '' }]);
  const removeMilestone = (i: number) => setMilestones((p) => p.filter((_, idx) => idx !== i));
  const updMilestone = (i: number, field: string, val: string) =>
    setMilestones((p) => p.map((m, idx) => (idx === i ? { ...m, [field]: val } : m)));

  // Computed dates from smart selectors
  const computedDates = useMemo(
    () => computeDatesForPeriod(form.period, form.selectedYear, form.selectedMonth, form.selectedQuarter),
    [form.period, form.selectedYear, form.selectedMonth, form.selectedQuarter]
  );

  const validate = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!form.title.trim()) errs.title = 'Title is required';
    const validMilestones = milestones.filter((m) => m.threshold && m.reward);
    if (validMilestones.length === 0) errs.milestones = 'At least one milestone with threshold and reward is required';
    if (form.type === 'personal' && !form.targetRepId) errs.targetRepId = 'Select a rep for personal incentives';
    return errs;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    const builtMilestones: IncentiveMilestone[] = milestones
      .filter((m) => m.threshold && m.reward)
      .map((m, i) => {
        return {
          id: m.existingId ?? `m_${Date.now()}_${i}`,
          threshold: parseFloat(m.threshold),
          reward: m.reward,
          achieved: isDuplicate ? false : (m.existingAchieved ?? false),
        };
      });

    const inc: Incentive = {
      id: isEdit && editIncentive ? editIncentive.id : `inc_${Date.now()}`,
      title: form.title,
      description: form.description,
      type: form.type,
      metric: form.metric,
      period: form.period,
      startDate: computedDates.startDate,
      endDate: computedDates.endDate,
      targetRepId: form.type === 'personal' ? form.targetRepId || null : null,
      milestones: builtMilestones,
      active: isEdit && editIncentive ? editIncentive.active : true, // duplicates always start active
    };
    onCreate(inc);
  };

  // Escape key closes modal
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const inputCls = 'w-full bg-[var(--surface-card)] border border-[var(--border)] text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-green)] placeholder-slate-500';
  const inputErrCls = 'w-full bg-[var(--surface-card)] border border-red-500/60 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 placeholder-slate-500';
  const labelCls = 'block text-xs font-medium text-[var(--text-secondary)] mb-1.5';
  const errTextCls = 'text-red-400 text-xs mt-1';

  // Year options: current year -1 to +3
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 1 + i).map((y) => ({
    value: String(y),
    label: String(y),
  }));

  const monthOptions = MONTHS.map((m, i) => ({ value: String(i), label: m }));
  const quarterOptions = QUARTERS.map((q) => ({ value: q.value, label: q.label }));

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="w-full max-w-lg my-auto rounded-2xl border border-[var(--border)] overflow-visible"
        style={{ backgroundColor: 'var(--navy-card)' }}
      >
        <div className="flex items-center justify-between p-6 border-b border-[var(--border-subtle)]" style={{ backgroundColor: 'var(--navy-card)' }}>
          <h2 className="text-white font-semibold text-lg">{isEdit ? 'Edit Incentive' : isDuplicate ? 'Duplicate Incentive' : 'New Incentive'}</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Template quick-fill */}
          {!isEdit && !isDuplicate && (
            <div>
              <label className={labelCls}>Template</label>
              <div className="flex flex-wrap gap-2">
                {INCENTIVE_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    onClick={() => {
                      setForm((p) => ({
                        ...p,
                        title: tpl.title,
                        description: tpl.description,
                        metric: tpl.metric,
                        period: tpl.period,
                      }));
                      setMilestones(tpl.milestones.map((m) => ({ threshold: m.threshold, reward: m.reward })));
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-green)]/40 hover:text-[var(--accent-green)] hover:bg-blue-900/20"
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Title */}
          <div>
            <label className={labelCls}>Title</label>
            <input
              type="text"
              placeholder="e.g. Q2 kW Sprint"
              value={form.title}
              onChange={(e) => upd('title', e.target.value)}
              className={submitted && errors.title ? inputErrCls : inputCls}
            />
            {submitted && errors.title && <p className={errTextCls}>{errors.title}</p>}
          </div>

          {/* Description */}
          <div>
            <label className={labelCls}>Description</label>
            <textarea rows={2} placeholder="Brief description of the goal..." value={form.description} onChange={(e) => upd('description', e.target.value)} className={inputCls + ' resize-none'} />
          </div>

          {/* Type + Metric */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 overflow-visible">
            <div>
              <label className={labelCls}>Type</label>
              <SearchableSelect
                value={form.type}
                onChange={(v) => upd('type', v)}
                searchable={false}
                options={[
                  { value: 'company', label: 'Company-Wide' },
                  { value: 'personal', label: 'Personal (Rep)' },
                ]}
              />
            </div>
            <div>
              <label className={labelCls}>Metric</label>
              <SearchableSelect
                value={form.metric}
                onChange={(v) => upd('metric', v)}
                searchable={false}
                options={[
                  { value: 'deals', label: 'Deals Closed' },
                  { value: 'kw', label: 'kW Sold' },
                  { value: 'commission', label: 'Commission Paid' },
                  { value: 'revenue', label: 'Revenue' },
                ]}
              />
            </div>
          </div>

          {/* Target Rep (personal only) */}
          {form.type === 'personal' && (
            <div className="overflow-visible">
              <label className={labelCls}>Target Rep</label>
              <SearchableSelect
                value={form.targetRepId}
                onChange={(v) => upd('targetRepId', v)}
                placeholder="Select Rep..."
                options={reps.filter((r) => r.active).map((r) => ({ value: r.id, label: r.name }))}
              />
              {submitted && errors.targetRepId && <p className={errTextCls}>{errors.targetRepId}</p>}
            </div>
          )}

          {/* Period + Smart Date Selectors */}
          <div className="overflow-visible">
            <label className={labelCls}>Period</label>
            <div className={`grid gap-3 overflow-visible ${form.period === 'alltime' ? 'grid-cols-1' : form.period === 'month' ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
              <div className="overflow-visible">
                <SearchableSelect
                  value={form.period}
                  onChange={(v) => upd('period', v)}
                  searchable={false}
                  options={[
                    { value: 'month', label: 'Monthly' },
                    { value: 'quarter', label: 'Quarterly' },
                    { value: 'year', label: 'Annual' },
                    { value: 'alltime', label: 'All Time' },
                  ]}
                />
              </div>

              {/* Monthly: month + year selectors */}
              {form.period === 'month' && (
                <>
                  <div className="overflow-visible">
                    <SearchableSelect
                      value={String(form.selectedMonth)}
                      onChange={(v) => upd('selectedMonth', parseInt(v))}
                      searchable={false}
                      options={monthOptions}
                    />
                  </div>
                  <div className="overflow-visible">
                    <SearchableSelect
                      value={String(form.selectedYear)}
                      onChange={(v) => upd('selectedYear', parseInt(v))}
                      searchable={false}
                      options={yearOptions}
                    />
                  </div>
                </>
              )}

              {/* Quarterly: quarter + year selectors */}
              {form.period === 'quarter' && (
                <div className="grid grid-cols-2 gap-3 overflow-visible">
                  <div className="overflow-visible">
                    <SearchableSelect
                      value={form.selectedQuarter}
                      onChange={(v) => upd('selectedQuarter', v)}
                      searchable={false}
                      options={quarterOptions}
                    />
                  </div>
                  <div className="overflow-visible">
                    <SearchableSelect
                      value={String(form.selectedYear)}
                      onChange={(v) => upd('selectedYear', parseInt(v))}
                      searchable={false}
                      options={yearOptions}
                    />
                  </div>
                </div>
              )}

              {/* Annual: year selector only */}
              {form.period === 'year' && (
                <div className="overflow-visible">
                  <SearchableSelect
                    value={String(form.selectedYear)}
                    onChange={(v) => upd('selectedYear', parseInt(v))}
                    searchable={false}
                    options={yearOptions}
                  />
                </div>
              )}

              {/* All Time: no date fields */}
            </div>

            {/* Show computed date range preview */}
            {form.period !== 'alltime' && computedDates.startDate && computedDates.endDate && (
              <p className="text-[var(--text-muted)] text-xs mt-1.5">
                {formatDate(computedDates.startDate)} — {formatDate(computedDates.endDate)}
              </p>
            )}
          </div>

          {/* Milestones */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls + ' mb-0'}>Milestones</label>
              <button type="button" onClick={addMilestone} className="text-[var(--accent-green)] hover:text-[var(--accent-cyan)] text-xs transition-colors flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            {submitted && errors.milestones && <p className={errTextCls + ' mb-2'}>{errors.milestones}</p>}
            <div className="space-y-2">
              {milestones.map((m, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  <input
                    type="number" min="0" step="any"
                    placeholder="Threshold (e.g. 10)"
                    value={m.threshold}
                    onChange={(e) => updMilestone(i, 'threshold', e.target.value)}
                    className={inputCls + ' w-full sm:w-32'}
                  />
                  <input
                    type="text"
                    placeholder="Reward (e.g. $200 Bonus)"
                    value={m.reward}
                    onChange={(e) => updMilestone(i, 'reward', e.target.value)}
                    className={inputCls + ' flex-1 min-w-0'}
                  />
                  {milestones.length > 1 && (
                    <button type="button" onClick={() => removeMilestone(i)} className="text-[var(--text-dim)] hover:text-red-400 transition-colors flex-shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 text-white font-semibold py-3 rounded-xl text-sm transition-all hover:opacity-90"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              {isEdit ? 'Save Changes' : isDuplicate ? 'Create Duplicate' : 'Create Incentive'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-[var(--border)] hover:bg-[var(--text-dim)] text-white font-medium py-3 rounded-xl text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EmptyState({ message, subtitle }: { message: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl" style={{ background: 'rgba(22,25,32,0.5)', border: '1px dashed var(--border)' }}>
      <Trophy className="w-12 h-12" style={{ color: 'var(--text-dim)' }} />
      <div className="text-center">
        <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{message}</p>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{subtitle || 'Create an incentive to motivate your team and track progress'}</p>
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function IncentivesSkeleton() {
  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-9 w-9 bg-[var(--surface-card)] rounded-lg animate-skeleton" />
            <div
              className="h-8 w-48 bg-[var(--surface-card)] rounded animate-skeleton"
              style={{ animationDelay: '75ms' }}
            />
          </div>
          <div
            className="h-3 w-64 bg-[var(--surface-card)]/70 rounded animate-skeleton ml-12"
            style={{ animationDelay: '100ms' }}
          />
        </div>
        <div
          className="h-9 w-32 bg-[var(--surface-card)] rounded-xl animate-skeleton"
          style={{ animationDelay: '50ms' }}
        />
      </div>

      {/* Section label */}
      <div
        className="h-3 w-24 bg-[var(--surface-card)]/70 rounded animate-skeleton mb-4"
        style={{ animationDelay: '75ms' }}
      />

      {/* 3 incentive card skeletons, each with a progress bar placeholder */}
      <div className="grid gap-4">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-[var(--border)]/50 overflow-hidden"
            style={{ backgroundColor: 'var(--navy-card)' }}
          >
            {/* Card header row */}
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-2 h-2 rounded-full bg-[var(--border)] animate-skeleton flex-shrink-0"
                  style={{ animationDelay: `${i * 75}ms` }}
                />
                <div className="space-y-2">
                  <div
                    className="h-4 w-40 bg-[var(--surface-card)] rounded animate-skeleton"
                    style={{ animationDelay: `${i * 75}ms` }}
                  />
                  <div
                    className="h-3 w-56 bg-[var(--surface-card)]/70 rounded animate-skeleton"
                    style={{ animationDelay: `${i * 75 + 40}ms` }}
                  />
                </div>
              </div>
              <div
                className="h-4 w-4 bg-[var(--surface-card)] rounded animate-skeleton flex-shrink-0 ml-4"
                style={{ animationDelay: `${i * 75}ms` }}
              />
            </div>

            {/* Progress section */}
            <div className="px-5 pb-5">
              {/* Progress label row */}
              <div className="flex justify-between mb-1.5">
                <div
                  className="h-3 w-40 bg-[var(--surface-card)]/70 rounded animate-skeleton"
                  style={{ animationDelay: `${i * 75 + 50}ms` }}
                />
                <div
                  className="h-3 w-8 bg-[var(--surface-card)]/70 rounded animate-skeleton"
                  style={{ animationDelay: `${i * 75 + 50}ms` }}
                />
              </div>
              {/* Progress bar placeholder */}
              <div
                className="h-3.5 bg-[var(--surface-card)] rounded-full animate-skeleton"
                style={{ animationDelay: `${i * 75 + 75}ms` }}
              />
              {/* Milestone placeholder row */}
              <div className="mt-3 flex items-center gap-3 rounded-xl px-4 py-3 border border-[var(--border)]/50 bg-[var(--surface-card)]/30">
                <div
                  className="w-8 h-8 rounded-full bg-[var(--border)]/50 animate-skeleton flex-shrink-0"
                  style={{ animationDelay: `${i * 75 + 100}ms` }}
                />
                <div className="space-y-1.5">
                  <div
                    className="h-3 w-28 bg-[var(--surface-card)] rounded animate-skeleton"
                    style={{ animationDelay: `${i * 75 + 100}ms` }}
                  />
                  <div
                    className="h-2.5 w-16 bg-[var(--surface-card)]/70 rounded animate-skeleton"
                    style={{ animationDelay: `${i * 75 + 120}ms` }}
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
