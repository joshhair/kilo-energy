/**
 * period-projection.ts — Phase-weighted pipeline boost helper.
 *
 * The mobile dashboard's "On Pace For YYYY" hero uses the formula:
 *
 *   OnPace(P) = commissionEarnedFromInPeriodDeals
 *             + paceRate × monthsRemainingInP
 *
 * (See app/dashboard/mobile/MobileDashboard.tsx for the assembly.) The
 * pipeline boost helper below is used in places where the hero needs to
 * credit existing-pipeline milestone cash that lands within the window
 * — currently exposed via computePhaseWeightedBoost for tests and any
 * future surfaces that want to display "pipeline value firing in
 * window" as a standalone stat.
 *
 * Math summary (no outer constant multiplier — per-milestone tables
 * ARE the probabilities):
 *
 *   boost = Σ over in-flight deals of:
 *             m1Mult[phase][horizon] × deal.m1
 *           + m2Mult[phase][horizon] × deal.m2
 *           + m3Mult[phase][horizon] × deal.m3
 *
 * Calibrated to typical residential-solar cadence (M1 at Acceptance ~1mo
 * after sold, M2 at Install ~4mo, M3 at PTO ~7mo). Adjust the table
 * values below if your installer mix runs notably faster or slower.
 */

import type { PipelineProject } from './aggregators';

// ─── On-pace formula (pure, testable) ──────────────────────────────────

/** Sum of M1 + M2 + M3 the viewer is owed on a single deal, regardless
 *  of when each milestone fires. Role-aware: primary closer, primary
 *  setter, additional closer/setter, or 0 if not on the deal. Mirrors
 *  the resolver used inside computePhaseWeightedBoost; exposed here so
 *  the dashboard's "commission earned from in-period deals" sum stays
 *  in lockstep with the helper above. */
export function viewerFullCommission(
  project: Pick<
    PipelineProject,
    | 'repId' | 'setterId'
    | 'm1Amount' | 'm2Amount' | 'm3Amount'
    | 'setterM1Amount' | 'setterM2Amount' | 'setterM3Amount'
    | 'additionalClosers' | 'additionalSetters'
  >,
  repId: string | null,
): number {
  if (!repId) return 0;
  if (project.repId === repId) {
    return (project.m1Amount ?? 0) + (project.m2Amount ?? 0) + (project.m3Amount ?? 0);
  }
  if (project.setterId === repId) {
    return (project.setterM1Amount ?? 0) + (project.setterM2Amount ?? 0) + (project.setterM3Amount ?? 0);
  }
  const cc = project.additionalClosers?.find((c) => c.userId === repId);
  if (cc) return (cc.m1Amount ?? 0) + (cc.m2Amount ?? 0) + (cc.m3Amount ?? 0);
  const cs = project.additionalSetters?.find((c) => c.userId === repId);
  if (cs) return (cs.m1Amount ?? 0) + (cs.m2Amount ?? 0) + (cs.m3Amount ?? 0);
  return 0;
}

/** The hero "On Pace" projection. Pure; no side effects.
 *
 *    OnPace = inPeriodCommissionEarned + paceRate × monthsRemainingInP
 *
 *  - inPeriodCommissionEarned: sum of viewerFullCommission across deals
 *    SOLD inside the period (credited at face value the moment they're
 *    sold, regardless of when milestones fire).
 *  - paceRate: rep's per-month earning rate at current cadence
 *    (= dealsPerMonth × avgFullCommissionPerDeal).
 *  - daysRemainingInPeriod: calendar days left in the active period.
 *    Converted to months via /30.44. Negative or zero clamps to 0 so
 *    closed periods don't subtract from earnings. */
export function computeOnPace(inputs: {
  inPeriodCommissionEarned: number;
  paceRate: number;
  daysRemainingInPeriod: number;
}): number {
  const monthsRemaining = Math.max(0, inputs.daysRemainingInPeriod / 30.44);
  return Math.max(0, Math.round(inputs.inPeriodCommissionEarned + inputs.paceRate * monthsRemaining));
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
