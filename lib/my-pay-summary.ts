/**
 * my-pay-summary.ts — server-side rep pay summary.
 *
 * Pure orchestrator that reproduces the rep-dashboard hero numbers
 * (app/dashboard/page.tsx) by SEQUENCING the existing, already-tested
 * helpers — it does NOT define any new commission math. It exists so the
 * native iOS app can fetch the same six numbers the web rep dashboard
 * shows, via GET /api/my-pay, with the formulas staying server-side.
 *
 * Inputs are the rep's OWN payroll + the projects in their scope, already
 * serialized to dollars (same shape /api/data hands the client context):
 * the projects they're a PARTY to, PLUS their direct trainees' deals (so
 * the trainer-override pipeline can be computed). This helper internally
 * splits those — party-only projects drive pipeline-base + on-pace, while
 * the full set (incl. trainee deals) feeds the trainer-override pipeline,
 * exactly as the rep dashboard does. Output is in dollars; the route
 * converts to integer cents at the wire.
 *
 * Mirrors:
 *   - pipeline   → app/dashboard/page.tsx ~981-989
 *   - on-pace    → app/dashboard/page.tsx ~1004-1035 (this-year horizon)
 *   - nextPayout → app/dashboard/page.tsx ~1237-1260
 */

import { sumPaid, sumPending } from './aggregators';
import {
  viewerPipelineRemaining,
  computeTrainerOverridePipeline,
  computeOnPace,
  computeCashForecast,
  viewerFullCommission,
  viewerMilestones,
} from './period-projection';
import { ACTIVE_PHASES, type TrainerAssignment } from './data';
import { isInPeriod, getPeriodDaysRemaining } from './period';

const BUSINESS_TZ = 'America/Los_Angeles';

/** Co-closer / co-setter slice the viewer math reads (dollars). */
interface SummaryParty {
  userId: string;
  m1Amount: number;
  m2Amount: number;
  m3Amount: number | null;
}

/** A project the summary math needs — superset of every field the
 *  reused helpers read, already serialized to dollars. */
export interface MyPaySummaryProject {
  id: string;
  phase: string;
  soldDate: string;
  kWSize: number;
  installer: string;
  repId?: string | null;
  setterId?: string | null;
  trainerId?: string | null;
  m1Amount: number;
  m2Amount: number;
  m3Amount: number | null;
  setterM1Amount: number;
  setterM2Amount: number;
  setterM3Amount: number | null;
  m1Paid?: boolean | null;
  m2Paid?: boolean | null;
  m3Paid?: boolean | null;
  additionalClosers?: ReadonlyArray<SummaryParty>;
  additionalSetters?: ReadonlyArray<SummaryParty>;
}

/** A payroll entry the summary math needs, serialized to dollars. */
export interface MyPaySummaryPayroll {
  status: string;
  date: string;
  amount: number;
  repId?: string;
  type?: string;
  isChargeback?: boolean;
  paymentStage?: string;
  projectId?: string | null;
}

export interface MyPaySummaryInput {
  /** The rep's own payroll entries (serialized to dollars). */
  payroll: ReadonlyArray<MyPaySummaryPayroll>;
  /** The rep's project scope (serialized to dollars): the deals they're a
   *  party to PLUS their direct trainees' deals — the same set /api/data's
   *  rep branch returns. Split internally. */
  projects: ReadonlyArray<MyPaySummaryProject>;
  /** Trainer assignments where the rep is trainer or trainee. */
  trainerAssignments: ReadonlyArray<TrainerAssignment>;
  /** installerName → { installPayPct }, for trainer-override tiering. */
  installerPayConfigs: Record<string, { installPayPct: number }>;
  repId: string;
  /** The clock. Defaulted by the route; injectable for tests. */
  now: Date;
}

export interface MyPaySummary {
  /** Sum of Pending payroll landing on the next Friday, or null if none. */
  nextPayout: number | null;
  /** Human label for that Friday, e.g. "Friday, July 4". */
  nextPayoutLabel: string;
  pending: number;
  pipeline: number;
  lifetimeEarned: number;
  onPace: number;
  onPaceCaption: string;
  /** "2026 Cash Forecast" hero (computeCashForecast). total === pipeline +
   *  futureSales + paid (when non-negative). All in dollars. */
  cashForecast2026: number;
  cashForecastPipeline: number;
  cashForecastNew: number;
  cashForecastPaid: number;
}

