'use client';

import { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../../lib/context';
import { useIsHydrated, useCountUp } from '../../../lib/hooks';
import { getTrainerOverrideRate } from '../../../lib/data';
import { fmt$, isPaidAndEffective } from '../../../lib/utils';
import {
  ChevronDown, GraduationCap, Banknote, Search, X,
} from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileSection from './shared/MobileSection';
import MobileCard from './shared/MobileCard';
import MobileEmptyState from './shared/MobileEmptyState';
import MobileTraineeExpandPanel from './MobileTraineeExpandPanel';
import { SegmentedPills } from '../../../components/ui';
import MobileAdminTrainingHub from './MobileAdminTrainingHub';

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
    payrollEntries,
    projects,
    reps,
  } = useApp();
  const isHydrated = useIsHydrated();

  useEffect(() => { document.title = 'Overrides | Kilo Energy'; }, []);

  const [expandedAssignment, setExpandedAssignment] = useState<string | null>(null);
  // Rep view tab — mirrors desktop's Active / Residuals split. Defaults to
  // Active because the override-remaining number the rep wants to verify
  // (the one baked into their Pipeline headline) comes from active trainees.
  const [repView, setRepView] = useState<'active' | 'residuals' | 'rates'>('active');

  const [paymentSearch, setPaymentSearch] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | 'Draft' | 'Pending' | 'Paid'>('all');

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

  const trainerEntries = useMemo(
    () => payrollEntries.filter((e) => e.repId === effectiveRepId && e.paymentStage === 'Trainer'),
    [payrollEntries, effectiveRepId],
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

      // Override pipeline remaining for this assignment — matches the dollar
      // amount baked into the rep's "Pipeline" headline via
      // computeTrainerOverridePipeline. Per project: max(0, currentRate × kW
      // × 1000 − already-paid Trainer-stage entries for this trainer).
      const paidByProject = new Map<string, number>();
      for (const e of trainerEntries) {
        if (!e.projectId) continue;
        if (e.repId !== assignment.trainerId) continue;
        if (!isPaidAndEffective(e)) continue;
        paidByProject.set(e.projectId, (paidByProject.get(e.projectId) ?? 0) + e.amount);
      }
      const overrideRemaining = currentRate > 0
        ? traineeDeals.reduce((sum, p) => {
            const expected = Math.round(currentRate * (p.kWSize ?? 0) * 1000 * 100) / 100;
            const paid = paidByProject.get(p.id) ?? 0;
            return sum + Math.max(0, expected - paid);
          }, 0)
        : 0;

      // Mirror desktop status derivation so the Active/Residuals tab split
      // honors the same rule (graduated assignments live in Residuals).
      const status = getAdminAssignmentStatus(assignment, trainee, consumedDeals);

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
        overrideRemaining,
        status,
      };
    });
  }, [myAssignments, directPseudoAssignments, reps, projects, payrollEntries, trainerEntries, effectiveRepId]);

  const getTraineeForEntry = (entry: (typeof trainerEntries)[0]): { name: string; id: string } | null => {
    if (!entry.projectId) return null;
    const project = projects.find((p) => p.id === entry.projectId);
    if (!project) return null;
    for (const td of traineeData) {
      if (project.repId === td.traineeId || project.setterId === td.traineeId) {
        return { name: td.traineeName, id: td.traineeId };
      }
    }
    return null;
  };

  const filteredPayments = useMemo(() => {
    let list = [...trainerEntries];
    if (paymentSearch) {
      const q = paymentSearch.toLowerCase();
      list = list.filter((e) => {
        const trainee = getTraineeForEntry(e);
        return (
          (e.customerName ?? '').toLowerCase().includes(q) ||
          (trainee?.name ?? '').toLowerCase().includes(q) ||
          (e.notes ?? '').toLowerCase().includes(q)
        );
      });
    }
    if (paymentStatusFilter !== 'all') {
      list = list.filter((e) => e.status === paymentStatusFilter);
    }
    return list.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  }, [trainerEntries, paymentSearch, paymentStatusFilter, traineeData, projects, getTraineeForEntry]);

  // Active / Residuals split (rep view). Matches desktop's filter rule: any
  // assignment with isActiveTraining === false belongs to Residuals; the rest
  // (training / maxed / paused) are Active.
  const activeTrainees = useMemo(
    () => traineeData.filter((t) => t.assignment.isActiveTraining !== false),
    [traineeData],
  );
  const residualTrainees = useMemo(
    () => traineeData.filter((t) => t.assignment.isActiveTraining === false),
    [traineeData],
  );
  const visibleTrainees = repView === 'active' ? activeTrainees : residualTrainees;

  // Sum of override remaining across all the rep's assignments — the dollar
  // amount that gets folded into the rep's Pipeline headline. Surfaced as a
  // stat tile so the rep can reconcile against the Dashboard / My Pay number.
  const totalOverrideRemaining = useMemo(
    () => traineeData.reduce((s, t) => s + t.overrideRemaining, 0),
    [traineeData],
  );

  if (!isHydrated) {
    return (
      <div className="px-5 pt-4 pb-28 space-y-4">
        <MobilePageHeader title="Overrides" />

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
        <MobilePageHeader title="Overrides" />
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-base" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>You don&apos;t have permission to view this page.</p>
        </div>
      </div>
    );
  }

  if (effectiveRole === 'admin') {
    return (
      <MobileAdminTrainingHub
        onNewAssignment={onNewAssignment}
        onEditAssignment={onEditAssignment}
        onBackfill={onBackfill}
        onDeleteAssignment={onDeleteAssignment}
      />
    );
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!isTrainer) {
    return (
      <div className="px-5 pt-4 pb-28 space-y-4">
        <MobilePageHeader title="Overrides" />
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
      <MobilePageHeader title="Overrides" />

      {/* ── Hero stat strip ────────────────────────────────────────────────
          Pipeline Override slots in as the second tile when > 0, mirroring
          the desktop Overrides → Overview tab. This is the dollar amount
          baked into the rep's Pipeline headline — reps can verify the math
          here against what shows on Dashboard / My Pay. Hidden for reps
          with no active override accrual so the layout stays clean. */}
      <div className="grid grid-cols-2 gap-3 motion-safe:animate-[fadeUpIn_300ms_cubic-bezier(0.16,1,0.3,1)_both] motion-safe:[animation-delay:60ms]">
        {[
          { label: 'Active Trainees', value: String(new Set(activeTrainees.map((t) => t.traineeId)).size), color: 'var(--text-primary)' },
          ...(totalOverrideRemaining > 0
            ? [{ label: 'Pipeline Override', value: fmt$(totalOverrideRemaining), color: 'var(--accent-cyan-text)' }]
            : []),
          { label: 'Override Earnings', value: fmt$(displayTotal), color: 'var(--accent-emerald-solid)' },
          { label: 'Pending', value: fmt$(pendingAmount), color: 'var(--accent-amber-text)' },
          ...(totalOverrideRemaining > 0
            ? []
            : [{ label: 'Draft', value: fmt$(draftAmount), color: 'var(--text-secondary)' }]),
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl px-4 py-3" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-dim)' }}>{stat.label}</p>
            <p className="text-2xl font-bold tabular-nums leading-none" style={{ color: stat.color, fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* ── Active / Residuals tab split ────────────────────────────────
          Matches the desktop /dashboard/training tabs so reps see the same
          mental model on either device. Active = isActiveTraining true
          (training, maxed, paused all live here); Residuals = graduated. */}
      <SegmentedPills<'active' | 'residuals' | 'rates'>
        options={[
          { value: 'active', label: 'Active', badge: activeTrainees.length || undefined },
          { value: 'residuals', label: 'Residuals', badge: residualTrainees.length || undefined },
          { value: 'rates', label: 'Rates' },
        ]}
        value={repView}
        onChange={setRepView}
        ariaLabel="Filter trainees by status"
      />

      {/* ── Trainees list (filtered by tab) ─────────────────────────────── */}
      {repView !== 'rates' && (
      <div key={repView} className="motion-safe:animate-[fadeUpIn_200ms_cubic-bezier(0.16,1,0.3,1)_both]">
      {visibleTrainees.length === 0 ? (
        <MobileCard>
          <MobileEmptyState
            icon={GraduationCap}
            title={repView === 'active' ? 'No active trainees' : 'No residuals yet'}
            subtitle={repView === 'active'
              ? 'Mark a trainee as graduated to move them to Residuals'
              : 'Graduated trainees will appear here'}
          />
        </MobileCard>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
          {visibleTrainees.map((td, idx) => {
            const isOpen = expandedAssignment === td.assignment.id;
            return (
              <div key={td.assignment.id} className="motion-safe:animate-[fadeUpIn_260ms_cubic-bezier(0.16,1,0.3,1)_both]" style={{ borderBottom: idx < visibleTrainees.length - 1 ? '1px solid var(--border-subtle)' : 'none', animationDelay: `${Math.min(idx, 6) * 40}ms` }}>
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
                    {td.overrideRemaining > 0 && (
                      <p className="mt-1 text-[11px] font-semibold tabular-nums" style={{ color: 'var(--accent-cyan-text)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                        {fmt$(td.overrideRemaining)} override remaining
                      </p>
                    )}
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
                    <MobileTraineeExpandPanel
                      isOpen={isOpen}
                      tiers={td.assignment.tiers}
                      activeTierIndex={td.activeTierIndex}
                      consumedDeals={td.consumedDeals}
                      earningsFromTrainee={td.earningsFromTrainee}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>
      )}

      {/* ── Rate Schedule view ───────────────────────────────────────────── */}
      {repView === 'rates' && (
        <div key="rates" className="space-y-3 motion-safe:animate-[fadeUpIn_200ms_cubic-bezier(0.16,1,0.3,1)_both]">
          {traineeData.length === 0 ? (
            <MobileCard>
              <MobileEmptyState
                icon={GraduationCap}
                title="No trainees yet"
                subtitle="You'll appear here once assigned a trainee"
              />
            </MobileCard>
          ) : (
            traineeData.map((td, idx) => (
              <div
                key={td.assignment.id}
                className="rounded-2xl overflow-hidden motion-safe:animate-[fadeUpIn_280ms_cubic-bezier(0.16,1,0.3,1)_both]"
                style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', animationDelay: `${Math.min(idx, 5) * 45}ms` }}
              >
                <div className="px-4 pt-3 pb-0 flex items-center gap-2.5">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{ background: 'color-mix(in srgb, var(--accent-amber-solid) 20%, transparent)', color: 'var(--accent-amber-text)' }}
                  >
                    {getInitials(td.traineeName)}
                  </div>
                  <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{td.traineeName}</span>
                  <StatusChip status={td.status} />
                </div>
                <MobileTraineeExpandPanel
                  isOpen={true}
                  tiers={td.assignment.tiers}
                  activeTierIndex={td.activeTierIndex}
                  consumedDeals={td.consumedDeals}
                  earningsFromTrainee={td.earningsFromTrainee}
                />
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Override Payments ────────────────────────────────────────────── */}
      <MobileSection title="Override Payments" count={filteredPayments.length} collapsible defaultOpen>
        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search customer or trainee…"
            value={paymentSearch}
            onChange={(e) => setPaymentSearch(e.target.value)}
            className="w-full pl-9 pr-9 py-2.5 rounded-2xl text-sm focus:outline-none"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
          />
          <button
            onClick={() => setPaymentSearch('')}
            className={`absolute right-3 top-1/2 -translate-y-1/2 motion-safe:transition-opacity motion-safe:duration-150 ${paymentSearch ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            aria-hidden={!paymentSearch}
            tabIndex={paymentSearch ? 0 : -1}
          >
            <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>
        {/* Status filter */}
        <div className="flex gap-2 overflow-x-auto py-2 mb-2 [-ms-overflow-style:none] [scrollbar-width:none] [-webkit-overflow-scrolling:touch]">
          {(['all', 'Draft', 'Pending', 'Paid'] as const).map((s) => {
            const isActive = paymentStatusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setPaymentStatusFilter(s)}
                className="flex-shrink-0 px-3 min-h-[44px] flex items-center rounded-full text-xs font-semibold touch-manipulation motion-safe:transition-all motion-safe:duration-200 motion-safe:[transition-timing-function:cubic-bezier(0.16,1,0.3,1)] active:scale-[0.92]"
                style={{
                  background: isActive ? 'var(--accent-amber-soft)' : 'var(--surface-card)',
                  color: isActive ? 'var(--accent-amber-text)' : 'var(--text-muted)',
                  border: `1px solid ${isActive ? 'color-mix(in srgb, var(--accent-amber-solid) 40%, transparent)' : 'var(--border-subtle)'}`,
                }}
              >
                {s === 'all' ? 'All' : s}
              </button>
            );
          })}
        </div>
        {filteredPayments.length === 0 ? (
          <MobileEmptyState
            icon={Banknote}
            title={paymentSearch || paymentStatusFilter !== 'all' ? 'No payments match' : 'No override payments yet'}
            subtitle={paymentSearch || paymentStatusFilter !== 'all' ? 'Try a different search or filter' : undefined}
          />
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
            {filteredPayments.map((entry, idx) => {
              const trainee = getTraineeForEntry(entry);
              return (
                <div
                  key={entry.id}
                  className="px-4 py-3 flex items-center justify-between gap-3
                             motion-safe:animate-[fadeUpIn_280ms_cubic-bezier(0.16,1,0.3,1)_both]"
                  style={{
                    borderBottom: idx < filteredPayments.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    animationDelay: `${Math.min(idx, 5) * 45}ms`,
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-[var(--text-primary)] line-clamp-2 break-words" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {entry.customerName || entry.notes || 'Override'}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      {trainee ? `${trainee.name} · ` : ''}{entry.date}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-lg font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--accent-emerald-display)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
                      {fmt$(entry.amount)}
                    </span>
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                      style={{
                        background: entry.status === 'Paid' ? 'color-mix(in srgb, var(--accent-emerald-solid) 12%, transparent)' : entry.status === 'Pending' ? 'color-mix(in srgb, var(--accent-amber-solid) 12%, transparent)' : 'var(--surface-card)',
                        color: entry.status === 'Paid' ? 'var(--accent-emerald-text)' : entry.status === 'Pending' ? 'var(--accent-amber-text)' : 'var(--text-secondary)',
                        border: `1px solid ${entry.status === 'Paid' ? 'color-mix(in srgb, var(--accent-emerald-solid) 25%, transparent)' : entry.status === 'Pending' ? 'color-mix(in srgb, var(--accent-amber-solid) 25%, transparent)' : 'var(--border-subtle)'}`,
                      }}
                    >
                      {entry.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </MobileSection>
    </div>
  );
}
