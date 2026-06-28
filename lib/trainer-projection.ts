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
  resolveTrainerLegs,
  type TrainerResolverAssignment,
  type TrainerResolverPayrollEntry,
  type TrainerLeg,
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
  /** Total projected $ for this leg = rate × kW × 1000 × share. Lumped (not split into M2/M3). */
  amount: number;
  leg: 'closer-trainer' | 'setter-trainer';
  /** Why this leg fired (project override, tier, etc.). */
  reason: string;
  /** True when a real Trainer-stage PayrollEntry for this trainer exists AND is marked Paid. */
  paid: boolean;
  /** True when an actual PayrollEntry already exists for this leg (i.e., not just projection). */
  hasEntry: boolean;
  /**
   * (Multi-party only) Distinct trainees credited to this trainer on this deal.
   * Populated when the multi-party path is used (additionalClosers or
   * additionalSetters provided to computeProjectedTrainerLegs). Always at
   * least one trainee on the multi-party path; empty/undefined on legacy
   * single-party legs.
   */
  trainees?: Array<{ userId: string | null; name: string }>;
  /**
   * (Multi-party only) Fraction of the deal this trainer is paid on
   * (0..1 after the cross-side cap). Undefined on legacy single-party
   * legs (those always represent share=1.0 of the deal).
   */
  share?: number;
}

export interface TrainerProjectionInput {
  id: string;
  trainerId: string | null;
  trainerRate: number | null;
  /** Closer's user id. */
  repId: string;
  setterId: string | null;
  kWSize: number;
  /**
   * (Multi-party — optional.) When ANY of `additionalClosers`,
   * `additionalSetters`, `m2Amount`, or `setterM2Amount` is provided,
   * the multi-party path runs: every party's TrainerAssignment chain
   * is resolved and shares are computed from m2 amounts. When omitted,
   * the legacy single-party path runs (preserves pre-2026-05-23
   * behavior for every existing caller). Mirrors the engine logic in
   * lib/context/project-transitions.ts.
   */
  additionalClosers?: ReadonlyArray<{ userId: string; userName?: string; m2Amount: number }>;
  additionalSetters?: ReadonlyArray<{ userId: string; userName?: string; m2Amount: number }>;
  m2Amount?: number;
  setterM2Amount?: number;
  /** Admin "remove all chain trainers" flag. When set (and there's no
   *  per-project override), the projection emits NO chain trainer legs —
   *  mirroring resolveTrainerLegs (lib/commission.ts) + the actual payroll
   *  generation in project-transitions.ts. Without this the projected margin
   *  would include a trainer leg that never gets paid. */
  noChainTrainer?: boolean;
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
  // Multi-party path — when the caller passes additionalClosers/Setters or
  // explicit m2 amounts, walk every party so co-setter/co-closer trainers
  // get projected legs of their own. Added 2026-05-23 to support the
  // Bryce/Patrick/Tyson multi-trainer scenario.
  const usesMultiParty =
    (project.additionalClosers && project.additionalClosers.length > 0) ||
    (project.additionalSetters && project.additionalSetters.length > 0) ||
    project.m2Amount !== undefined ||
    project.setterM2Amount !== undefined;

  if (usesMultiParty) {
    return computeMultiPartyProjectedLegs(project, trainerAssignments, payrollEntries);
  }

  // ── Legacy single-party path — preserves every pre-2026-05-23 behavior
  // for callers that haven't been upgraded yet. ─────────────────────────
  const legs: ProjectedTrainerLeg[] = [];
  const wattsTotal = (project.kWSize ?? 0) * 1000;

  // Admin cleared all chain trainers — mirror resolveTrainerLegs EXACTLY: a
  // per-project override still pays its single leg (named like the multi-party
  // override leg: setter-trainer when a setter exists, else closer-trainer);
  // every chain-derived leg is suppressed. (In the UI, setting noChainTrainer
  // also clears trainerId/trainerRate, so this is normally a clean "no legs" —
  // the override branch only matters for API-set deals, where it keeps this
  // legacy path consistent with the engine + actual payroll generation.)
  if (project.noChainTrainer) {
    if (project.trainerId && project.trainerRate != null) {
      return [buildLeg(project.trainerId, project.trainerRate, wattsTotal, project.setterId ? 'setter-trainer' : 'closer-trainer', 'project-override', project.id, payrollEntries)];
    }
    return legs;
  }

