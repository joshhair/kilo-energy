'use client';

import { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../../lib/context';
import { useIsHydrated } from '../../../lib/hooks';
import { getTrainerOverrideRate } from '../../../lib/data';
import { fmt$ } from '../../../lib/utils';
import { ChevronDown } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileSection from './shared/MobileSection';
import MobileCard from './shared/MobileCard';

// ── Component ────────────────────────────────────────────────────────────────

export default function MobileTraining() {
  const {
    effectiveRole,
    effectiveRepId,
    trainerAssignments,
    payrollEntries,
    projects,
    reps,
  } = useApp();
  const isHydrated = useIsHydrated();

  useEffect(() => { document.title = 'Training | Kilo Energy'; }, []);

  const [expandedTrainee, setExpandedTrainee] = useState<string | null>(null);

  // ── Derived data ─────────────────────────────────────────────────────────
  // NOTE: every hook below must run unconditionally on every render — the
  // PM guard return below this block would otherwise cause a rules-of-hooks
  // violation (hooks called in different order depending on role).
  const myAssignments = trainerAssignments.filter((a) => a.trainerId === effectiveRepId);

  // Direct-trainer projects: the admin set project.trainerId to this rep
  // manually, but there's no TrainerAssignment record for the closer/setter.
  // Without this pass those projects silently disappear from the Trainer tab
  // — the viewer can open them but can't see them listed (Luckie Judson,
  // 2026-04-20). We synthesize a one-tier pseudo-assignment per closer so
  // the existing UI can render them with no structural changes.
  const assignmentTraineeIds = new Set(myAssignments.map((a) => a.traineeId));
  const directTrainerProjects = projects.filter((p) =>
    p.trainerId === effectiveRepId &&
    p.phase !== 'Cancelled' &&
    p.phase !== 'On Hold' &&
    !assignmentTraineeIds.has(p.repId ?? '') &&
    !assignmentTraineeIds.has(p.setterId ?? ''),
  );

  const isTrainer = myAssignments.length > 0 || directTrainerProjects.length > 0;

  const trainerEntries = payrollEntries.filter(
    (e) => e.repId === effectiveRepId && e.paymentStage === 'Trainer',
  );

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

      return {
        assignment,
        traineeId: assignment.traineeId,
        traineeName,
        traineeRole,
        dealCount,
        currentRate,
        activeTierIndex,
      };
    });
  }, [myAssignments, directPseudoAssignments, reps, projects, payrollEntries, effectiveRepId]);

  const sortedOverrides = [...trainerEntries].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  if (!isHydrated) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4">
        <MobilePageHeader title="Training" />

        {/* Section header skeleton */}
        <div className="h-4 w-28 rounded-full animate-pulse" style={{ background: 'var(--m-border, var(--border-mobile))' }} />

        {/* Trainee rows skeleton */}
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
          {[0, 1].map((i) => (
            <div
              key={i}
              className="px-4 py-3 flex items-center justify-between gap-3 min-h-[56px] animate-pulse"
              style={{ borderBottom: i === 0 ? '1px solid var(--m-border, var(--border-mobile))' : 'none', animationDelay: `${i * 80}ms` }}
            >
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-32 rounded-full" style={{ background: 'var(--m-border, var(--border-mobile))' }} />
                <div className="h-3 w-24 rounded-full" style={{ background: 'var(--m-border, var(--border-mobile))', opacity: 0.6 }} />
              </div>
              <div className="h-4 w-4 rounded-full" style={{ background: 'var(--m-border, var(--border-mobile))' }} />
            </div>
          ))}
        </div>

        {/* Override payments section header skeleton */}
        <div className="h-4 w-40 rounded-full animate-pulse" style={{ background: 'var(--m-border, var(--border-mobile))', animationDelay: '160ms' }} />

        {/* Override payment rows skeleton */}
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="px-4 py-3 flex items-center justify-between gap-3 min-h-[52px] animate-pulse"
              style={{ borderBottom: i < 2 ? '1px solid var(--m-border, var(--border-mobile))' : 'none', animationDelay: `${200 + i * 60}ms` }}
            >
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-36 rounded-full" style={{ background: 'var(--m-border, var(--border-mobile))' }} />
                <div className="h-3 w-16 rounded-full" style={{ background: 'var(--m-border, var(--border-mobile))', opacity: 0.6 }} />
              </div>
              <div className="h-5 w-16 rounded-full" style={{ background: 'var(--m-border, var(--border-mobile))' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── PM guard (moved below hooks to satisfy rules-of-hooks) ──────────────
  if (effectiveRole === 'project_manager') {
    return (
      <div className="px-5 pt-4 pb-24">
        <MobilePageHeader title="Training" />
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>You don&apos;t have permission to view this page.</p>
        </div>
      </div>
    );
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!isTrainer) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4">
        <MobilePageHeader title="Training" />
        <MobileCard>
          <div className="py-8 text-center">
            <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>You don&apos;t have any trainees</p>
          </div>
        </MobileCard>
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-24 space-y-4">
      <MobilePageHeader title="Training" />

      {/* ── My Trainees ─────────────────────────────────────────────────── */}
      <MobileSection title="My Trainees" count={traineeData.length}>
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
          {traineeData.map((td, idx) => {
            const isOpen = expandedTrainee === td.traineeId;
            return (
              <div key={td.traineeId} style={{ borderBottom: idx < traineeData.length - 1 ? '1px solid var(--m-border, var(--border-mobile))' : 'none' }}>
                <button
                  onClick={() => setExpandedTrainee(isOpen ? null : td.traineeId)}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 min-h-[48px]
                             touch-manipulation
                             motion-safe:transition-[transform,background-color]
                             motion-safe:duration-150 motion-safe:ease-out
                             active:scale-[0.985]
                             active:bg-white/[0.03]"
                >
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{td.traineeName}</p>
                    <p className="text-base mt-0.5" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                      <span className="font-bold" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{td.dealCount}</span> deals &middot; <span className="font-bold" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${td.currentRate.toFixed(2)}/W</span> &middot; {td.traineeRole === 'both' ? 'Closer/Setter' : td.traineeRole.charAt(0).toUpperCase() + td.traineeRole.slice(1)}
                    </p>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 flex-shrink-0 motion-safe:transition-transform motion-safe:duration-300 motion-safe:[transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${
                      isOpen ? 'rotate-180' : 'rotate-0'
                    }`}
                    style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}
                  />
                </button>

                {/* Expandable rate tiers */}
                <div
                  className={`grid motion-safe:transition-[grid-template-rows] motion-safe:duration-300 motion-safe:[transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${
                    isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="px-4 pb-3">
                      <table className="w-full text-base" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                        <thead>
                          <tr style={{ color: 'var(--m-text-dim, #445577)' }}>
                            <th className="text-left py-1 font-semibold uppercase tracking-widest">Deals Up To</th>
                            <th className="text-right py-1 font-semibold uppercase tracking-widest">Rate ($/W)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {td.assignment.tiers.map((tier, i) => (
                            <tr
                              key={i}
                              className="motion-safe:animate-[fadeSlideIn_200ms_cubic-bezier(0.16,1,0.3,1)_both]"
                              style={{ animationDelay: `${i * 40}ms`, color: i === td.activeTierIndex ? 'var(--m-accent, var(--accent-emerald))' : 'var(--m-text-muted, var(--text-mobile-muted))' }}
                            >
                              <td className="py-1">{tier.upToDeal === null ? 'Unlimited' : tier.upToDeal}</td>
                              <td className="py-1 text-right tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${tier.ratePerW.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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
          <p className="text-base py-4 text-center" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>No override payments yet</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))' }}>
            {sortedOverrides.map((entry, idx) => (
              <div
                key={entry.id}
                className="px-4 py-3 flex items-center justify-between gap-3
                           motion-safe:animate-[fadeUpIn_280ms_cubic-bezier(0.16,1,0.3,1)_both]"
                style={{
                  borderBottom: idx < sortedOverrides.length - 1 ? '1px solid var(--m-border, var(--border-mobile))' : 'none',
                  animationDelay: `${Math.min(idx, 5) * 45}ms`,
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                    {entry.customerName || entry.notes || 'Override'}
                  </p>
                  <p className="text-base mt-0.5" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{entry.date}</p>
                </div>
                <span className="text-lg font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>
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
