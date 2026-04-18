/**
 * commission.ts — commission math for Kilo deals.
 *
 * All arithmetic uses the `Money` utility (lib/money.ts) internally to
 * avoid float drift. Public signatures still return `number` (dollars)
 * so existing call sites don't change.
 *
 * Extracted from lib/data.ts during Phase 7 structure polish — this is
 * the safety-critical code path that computes how much each rep gets
 * paid on every deal, so it lives on its own with its own test suite.
 */

import * as $ from './money';

// ─── Trainer-rate resolver ──────────────────────────────────────────────────
//
// Resolves the effective per-watt trainer override rate for a single deal.
// Precedence:
//   1. Per-project override (project.trainerId + project.trainerRate).
//   2. Rep-level TrainerAssignment tier chain (traineeId === closerRepId),
//      stepping through tiers sorted by sortOrder.
//   3. Nothing. rate = 0.
//
// Tier counting rule: "completed" = deals where the trainer has ALREADY
// earned a Trainer PayrollEntry. The current deal is explicitly excluded so
// the resolver stays stable across phase transitions (the trainer's M2/M3
// entries for THIS deal shouldn't consume a tier slot for THIS deal).

/** Minimal shape of a project for rate resolution. */
export interface TrainerResolverProject {
  id: string;
  trainerId?: string | null;
  trainerRate?: number | null;
}

/** Minimal shape of a tier. upToDeal is exclusive (tier covers 0..upToDeal-1). */
export interface TrainerResolverTier {
  upToDeal: number | null;
  ratePerW: number;
}

/** Minimal shape of a trainer assignment. Tiers must be in sortOrder. */
export interface TrainerResolverAssignment {
  id: string;
  trainerId: string;
  traineeId: string;
  tiers: TrainerResolverTier[];
  isActiveTraining?: boolean;
}

/** Minimal shape of a payroll entry for counting prior trainer earnings. */
export interface TrainerResolverPayrollEntry {
  repId: string;
  projectId: string | null;
  paymentStage: string;
}

/**
 * Why the resolver picked a given rate. Useful for debugging + telemetry;
 * `active-tier-N` encodes the 0-based tier index that was selected.
 */
export type TrainerRateReason =
  | 'project-override'
  | `active-tier-${number}`
  | 'maxed'
  | 'none';

export interface TrainerRateResolution {
  rate: number;
  trainerId: string | null;
  reason: TrainerRateReason;
}

/**
 * Returns the effective trainer rate + attributed trainer for one deal.
 *
 * Pure function — no DB, no state. Feed it the project, the closer's ID,
 * and the full trainer-assignment + payroll-entry lists (already loaded
 * into memory by the hydrating call site).
 *
 * `priorDealsConsumed` counts DISTINCT projectIds where this trainer has
 * already earned a Trainer PayrollEntry for this trainee — not including
 * the current project. A trainee's first deal sees `consumed = 0` even if
 * that deal already has draft Trainer entries on it.
 */
export function resolveTrainerRate(
  project: TrainerResolverProject,
  closerRepId: string | null | undefined,
  trainerAssignments: readonly TrainerResolverAssignment[],
  payrollEntries: readonly TrainerResolverPayrollEntry[],
): TrainerRateResolution {
  // 1. Per-project override short-circuits the entire chain.
  if (project.trainerId && project.trainerRate != null) {
    return {
      rate: project.trainerRate,
      trainerId: project.trainerId,
      reason: 'project-override',
    };
  }

  // 2. Rep-level assignment. The closer is the trainee; match on traineeId.
  if (!closerRepId) {
    return { rate: 0, trainerId: null, reason: 'none' };
  }
  const assignment = trainerAssignments.find((a) => a.traineeId === closerRepId);
  if (!assignment) {
    return { rate: 0, trainerId: null, reason: 'none' };
  }

  // Count PRIOR deals where this trainer-trainee pair already earned a
  // Trainer PayrollEntry. Using a Set on projectId de-duplicates multi-entry
  // deals (M2 + M3 both emit a Trainer row for the same project).
  const consumedProjectIds = new Set<string>();
  for (const entry of payrollEntries) {
    if (entry.paymentStage !== 'Trainer') continue;
    if (entry.repId !== assignment.trainerId) continue;
    if (entry.projectId == null) continue;
    if (entry.projectId === project.id) continue;
    consumedProjectIds.add(entry.projectId);
  }
  const dealsConsumed = consumedProjectIds.size;

  // 3. Walk tiers in order. First tier where the cap is either null
  //    (perpetuity) or still has capacity (consumed < upToDeal) wins.
  for (let i = 0; i < assignment.tiers.length; i++) {
    const tier = assignment.tiers[i];
    if (tier.upToDeal === null || dealsConsumed < tier.upToDeal) {
      return {
        rate: tier.ratePerW,
        trainerId: assignment.trainerId,
        reason: `active-tier-${i}`,
      };
    }
  }

  // 4. All capped, no perpetuity tier — trainer earns nothing on this deal.
  return { rate: 0, trainerId: null, reason: 'maxed' };
}

