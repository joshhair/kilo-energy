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
 * Phase multipliers per projection horizon. Each entry is the fraction
 * of that phase's upcoming-M2 (and upcoming-M1 for the New phase) that
 * is expected to land within the horizon. Calibrated against typical
 * solar-install cadence — adjust the values here if your installer mix
 * runs faster/slower than baseline.
 *
 * Phases NOT in the table (Installed, PTO, Completed) contribute 0 to
 * the boost — those deals have already fired their M2 (which is captured
 * by the monthlyRate via actual paid history), so including them again
 * would double-count.
 */
const PHASE_MULT_30: Record<string, number> = {
  'New': 0.02,
  'Acceptance': 0.05,
  'Site Survey': 0.10,
  'Design': 0.20,
  'Permitting': 0.40,
  'Pending Install': 0.80,
};

const PHASE_MULT_90: Record<string, number> = {
  'New': 0.20,
  'Acceptance': 0.30,
  'Site Survey': 0.50,
  'Design': 0.65,
  'Permitting': 0.85,
  'Pending Install': 1.0,
};

const PHASE_MULT_365: Record<string, number> = {
  'New': 1.0,
  'Acceptance': 1.0,
  'Site Survey': 1.0,
  'Design': 1.0,
  'Permitting': 1.0,
  'Pending Install': 1.0,
};

/**
 * Pick the right phase-multiplier table for the given horizon. Step-
 * wise rather than continuously interpolated for legibility — the
 * three breakpoints (45d, 135d) split the period selector cleanly
 * into "month", "quarter", and "year" ranges.
 */
function getPhaseMultiplierTable(daysRemaining: number | null): Record<string, number> {
  if (daysRemaining === null) return PHASE_MULT_365;
  if (daysRemaining <= 45) return PHASE_MULT_30;
  if (daysRemaining <= 135) return PHASE_MULT_90;
  return PHASE_MULT_365;
}

/**
 * Phases where M1 is still upcoming (hasn't fired yet). At any phase
 * past 'New', the deal has been Accepted so M1 already paid out (and
 * is captured in monthlyRate via paid history). Only 'New' deals
 * contribute M1 to the boost.
 */
const PRE_ACCEPTANCE_PHASES = new Set<string>(['New']);

/**
 * Phases excluded from the boost entirely. Cancelled deals never close.
 * Installed/PTO/Completed deals have already fired M2 — including them
 * would double-count against the monthlyRate.
 */
const EXCLUDED_FROM_BOOST_PHASES = new Set<string>([
  'Cancelled',
  'On Hold',
  'Installed',
  'PTO',
  'Completed',
]);

/**
 * Resolve the viewer's role-aware M1 and M2 amount contribution on a
 * given project. Mirrors the resolution used in the on-pace and
 * Expected Pay calculations elsewhere — primary closer takes M1+M2
 * fields, primary setter takes setter* fields, co-party takes their
 * row's amounts, not-on-deal contributes nothing.
 */
function viewerM1M2(project: PipelineProject, repId: string): { m1: number; m2: number } {
  if (project.repId === repId) {
    return { m1: project.m1Amount ?? 0, m2: project.m2Amount ?? 0 };
  }
  if (project.setterId === repId) {
    return { m1: project.setterM1Amount ?? 0, m2: project.setterM2Amount ?? 0 };
  }
  const cc = project.additionalClosers?.find((c) => c.userId === repId);
  if (cc) return { m1: cc.m1Amount, m2: cc.m2Amount };
  const cs = project.additionalSetters?.find((s) => s.userId === repId);
  if (cs) return { m1: cs.m1Amount, m2: cs.m2Amount };
  return { m1: 0, m2: 0 };
}

/**
 * Compute the phase-weighted pipeline boost for a viewer.
 *
 * Sum (across the viewer's in-flight deals) of:
 *   phaseMultiplier(phase, horizon) × (m1 [if pre-Acceptance] + m2)
 * then multiply by the 0.15 outer factor.
 *
 * At `daysRemaining = null` (all-time), every phase weight is 1.0 so
 * the result is `0.15 × fullPipeline` — bit-identical to the legacy
 * annual pipeline boost. So callers can use this helper uniformly.
 *
 * Pure; no side effects.
 */
export function computePhaseWeightedBoost(
  projects: ReadonlyArray<PipelineProject>,
  repId: string | null,
  daysRemaining: number | null,
): number {
  if (!repId) return 0;

  const table = getPhaseMultiplierTable(daysRemaining);
  let weightedSum = 0;

  for (const project of projects) {
    if (EXCLUDED_FROM_BOOST_PHASES.has(project.phase)) continue;
    const mult = table[project.phase] ?? 0;
    if (mult === 0) continue;

    const { m1, m2 } = viewerM1M2(project, repId);
    const m1Contribution = PRE_ACCEPTANCE_PHASES.has(project.phase) ? m1 : 0;
    weightedSum += mult * (m1Contribution + m2);
  }

  // 0.15 outer factor — empirical "fraction of upcoming pipeline value
  // to credit beyond the rate-based projection". See module docstring
  // for the rationale on why this stays constant across horizons.
  return Math.round(0.15 * weightedSum);
}
