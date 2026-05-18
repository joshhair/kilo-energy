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
import {
  ACTIVE_PHASES,
  INSTALLER_PAY_CONFIGS,
  DEFAULT_INSTALL_PAY_PCT,
  getTrainerOverrideRate,
  type TrainerAssignment,
} from './data';

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

// ─── Per-milestone resolver (exported for the cash-forecast helper) ────

/** Per-milestone amounts the viewer is owed on a single deal, role-aware.
 *  Returns each milestone separately so callers can date them
 *  individually (e.g. cash-forecast helper). */
export function viewerMilestones(
  project: Pick<
    PipelineProject,
    | 'repId' | 'setterId'
    | 'm1Amount' | 'm2Amount' | 'm3Amount'
    | 'setterM1Amount' | 'setterM2Amount' | 'setterM3Amount'
    | 'additionalClosers' | 'additionalSetters'
  >,
  repId: string | null,
): { m1: number; m2: number; m3: number } {
  if (!repId) return { m1: 0, m2: 0, m3: 0 };
  if (project.repId === repId) {
    return { m1: project.m1Amount ?? 0, m2: project.m2Amount ?? 0, m3: project.m3Amount ?? 0 };
  }
  if (project.setterId === repId) {
    return { m1: project.setterM1Amount ?? 0, m2: project.setterM2Amount ?? 0, m3: project.setterM3Amount ?? 0 };
  }
  const cc = project.additionalClosers?.find((c) => c.userId === repId);
  if (cc) return { m1: cc.m1Amount ?? 0, m2: cc.m2Amount ?? 0, m3: cc.m3Amount ?? 0 };
  const cs = project.additionalSetters?.find((c) => c.userId === repId);
  if (cs) return { m1: cs.m1Amount ?? 0, m2: cs.m2Amount ?? 0, m3: cs.m3Amount ?? 0 };
  return { m1: 0, m2: 0, m3: 0 };
}

// ─── Cash Forecast (2026 hero) ──────────────────────────────────────────

/** Milestone lag in days from soldDate. Calibrated to typical residential-
 *  solar cadence — adjust if your installer mix runs notably faster/slower.
 *  M1 fires at Acceptance, M2 at Install, M3 at PTO. */
export const MILESTONE_LAG_DAYS = { m1: 14, m2: 45, m3: 80 } as const;

/** For each phase, which milestones have ALREADY fired (so we shouldn't
 *  re-credit them in the forecast — they're either already paid or
 *  already counted in paid history). */
const MILESTONES_FIRED_BY_PHASE: Record<string, { m1: boolean; m2: boolean; m3: boolean }> = {
  'New':             { m1: false, m2: false, m3: false },
  'Acceptance':      { m1: true,  m2: false, m3: false },
  'Site Survey':     { m1: true,  m2: false, m3: false },
  'Design':          { m1: true,  m2: false, m3: false },
  'Permitting':      { m1: true,  m2: false, m3: false },
  'Pending Install': { m1: true,  m2: false, m3: false },
  'Installed':       { m1: true,  m2: true,  m3: false },
  'PTO':             { m1: true,  m2: true,  m3: false }, // M3 fires AT PTO — imminent
  'Completed':       { m1: true,  m2: true,  m3: true  },
};

/** Cash forecast for the current calendar year. Sums:
 *   - Pending milestones on in-flight deals whose ETA (soldDate + lag) lands by Dec 31
 *   - Projected new-sales' milestones firing by Dec 31 (at current pace, with deal value derived from rep's actual avg M1/M2/M3 split)
 *   - Cash already paid YTD
 *
 *  Returns the total + a breakdown for the hero subtitle. */
