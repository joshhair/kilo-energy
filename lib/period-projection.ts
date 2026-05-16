/**
 * period-projection.ts — Period-scoped earnings projection.
 *
 * The mobile dashboard hero card shows an "on pace" projection that
 * adapts by period. The math reconciles across periods so a rep
 * switching between this-month, this-quarter, this-year tells a
 * coherent story (consistency was the central design requirement).
 *
 * # Two periods, two math shapes
 *
 * `all` ('lifetime trajectory hypothetical'):
 *   projection = monthlyRate × 12 + 0.15 × fullPipeline
 *   This is the legacy formula — kept unchanged. Answers
 *   "what's your annualized run rate?" not "what will you finish
 *   the calendar year with?".
 *
 * `this-month` / `this-quarter` / `this-year` (period-scoped):
 *   projection = paidInPeriodSoFar
 *              + monthlyRate × (daysRemaining / 30.44)
 *              + pipelineBoostForHorizon
 *   Where pipelineBoostForHorizon is computed via the phase-weighted
 *   helper below — different phases get different probabilities of
 *   converting to M2 within the horizon window. Answers "what will
 *   you actually end the period with?".
 *
 * # Phase-weighted boost (the accuracy upgrade)
 *
 * Old design: boost = 0.15 × allPipeline × (daysRemaining / 365).
 * Linear scaling treats every phase equally — a "New" deal counts the
 * same as a "Pending Install" deal in the 30-day projection. That
 * over-projects for early-pipeline reps and under-projects for
 * late-pipeline reps.
 *
 * New design: boost = 0.15 × Σ(phaseMultiplier(phase, horizon) × m1m2).
 * Late-phase deals dominate the short-horizon boost; early-phase deals
 * dominate the long-horizon boost. At 365 days, every phase is 1.0 so
 * the calculation collapses back to 0.15 × fullPipeline — same as the
 * all-time annual number.
 *
 * # Why this is the consistent design
 *
 * Reconciliation: a rep switching this-month → this-quarter → this-year
 * sees numbers that build coherently — paid-so-far carries forward,
 * pace component scales with horizon, boost adapts to phase × horizon.
 * Tested in tests/unit/period-projection.test.ts.
 */

import type { PipelineProject } from './aggregators';

export interface PeriodProjectionInputs {
  /** Earnings already collected in the period to date. Ignored for
   *  the all-time path (daysRemaining=null) which uses annual run
   *  rate directly. */
  paidInPeriodSoFar: number;
  /** Rep's blended monthly earning rate. Computed by the dashboard's
   *  on-pace memo as 60% pace-based + 40% actual-paid for reps with
   *  ≥60 days of history, pure pace-based otherwise. */
  monthlyEarningRate: number;
  /** Pipeline boost already scaled to the projection horizon. Caller
   *  is responsible for phase-weighting via computePhaseWeightedBoost
   *  before passing in. For the all-time path, pass `0.15 × fullPipeline`
   *  (the annual boost figure). For period paths, pass the result of
   *  computePhaseWeightedBoost(projects, repId, daysRemaining). */
  pipelineBoostForHorizon: number;
  /** Days remaining until period end. Null → no horizon (all-time);
   *  use annual projection. ≤0 → period has already closed; treated
   *  as 0 (projection collapses to paidInPeriodSoFar). */
  daysRemaining: number | null;
}

/**
 * Project earnings for a period given the rep's blended rate +
 * (already-scaled) pipeline boost. Pure; no side effects.
 *
 * Returns 0 if all inputs zero; never negative.
 */
export function computePeriodProjection(inputs: PeriodProjectionInputs): number {
  const { paidInPeriodSoFar, monthlyEarningRate, pipelineBoostForHorizon, daysRemaining } = inputs;

  // All-time horizon: classic annual = monthlyRate × 12 + full boost.
  // Matches the existing onPaceAnnual semantics so the hero number is
  // unchanged for the 'all' period (per user direction — this stays
  // anchored to the "annualized rate" framing). Caller should pass the
  // full annual boost (0.15 × fullPipeline) for this path.
  if (daysRemaining === null) {
    return Math.max(0, Math.round(monthlyEarningRate * 12 + pipelineBoostForHorizon));
  }

  // Closed period (daysRemaining ≤ 0) — no future projection, just
  // the actual-paid total. Defensive: this branch shouldn't normally
  // fire because historical periods use a different hero variant.
  if (daysRemaining <= 0) {
    return Math.max(0, Math.round(paidInPeriodSoFar));
  }

  // Open period: paid-to-date + pace × remaining days + scaled boost.
  // 30.44 is the average days-per-month over a calendar year (365/12);
  // dividing daysRemaining by it converts a "days" horizon into a
  // "months at current rate" multiplier for the monthly rate.
  const paceComponent = monthlyEarningRate * (daysRemaining / 30.44);
  return Math.max(0, Math.round(paidInPeriodSoFar + paceComponent + pipelineBoostForHorizon));
}

// ─── Phase-weighted boost ───────────────────────────────────────────────

/**
 * Per-milestone × per-horizon probability tables. Each value is the
 * expected fraction of that milestone payment that fires within the
 * projection window for a deal sitting at the given phase.
 *
 *  - M1 fires at Acceptance: only "New" deals have pending M1
 *  - M2 fires at Install:    pre-Install phases have pending M2
 *  - M3 fires at PTO:        every non-Completed phase has pending M3
 *    (and the post-Install phases dominate the short-horizon M3 boost)
 *
 * Tables are step-wise (30 / 90 / 365 day buckets) rather than
 * continuously interpolated for legibility. Each value is calibrated
 * against typical residential-solar cadence — adjust if your installer
 * mix runs faster/slower.
 *
 * No outer 0.15 multiplier — the per-phase probabilities ARE the credit
 * fraction. Earlier formulas had both, double-discounting pipeline.
 */
