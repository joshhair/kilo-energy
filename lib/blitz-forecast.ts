/**
 * blitz-forecast.ts — Personal earnings forecast helper.
 *
 * "If you close X deals at this blitz, you'd earn ~$Y" — answers the
 * pre-blitz commitment question for reps. Used on the blitz detail
 * page (Phase 2d).
 *
 * # The math
 *
 *   forecast = expectedDeals × avgCommissionPerDeal
 *
 * Where `avgCommissionPerDeal` is the rep's role-aware historical
 * average over their non-cancelled projects:
 *
 *   - Closer-leaning rep: avg of (m1 + m2 + m3) from deals they closed
 *   - Setter-leaning rep: avg of (setterM1 + setterM2 + setterM3) from deals they set
 *   - Mixed rep: weighted average by role frequency
 *
 * For new reps with <3 historical deals, fall back to a global rep
 * average baseline. Without this fallback the forecast would show $0
 * which is demoralizing and useless.
 */

import type { PipelineProject } from './aggregators';

export interface ForecastInputs {
  /** Viewer's historical projects (any phase except Cancelled). */
  projects: ReadonlyArray<PipelineProject>;
  /** Viewer's user id — drives role resolution per project. */
  repId: string | null;
  /** How many deals to project. */
  expectedDeals: number;
  /** Global fallback when the rep has < MIN_HISTORY deals. Computed
   *  upstream from the team-wide avg or admin-set baseline. */
  fallbackAvgPerDeal?: number;
}

const MIN_HISTORY = 3;

/**
 * Compute the rep's historical average commission per deal. Returns 0
 * if they have no qualifying deals (caller should swap in a fallback).
 */
export function computeAvgCommissionPerDeal(
  projects: ReadonlyArray<PipelineProject>,
  repId: string | null,
): number {
  if (!repId) return 0;
  let total = 0;
  let count = 0;
  for (const p of projects) {
    if (p.phase === 'Cancelled') continue;
    let commission = 0;
    if (p.repId === repId) {
      commission = (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0);
    } else if (p.setterId === repId) {
      commission = (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0);
    } else {
      const cc = p.additionalClosers?.find((c) => c.userId === repId);
      if (cc) commission = cc.m1Amount + cc.m2Amount + (cc.m3Amount ?? 0);
      else {
        const cs = p.additionalSetters?.find((s) => s.userId === repId);
        if (cs) commission = cs.m1Amount + cs.m2Amount + (cs.m3Amount ?? 0);
      }
    }
    if (commission > 0) {
      total += commission;
      count += 1;
    }
  }
  if (count === 0) return 0;
  return total / count;
}

/**
 * Project earnings for `expectedDeals` deals at the viewer's
 * historical avg. Falls back to `fallbackAvgPerDeal` when the rep
 * doesn't have enough history (< MIN_HISTORY non-cancelled deals
 * with positive commission). Returns a non-negative integer.
 */
export function forecastBlitzEarnings(inputs: ForecastInputs): {
  forecast: number;
  avgPerDeal: number;
  usedFallback: boolean;
} {
  const { projects, repId, expectedDeals, fallbackAvgPerDeal = 0 } = inputs;
  if (expectedDeals <= 0) {
    return { forecast: 0, avgPerDeal: 0, usedFallback: false };
  }

  // Count qualifying historical deals to decide whether to use the rep's
  // own average or fall back. A new rep with one $30K deal shouldn't see
  // a forecast that assumes every deal is $30K — too volatile.
  const qualifying = projects.filter((p) => p.phase !== 'Cancelled');
  const repAvg = computeAvgCommissionPerDeal(qualifying, repId);
  const hasEnoughHistory = qualifying.length >= MIN_HISTORY && repAvg > 0;

  const avgPerDeal = hasEnoughHistory ? repAvg : fallbackAvgPerDeal;
  const usedFallback = !hasEnoughHistory && fallbackAvgPerDeal > 0;
  const forecast = Math.max(0, Math.round(expectedDeals * avgPerDeal));
  return { forecast, avgPerDeal: Math.round(avgPerDeal), usedFallback };
}