export function computeCashForecast(inputs: {
  projects: ReadonlyArray<PipelineProject>;
  repId: string | null;
  dealsPerMonth: number;
  avgM1: number;
  avgM2: number;
  avgM3: number;
  paidYTD: number;
  today?: Date;
}): { total: number; pipeline: number; futureSales: number; paid: number } {
  const { projects, repId, dealsPerMonth, avgM1, avgM2, avgM3, paidYTD } = inputs;
  const today = inputs.today ?? new Date();
  if (!repId) return { total: Math.round(paidYTD), pipeline: 0, futureSales: 0, paid: Math.round(paidYTD) };

  const yearEnd = new Date(today.getFullYear(), 11, 31, 23, 59, 59).getTime();
  const dayMs = 86_400_000;

  // ── Pipeline cash: existing deals' pending milestones with ETAs in window
  let pipelineCash = 0;
  for (const p of projects) {
    if (p.phase === 'Cancelled' || p.phase === 'On Hold') continue;
    const fired = MILESTONES_FIRED_BY_PHASE[p.phase] ?? MILESTONES_FIRED_BY_PHASE['New'];
    const { m1, m2, m3 } = viewerMilestones(p, repId);
    const soldMs = new Date(p.soldDate + 'T12:00:00Z').getTime();
    if (!fired.m1 && soldMs + MILESTONE_LAG_DAYS.m1 * dayMs <= yearEnd) pipelineCash += m1;
    if (!fired.m2 && soldMs + MILESTONE_LAG_DAYS.m2 * dayMs <= yearEnd) pipelineCash += m2;
    if (!fired.m3 && soldMs + MILESTONE_LAG_DAYS.m3 * dayMs <= yearEnd) pipelineCash += m3;
  }

  // ── Future-sales cash: deals projected at current pace, milestones firing in window
  // Simulate one sale at the midpoint of each remaining month at rate=dealsPerMonth.
  let futureCash = 0;
  if (dealsPerMonth > 0 && (avgM1 > 0 || avgM2 > 0 || avgM3 > 0)) {
    const todayMs = today.getTime();
    const currentMonth = today.getMonth();
    for (let m = currentMonth; m <= 11; m++) {
      // Mid-month sale date (Day 15 of each month)
      const saleDate = new Date(today.getFullYear(), m, 15, 12).getTime();
      // Only count sales in the future (today or later)
      if (saleDate < todayMs) continue;
      // For the current month, only the rest of the month counts (avoid
      // double-counting deals already sold this month — those are in
      // pipelineCash).
      const monthFraction = m === currentMonth
        ? Math.max(0, (new Date(today.getFullYear(), m + 1, 1).getTime() - todayMs) / (30.44 * dayMs))
        : 1;
      const dealsThisMonth = dealsPerMonth * monthFraction;
      if (saleDate + MILESTONE_LAG_DAYS.m1 * dayMs <= yearEnd) futureCash += avgM1 * dealsThisMonth;
      if (saleDate + MILESTONE_LAG_DAYS.m2 * dayMs <= yearEnd) futureCash += avgM2 * dealsThisMonth;
      if (saleDate + MILESTONE_LAG_DAYS.m3 * dayMs <= yearEnd) futureCash += avgM3 * dealsThisMonth;
    }
  }

  const pipeline = Math.round(pipelineCash);
  const futureSales = Math.round(futureCash);
  const paid = Math.round(paidYTD);
  return { total: Math.max(0, pipeline + futureSales + paid), pipeline, futureSales, paid };
}

// ─── Viewer pipeline remaining (Dashboard ↔ My Pay reconciliation) ─────

/** Shape of a payroll entry we need for pipeline accounting. Loose so it
 *  works against the Project page's full PayrollEntry type AND the slimmer
 *  shape used by the mobile dashboard. */
type PayrollForPipeline = {
  projectId?: string | null;
  paymentStage?: string | null;
  status: string;
  date: string;
  amount: number;
};

/** Build the two maps needed to compute viewer pipeline-remaining numbers
 *  across a set of payroll entries. Returns:
 *   - netByProjectStage: project+stage → net of ALL entries (any status)
 *     for that stage. Used as the "expected" amount when payroll exists
 *     (captures chargebacks). Falls back to project.mXAmount when missing.
 *   - paidByProjectStage: project+stage → sum of Paid entries (excluding
 *     Trainer stage) with date ≤ today. Used as the "already paid"
 *     subtraction per stage so per-milestone remaining values sum to the
 *     pipeline total exactly.
 */
