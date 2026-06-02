'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import { getTrainerOverrideRate } from '../../../lib/data';
import { fmt$ } from '../../../lib/utils';
import {
  ChevronDown, Plus, Search, Pencil, Play, ShieldCheck, RotateCcw, Trash2,
  Users, X, MoreVertical, ArrowRight,
} from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileCard from './shared/MobileCard';
import MobileEmptyState from './shared/MobileEmptyState';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0] ?? '').join('').toUpperCase().slice(0, 2);
}

function getAdminAssignmentStatus(
  assignment: { isActiveTraining?: boolean | null; tiers: { upToDeal: number | null }[] },
  trainee: { active?: boolean } | undefined,
  consumedDeals: number,
): 'training' | 'residuals' | 'maxed' | 'paused' {
  if (trainee && trainee.active === false) return 'paused';
  if (assignment.isActiveTraining === false) return 'residuals';
  const hasPerpetual = assignment.tiers.some((t) => t.upToDeal === null);
  if (!hasPerpetual) {
    const lastCap = assignment.tiers[assignment.tiers.length - 1]?.upToDeal ?? 0;
    if (consumedDeals >= lastCap) return 'maxed';
  }
  return 'training';
}

const STATUS_CHIP_STYLES = {
  training:  { bg: 'color-mix(in srgb, var(--accent-emerald-solid) 12%, transparent)', color: 'var(--accent-emerald-text)', border: 'color-mix(in srgb, var(--accent-emerald-solid) 25%, transparent)', label: 'Active' },
  residuals: { bg: 'var(--surface-card)', color: 'var(--text-secondary)', border: 'var(--border-subtle)', label: 'Residuals' },
  maxed:     { bg: 'var(--surface-card)', color: 'var(--text-muted)', border: 'var(--border-subtle)', label: 'Maxed' },
  paused:    { bg: 'color-mix(in srgb, var(--accent-amber-solid) 12%, transparent)', color: 'var(--accent-amber-text)', border: 'color-mix(in srgb, var(--accent-amber-solid) 25%, transparent)', label: 'Paused' },
} as const;

