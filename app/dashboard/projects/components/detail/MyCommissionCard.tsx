'use client';

/**
 * MyCommissionCard — the rep/sub-dealer "My Commission" card: hero total
 * (parity contract with MobileProjectDetail's hero), paid-entry lists, and
 * the projected-milestones fallback. Extracted verbatim from
 * projects/[id]/page.tsx (T4.1 split, 2026-06-11). Render-gating
 * (rep/sub-dealer, not PM) is the parent's responsibility.
 * isTrainerOnDeal / isTrainerRep are near-duplicates with different roles
 * — deliberately NOT merged (see the inline comments).
 */

import { myCommissionOnProject } from '@/lib/commissionHelpers';
import { formatDate } from '@/lib/utils';
import type { Project, PayrollEntry, TrainerAssignment } from '@/lib/data';
import type { Role } from '@/lib/notifications/types';

export function MyCommissionCard({ project, effectiveRole, effectiveRepId, payrollEntries, trainerAssignments, myEntries, setterTotalExpected }: {
  project: Project;
  effectiveRole: Role | null;
  effectiveRepId: string | null;
  payrollEntries: PayrollEntry[];
  trainerAssignments: TrainerAssignment[];
  myEntries: PayrollEntry[];
  setterTotalExpected: number;
}) {
        // isTrainerOnDeal flags the trainer-ONLY case (drives the
        // "My Commission (Trainer)" heading + dedicated trainer entries
        // list below). When the viewer is also the closer/setter/co-party,
        // their projected trainer pay folds into the role hero card via
        // `viewerTrainerPay` below — the trainer-only heading would be
        // misleading. So we keep the exclusion guards here.
        const isTrainerOnDeal = project.trainerId === effectiveRepId && project.repId !== effectiveRepId && project.setterId !== effectiveRepId && !(project.additionalClosers ?? []).some((c) => c.userId === effectiveRepId) && !(project.additionalSetters ?? []).some((s) => s.userId === effectiveRepId);
        const trainerOnlyEntries = isTrainerOnDeal ? payrollEntries.filter((e) => e.projectId === project.id && e.repId === effectiveRepId && e.paymentStage === 'Trainer') : [];
        return (
        <div className="card-surface rounded-2xl p-6 mb-5">
          <h2 className="text-[var(--text-primary)] font-semibold mb-4">{isTrainerOnDeal ? 'My Commission (Trainer)' : 'My Commission'}</h2>
          {(() => {
            // Compute the rep's total once so both the payroll view and the
            // "projected" view use the same hero number. Matches the
            // MobileProjectDetail "Your Commission $X" hero — parity fix
            // so a rep sees one total on their phone and the same total
            // on desktop (previously desktop only showed milestone boxes).
            const coSetterEntry = (project.additionalSetters ?? []).find((s) => s.userId === effectiveRepId);
            const isSetterRep = project.setterId === effectiveRepId;
            const isCloserRep2 = project.repId === effectiveRepId;
            // isTrainerRep gates the "trainer-only" hero card path. When
            // the viewer is also closer/setter/co-party, the trainer
            // projection is folded into their role hero card (via the
            // `viewerTrainerPay` block below), so the standalone trainer
            // card only fires when this is a pure trainer view — no other
            // role on the deal.
            const isTrainerRep = project.trainerId === effectiveRepId && !isCloserRep2 && !isSetterRep && !(project.additionalClosers ?? []).some((c) => c.userId === effectiveRepId) && !coSetterEntry;

            // Trainer-only path: single lump paid at Trainer stage, no M1/M2/M3.
            // Projected as trainerRate × kW × 1000; paid entries override if
            // they exist.
            if (isTrainerRep) {
              const trainerEntries = payrollEntries.filter((e) => e.projectId === project.id && e.repId === effectiveRepId && e.paymentStage === 'Trainer');
              const paidTotal = trainerEntries.filter((e) => e.status === 'Paid').reduce((s, e) => s + e.amount, 0);
              const pendingTotal = trainerEntries.filter((e) => e.status !== 'Paid').reduce((s, e) => s + e.amount, 0);
              const projected = (project.trainerRate ?? 0) * (project.kWSize ?? 0) * 1000;
              const myTotal = trainerEntries.length > 0 ? (paidTotal + pendingTotal) : projected;
              return myTotal > 0 ? (
                <div className="mb-5 rounded-2xl p-5 relative overflow-hidden"
                     style={{ background: 'linear-gradient(135deg, var(--accent-emerald-soft), color-mix(in srgb, var(--accent-cyan-solid) 6%, transparent))', border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 25%, transparent)' }}>
                  <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full opacity-40 pointer-events-none"
                       style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--accent-emerald-solid) 25%, transparent) 0%, transparent 65%)' }} />
                  <p className="text-[var(--text-muted)] text-xs uppercase tracking-widest mb-1">Your Commission (Trainer)</p>
                  <p className="text-[var(--accent-emerald-display)] text-4xl font-black tabular-nums">
                    ${myTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-[var(--text-secondary)] text-sm mt-1">
                    Trainer payout on this deal
                    {project.trainerRate != null && ` · $${project.trainerRate.toFixed(2)}/W × ${project.kWSize} kW`}
                  </p>
                </div>
              ) : null;
            }

            const myCommission = myCommissionOnProject(project, effectiveRepId, effectiveRole, payrollEntries, trainerAssignments);
            return myCommission.total > 0 ? (
              <div className="mb-5 rounded-2xl p-5 relative overflow-hidden"
                   style={{ background: 'linear-gradient(135deg, var(--accent-emerald-soft), color-mix(in srgb, var(--accent-cyan-solid) 6%, transparent))', border: '1px solid color-mix(in srgb, var(--accent-emerald-solid) 25%, transparent)' }}>
                <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full opacity-40 pointer-events-none"
                     style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--accent-emerald-solid) 25%, transparent) 0%, transparent 65%)' }} />
                <p className="text-[var(--text-muted)] text-xs uppercase tracking-widest mb-1">Your Commission</p>
                <p className="text-[var(--accent-emerald-display)] text-4xl font-black tabular-nums">
                  ${myCommission.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
                <p className="text-[var(--text-secondary)] text-sm mt-1">
                  {myCommission.status === 'paid'
                    ? 'Fully paid'
                    : myCommission.status === 'partial'
                    ? 'Partially paid · see breakdown below'
                    : 'Projected earnings on this deal'}
                  {myCommission.trainerProjection > 0 && ` (includes $${myCommission.trainerProjection.toLocaleString(undefined, { maximumFractionDigits: 0 })} trainer override)`}
                </p>
              </div>
            ) : null;
          })()}
          {/* Trainer branch: they don't have M1/M2/M3 — the hero above is
              their full total. If Trainer-stage entries exist, list them;
              else show "no payments yet" (phase will trigger generation). */}
          {isTrainerOnDeal ? (
            trainerOnlyEntries.length > 0 ? (
              <div className="space-y-2">
                {trainerOnlyEntries.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between bg-[var(--surface-card)]/50 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-[var(--text-secondary)] text-sm font-medium">{entry.paymentStage}</p>
                      <p className="text-[var(--text-muted)] text-xs mt-0.5">{formatDate(entry.date)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                        entry.status === 'Paid' ? 'bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald-text)]' :
                        entry.status === 'Pending' ? 'bg-[var(--accent-amber-soft)] text-[var(--accent-amber-text)]' :
                        'bg-[var(--border)] text-[var(--text-secondary)]'
                      }`}>{entry.status}</span>
                      <span className="text-[var(--accent-emerald-text)] font-bold">${entry.amount.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[var(--text-muted)] text-sm">
                No payments yet &mdash; trainer payout is released when the deal progresses past Acceptance.
              </p>
            )
          ) : myEntries.length > 0 ? (
            <div className="space-y-2">
              {myEntries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between bg-[var(--surface-card)]/50 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-[var(--text-secondary)] text-sm font-medium">
                      {entry.paymentStage}
                      {entry.notes ? <span className="text-[var(--text-muted)] font-normal ml-1.5 text-xs">({entry.notes})</span> : null}
                    </p>
                    <p className="text-[var(--text-muted)] text-xs mt-0.5">{formatDate(entry.date)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                      entry.status === 'Paid' ? 'bg-[var(--accent-emerald-soft)] text-[var(--accent-emerald-text)]' :
                      entry.status === 'Pending' ? 'bg-[var(--accent-amber-soft)] text-[var(--accent-amber-text)]' :
                      'bg-[var(--border)] text-[var(--text-secondary)]'
                    }`}>
                      {entry.status}
                    </span>
                    <span className="text-[var(--accent-emerald-text)] font-bold">${entry.amount.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (() => {
              const coCloserEntry = (project.additionalClosers ?? []).find((c) => c.userId === effectiveRepId);
              const coSetterEntry = (project.additionalSetters ?? []).find((s) => s.userId === effectiveRepId);
              const isSetterRep = project.setterId === effectiveRepId;
              const isCloserRep = project.repId === effectiveRepId;
              const expM1 = isSetterRep ? (project.setterM1Amount ?? 0) : coCloserEntry ? coCloserEntry.m1Amount : coSetterEntry ? coSetterEntry.m1Amount : (project.m1Amount ?? 0);
              const expM2 = isSetterRep ? (project.setterM2Amount ?? 0) : coCloserEntry ? coCloserEntry.m2Amount : coSetterEntry ? coSetterEntry.m2Amount : (project.m2Amount ?? 0);
              const expM3 = isSetterRep ? (project.setterM3Amount ?? 0) : coCloserEntry ? (coCloserEntry.m3Amount ?? 0) : coSetterEntry ? (coSetterEntry.m3Amount ?? 0) : (project.m3Amount ?? 0);
              // Closer viewing their own deal: show setter's TOTAL (not breakdown)
              // so they can see what their setter is making. Policy: setters and
              // trainers don't get this reciprocal visibility.
              const showSetterTotal = isCloserRep && project.setterId && setterTotalExpected > 0;
              return (
            <div>
              <div className="flex gap-4 mb-4">
                <div className="flex-1 bg-[var(--surface-card)]/50 rounded-xl px-4 py-3">
                  <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-0.5">Expected M1</p>
                  <p className="text-[var(--accent-emerald-text)] font-bold">${expM1.toLocaleString()}</p>
                </div>
                <div className="flex-1 bg-[var(--surface-card)]/50 rounded-xl px-4 py-3">
                  <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-0.5">Expected M2</p>
                  <p className="text-[var(--accent-emerald-text)] font-bold">${expM2.toLocaleString()}</p>
                </div>
                {expM3 > 0 && (
                  <div className="flex-1 bg-[var(--surface-card)]/50 rounded-xl px-4 py-3">
                    <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-0.5">Expected M3</p>
                    <p className="text-[var(--accent-teal-text)] font-bold">${expM3.toLocaleString()}</p>
                  </div>
                )}
              </div>
              {showSetterTotal && (
                <div className="mb-3 bg-[var(--surface-card)]/50 rounded-xl px-4 py-2.5 flex items-center justify-between">
                  <span className="text-[var(--text-muted)] text-xs">{project.setterName} (setter) total</span>
                  <span className="text-[var(--text-secondary)] font-semibold text-sm">${setterTotalExpected.toLocaleString()}</span>
                </div>
              )}
              <p className="text-[var(--text-muted)] text-sm">
                No payments yet &mdash; commission will appear here as milestones are reached.
              </p>
            </div>
              );
            })()}
        </div>
        );
}