/** Per-rep breakdown of a deal's commission across milestones. */
export interface CommissionSplit {
  closerTotal: number;
  setterTotal: number;
  closerM1: number;
  closerM2: number;
  closerM3: number;
  setterM1: number;
  setterM2: number;
  setterM3: number;
}

/** Core formula in Money terms: max(0, (soldPPW - baseline) × kW × 1000). */
export function commissionMoney(soldPPW: number, baselinePerW: number, kW: number): $.Money {
  if (!Number.isFinite(soldPPW) || !Number.isFinite(baselinePerW) || !Number.isFinite(kW)) {
    return $.ZERO;
  }
  // Total watts × rate-diff $/W = total dollars. Round to cents ONCE, here.
  const dollars = (soldPPW - baselinePerW) * kW * 1000;
  return $.nonNegative($.fromDollars(dollars));
}

// Commission = (soldPPW - baseline) × kW × 1000
// Returns total commission amount in dollars.
export function calculateCommission(soldPPW: number, baselinePerW: number, kW: number): number {
  return $.toDollars(commissionMoney(soldPPW, baselinePerW, kW));
}

/**
 * Calculates the full closer/setter commission split and M1/M2/M3 milestone breakdown.
 * Pass setterBaselinePerW=0 for self-gen deals (no setter).
 * trainerRate is added on top of setterBaselinePerW before the 50/50 split point.
 *
 * All arithmetic is done in integer cents (`lib/money`). Invariants:
 *  - closerM1 + closerM2 + closerM3 === closerTotal (to the cent)
 *  - setterM1 + setterM2 + setterM3 === setterTotal (to the cent)
 *  - closerHalf + setterHalf === aboveSplit (to the cent, via splitEvenly)
 */