const M1_MULT_30: Record<string, number>  = { 'New': 0.50 };
const M1_MULT_90: Record<string, number>  = { 'New': 0.85 };
const M1_MULT_365: Record<string, number> = { 'New': 1.00 };

const M2_MULT_30: Record<string, number> = {
  'New': 0.02, 'Acceptance': 0.05, 'Site Survey': 0.10,
  'Design': 0.20, 'Permitting': 0.40, 'Pending Install': 0.80,
};
const M2_MULT_90: Record<string, number> = {
  'New': 0.20, 'Acceptance': 0.30, 'Site Survey': 0.50,
  'Design': 0.65, 'Permitting': 0.85, 'Pending Install': 1.00,
};
const M2_MULT_365: Record<string, number> = {
  'New': 1.0, 'Acceptance': 1.0, 'Site Survey': 1.0,
  'Design': 1.0, 'Permitting': 1.0, 'Pending Install': 1.0,
};

// M3 fires later than M2 (PTO ≈ 3-6 months after install), so each
// row of the M3 table is shifted right vs M2 — only post-install phases
// contribute meaningfully at the 30-day horizon.
const M3_MULT_30: Record<string, number> = {
  'Pending Install': 0.02, 'Installed': 0.20, 'PTO': 0.50,
};
const M3_MULT_90: Record<string, number> = {
  'Design': 0.02, 'Permitting': 0.05, 'Pending Install': 0.15,
  'Installed': 0.50, 'PTO': 1.00,
};
const M3_MULT_365: Record<string, number> = {
  'New': 0.40, 'Acceptance': 0.45, 'Site Survey': 0.55,
  'Design': 0.65, 'Permitting': 0.75, 'Pending Install': 0.85,
  'Installed': 1.00, 'PTO': 1.00,
};

function pickTables(daysRemaining: number | null) {
  if (daysRemaining === null) return { m1: M1_MULT_365, m2: M2_MULT_365, m3: M3_MULT_365 };
  if (daysRemaining <= 45)    return { m1: M1_MULT_30,  m2: M2_MULT_30,  m3: M3_MULT_30  };
  if (daysRemaining <= 135)   return { m1: M1_MULT_90,  m2: M2_MULT_90,  m3: M3_MULT_90  };
  return { m1: M1_MULT_365, m2: M2_MULT_365, m3: M3_MULT_365 };
}

/**
 * Phases excluded from the boost entirely. Cancelled / On Hold deals
 * never produce milestones. "Completed" deals have already fired every
 * milestone including M3, so they contribute nothing forward-looking.
 */
const EXCLUDED_FROM_BOOST_PHASES = new Set<string>([
  'Cancelled',
  'On Hold',
  'Completed',
]);

/**
 * Resolve the viewer's role-aware M1, M2, M3 amount contribution on a
 * given project. Mirrors the resolution used in the on-pace and
 * Expected Pay calculations elsewhere — primary closer takes M*Amount
 * fields, primary setter takes setterM*Amount fields, co-party takes
 * their row's amounts, not-on-deal contributes nothing.
 */
function viewerMilestones(project: PipelineProject, repId: string): { m1: number; m2: number; m3: number } {
  if (project.repId === repId) {
    return {
      m1: project.m1Amount ?? 0,
      m2: project.m2Amount ?? 0,
      m3: project.m3Amount ?? 0,
    };
  }
  if (project.setterId === repId) {
    return {
      m1: project.setterM1Amount ?? 0,
      m2: project.setterM2Amount ?? 0,
      m3: project.setterM3Amount ?? 0,
    };
  }
  const cc = project.additionalClosers?.find((c) => c.userId === repId);
  if (cc) return { m1: cc.m1Amount, m2: cc.m2Amount, m3: cc.m3Amount ?? 0 };
  const cs = project.additionalSetters?.find((s) => s.userId === repId);
  if (cs) return { m1: cs.m1Amount, m2: cs.m2Amount, m3: cs.m3Amount ?? 0 };
  return { m1: 0, m2: 0, m3: 0 };
}

/**
 * Compute the phase-weighted pipeline boost for a viewer.
 *
 * Sum (across the viewer's in-flight deals) of per-milestone expected
 * value within the horizon:
 *
 *   Σ over projects of:
 *     m1Mult[phase][horizon] × deal.m1
 *   + m2Mult[phase][horizon] × deal.m2
 *   + m3Mult[phase][horizon] × deal.m3
 *
 * No outer scaling factor — the per-phase probabilities are the credit
 * fraction. At 365-day horizon, M1 and M2 multipliers are 1.0 (every
 * in-flight deal closes within a year) and M3 multipliers reflect that
 * earlier-pipeline deals' PTO may slip past year-end (0.40-0.85).
 *
 * Pure; no side effects.
 */
export function computePhaseWeightedBoost(
  projects: ReadonlyArray<PipelineProject>,
  repId: string | null,
  daysRemaining: number | null,
): number {
  if (!repId) return 0;
  const { m1: m1Table, m2: m2Table, m3: m3Table } = pickTables(daysRemaining);
  let total = 0;
  for (const project of projects) {
    if (EXCLUDED_FROM_BOOST_PHASES.has(project.phase)) continue;
    const { m1, m2, m3 } = viewerMilestones(project, repId);
    total += (m1Table[project.phase] ?? 0) * m1;
    total += (m2Table[project.phase] ?? 0) * m2;
    total += (m3Table[project.phase] ?? 0) * m3;
  }
  return Math.round(total);
}