function StatusChip({ status }: { status: 'training' | 'residuals' | 'maxed' | 'paused' }) {
  const s = STATUS_CHIP_STYLES[status];
  return (
    <span
      className="flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
    >
      {s.label}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface MobileAdminTrainingHubProps {
  onNewAssignment?: () => void;
  onEditAssignment?: (id: string) => void;
  onBackfill?: (id: string) => void;
  onDeleteAssignment?: (id: string) => void;
}

export default function MobileAdminTrainingHub({
  onNewAssignment,
  onEditAssignment,
  onBackfill,
  onDeleteAssignment,
}: MobileAdminTrainingHubProps) {
  const {
    trainerAssignments,
    setTrainerAssignments,
    payrollEntries,
    projects,
    reps,
  } = useApp();
  const { toast } = useToast();

  const [adminSearch, setAdminSearch] = useState('');
  const [adminStatusFilter, setAdminStatusFilter] = useState<'all' | 'training' | 'residuals' | 'maxed' | 'paused'>('all');
  const [expandedTrainerIds, setExpandedTrainerIds] = useState<Set<string>>(new Set());
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [adminTrainerFilter, setAdminTrainerFilter] = useState('');
  const [adminRepFilter, setAdminRepFilter] = useState('');

  const getConsumedDeals = useCallback((a: { trainerId: string; traineeId: string }) => {
    const seen = new Set<string>();
    for (const e of payrollEntries) {
      if (e.paymentStage !== 'Trainer') continue;
      if (e.repId !== a.trainerId) continue;
      if (e.projectId == null) continue;
      const p = projects.find((proj) => proj.id === e.projectId);
      if (!p) continue;
      if (p.repId !== a.traineeId && p.setterId !== a.traineeId) continue;
      seen.add(e.projectId);
    }
    return seen.size;
  }, [payrollEntries, projects]);

  const adminDirectPseudoAssignments = useMemo(() => {
    const assignedPairs = new Set(
      trainerAssignments.map((a) => `${a.trainerId}::${a.traineeId}`),
    );
    const directProjects = projects.filter((p) => {
      if (!p.trainerId) return false;
      if (p.phase === 'Cancelled' || p.phase === 'On Hold') return false;
      const closerKey = `${p.trainerId}::${p.repId ?? ''}`;
      const setterKey = `${p.trainerId}::${p.setterId ?? ''}`;
      return !assignedPairs.has(closerKey) && !assignedPairs.has(setterKey);
    });
    const byPair = new Map<string, { trainerId: string; closerId: string; rate: number }>();
    for (const p of directProjects) {
      const trainerId = p.trainerId;
      const closerId = p.repId;
      if (!trainerId || !closerId) continue;
      const key = `${trainerId}::${closerId}`;
      if (!byPair.has(key)) byPair.set(key, { trainerId, closerId, rate: p.trainerRate ?? 0 });
    }
    return Array.from(byPair.values()).map(({ trainerId, closerId, rate }) => ({
      id: `direct-${trainerId}::${closerId}`,
      trainerId,
      traineeId: closerId,
      tiers: [{ upToDeal: null as null | number, ratePerW: rate }],
      isActiveTraining: true as const,
    }));
  }, [trainerAssignments, projects]);

  const adminRows = useMemo(() => {
    const allRows = [...trainerAssignments, ...adminDirectPseudoAssignments];
    return allRows.map((a) => {
      const trainee = reps.find((r) => r.id === a.traineeId);
      const trainer = reps.find((r) => r.id === a.trainerId);
      const consumed = getConsumedDeals(a);
      const status = getAdminAssignmentStatus(a, trainee, consumed);
      const rate = getTrainerOverrideRate(a, consumed);
      const foundTierIdx = a.tiers.findIndex((t) => t.upToDeal === null || consumed < t.upToDeal);
      const activeTierIndex = foundTierIdx === -1 ? a.tiers.length - 1 : foundTierIdx;
      return { assignment: a, trainer, trainee, consumed, status, rate, activeTierIndex };
    });
  }, [trainerAssignments, adminDirectPseudoAssignments, reps, getConsumedDeals]);

  const filteredAdminRows = useMemo(() => {
    return adminRows.filter((row) => {
      if (adminStatusFilter !== 'all' && row.status !== adminStatusFilter) return false;
      if (adminTrainerFilter && row.assignment.trainerId !== adminTrainerFilter) return false;
      if (adminRepFilter && row.assignment.traineeId !== adminRepFilter) return false;
      if (adminSearch) {
        const q = adminSearch.toLowerCase();
        return (
          (row.trainer?.name ?? '').toLowerCase().includes(q) ||
          (row.trainee?.name ?? '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [adminRows, adminStatusFilter, adminTrainerFilter, adminRepFilter, adminSearch]);

  const groupedByTrainer = useMemo(() => {
    const map = new Map<string, { trainerId: string; trainerName: string; rows: typeof filteredAdminRows }>();
    for (const row of filteredAdminRows) {
      const tid = row.assignment.trainerId;
      const entry = map.get(tid);
      if (entry) {
        entry.rows.push(row);
      } else {
        map.set(tid, { trainerId: tid, trainerName: row.trainer?.name ?? 'Unknown', rows: [row] });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => b.rows.length - a.rows.length || a.trainerName.localeCompare(b.trainerName),
    );
  }, [filteredAdminRows]);

  const adminStats = useMemo(() => {
    const totalAssignments = trainerAssignments.length;
    const uniqueTrainerCount = new Set(trainerAssignments.map((a) => a.trainerId)).size;
    const avgRate = adminRows.length > 0
      ? adminRows.reduce((s, r) => s + r.rate, 0) / adminRows.length
      : 0;
    const lifetimeTrainerPaid = payrollEntries
      .filter((e) => e.paymentStage === 'Trainer' && e.status === 'Paid')
      .reduce((s, e) => s + e.amount, 0);
    const activeTrainingCount = adminRows.filter((r) => r.status === 'training').length;
    return { totalAssignments, uniqueTrainerCount, avgRate, lifetimeTrainerPaid, activeTrainingCount };
  }, [trainerAssignments, adminRows, payrollEntries]);

  const trainerOptions = useMemo(() => {
    const ids = new Set(adminRows.map((r) => r.assignment.trainerId));
    return reps.filter((r) => ids.has(r.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [adminRows, reps]);

  const repOptions = useMemo(() => {
    const ids = new Set(adminRows.map((r) => r.assignment.traineeId));
    return reps.filter((r) => ids.has(r.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [adminRows, reps]);

  const patchAssignment = useCallback(async (
    id: string,
    body: { isActiveTraining: boolean },
    successMsg: string,
  ) => {
    if (id.startsWith('direct-')) {
      toast('This is a per-deal trainer override. Open the project to change it.', 'info');
      return;
    }
    const prev = trainerAssignments.find((a) => a.id === id);
    if (!prev) return;
    setTrainerAssignments((list) => list.map((a) => (a.id === id ? { ...a, ...body } : a)));
    try {
      const res = await fetch('/api/trainer-assignments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) throw new Error('non-2xx');
      toast(successMsg, 'success');
    } catch {
      setTrainerAssignments((list) => list.map((a) => (a.id === id ? prev : a)));
      toast('Failed to update assignment', 'error');
    }
  }, [trainerAssignments, setTrainerAssignments, toast]);

  const markGraduated = useCallback((id: string) => patchAssignment(id, { isActiveTraining: false }, 'Marked as graduated'), [patchAssignment]);
  const resumeTraining = useCallback((id: string) => patchAssignment(id, { isActiveTraining: true }, 'Coaching reactivated'), [patchAssignment]);

  return (
    <div className="px-5 pt-4 pb-28 space-y-4">
      <MobilePageHeader title="Overrides" />

      {/* Stats strip */}
      {adminStats && (
        <div className="grid grid-cols-2 gap-3 motion-safe:animate-[fadeUpIn_300ms_cubic-bezier(0.16,1,0.3,1)_both] motion-safe:[animation-delay:60ms]">
          {[
            { label: 'Lifetime Paid', value: fmt$(adminStats.lifetimeTrainerPaid) },
            { label: 'Active / Total', value: `${adminStats.activeTrainingCount}/${adminStats.totalAssignments}` },
            { label: 'Trainers', value: String(adminStats.uniqueTrainerCount) },
            { label: 'Avg Rate', value: `$${adminStats.avgRate.toFixed(2)}/W` },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl px-4 py-3" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
              <p className="uppercase mb-1" style={{ color: 'var(--accent-emerald-text)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.22em' }}>{stat.label}</p>
              <p
                className="text-2xl tabular-nums leading-none"
                style={{ color: 'var(--text-primary)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* New Assignment button */}
      {onNewAssignment && (
        <button
          onClick={onNewAssignment}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out active:scale-[0.985] touch-manipulation"
          style={{
            background: 'var(--accent-emerald-soft)',
            color: 'var(--accent-emerald-text)',
            border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 30%, transparent)',
          }}
        >
          <Plus className="w-4 h-4" />
          New Assignment
        </button>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        <input
          type="text"
          placeholder="Search trainer or rep…"
          value={adminSearch}
          onChange={(e) => setAdminSearch(e.target.value)}
          className="w-full pl-9 pr-9 py-2.5 rounded-2xl text-sm focus:outline-none"
          style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
        />
        <button
          onClick={() => setAdminSearch('')}
          className={`absolute right-3 top-1/2 -translate-y-1/2 motion-safe:transition-opacity motion-safe:duration-150 ${adminSearch ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
          aria-hidden={!adminSearch}
          tabIndex={adminSearch ? 0 : -1}
        >
          <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>

      {/* Status filter chips */}
      <div className="flex gap-2 overflow-x-auto py-1 [-ms-overflow-style:none] [scrollbar-width:none] [-webkit-overflow-scrolling:touch]">
        {(['all', 'training', 'residuals', 'maxed', 'paused'] as const).map((s) => {
          const label = s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1);
          const isActive = adminStatusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setAdminStatusFilter(s)}
              className="flex-shrink-0 px-3 min-h-[44px] flex items-center rounded-full text-xs font-semibold touch-manipulation motion-safe:transition-all motion-safe:duration-200 motion-safe:[transition-timing-function:cubic-bezier(0.16,1,0.3,1)] active:scale-[0.92]"
              style={{
                background: isActive ? 'var(--accent-emerald-soft)' : 'var(--surface-card)',
                color: isActive ? 'var(--accent-emerald-text)' : 'var(--text-muted)',
                border: `1px solid ${isActive ? 'color-mix(in srgb, var(--accent-emerald-solid) 40%, transparent)' : 'var(--border-subtle)'}`,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Trainer + Rep dropdowns */}
      <div className="flex gap-2">
        <select
          value={adminTrainerFilter}
          onChange={(e) => setAdminTrainerFilter(e.target.value)}
          className="flex-1 py-2 px-3 rounded-2xl text-sm focus:outline-none"
          style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: adminTrainerFilter ? 'var(--text-primary)' : 'var(--text-muted)' }}
        >
          <option value="">All Trainers</option>
          {trainerOptions.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <select
          value={adminRepFilter}
          onChange={(e) => setAdminRepFilter(e.target.value)}
          className="flex-1 py-2 px-3 rounded-2xl text-sm focus:outline-none"
          style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: adminRepFilter ? 'var(--text-primary)' : 'var(--text-muted)' }}
        >
          <option value="">All Reps</option>
          {repOptions.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>

      {/* Trainer profile card — renders when a specific trainer is filtered */}
      {adminTrainerFilter && (() => {
        const trainerRep = reps.find((r) => r.id === adminTrainerFilter);
        if (!trainerRep) return null;
        const theirAssignments = trainerAssignments.filter((a) => a.trainerId === adminTrainerFilter);
        const lifetimeEarned = payrollEntries
          .filter((e) => e.repId === adminTrainerFilter && e.paymentStage === 'Trainer' && e.status === 'Paid')
          .reduce((s, e) => s + e.amount, 0);
        const pendingEarnings = payrollEntries
          .filter((e) => e.repId === adminTrainerFilter && e.paymentStage === 'Trainer' && (e.status === 'Draft' || e.status === 'Pending'))
          .reduce((s, e) => s + e.amount, 0);
        const trainerRowsForTrainer = adminRows.filter((r) => r.assignment.trainerId === adminTrainerFilter);
        const active = trainerRowsForTrainer.filter((r) => r.status === 'training').length;
        const residuals = trainerRowsForTrainer.filter((r) => r.status === 'residuals').length;
        const paused = trainerRowsForTrainer.filter((r) => r.status === 'paused').length;
        const maxed = trainerRowsForTrainer.filter((r) => r.status === 'maxed').length;
        return (
          <div className="rounded-2xl p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{ background: 'color-mix(in srgb, var(--accent-amber-solid) 20%, transparent)', color: 'var(--accent-amber-text)' }}
              >
                {getInitials(trainerRep.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/dashboard/users/${trainerRep.id}`} className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                    {trainerRep.name}
                  </Link>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--accent-amber-solid) 12%, transparent)', color: 'var(--accent-amber-text)', border: '1px solid color-mix(in srgb, var(--accent-amber-solid) 25%, transparent)' }}>Trainer</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{theirAssignments.length}</span> assignment{theirAssignments.length === 1 ? '' : 's'}</span>
                  {active > 0 && <span><span className="font-semibold" style={{ color: 'var(--accent-amber-text)' }}>{active}</span> training</span>}
                  {residuals > 0 && <span><span className="font-semibold" style={{ color: 'var(--accent-cyan-text)' }}>{residuals}</span> residuals</span>}
                  {paused > 0 && <span><span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>{paused}</span> paused</span>}
                  {maxed > 0 && <span><span className="font-semibold" style={{ color: 'var(--accent-emerald-text)' }}>{maxed}</span> maxed</span>}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--accent-amber-text)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                      ${lifetimeEarned.toLocaleString()}
                    </p>
                    {pendingEarnings > 0 && (
                      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>+${pendingEarnings.toLocaleString()} pending</p>
                    )}
                  </div>
                  <Link
                    href={`/dashboard/payroll?rep=${encodeURIComponent(trainerRep.id)}&type=Trainer`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
                    style={{ background: 'color-mix(in srgb, var(--accent-amber-solid) 12%, transparent)', color: 'var(--accent-amber-text)', border: '1px solid color-mix(in srgb, var(--accent-amber-solid) 25%, transparent)' }}
                  >
                    View payments <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Result count */}
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {filteredAdminRows.length} of {adminRows.length} assignment{adminRows.length === 1 ? '' : 's'}
      </p>

      {/* Assignment list */}
      {filteredAdminRows.length === 0 ? (
        <div className="motion-safe:animate-[fadeUpIn_280ms_cubic-bezier(0.16,1,0.3,1)_both]">
          <MobileCard>
            <MobileEmptyState
              icon={Users}
              title="No assignments match"
              subtitle="Try a different search or filter"
            />
          </MobileCard>
        </div>
      ) : (
        <div key={`${adminStatusFilter}-${adminTrainerFilter}-${adminRepFilter}-${adminSearch}`} className="space-y-3">
          {groupedByTrainer.map((group, gIdx) => {
            const isExpanded = expandedTrainerIds.has(group.trainerId);
            return (
              <div
                key={group.trainerId}
                className="rounded-2xl overflow-hidden motion-safe:animate-[fadeUpIn_280ms_cubic-bezier(0.16,1,0.3,1)_both]"
                style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', animationDelay: `${Math.min(gIdx, 5) * 45}ms` }}
              >
                {/* Trainer header — tap to expand/collapse */}
                <button
                  onClick={() => setExpandedTrainerIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.trainerId)) next.delete(group.trainerId);
                    else next.add(group.trainerId);
                    return next;
                  })}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 min-h-[52px] text-left touch-manipulation"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                      style={{ background: 'var(--accent-emerald-soft)', color: 'var(--accent-emerald-text)' }}
                    >
                      {getInitials(group.trainerName)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm line-clamp-2 break-words" style={{ color: 'var(--text-primary)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                        {group.trainerName}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {group.rows.length} trainee{group.rows.length === 1 ? '' : 's'}
                        {' · '}
                        {group.rows.filter((r) => r.status === 'training').length} active
                      </p>
                    </div>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                    style={{ color: 'var(--text-muted)' }}
                  />
                </button>

                {/* Trainee rows */}
                <div
                  className={`grid motion-safe:transition-[grid-template-rows] motion-safe:duration-300 motion-safe:[transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${
                    isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                  }`}
                >
                  <div className="overflow-hidden">
                  <div aria-hidden={!isExpanded || undefined} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    {group.rows.map((row, idx) => {
                      const isMenuOpen = openActionMenuId === row.assignment.id;
                      const traineeName = row.trainee?.name ?? 'Unknown';
                      return (
                        <div
                          key={row.assignment.id}
                          style={{ borderBottom: idx < group.rows.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}
                        >
                          {/* Trainee info row */}
                          <div className="px-4 py-3 flex items-center gap-3">
                            <div
                              className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                              style={{ background: 'color-mix(in srgb, var(--accent-emerald-solid) 15%, transparent)', color: 'var(--accent-emerald-text)' }}
                            >
                              {getInitials(traineeName)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold line-clamp-2 break-words" style={{ color: 'var(--text-primary)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                                {traineeName}
                              </p>
                              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                <span className="font-bold tabular-nums">${row.rate.toFixed(2)}/W</span>
                                {' · '}
                                {row.consumed} deal{row.consumed === 1 ? '' : 's'}
                              </p>
                            </div>
                            <StatusChip status={row.status} />
                            <button
                              onClick={() => setOpenActionMenuId(isMenuOpen ? null : row.assignment.id)}
                              className="w-[44px] h-[44px] -mr-2 flex items-center justify-center rounded-xl flex-shrink-0 motion-safe:transition-[transform,background-color] motion-safe:duration-150 touch-manipulation active:scale-[0.90]"
                              style={{
                                color: isMenuOpen ? 'var(--text-primary)' : 'var(--text-secondary)',
                                background: isMenuOpen ? 'color-mix(in srgb, var(--text-primary) 8%, transparent)' : 'transparent',
                              }}
                              aria-label="Row actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Inline action strip */}
                          <div
                            className={`grid motion-safe:transition-[grid-template-rows] motion-safe:duration-200 motion-safe:[transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${
                              isMenuOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                            }`}
                          >
                            <div className="overflow-hidden">
                            <div
                              className="px-4 pb-3 pt-3 grid grid-cols-2 gap-2"
                              aria-hidden={!isMenuOpen || undefined}
                              style={{ borderTop: '1px solid var(--border-subtle)' }}
                            >
                              <Link
                                href={`/dashboard/users/${row.assignment.traineeId}`}
                                onClick={() => setOpenActionMenuId(null)}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap min-h-[44px] touch-manipulation motion-safe:transition-transform motion-safe:duration-[120ms] motion-safe:ease-out active:scale-[0.96]"
                                style={{ background: 'var(--surface-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
                              >
                                View profile
                              </Link>

                              {row.assignment.isActiveTraining === false ? (
                                <button
                                  onClick={() => { setOpenActionMenuId(null); resumeTraining(row.assignment.id); }}
                                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap min-h-[44px] touch-manipulation motion-safe:transition-transform motion-safe:duration-[120ms] motion-safe:ease-out active:scale-[0.96]"
                                  style={{ background: 'var(--accent-amber-solid)', color: 'var(--text-on-accent)', border: '1px solid var(--accent-amber-solid)' }}
                                  title="Move this rep back to Active coaching from Residuals"
                                >
                                  <Play className="w-3 h-3" /> Reactivate
                                </button>
                              ) : (
                                <button
                                  onClick={() => { setOpenActionMenuId(null); markGraduated(row.assignment.id); }}
                                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap min-h-[44px] touch-manipulation motion-safe:transition-transform motion-safe:duration-[120ms] motion-safe:ease-out active:scale-[0.96]"
                                  style={{ background: 'var(--accent-emerald-solid)', color: 'var(--text-on-accent)', border: '1px solid var(--accent-emerald-solid)' }}
                                >
                                  <ShieldCheck className="w-3 h-3" /> Graduate
                                </button>
                              )}

                              {!row.assignment.id.startsWith('direct-') && onEditAssignment && (
                                <button
                                  onClick={() => { setOpenActionMenuId(null); onEditAssignment(row.assignment.id); }}
                                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap min-h-[44px] touch-manipulation motion-safe:transition-transform motion-safe:duration-[120ms] motion-safe:ease-out active:scale-[0.96]"
                                  style={{ background: 'var(--surface-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
                                >
                                  <Pencil className="w-3 h-3" /> Edit
                                </button>
                              )}

                              {onBackfill && !row.assignment.id.startsWith('direct-') && (
                                <button
                                  onClick={() => { setOpenActionMenuId(null); onBackfill(row.assignment.id); }}
                                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap min-h-[44px] touch-manipulation motion-safe:transition-transform motion-safe:duration-[120ms] motion-safe:ease-out active:scale-[0.96]"
                                  style={{ background: 'var(--surface-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
                                >
                                  <RotateCcw className="w-3 h-3" /> Backfill
                                </button>
                              )}

                              {onDeleteAssignment && (
                                <button
                                  onClick={() => { setOpenActionMenuId(null); onDeleteAssignment(row.assignment.id); }}
                                  className="col-span-2 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap min-h-[44px] touch-manipulation motion-safe:transition-transform motion-safe:duration-[120ms] motion-safe:ease-out active:scale-[0.96]"
                                  style={{ background: 'color-mix(in srgb, var(--accent-red-solid) 12%, transparent)', color: 'var(--accent-red-text)', border: '1px solid color-mix(in srgb, var(--accent-red-solid) 30%, transparent)' }}
                                >
                                  <Trash2 className="w-3 h-3" /> Delete
                                </button>
                              )}
                            </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
