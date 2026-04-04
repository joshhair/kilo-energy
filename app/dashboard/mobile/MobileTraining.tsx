'use client';

import { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../../lib/context';
import { useIsHydrated } from '../../../lib/hooks';
import { getTrainerOverrideRate } from '../../../lib/data';
import { fmt$ } from '../../../lib/utils';
import { ChevronDown, ChevronUp } from 'lucide-react';
import MobilePageHeader from './shared/MobilePageHeader';
import MobileSection from './shared/MobileSection';
import MobileCard from './shared/MobileCard';

// ── Component ────────────────────────────────────────────────────────────────

export default function MobileTraining() {
  const {
    currentRepId,
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

  // ── PM guard ─────────────────────────────────────────────────────────────
  if (effectiveRole === 'project_manager') {
    return (
      <div className="px-5 pt-4 pb-24">
        <MobilePageHeader title="Training" />
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-base text-slate-400">You don&apos;t have permission to view this page.</p>
        </div>
      </div>
    );
  }

  // ── Derived data ─────────────────────────────────────────────────────────
  const myAssignments = trainerAssignments.filter((a) => a.trainerId === effectiveRepId);
  const isTrainer = myAssignments.length > 0;

  const trainerEntries = payrollEntries.filter(
    (e) => e.repId === effectiveRepId && e.paymentStage === 'Trainer',
  );

  const traineeData = useMemo(() => {
    return myAssignments.map((assignment) => {
      const trainee = reps.find((r) => r.id === assignment.traineeId);
      const traineeName = trainee ? trainee.name : assignment.traineeId;

      const traineeDeals = projects.filter(
        (p) =>
          (p.repId === assignment.traineeId || p.setterId === assignment.traineeId) &&
          p.phase !== 'Cancelled' &&
          p.phase !== 'On Hold',
      );
      const dealCount = traineeDeals.length;
      const currentRate = getTrainerOverrideRate(assignment, dealCount);

      // Find active tier
      let activeTierIndex = 0;
      for (let i = 0; i < assignment.tiers.length; i++) {
        const tier = assignment.tiers[i];
        if (tier.upToDeal === null || dealCount < tier.upToDeal) {
          activeTierIndex = i;
          break;
        }
      }

      return {
        assignment,
        traineeId: assignment.traineeId,
        traineeName,
        dealCount,
        currentRate,
        activeTierIndex,
      };
    });
  }, [myAssignments, reps, projects]);

  const sortedOverrides = [...trainerEntries].sort((a, b) => b.date.localeCompare(a.date));

  if (!isHydrated) {
    return (
      <div className="px-5 pt-4 pb-24 space-y-4">
        <MobilePageHeader title="Training" />
        <div className="rounded-2xl p-5 bg-slate-900/60 border border-slate-800/20 h-48 animate-pulse" />
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
            <p className="text-base text-slate-400">You don&apos;t have any trainees</p>
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
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800/20 divide-y divide-slate-800/30 overflow-hidden">
          {traineeData.map((td) => {
            const isOpen = expandedTrainee === td.traineeId;
            return (
              <div key={td.traineeId}>
                <button
                  onClick={() => setExpandedTrainee(isOpen ? null : td.traineeId)}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 min-h-[48px] active:bg-slate-800/40 transition-colors"
                >
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-semibold text-white truncate">{td.traineeName}</p>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {td.dealCount} deals &middot; ${td.currentRate.toFixed(2)}/W
                    </p>
                  </div>
                  {isOpen
                    ? <ChevronUp className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  }
                </button>

                {/* Expandable rate tiers */}
                {isOpen && (
                  <div className="px-4 pb-3">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-500 uppercase tracking-wider">
                          <th className="text-left py-1 font-semibold">Deals Up To</th>
                          <th className="text-right py-1 font-semibold">Rate ($/W)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {td.assignment.tiers.map((tier, i) => (
                          <tr
                            key={i}
                            className={i === td.activeTierIndex ? 'text-emerald-400' : 'text-slate-400'}
                          >
                            <td className="py-1">{tier.upToDeal === null ? 'Unlimited' : tier.upToDeal}</td>
                            <td className="py-1 text-right tabular-nums">${tier.ratePerW.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </MobileSection>

      {/* ── Override Payments ────────────────────────────────────────────── */}
      <MobileSection title="Override Payments" count={sortedOverrides.length} collapsible defaultOpen>
        {sortedOverrides.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center">No override payments yet</p>
        ) : (
          <div className="rounded-2xl bg-slate-900/60 border border-slate-800/20 divide-y divide-slate-800/30 overflow-hidden">
            {sortedOverrides.map((entry) => (
              <div key={entry.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">
                    {entry.customerName || entry.notes || 'Override'}
                  </p>
                  <p className="text-sm text-slate-500 mt-0.5">{entry.date}</p>
                </div>
                <span className="text-sm font-semibold text-white tabular-nums whitespace-nowrap">
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
