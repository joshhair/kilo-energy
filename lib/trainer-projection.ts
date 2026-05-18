/**
 * trainer-projection.ts — Compute the trainer-payment rows a project
 * is *projected* to earn, even before its phase transitions to
 * Installed (which is when project-transitions.ts actually generates
 * the Trainer-stage PayrollEntry rows).
 *
 * Why: McMorrow-class bug — when a deal is still in "New" phase, no
 * PayrollEntry rows exist, but the breakdown UI used to read trainer
 * info only from PayrollEntry. Result: even when the assignment
 * chain clearly resolves the trainer (e.g. Hunter → Chris), the
 * trainer row was invisible. This helper makes the projection an
 * explicit, shared computation that both render paths can use.
 *
 * Mirrors the install-time generation logic in
 * lib/context/project-transitions.ts:480-557 — same resolver, same
 * setter-override match, same self-trainer guard. If you change one,
 * change the other.
 *
 * Pure function: no DB, no React. Caller hydrates the inputs.
 */
import {
  resolveTrainerRate,
  type TrainerResolverAssignment,
  type TrainerResolverPayrollEntry,
} from './commission';

/** Local extension — `paid` flag needs the entry's status, which the
 *  resolver-shape interface doesn't expose. Real PayrollEntry rows
 *  satisfy this superset; tests use plain literals. */
type PayrollEntryWithStatus = TrainerResolverPayrollEntry & { status?: string };

/**
 * One trainer-payment leg for a project. A deal can have up to two:
 *  - closer-trainer: someone trains the closer; deducted from closer pay
 *  - setter-trainer: someone trains the setter; deducted from setter pay
 *
 * When `leg === 'closer-trainer'` AND the resolved trainer is the
 * closer themselves AND there's a setter, the leg is suppressed
 * here — the setter-trainer leg owns that override (self-loop
 * avoidance, same guard as project-transitions.ts).
 */
export interface ProjectedTrainerLeg {
  /** User id of the trainer being paid. */
  trainerId: string;
  /** Resolved $/W rate. */
  rate: number;
  /** Total projected $ for this leg = rate × kW × 1000. Lumped (not split into M2/M3). */
  amount: number;
  leg: 'closer-trainer' | 'setter-trainer';
  /** Why this leg fired (project override, tier, etc.). */
  reason: string;
  /** True when a real Trainer-stage PayrollEntry for this trainer exists AND is marked Paid. */
  paid: boolean;
  /** True when an actual PayrollEntry already exists for this leg (i.e., not just projection). */
  hasEntry: boolean;
}

export interface TrainerProjectionInput {
  id: string;
  trainerId: string | null;
  trainerRate: number | null;
  /** Closer's user id. */
  repId: string;
  setterId: string | null;
  kWSize: number;
}

/**
 * Compute zero, one, or two projected trainer legs for a project.
 *
 * Always runs (phase-independent). When real PayrollEntry rows exist
 * for the resolved trainer, `hasEntry: true` is set so the caller can
 * decide whether to render a "Projected" badge or treat it as the
 * real (post-install) row.
 */
export function computeProjectedTrainerLegs(
  project: TrainerProjectionInput,
  trainerAssignments: readonly TrainerResolverAssignment[],
  payrollEntries: readonly PayrollEntryWithStatus[],
): ProjectedTrainerLeg[] {
  const legs: ProjectedTrainerLeg[] = [];
  const wattsTotal = (project.kWSize ?? 0) * 1000;

  // ── Closer-trainer leg ──
  // Resolves the closer's chain trainer, honoring the per-project
  // override (which short-circuits the chain in resolveTrainerRate's
  // step 1). Guard: when trainer === closer AND there's a setter,
  // the setter-trainer leg below will fire and pay this same trainer
  // — emitting both would double-pay (closer is also the trainer for
  // the setter, but not for themselves). Matches the same guard in
  // project-transitions.ts:489 (shipped in this same commit chain).
  const closerRes = resolveTrainerRate(
    { id: project.id, trainerId: project.trainerId, trainerRate: project.trainerRate },
    project.repId,
    trainerAssignments,
    payrollEntries,
  );
  const closerSelfTrainerWithSetter =
    closerRes.trainerId === project.repId && project.setterId != null;
  if (closerRes.rate > 0 && closerRes.trainerId && !closerSelfTrainerWithSetter) {
    legs.push(buildLeg(closerRes.trainerId, closerRes.rate, wattsTotal, 'closer-trainer', closerRes.reason, project.id, payrollEntries));
  }

  // ── Setter-trainer leg ──
  // Resolves the setter's chain trainer WITHOUT passing the project
  // override (so we get the raw chain result), then applies the
  // override if it targets the same trainer. Mirrors the 2026-04-24
  // fix at project-transitions.ts:519-557 (Josh's Chris Abbott /
  // Hunter Helton case).
  if (project.setterId) {
    const setterResRaw = resolveTrainerRate(
      { id: project.id, trainerId: null, trainerRate: null },
      project.setterId,
      trainerAssignments,
      payrollEntries,
    );
    const overrideAppliesToSetter =
      project.trainerId != null &&
      project.trainerRate != null &&
      setterResRaw.trainerId === project.trainerId;
    const setterRate = overrideAppliesToSetter ? project.trainerRate! : setterResRaw.rate;
    const setterTrainerId = overrideAppliesToSetter ? project.trainerId! : setterResRaw.trainerId;
    const setterReason = overrideAppliesToSetter ? 'project-override' : setterResRaw.reason;
    if (setterRate > 0 && setterTrainerId) {
      legs.push(buildLeg(setterTrainerId, setterRate, wattsTotal, 'setter-trainer', setterReason, project.id, payrollEntries));
    }
  }

  return legs;
}

function buildLeg(
  trainerId: string,
  rate: number,
  wattsTotal: number,
  leg: 'closer-trainer' | 'setter-trainer',
  reason: string,
  projectId: string,
  payrollEntries: readonly PayrollEntryWithStatus[],
): ProjectedTrainerLeg {
  const entry = payrollEntries.find(
    (e) => e.projectId === projectId && e.paymentStage === 'Trainer' && e.repId === trainerId,
  );
  return {
    trainerId,
    rate,
    amount: rate * wattsTotal,
    leg,
    reason,
    paid: !!(entry && entry.status === 'Paid'),
    hasEntry: !!entry,
  };
}

/**
 * Returns the total projected trainer pay for a specific viewer
 * across both legs. Sum of `amount` for every leg whose `trainerId`
 * is the viewer. Used to combine closer + trainer pay in MyPay totals.
 */
export function sumProjectedTrainerPayForRep(
  legs: readonly ProjectedTrainerLeg[],
  repId: string | null | undefined,
): number {
  if (!repId) return 0;
  let sum = 0;
  for (const l of legs) if (l.trainerId === repId) sum += l.amount;
  return sum;
}