export function splitCloserSetterPay(
  soldPPW: number,
  closerPerW: number,
  setterBaselinePerW: number,
  trainerRate: number,
  kW: number,
  installPayPct: number,
): CommissionSplit {
  const isSelfGen = setterBaselinePerW === 0;

  let closerTotalM: $.Money;
  let setterTotalM: $.Money;
  if (isSelfGen) {
    closerTotalM = commissionMoney(soldPPW, closerPerW, kW);
    setterTotalM = $.ZERO;
  } else {
    // Closer gets paid on the $/W slice between their baseline and the
    // setter baseline (the "differential"), capped by soldPPW.
    const diffPerW = soldPPW > closerPerW
      ? Math.max(0, Math.min(setterBaselinePerW - closerPerW, soldPPW - closerPerW))
      : 0;
    const closerDifferentialM = diffPerW > 0
      ? $.fromDollars(diffPerW * kW * 1000)
      : $.ZERO;

    // Everything above the split point (setter baseline + trainer override)
    // is split 50/50. splitEvenly guarantees the two halves sum to the
    // whole — no 1-cent drift from independent rounding.
    const splitPoint = setterBaselinePerW + trainerRate;
    const aboveSplitM = commissionMoney(soldPPW, splitPoint, kW);
    const [closerHalf, setterHalf] = $.splitEvenly(aboveSplitM, 2);

    closerTotalM = $.add(closerDifferentialM, closerHalf);
    setterTotalM = setterHalf;
  }

  // M1 is a flat upfront amount that counts against the closer's total
  // on self-gen deals, or the setter's total on setter deals.
  const m1FlatM = $.fromDollars(kW >= 5 ? 1000 : 500);
  const closerM1M = isSelfGen ? $.min(m1FlatM, $.nonNegative(closerTotalM)) : $.ZERO;
  const closerRemainderM = $.nonNegative($.sub(closerTotalM, closerM1M));
  const setterM1M = isSelfGen ? $.ZERO : $.min(m1FlatM, $.nonNegative(setterTotalM));
  const setterRemainderM = $.nonNegative($.sub(setterTotalM, setterM1M));

  // M2/M3 split: allocate the remainder by installPayPct / (100-installPayPct).
  // allocate() guarantees m2+m3 === remainder exactly.
  const hasM3 = installPayPct < 100;
  let closerM2M: $.Money;
  let closerM3M: $.Money;
  let setterM2M: $.Money;
  let setterM3M: $.Money;
  if (hasM3) {
    [closerM2M, closerM3M] = $.allocate(closerRemainderM, [installPayPct, 100 - installPayPct]);
    [setterM2M, setterM3M] = $.allocate(setterRemainderM, [installPayPct, 100 - installPayPct]);
  } else {
    closerM2M = closerRemainderM;
    closerM3M = $.ZERO;
    setterM2M = setterRemainderM;
    setterM3M = $.ZERO;
  }

  return {
    closerTotal: $.toDollars(closerTotalM),
    setterTotal: $.toDollars(setterTotalM),
    closerM1: $.toDollars(closerM1M),
    closerM2: $.toDollars(closerM2M),
    closerM3: $.toDollars(closerM3M),
    setterM1: $.toDollars(setterM1M),
    setterM2: $.toDollars(setterM2M),
    setterM3: $.toDollars(setterM3M),
  };
}

/**
 * Decides whether to create a Draft setter M1 PayrollEntry when a setter is
 * added to a deal after initial submission. Called from the updateProject
 * setter-replacement path.
 *
 * Returns true ⇒ create a new Draft setter M1 for `newSetterId`.
 * Returns false ⇒ skip (admin will reconcile manually).
 *
 * Rules:
 *  1. Phase must be at or past Acceptance (before that no payroll exists yet).
 *  2. The deal must actually owe the setter an M1 (`effectiveSetterM1 > 0`).
 *  3. The NEW setter must not already have an M1 entry for this project
 *     (defensive — a duplicate create would double-pay).
 *  4. The PREVIOUS setter (if any) must not have been already Paid an M1 —
 *     that's the only case where admin must reconcile (can't un-pay).
 *
 * The key bug this fixes: historically the guard blocked when the CLOSER had
 * a Paid M1 (left over from when the deal had no setter). That left a new
 * setter silently without an M1 entry while `setterM1AmountCents` was still
 * set on the Project, producing orphan amounts. See check-timothy-salunga.mts
 * for the systemic-drift scan that found 15 projects with this shape.
 */
export function shouldCreateSetterM1OnSetterAdd(opts: {
  pastAcceptance: boolean;
  effectiveSetterM1: number | null | undefined;
  projectId: string;
  newSetterId: string;
  oldSetterId: string | null | undefined;
  existingEntries: ReadonlyArray<{
    projectId: string | null;
    repId: string;
    paymentStage: string;
    status: string;
  }>;
}): boolean {
  const { pastAcceptance, effectiveSetterM1, projectId, newSetterId, oldSetterId, existingEntries } = opts;
  if (!pastAcceptance) return false;
  if ((effectiveSetterM1 ?? 0) <= 0) return false;

  const newSetterAlreadyHasM1 = existingEntries.some(
    (e) => e.projectId === projectId && e.repId === newSetterId && e.paymentStage === 'M1',
  );
  if (newSetterAlreadyHasM1) return false;

  const previousSetterWasPaidM1 = !!oldSetterId && existingEntries.some(
    (e) =>
      e.projectId === projectId &&
      e.repId === oldSetterId &&
      e.paymentStage === 'M1' &&
      e.status === 'Paid',
  );
  return !previousSetterWasPaidM1;
}
