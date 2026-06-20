/**
 * my-pay-summary.ts — server-side rep pay summary.
 *
 * Pure orchestrator that reproduces the rep-dashboard hero numbers
 * (app/dashboard/page.tsx) by SEQUENCING the existing, already-tested
 * helpers — it does NOT define any new commission math. It exists so the
 * native iOS app can fetch the same six numbers the web rep dashboard
 * shows, via GET /api/my-pay, with the formulas staying server-side.
 *
 * Inputs are the rep's OWN payroll + the projects they're a party to,
 * already serialized to dollars (same shape the client context holds).
 * Output is in dollars; the route converts to integer cents at the wire.
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
  viewerFullCommission,
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
  /** Projects the rep is a party to (repId/setterId/trainerId/additional). */
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

  // ── Lifetime earned + pending (canonical aggregators) ──
  const lifetimeEarned = sumPaid(payroll, { asOf: todayStr });
  const pending = sumPending(payroll);

  // ── Pipeline = unpaid M1+M2+M3 on active deals + trainer override ──
  const activeProjects = projects.filter((p) => (ACTIVE_PHASES as readonly string[]).includes(p.phase));
  const pipeline = viewerPipelineRemaining(activeProjects, repId, payroll, todayStr).total
    + computeTrainerOverridePipeline({
        trainerAssignments,
        projects,
        payroll,
        installerPayConfigs,
        repId,
        today: todayStr,
      });

  // ── On-Pace (this-year horizon), mirroring the rep dashboard ──
  const horizon = 'this-year';
  const nonCancelled = projects.filter((p) => p.phase !== 'Cancelled');
  let paceRate = 0;
  if (nonCancelled.length > 0) {
    const avgFullCommissionPerDeal =
      nonCancelled.reduce((s, p) => s + viewerFullCommission(p, repId), 0) / nonCancelled.length;
    const sorted = [...nonCancelled].sort((a, b) => a.soldDate.localeCompare(b.soldDate));
    const firstDealDate = new Date(`${sorted[0].soldDate}T12:00:00`);
    // Floor effective days at 30 so a brand-new rep's first few days don't
    // extrapolate into an unrealistic monthly pace. Matches the dashboard.
    const daysSinceFirst = Math.max((now.getTime() - firstDealDate.getTime()) / 86400000, 1);
    const effectiveDays = Math.max(daysSinceFirst, 30);
    const dealsPerMonth = (nonCancelled.length / effectiveDays) * 30.44;
    paceRate = dealsPerMonth * avgFullCommissionPerDeal;
  }
  const inPeriodCommissionEarned = projects
    .filter((p) => p.phase !== 'Cancelled' && isInPeriod(p.soldDate, horizon))
    .reduce((s, p) => s + viewerFullCommission(p, repId), 0);
  const daysRemainingInPeriod = getPeriodDaysRemaining(horizon, now) ?? 0;
  const onPace = computeOnPace({ inPeriodCommissionEarned, paceRate, daysRemainingInPeriod });
  const onPaceCaption = `On Pace For ${year}`;

  // ── Next payout = Pending payroll landing on the next Friday ──
  const { date: nextFridayDate, label: nextPayoutLabel } = nextFridayFor(todayStr);
  const onFriday = payroll.filter((p) => p.date === nextFridayDate && p.status === 'Pending');
  const nextPayout = onFriday.length > 0
    ? onFriday.reduce((s, p) => s + p.amount, 0)
    : null;

  return { nextPayout, nextPayoutLabel, pending, pipeline, lifetimeEarned, onPace, onPaceCaption };
}