/** Is the rep a direct party to this deal? Matches the dashboard's
 *  `allMyProjects` participation predicate (app/dashboard/page.tsx ~792):
 *  primary closer (repId), primary setter, per-project trainer override,
 *  or an additional closer/setter. Deals where the rep is only the
 *  ASSIGNMENT trainer of the closer (chain-trainee deals) are NOT a party
 *  here — they belong only to the trainer-override computation. */
function isParty(p: MyPaySummaryProject, repId: string): boolean {
  return p.repId === repId
    || p.setterId === repId
    || p.trainerId === repId
    || (p.additionalClosers?.some((c) => c.userId === repId) ?? false)
    || (p.additionalSetters?.some((s) => s.userId === repId) ?? false);
}

/** Business-local (Pacific) YYYY-MM-DD for a given instant. Pacific — not
 *  raw server-UTC — so a CA rep's numbers match what their browser-local
 *  web dashboard shows (and so the server doesn't roll a day early). */
function businessDateStr(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** Next Friday (today if today is Friday) for a YYYY-MM-DD, plus its label.
 *  Mirrors the dashboard's (5 - day + 7) % 7 step. Noon-UTC anchoring keeps
 *  the weekday stable across DST. */
function nextFridayFor(todayStr: string): { date: string; label: string } {
  const noon = new Date(`${todayStr}T12:00:00Z`);
  const daysToFriday = (5 - noon.getUTCDay() + 7) % 7;
  const nf = new Date(noon);
  nf.setUTCDate(noon.getUTCDate() + daysToFriday);
  const date = `${nf.getUTCFullYear()}-${String(nf.getUTCMonth() + 1).padStart(2, '0')}-${String(nf.getUTCDate()).padStart(2, '0')}`;
  const label = nf.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
  return { date, label };
}

/**
 * Compute the rep's pay summary. Pure — all numbers come from the shared
 * aggregators / period-projection helpers, sequenced exactly as the rep
 * dashboard does.
 */
export function computeMyPaySummary(input: MyPaySummaryInput): MyPaySummary {
  const { payroll, projects, trainerAssignments, installerPayConfigs, repId, now } = input;
  const todayStr = businessDateStr(now);
  const year = Number(todayStr.slice(0, 4));
  // One consistent business-local (Pacific) clock for all period math, so
  // the year used by isInPeriod / getPeriodDaysRemaining can't disagree
  // with todayStr / onPaceCaption at the New Year UTC↔Pacific boundary.
  // Noon UTC of the Pacific calendar date carries the right year, mid-day.
  const businessNow = new Date(`${todayStr}T12:00:00Z`);

  // Split the scope: party-only projects drive pipeline-base + on-pace; the
  // FULL set (which also includes the rep's trainees' deals) feeds the
  // trainer-override pipeline. Mirrors app/dashboard/page.tsx, which filters
  // `allMyProjects` by participation but passes the full `projects` array to
  // computeTrainerOverridePipeline.
  const myProjects = projects.filter((p) => isParty(p, repId));

  // ── Lifetime earned + pending (canonical aggregators) ──
  const lifetimeEarned = sumPaid(payroll, { asOf: todayStr });
  const pending = sumPending(payroll);

  // ── Pipeline = unpaid M1+M2+M3 on active deals + trainer override ──
  const activeProjects = myProjects.filter((p) => (ACTIVE_PHASES as readonly string[]).includes(p.phase));
  const pipeline = viewerPipelineRemaining(activeProjects, repId, payroll, todayStr).total
    + computeTrainerOverridePipeline({
        trainerAssignments,
        projects, // FULL set — trainee deals live here, not in myProjects
        payroll,
        installerPayConfigs,
        repId,
        today: todayStr,
      });

  // ── On-Pace (this-year horizon), mirroring the rep dashboard ──
  const horizon = 'this-year';
  const nonCancelled = myProjects.filter((p) => p.phase !== 'Cancelled');
  let paceRate = 0;
  if (nonCancelled.length > 0) {
    const avgFullCommissionPerDeal =
      nonCancelled.reduce((s, p) => s + viewerFullCommission(p, repId), 0) / nonCancelled.length;
    const sorted = [...nonCancelled].sort((a, b) => a.soldDate.localeCompare(b.soldDate));
    const firstDealDate = new Date(`${sorted[0].soldDate}T12:00:00`);
    // Floor effective days at 30 so a brand-new rep's first few days don't
    // extrapolate into an unrealistic monthly pace. Matches the dashboard.
    const daysSinceFirst = Math.max((businessNow.getTime() - firstDealDate.getTime()) / 86400000, 1);
    const effectiveDays = Math.max(daysSinceFirst, 30);
    const dealsPerMonth = (nonCancelled.length / effectiveDays) * 30.44;
    paceRate = dealsPerMonth * avgFullCommissionPerDeal;
  }
  const inPeriodCommissionEarned = nonCancelled
    .filter((p) => isInPeriod(p.soldDate, horizon, businessNow))
    .reduce((s, p) => s + viewerFullCommission(p, repId), 0);
  const daysRemainingInPeriod = getPeriodDaysRemaining(horizon, businessNow) ?? 0;
  const onPace = computeOnPace({ inPeriodCommissionEarned, paceRate, daysRemainingInPeriod });
  const onPaceCaption = `On Pace For ${year}`;

  // ── 2026 Cash Forecast — reuse computeCashForecast exactly as the rep
  // dashboard does (MobileDashboard ~456-486). Pending milestones with ETAs
  // landing by Dec 31 + future-sales at current pace + paid YTD. total ===
  // pipeline + new + paid (when non-negative). NO new forecast math here.
  // asOf = Pacific todayStr (not sumPaid's host-local default) so the paid
  // cutoff matches the rest of this endpoint's business clock — otherwise a
  // UTC server could count a next-day-Pacific paid row the dashboard wouldn't.
  const paidYTD = sumPaid(payroll.filter((p) => isInPeriod(p.date, 'this-year', businessNow)), { asOf: todayStr });
  const avgMilestones = (() => {
    if (nonCancelled.length === 0) return { avgM1: 0, avgM2: 0, avgM3: 0 };
    let m1 = 0, m2 = 0, m3 = 0;
    for (const p of nonCancelled) { const m = viewerMilestones(p, repId); m1 += m.m1; m2 += m.m2; m3 += m.m3; }
    return { avgM1: m1 / nonCancelled.length, avgM2: m2 / nonCancelled.length, avgM3: m3 / nonCancelled.length };
  })();
  const avgMilestoneSum = avgMilestones.avgM1 + avgMilestones.avgM2 + avgMilestones.avgM3;
  // dealsPerMonth recovered from paceRate exactly as MobileDashboard does.
  const forecastDealsPerMonth = paceRate && avgMilestoneSum > 0 ? paceRate / avgMilestoneSum : 0;
  const forecast = computeCashForecast({
    projects: myProjects,
    repId,
    dealsPerMonth: forecastDealsPerMonth,
    avgM1: avgMilestones.avgM1,
    avgM2: avgMilestones.avgM2,
    avgM3: avgMilestones.avgM3,
    paidYTD,
    today: businessNow,
  });

  // ── Next payout = Pending payroll landing on the next Friday ──
  const { date: nextFridayDate, label: nextPayoutLabel } = nextFridayFor(todayStr);
  const onFriday = payroll.filter((p) => p.date === nextFridayDate && p.status === 'Pending');
  const nextPayout = onFriday.length > 0
    ? onFriday.reduce((s, p) => s + p.amount, 0)
    : null;

  return {
    nextPayout, nextPayoutLabel, pending, pipeline, lifetimeEarned, onPace, onPaceCaption,
    cashForecast2026: forecast.total,
    cashForecastPipeline: forecast.pipeline,
    cashForecastNew: forecast.futureSales,
    cashForecastPaid: forecast.paid,
  };
}