export function buildPipelineMaps(
  payrollEntries: ReadonlyArray<PayrollForPipeline>,
  today: string,
): {
  netByProjectStage: Map<string, number>;
  paidByProjectStage: Map<string, number>;
} {
  const netByProjectStage = new Map<string, number>();
  const paidByProjectStage = new Map<string, number>();
  for (const e of payrollEntries) {
    if (!e.projectId) continue;
    if (e.paymentStage !== 'M1' && e.paymentStage !== 'M2' && e.paymentStage !== 'M3') continue;
    const key = `${e.projectId}:${e.paymentStage}`;
    netByProjectStage.set(key, (netByProjectStage.get(key) ?? 0) + e.amount);
    if (e.status === 'Paid' && e.date <= today) {
      paidByProjectStage.set(key, (paidByProjectStage.get(key) ?? 0) + e.amount);
    }
  }
  return { netByProjectStage, paidByProjectStage };
}

/** Per-milestone *remaining* commission the viewer is owed on a single
 *  deal, role-aware. For each stage:
 *
 *    expected = payroll-net-for-stage (if any) ?? project.mXAmount (role-aware)
 *    paid     = Σ Paid entries for that project+stage with date ≤ today
 *    remaining = max(0, expected - paid)
 *
 *  Clamping per-stage (rather than project-total) means an overpayment on
 *  one milestone doesn't silently subtract from another. Edge-cases with
 *  chargebacks rare in practice; this keeps the breakdown additive. */
export function viewerRemainingByMilestone(
  project: Pick<
    PipelineProject,
    | 'repId' | 'setterId'
    | 'm1Amount' | 'm2Amount' | 'm3Amount'
    | 'setterM1Amount' | 'setterM2Amount' | 'setterM3Amount'
    | 'additionalClosers' | 'additionalSetters'
  > & { id: string },
  repId: string | null,
  netByProjectStage: Map<string, number>,
  paidByProjectStage: Map<string, number>,
): { m1: number; m2: number; m3: number } {
  const expected = viewerMilestones(project, repId);
  const get = (stage: 'M1' | 'M2' | 'M3') => `${project.id}:${stage}`;
  const m1Expected = netByProjectStage.get(get('M1')) ?? expected.m1;
  const m2Expected = netByProjectStage.get(get('M2')) ?? expected.m2;
  const m3Expected = netByProjectStage.get(get('M3')) ?? expected.m3;
  const m1Paid = paidByProjectStage.get(get('M1')) ?? 0;
  const m2Paid = paidByProjectStage.get(get('M2')) ?? 0;
  const m3Paid = paidByProjectStage.get(get('M3')) ?? 0;
  return {
    m1: Math.max(0, m1Expected - m1Paid),
    m2: Math.max(0, m2Expected - m2Paid),
    m3: Math.max(0, m3Expected - m3Paid),
  };
}

/** Active-projects pipeline total + per-milestone breakdown. The total
 *  reconciles across Dashboard and My Pay so both surfaces show the same
 *  "Pipeline" headline. Excludes trainer override (handled separately
 *  where applicable). */
export function viewerPipelineRemaining<P extends Pick<
  PipelineProject,
  | 'repId' | 'setterId'
  | 'm1Amount' | 'm2Amount' | 'm3Amount'
  | 'setterM1Amount' | 'setterM2Amount' | 'setterM3Amount'
  | 'additionalClosers' | 'additionalSetters'
> & { id: string }>(
  activeProjects: ReadonlyArray<P>,
  repId: string | null,
  payrollEntries: ReadonlyArray<PayrollForPipeline>,
  today: string,
): { total: number; m1: number; m2: number; m3: number } {
  const { netByProjectStage, paidByProjectStage } = buildPipelineMaps(payrollEntries, today);
  let m1 = 0, m2 = 0, m3 = 0;
  for (const p of activeProjects) {
    const r = viewerRemainingByMilestone(p, repId, netByProjectStage, paidByProjectStage);
    m1 += r.m1; m2 += r.m2; m3 += r.m3;
  }
  return { total: m1 + m2 + m3, m1, m2, m3 };
}