  // ── Closer-trainer leg ──
  // Resolves the closer's chain trainer, honoring the per-project
  // override (which short-circuits the chain in resolveTrainerRate's
  // step 1). Guard: when trainer === closer AND there's a setter,
  // the setter-trainer leg below will fire and pay this same trainer
  // — emitting both would double-pay (closer is also the trainer for
  // the setter, but not for themselves). Matches the same guard in
  // project-transitions.ts.
  const closerRes = resolveTrainerRate(
    { id: project.id, trainerId: project.trainerId, trainerRate: project.trainerRate },
    project.repId,
    trainerAssignments,
    payrollEntries,
  );
  const closerSelfTrainerWithSetter =
    closerRes.trainerId === project.repId && project.setterId != null;

  // ── Setter-trainer resolution ──
  // Resolved up-front (independent of the closer leg) so we can dedup
  // SAME-TRAINER-BOTH-LEGS before emitting. Mirrors project-transitions.ts.
  let setterRate = 0;
  let setterTrainerId: string | null = null;
  let setterReason = '';
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
    setterRate = overrideAppliesToSetter ? project.trainerRate! : setterResRaw.rate;
    setterTrainerId = overrideAppliesToSetter ? project.trainerId! : setterResRaw.trainerId;
    setterReason = overrideAppliesToSetter ? 'project-override' : setterResRaw.reason;
  }

  // Single-trainer rule: one leg per project even when same trainer
  // appears on both closer + setter chains. Mirrors the dedup in
  // project-transitions.ts at the engine level so projection and actual
  // payroll generation can never disagree.
  const sameTrainerBothLegs =
    !!closerRes.trainerId &&
    closerRes.rate > 0 &&
    !!setterTrainerId &&
    setterRate > 0 &&
    closerRes.trainerId === setterTrainerId;

  const closerLegFires = closerRes.rate > 0 && !!closerRes.trainerId && !closerSelfTrainerWithSetter;
  if (closerLegFires) {
    legs.push(buildLeg(closerRes.trainerId!, closerRes.rate, wattsTotal, 'closer-trainer', closerRes.reason, project.id, payrollEntries));
  }

  // Setter leg fires UNLESS the closer leg already fired for the same
  // trainer (the combined case). Self-trainer-with-setter SUPPRESSES the
  // closer leg, so the setter leg is allowed to fire in that case — it's
  // the path that actually pays the trainer.
  const setterLegFires =
    !!project.setterId &&
    !!setterTrainerId &&
    setterRate > 0 &&
    !(closerLegFires && sameTrainerBothLegs);
  if (setterLegFires) {
    legs.push(buildLeg(setterTrainerId!, setterRate, wattsTotal, 'setter-trainer', setterReason, project.id, payrollEntries));
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
 * Multi-party path — walks every closer + setter party on the deal,
 * resolves each chain, applies the same self-trainer-with-setter guard
 * and cross-side cap as the engine in project-transitions.ts.
 *
 * Returns one ProjectedTrainerLeg per dedup'd trainer (not per party),
 * with `trainees[]` listing every party whose chain led to this trainer
 * and `share` reflecting their summed contribution (capped at 1.0).
 *
 * For the project page Commission Breakdown, this means a Bryce/Patrick/
 * Tyson deal renders two trainer rows: Hunter (via Patrick, share 0.5)
 * and Paul (via Tyson, share 0.5).
 */
function computeMultiPartyProjectedLegs(
  project: TrainerProjectionInput,
  trainerAssignments: readonly TrainerResolverAssignment[],
  payrollEntries: readonly PayrollEntryWithStatus[],
): ProjectedTrainerLeg[] {
  const wattsTotal = (project.kWSize ?? 0) * 1000;

  const primaryCloserM2 = project.m2Amount ?? 1;
  const closerParties = [
    { userId: project.repId, m2Amount: primaryCloserM2 },
    ...(project.additionalClosers ?? []).map((c) => ({
      userId: c.userId,
      userName: c.userName,
      m2Amount: c.m2Amount,
    })),
  ];
  const setterParties = project.setterId
    ? [
        { userId: project.setterId, m2Amount: project.setterM2Amount ?? 1 },
        ...(project.additionalSetters ?? []).map((s) => ({
          userId: s.userId,
          userName: s.userName,
          m2Amount: s.m2Amount,
        })),
      ]
    : (project.additionalSetters ?? []).map((s) => ({
        userId: s.userId,
        userName: s.userName,
        m2Amount: s.m2Amount,
      }));

  const repName = (_id: string): string | undefined => undefined; // names hydrated by caller
  const rawLegs = resolveTrainerLegs(
    {
      project: { id: project.id, trainerId: project.trainerId, trainerRate: project.trainerRate, noChainTrainer: project.noChainTrainer },
      closerParties,
      setterParties,
      trainerAssignments,
      payrollEntries,
    },
    repName,
  );

  // Same guards as the engine: self-trainer-with-setter drops the closer-side
  // self-loop leg when any setter party exists.
  const anySetter = setterParties.some((p) => !!p.userId);
  const filteredLegs = rawLegs.filter((leg) => {
    if (leg.side === 'closer' && anySetter && leg.trainerId === leg.traineeId) {
      return false;
    }
    return true;
  });

  // Aggregate by trainerId.
  interface Group {
    trainerId: string;
    legs: TrainerLeg[];
    totalShare: number;
    chosenRate: number;
    chosenShareForRate: number;
    isOverride: boolean;
    sides: Set<'closer' | 'setter' | 'override'>;
  }
  const byTrainer = new Map<string, Group>();
  for (const leg of filteredLegs) {
    const existing = byTrainer.get(leg.trainerId);
    if (existing) {
      existing.legs.push(leg);
      existing.totalShare += leg.share;
      existing.sides.add(leg.side);
      if (leg.share > existing.chosenShareForRate) {
        existing.chosenRate = leg.ratePerW;
        existing.chosenShareForRate = leg.share;
      }
    } else {
      byTrainer.set(leg.trainerId, {
        trainerId: leg.trainerId,
        legs: [leg],
        totalShare: leg.share,
        chosenRate: leg.ratePerW,
        chosenShareForRate: leg.share,
        isOverride: leg.side === 'override',
        sides: new Set([leg.side]),
      });
    }
  }

  const out: ProjectedTrainerLeg[] = [];
  for (const group of byTrainer.values()) {
    const cappedShare = Math.min(1.0, group.totalShare);
    const amount = group.chosenRate * wattsTotal * cappedShare;
    if (amount <= 0) continue;

    // Determine the dominant leg name for backward compat. Prefer the side
    // with the largest accumulated share; tie → setter (matches legacy
    // dedup behavior where setter leg owns the combined entry).
    const closerShare = group.legs
      .filter((l) => l.side === 'closer')
      .reduce((s, l) => s + l.share, 0);
    const setterShare = group.legs
      .filter((l) => l.side === 'setter')
      .reduce((s, l) => s + l.share, 0);
    const legName: 'closer-trainer' | 'setter-trainer' =
      group.isOverride
        ? (project.setterId ? 'setter-trainer' : 'closer-trainer')
        : (setterShare >= closerShare ? 'setter-trainer' : 'closer-trainer');

    const entry = payrollEntries.find(
      (e) => e.projectId === project.id && e.paymentStage === 'Trainer' && e.repId === group.trainerId,
    );

    const trainees = group.legs
      .filter((l) => l.traineeId !== null)
      .map((l) => ({ userId: l.traineeId, name: l.traineeName }));

    out.push({
      trainerId: group.trainerId,
      rate: group.chosenRate,
      amount,
      leg: legName,
      reason: group.legs[0].reason,
      paid: !!(entry && entry.status === 'Paid'),
      hasEntry: !!entry,
      trainees,
      share: cappedShare,
    });
  }
  return out;
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
