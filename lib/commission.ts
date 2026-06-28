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
  /** Admin's "remove all trainers" flag — suppresses chain trainer commission. */
  noChainTrainer?: boolean | null;
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
 * projectId → the deal's closer/setter ids. Lets the resolver scope a trainee's
 * consumed-deal count to projects THEY were a party to (closer or setter).
 * Without this scoping, a trainer with multiple trainees has every trainee's
 * tier resolved against the trainer's COMBINED Trainer-entry count, so trainees
 * burn numbered tiers early and are UNDERPAID. Callers on the actual-pay path
 * MUST pass it; when omitted the resolver falls back to the legacy unscoped
 * count (display/projection callers, corrected separately via the server field).
 */
export type ProjectPartiesLookup = ReadonlyMap<string, { closerId: string | null; setterId: string | null }>;

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
 * already earned a Trainer PayrollEntry AND this trainee was a party (closer
 * or setter) — not including the current project. A trainee's first deal sees
 * `consumed = 0` even if that deal already has draft Trainer entries on it.
 * Pass `projectParties` so the count is scoped to the trainee (see its docs);
 * omitting it falls back to the legacy unscoped count.
 */
export function resolveTrainerRate(
  project: TrainerResolverProject,
  closerRepId: string | null | undefined,
  trainerAssignments: readonly TrainerResolverAssignment[],
  payrollEntries: readonly TrainerResolverPayrollEntry[],
  projectParties?: ProjectPartiesLookup,
): TrainerRateResolution {
  // 1. Per-project override short-circuits the entire chain.
  if (project.trainerId && project.trainerRate != null) {
    return {
      rate: project.trainerRate,
      trainerId: project.trainerId,
      reason: 'project-override',
    };
  }

  // 1b. Admin removed all chain trainers from this deal. The override above
  //     still pays (checked first); everything chain-derived is suppressed.
  //     Mirrors resolveTrainerLegs + install-time payroll generation. Callers
  //     must pass the EFFECTIVE noChainTrainer for this to take effect.
  if (project.noChainTrainer) {
    return { rate: 0, trainerId: null, reason: 'none' };
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
  // deals (M2 + M3 both emit a Trainer row for the same project). The
  // projectParties scope (when supplied) restricts the count to deals where
  // THIS trainee was closer or setter — without it, a trainer with multiple
  // trainees resolves each trainee's tier against the combined count and
  // underpays them. Mirrors calculator/page.tsx:381-383 / :398-400.
  const consumedProjectIds = new Set<string>();
  for (const entry of payrollEntries) {
    if (entry.paymentStage !== 'Trainer') continue;
    if (entry.repId !== assignment.trainerId) continue;
    if (entry.projectId == null) continue;
    if (entry.projectId === project.id) continue;
    if (projectParties) {
      const parties = projectParties.get(entry.projectId);
      if (!parties || (parties.closerId !== assignment.traineeId && parties.setterId !== assignment.traineeId)) continue;
    }
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

// ─── Multi-party trainer-leg resolver ───────────────────────────────────────
//
// Built 2026-05-23 for the multi-setter/multi-trainer scenario (Bryce/Patrick/
// Tyson with separate trainers Hunter + Paul, splitting the deal 50/50).
//
// resolveTrainerRate above answers "what's the rate for ONE party?". This
// helper answers "what trainer entries should fire for ALL parties on this
// deal?" by walking the primary closer/setter AND each co-party, resolving
// each one's chain, and assigning a share so amounts split proportionally.
//
// Semantics:
//   * Per-project override (project.trainerId + project.trainerRate) wins
//     and SHORT-CIRCUITS: returns a single leg with share=1.0 attributed to
//     side='override'. This preserves the "historical / one-off mentor" UX
//     where admin says "for this one deal, Hunter at $0.10/W, period."
//   * Otherwise we walk every party (primary + co-parties) on each side
//     and resolve their TrainerAssignment chain. The party's share is its
//     M2 amount / total M2 amount on that side — so Patrick getting $500 of
//     a $1000 setter pool has share=0.5, and Hunter's leg pays out at
//     ratePerW × kW × installPct × 0.5.
//   * If the SAME trainer is reached via multiple legs (e.g. Hunter trains
//     both Patrick AND Tyson, or trains both a closer and a setter on the
//     same deal), the caller is responsible for dedup — typically by
//     summing the leg amounts and concatenating trainee names in the
//     PayrollEntry.notes field. We return one leg per party rather than
//     pre-merging so the caller has full forensic detail.
//   * Self-trainer-with-setter (closer is their own trainer AND a setter
//     exists) is a special case from prior bug history; the caller still
//     handles that — we just return the legs and let the existing dedup
//     rules decide what to fire.
//
// History context: when this was single-trainer-only, the resolver returned
// one rate. Co-setter trainers got NOTHING. The Bryce/Patrick deal on
// 2026-05-23 surfaced this — Patrick + Tyson 50/50 with trainers Hunter +
// Paul should have paid each trainer half the override, but Hunter got
// 100% and Paul got 0. See project_kilo_setter_regression memory for the
// surrounding incident chain.

/** Minimal shape of one party on a deal (primary or co-). */
export interface TrainerPartyInput {
  /** User ID of the closer or setter. Null/empty = no party on this slot. */
  userId: string | null | undefined;
  userName?: string;
  /** M2 dollars assigned to this party. Drives the share calc. */
  m2Amount: number;
}

/** Inputs needed to resolve all trainer legs for one project. */
export interface TrainerLegsInput {
  project: TrainerResolverProject;
  /** Primary closer + every additional closer with their M2 amounts. */
  closerParties: TrainerPartyInput[];
  /** Primary setter + every additional setter with their M2 amounts. */
  setterParties: TrainerPartyInput[];
  trainerAssignments: readonly TrainerResolverAssignment[];
  payrollEntries: readonly TrainerResolverPayrollEntry[];
  /** Scopes each trainee's consumed-deal count to their own deals — see
   *  ProjectPartiesLookup. Actual-pay callers MUST pass it. */
  projectParties?: ProjectPartiesLookup;
}

/** Which side of the deal a trainer leg attributes to. */
export type TrainerLegSide = 'closer' | 'setter' | 'override';

/** One trainer's pay leg on a deal. Multiple legs may share a trainerId. */
export interface TrainerLeg {
  trainerId: string;
  ratePerW: number;
  /** 0..1 — multiply into kW × installPct% for this leg's dollar amount. */
  share: number;
  side: TrainerLegSide;
  /** The trainee whose chain produced this leg. Null on override-path legs. */
  traineeId: string | null;
  /** Pre-resolved display name for the trainee, used in PayrollEntry.notes. */
  traineeName: string;
  reason: TrainerRateReason;
}

/**
 * Resolves every trainer leg that should fire on this deal. See section
 * comment above for semantics; see tests/unit/multi-setter-trainer-split
 * for worked examples.
 */
export function resolveTrainerLegs(
  input: TrainerLegsInput,
  repNameById: (id: string) => string | undefined,
): TrainerLeg[] {
  const { project, closerParties, setterParties, trainerAssignments, payrollEntries, projectParties } = input;

  // 1. Per-project override — single leg covering the whole deal.
  if (project.trainerId && project.trainerRate != null) {
    return [{
      trainerId: project.trainerId,
      ratePerW: project.trainerRate,
      share: 1.0,
      side: 'override',
      traineeId: null,
      traineeName: '',
      reason: 'project-override',
    }];
  }

  // Admin explicitly removed all chain trainers from this deal.
  if (project.noChainTrainer) return [];

  const legs: TrainerLeg[] = [];

  // 2. Closer side — walk every closer party, resolve each one's chain.
  const totalCloserM2 = closerParties.reduce((s, p) => s + (p.m2Amount || 0), 0);
  for (const party of closerParties) {
    if (!party.userId) continue;
    const res = resolveTrainerRate(
      // Pass override-free project shape so chain resolution isn't
      // short-circuited; the override path was handled above.
      { id: project.id, trainerId: null, trainerRate: null },
      party.userId,
      trainerAssignments,
      payrollEntries,
      projectParties,
    );
    if (res.rate <= 0 || !res.trainerId) continue;
    const share = totalCloserM2 > 0 ? (party.m2Amount || 0) / totalCloserM2 : 0;
    if (share <= 0) continue;
    legs.push({
      trainerId: res.trainerId,
      ratePerW: res.rate,
      share,
      side: 'closer',
      traineeId: party.userId,
      traineeName: party.userName ?? repNameById(party.userId) ?? '',
      reason: res.reason,
    });
  }

  // 3. Setter side — same pattern.
  const totalSetterM2 = setterParties.reduce((s, p) => s + (p.m2Amount || 0), 0);
  for (const party of setterParties) {
    if (!party.userId) continue;
    const res = resolveTrainerRate(
      { id: project.id, trainerId: null, trainerRate: null },
      party.userId,
      trainerAssignments,
      payrollEntries,
      projectParties,
    );
    if (res.rate <= 0 || !res.trainerId) continue;
    const share = totalSetterM2 > 0 ? (party.m2Amount || 0) / totalSetterM2 : 0;
    if (share <= 0) continue;
    legs.push({
      trainerId: res.trainerId,
      ratePerW: res.rate,
      share,
      side: 'setter',
      traineeId: party.userId,
      traineeName: party.userName ?? repNameById(party.userId) ?? '',
      reason: res.reason,
    });
  }

  return legs;
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