// ─── Trainer override pipeline ─────────────────────────────────────────

/** Shape of a project the trainer-override math needs. Loose superset of
 *  PipelineProject + a few trainer-relevant fields. */
type TrainerOverrideProject = {
  id: string;
  phase: string;
  kWSize: number;
  installer: string;
  repId?: string | null;
  setterId?: string | null;
  m1Paid?: boolean | null;
  m2Paid?: boolean | null;
  m3Paid?: boolean | null;
  additionalClosers?: ReadonlyArray<{ userId: string }>;
  additionalSetters?: ReadonlyArray<{ userId: string }>;
};

/** Trainer-override pipeline remaining for one rep across all their
 *  trainer assignments. Per-kW rate from `getTrainerOverrideRate` (tier
 *  based on completed-deal count), per project = `rate × kW × 1000`,
 *  minus already-paid Trainer-stage entries.
 *
 *  Returns the dollar amount the trainer is still owed across all active
 *  trainee deals. Zero when the rep has no trainer assignments.
 *
 *  Shared by both Dashboard surfaces and (post-bake-in) both My Pay
 *  surfaces so the "In Pipeline" headline reconciles end-to-end. */
export function computeTrainerOverridePipeline(inputs: {
  trainerAssignments: ReadonlyArray<TrainerAssignment>;
  projects: ReadonlyArray<TrainerOverrideProject>;
  payroll: ReadonlyArray<PayrollForPipeline>;
  installerPayConfigs: Record<string, { installPayPct: number }>;
  repId: string | null;
  today: string;
}): number {
  const { trainerAssignments, projects, payroll, installerPayConfigs, repId, today } = inputs;
  if (!repId) return 0;
  const myAssignments = trainerAssignments.filter((a) => a.trainerId === repId);
  if (myAssignments.length === 0) return 0;

  // Pre-build the paid-trainer-stage map once. Same trainer-stage entry
  // can apply to any of this rep's trainee assignments (the rep owns it,
  // not the assignment), so a project-id keyed map is sufficient.
  const paidTrainerByProject = new Map<string, number>();
  for (const e of payroll) {
    if (!e.projectId) continue;
    if (e.paymentStage !== 'Trainer') continue;
    if (e.status !== 'Paid') continue;
    if (e.date > today) continue;
    paidTrainerByProject.set(e.projectId, (paidTrainerByProject.get(e.projectId) ?? 0) + e.amount);
  }

  return myAssignments.reduce((sum, assignment) => {
    const isTraineeParty = (p: TrainerOverrideProject) =>
      p.repId === assignment.traineeId ||
      p.setterId === assignment.traineeId ||
      p.additionalClosers?.some((c) => c.userId === assignment.traineeId) ||
      p.additionalSetters?.some((s) => s.userId === assignment.traineeId);

    // Tier progression: count trainee's "fully paid out" deals. The
    // milestone that signals "fully paid out" depends on the installer's
    // pay split — < 100% means M3 is the final payout, otherwise M2 is.
    const completedDeals = projects.filter((p) => {
      if (!isTraineeParty(p)) return false;
      const installPct = installerPayConfigs[p.installer]?.installPayPct
        ?? INSTALLER_PAY_CONFIGS[p.installer]?.installPayPct
        ?? DEFAULT_INSTALL_PAY_PCT;
      return installPct < 100 ? p.m3Paid === true : p.m2Paid === true;
    }).length;

    const overrideRate = getTrainerOverrideRate(assignment, completedDeals);
    if (overrideRate <= 0) return sum;

    const traineeActive = projects.filter(
      (p) => (ACTIVE_PHASES as readonly string[]).includes(p.phase) && isTraineeParty(p),
    );

    return sum + traineeActive.reduce((pSum, p) => {
      const expected = Math.round(overrideRate * p.kWSize * 1000 * 100) / 100;
      const alreadyPaid = paidTrainerByProject.get(p.id) ?? 0;
      return pSum + Math.max(0, expected - alreadyPaid);
    }, 0);
  }, 0);
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
