/**
 * period-projection.ts — Period-scoped earnings projection.
 *
 * The mobile dashboard hero card shows an "on pace" projection. For
 * the legacy all-time and this-year periods, the projection is the
 * rep's annual run rate (today's behavior, kept). For shorter
 * windows (this-month, this-quarter) the projection scales to the
 * period's end so the headline answers "what am I on pace to earn
 * by the end of THIS month?" rather than "what am I on pace to earn
 * over the next 12 months?".
 *
 * Inputs come from MobileDashboard's on-pace memo (which already
 * computes the blended monthly rate + pipeline boost for the rep)
 * plus the period's days-remaining bound. The math itself is pure
 * and lives here so it can be unit-tested independently.
 *
 * # Math
 *
 * For `daysRemaining = null` (all-time horizon):
 *   projection = monthlyRate × 12 + pipelineBoostAnnual
 *
 * For `daysRemaining ≥ 0` (period horizon):
 *   projection = paidInPeriodSoFar
 *              + monthlyRate × (daysRemaining / 30.44)
 *              + pipelineBoostAnnual × (daysRemaining / 365)
 *
 * The pipeline boost scaling is linear in horizon length. Rationale:
 * the boost represents "deals expected to close within the projection
 * window." A shorter horizon catches fewer in-flight deals. 30 days
 * captures ~8% of the annual boost; 90 days ~25%; 365 days the full
 * boost. Calibration matches the historical 0.15 annual factor; if
 * future analysis shows pipeline conversion is non-linear in horizon,
 * swap this scalar for a phase-weighted version.
 */

export interface PeriodProjectionInputs {
  /** Earnings already collected in the period to date. Ignored for
   *  the all-time path (daysRemaining=null) which uses annual run
   *  rate directly. */
  paidInPeriodSoFar: number;
  /** Rep's blended monthly earning rate. Computed by the dashboard's
   *  on-pace memo as 60% pace-based + 40% actual-paid for reps with
   *  ≥60 days of history, pure pace-based otherwise. */
  monthlyEarningRate: number;
  /** Annual pipeline boost = 0.15 × (projected M1 + M2 on in-flight
   *  deals). This is the FULL annual figure; the helper scales it
   *  down linearly when projecting to a shorter horizon. */
  pipelineBoostAnnual: number;
  /** Days remaining until period end. Null → no horizon (all-time);
   *  use annual projection. ≤0 → period has already closed; treated
   *  as 0 (projection collapses to paidInPeriodSoFar). */
  daysRemaining: number | null;
}

/**
 * Project earnings for a period given the rep's blended rate +
 * pipeline boost. Pure; no side effects.
 *
 * Returns 0 if all inputs zero; never negative.
 */
export function computePeriodProjection(inputs: PeriodProjectionInputs): number {
  const { paidInPeriodSoFar, monthlyEarningRate, pipelineBoostAnnual, daysRemaining } = inputs;

  // All-time horizon: classic annual = monthlyRate × 12 + boost.
  // Matches the existing onPaceAnnual semantics so the hero number
  // is unchanged for the 'all' and 'this-year' periods (per user
  // direction — these stay anchored to year-end framing).
  if (daysRemaining === null) {
    return Math.max(0, Math.round(monthlyEarningRate * 12 + pipelineBoostAnnual));
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
  const boostComponent = pipelineBoostAnnual * (daysRemaining / 365);
  return Math.max(0, Math.round(paidInPeriodSoFar + paceComponent + boostComponent));
}
