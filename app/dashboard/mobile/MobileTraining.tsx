'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useApp } from '../../../lib/context';
import { useIsHydrated, useCountUp } from '../../../lib/hooks';
import { useToast } from '../../../lib/toast';
import { getTrainerOverrideRate } from '../../../lib/data';
import { fmt$, isPaidAndEffective } from '../../../lib/utils';
import {
  ChevronDown, GraduationCap, Banknote, Plus, Search,
  Pencil, Play, ShieldCheck, RotateCcw, Trash2, Users, X, MoreVertical,
} from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileSection from './shared/MobileSection';
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
  training:  { bg: 'color-mix(in srgb, var(--accent-emerald-solid) 12%, transparent)', color: 'var(--accent-emerald-text)', border: 'color-mix(in srgb, var(--accent-emerald-solid) 25%, transparent)', label: 'Training' },
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

// ── Component ────────────────────────────────────────────────────────────────

export default function MobileTraining({
  onNewAssignment,
  onEditAssignment,
  onBackfill,
  onDeleteAssignment,
}: {
  onNewAssignment?: () => void;
  onEditAssignment?: (id: string) => void;
  onBackfill?: (id: string) => void;
  onDeleteAssignment?: (id: string) => void;
} = {}) {
  const {
    effectiveRole,
    effectiveRepId,
    trainerAssignments,
    setTrainerAssignments,
    payrollEntries,
    projects,
    reps,
  } = useApp();
  const isHydrated = useIsHydrated();
  const { toast } = useToast();

  useEffect(() => { document.title = 'Training | Kilo Energy'; }, []);

  const [expandedAssignment, setExpandedAssignment] = useState<string | null>(null);

  // ── Admin state (unconditional — rules of hooks) ──────────────────────────
  const [adminSearch, setAdminSearch] = useState('');
  const [adminStatusFilter, setAdminStatusFilter] = useState<'all' | 'training' | 'residuals' | 'maxed' | 'paused'>('all');
  const [expandedTrainerIds, setExpandedTrainerIds] = useState<Set<string>>(new Set());
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  // ── Derived data ─────────────────────────────────────────────────────────
  // NOTE: every hook below must run unconditionally on every render — the
  // PM guard return below this block would otherwise cause a rules-of-hooks
  // violation (hooks called in different order depending on role).

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

  // Synthetic assignments for per-project trainer overrides that have no
  // TrainerAssignment record. Admin-only — mirrors the desktop page logic.
  const adminDirectPseudoAssignments = useMemo(() => {
    if (effectiveRole !== 'admin') return [];
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
  }, [effectiveRole, trainerAssignments, projects]);

  const adminRows = useMemo(() => {
    if (effectiveRole !== 'admin') return [];
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
  }, [effectiveRole, trainerAssignments, adminDirectPseudoAssignments, reps, getConsumedDeals]);

  const filteredAdminRows = useMemo(() => {
    return adminRows.filter((row) => {
      if (adminStatusFilter !== 'all' && row.status !== adminStatusFilter) return false;
      if (adminSearch) {
        const q = adminSearch.toLowerCase();
        return (
          (row.trainer?.name ?? '').toLowerCase().includes(q) ||
          (row.trainee?.name ?? '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [adminRows, adminStatusFilter, adminSearch]);

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
    if (effectiveRole !== 'admin') return null;
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
  }, [effectiveRole, trainerAssignments, adminRows, payrollEntries]);

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
  const resumeTraining = useCallback((id: string) => patchAssignment(id, { isActiveTraining: true }, 'Training resumed'), [patchAssignment]);

  const myAssignments = effectiveRole === 'admin'
    ? trainerAssignments
    : trainerAssignments.filter((a) => a.trainerId === effectiveRepId);

  // Direct-trainer projects: the admin set project.trainerId to this rep
  // manually, but there's no TrainerAssignment record for the closer/setter.
  // Without this pass those projects silently disappear from the Trainer tab
  // — the viewer can open them but can't see them listed (Luckie Judson,
  // 2026-04-20). We synthesize a one-tier pseudo-assignment per closer so
  // the existing UI can render them with no structural changes.
  // Not needed for admin — all real assignments are already in myAssignments.
  const assignmentTraineeIds = useMemo(
    () => new Set(myAssignments.map((a) => a.traineeId)),
    [myAssignments],
  );
  const directTrainerProjects = useMemo(() => {
    if (effectiveRole === 'admin') return [];
    return projects.filter((p) =>
      p.trainerId === effectiveRepId &&
      p.phase !== 'Cancelled' &&
      p.phase !== 'On Hold' &&
      !assignmentTraineeIds.has(p.repId ?? '') &&
      !assignmentTraineeIds.has(p.setterId ?? ''),
    );
  }, [effectiveRole, projects, effectiveRepId, assignmentTraineeIds]);

  const isTrainer = effectiveRole === 'admin' || myAssignments.length > 0 || directTrainerProjects.length > 0;

  const trainerEntries = payrollEntries.filter(
    (e) => e.repId === effectiveRepId && e.paymentStage === 'Trainer',
  );

  const totalOverrides = trainerEntries.filter(isPaidAndEffective).reduce((s, e) => s + (e.amount ?? 0), 0);
  const displayTotal = useCountUp(totalOverrides, 900);
  const pendingAmount = trainerEntries.filter((e) => e.status === 'Pending').reduce((s, e) => s + (e.amount ?? 0), 0);
  const draftAmount = trainerEntries.filter((e) => e.status === 'Draft').reduce((s, e) => s + (e.amount ?? 0), 0);

  // Pseudo-assignments for direct-trainer projects, grouped by closer.
  // One synthesized entry per unique closer; tier = that project's
  // trainerRate. Rendered alongside real assignments under My Trainees.
  const directPseudoAssignments = useMemo(() => {
    const byCloser = new Map<string, typeof projects>();
    for (const p of directTrainerProjects) {
      const key = p.repId ?? '';
      if (!key) continue;
      if (!byCloser.has(key)) byCloser.set(key, []);
      byCloser.get(key)!.push(p);
    }
    return Array.from(byCloser.entries()).map(([closerId, projs]) => {
      const sample = projs[0];
      const rate = sample?.trainerRate ?? 0;
      return {
        id: `direct-${closerId}`,
        trainerId: effectiveRepId!,
        traineeId: closerId,
        tiers: [{ upToDeal: null, ratePerW: rate }],
        isActiveTraining: true,
      };
    });
  }, [directTrainerProjects, effectiveRepId]);

  const traineeData = useMemo(() => {
    const all = [
      ...myAssignments.map((a) => ({ ...a, _isDirect: false })),
      ...directPseudoAssignments.map((a) => ({ ...a, _isDirect: true })),
    ];
    return all.map((assignment) => {
      const trainee = reps.find((r) => r.id === assignment.traineeId);
      const traineeName = trainee ? trainee.name : assignment.traineeId;
      const traineeRole = trainee?.repType ?? 'closer';

      // Real assignments: all active deals the trainee is on.
      // Pseudo (direct-trainer): only deals where viewer is the project's
      // trainer — avoids pulling in unrelated deals from this closer.
      const traineeDeals = projects.filter(
        (p) =>
          (p.repId === assignment.traineeId || p.setterId === assignment.traineeId) &&
          p.phase !== 'Cancelled' &&
          p.phase !== 'On Hold' &&
          (!assignment._isDirect || p.trainerId === effectiveRepId),
      );
      const dealCount = traineeDeals.length;

      // Count only distinct projectIds where this trainer earned a Trainer payroll
      // entry for this trainee — matches the desktop getConsumedDeals logic.
      const seenProjects = new Set<string>();
      for (const e of payrollEntries) {
        if (e.paymentStage !== 'Trainer') continue;
        if (e.repId !== assignment.trainerId) continue;
        if (e.projectId == null) continue;
        const p = projects.find((proj) => proj.id === e.projectId);
        if (!p) continue;
        if (p.repId !== assignment.traineeId && p.setterId !== assignment.traineeId) continue;
        seenProjects.add(e.projectId);
      }
      const consumedDeals = seenProjects.size;

      const currentRate = getTrainerOverrideRate(assignment, consumedDeals);

      // Find active tier
      let activeTierIndex = assignment.tiers.length - 1;
      for (let i = 0; i < assignment.tiers.length; i++) {
        const tier = assignment.tiers[i];
        if (tier.upToDeal === null || consumedDeals < tier.upToDeal) {
          activeTierIndex = i;
          break;
        }
      }

      const traineeProjectIds = new Set(traineeDeals.map((p) => p.id));
      const earningsFromTrainee = trainerEntries
        .filter((e) => e.projectId && traineeProjectIds.has(e.projectId) && e.repId === assignment.trainerId && isPaidAndEffective(e))
        .reduce((s, e) => s + e.amount, 0);

      return {
        assignment,
        traineeId: assignment.traineeId,
        traineeName,
        traineeRole,
        dealCount,
        consumedDeals,
        currentRate,
        activeTierIndex,
        earningsFromTrainee,
      };
    });
  }, [myAssignments, directPseudoAssignments, reps, projects, payrollEntries, trainerEntries, effectiveRepId]);

  const sortedOverrides = [...trainerEntries].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  if (!isHydrated) {
    return (
      <div className="px-5 pt-4 pb-28 space-y-4">
        <MobilePageHeader title="Training" />

        {/* Section header skeleton */}
        <div className="h-4 w-28 rounded-full animate-pulse" style={{ background: 'var(--border-subtle)' }} />

        {/* Trainee rows skeleton */}
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
          {[0, 1].map((i) => (
            <div
              key={i}
              className="px-4 py-3 flex items-center justify-between gap-3 min-h-[56px] animate-pulse"
              style={{ borderBottom: i === 0 ? '1px solid var(--border-subtle)' : 'none', animationDelay: `${i * 80}ms` }}
            >
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-32 rounded-full" style={{ background: 'var(--border-subtle)' }} />
                <div className="h-3 w-24 rounded-full" style={{ background: 'var(--border-subtle)', opacity: 0.6 }} />
              </div>
              <div className="h-4 w-4 rounded-full" style={{ background: 'var(--border-subtle)' }} />
            </div>
          ))}
        </div>

        {/* Override payments section header skeleton */}
        <div className="h-4 w-40 rounded-full animate-pulse" style={{ background: 'var(--border-subtle)', animationDelay: '160ms' }} />

        {/* Override payment rows skeleton */}
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="px-4 py-3 flex items-center justify-between gap-3 min-h-[52px] animate-pulse"
              style={{ borderBottom: i < 2 ? '1px solid var(--border-subtle)' : 'none', animationDelay: `${200 + i * 60}ms` }}
            >
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-36 rounded-full" style={{ background: 'var(--border-subtle)' }} />
                <div className="h-3 w-16 rounded-full" style={{ background: 'var(--border-subtle)', opacity: 0.6 }} />
              </div>
              <div className="h-5 w-16 rounded-full" style={{ background: 'var(--border-subtle)' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── PM guard (moved below hooks to satisfy rules-of-hooks) ──────────────
  if (effectiveRole === 'project_manager') {
    return (
      <div className="px-5 pt-4 pb-28">
        <MobilePageHeader title="Training" />
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-base" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>You don&apos;t have permission to view this page.</p>
        </div>
      </div>
    );
  }

  // ── ADMIN HUB ─────────────────────────────────────────────────────────────
  if (effectiveRole === 'admin') {
    return (
      <div className="px-5 pt-4 pb-28 space-y-4">
        <MobilePageHeader title="Trainer Hub" />

        {/* Stats strip */}
        {adminStats && (
          <div className="grid grid-cols-2 gap-3 motion-safe:animate-[fadeUpIn_300ms_cubic-bezier(0.16,1,0.3,1)_both] motion-safe:[animation-delay:60ms]">
            {[
              { label: 'Lifetime Paid', value: fmt$(adminStats.lifetimeTrainerPaid), accent: true },
              { label: 'Active / Total', value: `${adminStats.activeTrainingCount}/${adminStats.totalAssignments}`, accent: false },
              { label: 'Trainers', value: String(adminStats.uniqueTrainerCount), accent: false },
              { label: 'Avg Rate', value: `$${adminStats.avgRate.toFixed(2)}/W`, accent: true },
            ].map((stat) => (
              <div key={stat.label} className="rounded-2xl px-4 py-3" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
                <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-dim)' }}>{stat.label}</p>
                <p
                  className="text-2xl font-bold tabular-nums leading-none"
                  style={{ color: stat.accent ? 'var(--accent-emerald-solid)' : 'var(--text-primary)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}
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
        <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none]">
          {(['all', 'training', 'residuals', 'maxed', 'paused'] as const).map((s) => {
            const label = s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1);
            const isActive = adminStatusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setAdminStatusFilter(s)}
                className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
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
          <div key={`${adminStatusFilter}-${adminSearch}`} className="space-y-3">
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
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
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
                                className="p-1.5 rounded-lg flex-shrink-0 motion-safe:transition motion-safe:duration-150 active:scale-90 touch-manipulation"
                                style={{ color: 'var(--text-secondary)' }}
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
                            {isMenuOpen && (
                              <div
                                className="px-4 pb-3 flex flex-wrap gap-2"
                                style={{ borderTop: '1px solid var(--border-subtle)' }}
                              >
                                <Link
                                  href={`/dashboard/users/${row.assignment.traineeId}`}
                                  onClick={() => setOpenActionMenuId(null)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
                                  style={{ background: 'var(--surface-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
                                >
                                  View profile
                                </Link>

                                {row.assignment.isActiveTraining === false ? (
                                  <button
                                    onClick={() => { setOpenActionMenuId(null); resumeTraining(row.assignment.id); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
                                    style={{ background: 'var(--accent-amber-soft)', color: 'var(--accent-amber-text)', border: '1px solid color-mix(in srgb, var(--accent-amber-solid) 30%, transparent)' }}
                                  >
                                    <Play className="w-3 h-3" /> Resume
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => { setOpenActionMenuId(null); markGraduated(row.assignment.id); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
                                    style={{ background: 'color-mix(in srgb, var(--accent-emerald-solid) 12%, transparent)', color: 'var(--accent-emerald-text)', border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 25%, transparent)' }}
                                  >
                                    <ShieldCheck className="w-3 h-3" /> Graduate
                                  </button>
                                )}

                                {!row.assignment.id.startsWith('direct-') && onEditAssignment && (
                                  <button
                                    onClick={() => { setOpenActionMenuId(null); onEditAssignment(row.assignment.id); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
                                    style={{ background: 'var(--surface-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
                                  >
                                    <Pencil className="w-3 h-3" /> Edit
                                  </button>
                                )}

                                {onBackfill && (
                                  <button
                                    onClick={() => { setOpenActionMenuId(null); onBackfill(row.assignment.id); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
                                    style={{ background: 'var(--surface-card)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
                                  >
                                    <RotateCcw className="w-3 h-3" /> Backfill
                                  </button>
                                )}

                                {onDeleteAssignment && (
                                  <button
                                    onClick={() => { setOpenActionMenuId(null); onDeleteAssignment(row.assignment.id); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
                                    style={{ background: 'color-mix(in srgb, var(--accent-red-solid) 10%, transparent)', color: 'var(--accent-red-text)', border: '1px solid color-mix(in srgb, var(--accent-red-solid) 25%, transparent)' }}
                                  >
                                    <Trash2 className="w-3 h-3" /> Delete
                                  </button>
                                )}
                              </div>
                            )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
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

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!isTrainer) {
    return (
      <div className="px-5 pt-4 pb-28 space-y-4">
        <MobilePageHeader title="Training" />
        <div className="motion-safe:animate-[fadeUpIn_300ms_cubic-bezier(0.16,1,0.3,1)_both]">
          <MobileCard>
            <MobileEmptyState
              icon={GraduationCap}
              title="No trainees yet"
              subtitle="You'll appear here once assigned a trainee"
            />
          </MobileCard>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-28 space-y-4">
      <MobilePageHeader title="Training" />

      {/* ── Hero stat strip ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 motion-safe:animate-[fadeUpIn_300ms_cubic-bezier(0.16,1,0.3,1)_both] motion-safe:[animation-delay:60ms]">
        {[
          { label: 'Active Trainees', value: String(new Set(traineeData.filter((t) => t.assignment.isActiveTraining !== false).map((t) => t.traineeId)).size), color: 'var(--text-primary)' },
          { label: 'Override Earnings', value: fmt$(displayTotal), color: 'var(--accent-emerald-solid)' },
          { label: 'Pending', value: fmt$(pendingAmount), color: 'var(--accent-amber-text)' },
          { label: 'Draft', value: fmt$(draftAmount), color: 'var(--text-secondary)' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl px-4 py-3" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-dim)' }}>{stat.label}</p>
            <p className="text-2xl font-bold tabular-nums leading-none" style={{ color: stat.color, fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* ── My Trainees ─────────────────────────────────────────────────── */}
      <MobileSection title="My Trainees" count={traineeData.length}>
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
          {traineeData.map((td, idx) => {
            const isOpen = expandedAssignment === td.assignment.id;
            return (
              <div key={td.assignment.id} style={{ borderBottom: idx < traineeData.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                <button
                  onClick={() => setExpandedAssignment(isOpen ? null : td.assignment.id)}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 min-h-[48px]
                             touch-manipulation
                             motion-safe:transition-[transform,background-color]
                             motion-safe:duration-150 motion-safe:ease-out
                             active:scale-[0.985]
                             active:bg-[color-mix(in_srgb,var(--text-primary)_3%,transparent)]"
                >
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-base font-semibold text-[var(--text-primary)] line-clamp-2 break-words" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{td.traineeName}</p>
                    <p className="text-base mt-0.5" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      <span className="font-bold" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{td.dealCount}</span> deals &middot; <span className="font-bold" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${td.currentRate.toFixed(2)}/W</span> &middot; {td.traineeRole === 'both' ? 'Closer/Setter' : td.traineeRole.charAt(0).toUpperCase() + td.traineeRole.slice(1)}
                    </p>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 flex-shrink-0 motion-safe:transition-transform motion-safe:duration-300 motion-safe:[transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${
                      isOpen ? 'rotate-180' : 'rotate-0'
                    }`}
                    style={{ color: 'var(--text-muted)' }}
                  />
                </button>

                {/* Expandable rate tiers */}
                <div
                  className={`grid motion-safe:transition-[grid-template-rows] motion-safe:duration-300 motion-safe:[transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${
                    isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                  }`}
                >
                  <div className="overflow-hidden">
                    {isOpen && <div className="px-4 pb-3">
                      {(() => {
                        const prevThreshold = td.activeTierIndex > 0
                          ? (td.assignment.tiers[td.activeTierIndex - 1].upToDeal ?? 0) : 0;
                        const nextThreshold = td.assignment.tiers[td.activeTierIndex]?.upToDeal ?? null;
                        const range = nextThreshold === null ? 1 : Math.max(1, nextThreshold - prevThreshold);
                        const pct = nextThreshold === null ? 100 : Math.min(100, ((td.consumedDeals - prevThreshold) / range) * 100);
                        return (
                          <div className="mb-3 pt-1 motion-safe:animate-[fadeUpIn_240ms_cubic-bezier(0.16,1,0.3,1)_both]" style={{ animationDelay: '0ms' }}>
                            <div className="flex justify-between text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-dim)' }}>
                              <span>{td.consumedDeals} deals</span>
                              <span>{nextThreshold === null ? 'Max tier reached' : `${nextThreshold} to advance`}</span>
                            </div>
                            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
                              <div
                                className="h-full rounded-full animate-progress-grow"
                                style={{ width: `${pct}%`, transformOrigin: 'left', animationDelay: '60ms', background: 'var(--accent-emerald-solid)' }}
                              />
                            </div>
                          </div>
                        );
                      })()}
                      <div className="flex justify-between items-center mb-2 text-base motion-safe:animate-[fadeUpIn_240ms_cubic-bezier(0.16,1,0.3,1)_both]" style={{ animationDelay: '80ms', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                        <span className="font-semibold uppercase tracking-widest text-[11px]" style={{ color: 'var(--text-dim)' }}>Earned from Trainee</span>
                        <span className="font-bold tabular-nums" style={{ color: 'var(--accent-emerald-display)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{fmt$(td.earningsFromTrainee)}</span>
                      </div>
                      <table className="w-full text-base motion-safe:animate-[fadeUpIn_240ms_cubic-bezier(0.16,1,0.3,1)_both]" style={{ animationDelay: '140ms', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                        <thead>
                          <tr style={{ color: 'var(--text-dim)' }}>
                            <th className="text-left py-1 font-semibold uppercase tracking-widest">Deals Up To</th>
                            <th className="text-right py-1 font-semibold uppercase tracking-widest">Rate ($/W)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {td.assignment.tiers.map((tier, i) => (
                            <tr
                              key={i}
                              className="motion-safe:animate-[fadeSlideIn_200ms_cubic-bezier(0.16,1,0.3,1)_both]"
                              style={{ animationDelay: `${200 + i * 55}ms`, color: i === td.activeTierIndex ? 'var(--accent-emerald-solid)' : 'var(--text-muted)' }}
                            >
                              <td className="py-1">{tier.upToDeal === null ? 'Unlimited' : tier.upToDeal}</td>
                              <td className="py-1 text-right tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                                ${tier.ratePerW.toFixed(2)}
                                {i === td.activeTierIndex && (
                                  <span
                                    className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide leading-none"
                                    style={{ background: 'color-mix(in srgb, var(--accent-emerald-solid) 18%, transparent)', color: 'var(--accent-emerald-text)' }}
                                  >ACTIVE</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </MobileSection>

      {/* ── Override Payments ────────────────────────────────────────────── */}
      <MobileSection title="Override Payments" count={sortedOverrides.length} collapsible defaultOpen>
        {sortedOverrides.length === 0 ? (
          <MobileEmptyState icon={Banknote} title="No override payments yet" />
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
            {sortedOverrides.map((entry, idx) => (
              <div
                key={entry.id}
                className="px-4 py-3 flex items-center justify-between gap-3
                           motion-safe:animate-[fadeUpIn_280ms_cubic-bezier(0.16,1,0.3,1)_both]"
                style={{
                  borderBottom: idx < sortedOverrides.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  animationDelay: `${Math.min(idx, 5) * 45}ms`,
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-[var(--text-primary)] line-clamp-2 break-words" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                    {entry.customerName || entry.notes || 'Override'}
                  </p>
                  <p className="text-base mt-0.5" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.date}</p>
                </div>
                <span className="text-lg font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--accent-emerald-display)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                  {fmt$(entry.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </MobileSection>
    </div>
  );
}
