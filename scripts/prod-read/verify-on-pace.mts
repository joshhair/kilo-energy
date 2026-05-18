/**
 * scripts/prod-read/verify-on-pace.mts — Phase 3 math sanity check.
 *
 * Pulls real prod data (read-only) for the rep we're examining, plus
 * cross-checks across 2 other reps at different tenure tiers. Computes
 * `OnPace(P) = inPeriodCommissionEarned + paceRate × monthsRemainingInP`
 * for each rep × each period (Month / Quarter / Year / All Time) and
 * prints a table.
 *
 * Acceptance: numbers fall within the bands the user signed off on
 * (see verification-plan.md §4.3). Outside bands → STOP and reinvestigate.
 */

import { writeSnapshot } from './index.mts';
import { getRepPipeline, getRepPaidHistory, getRepsOverview } from './queries.mts';

// Helpers are duplicated inline from lib/period-projection.ts because
// tsx can't resolve .ts → .mts imports across the script ↔ app boundary
// (TS plays games with module resolution that don't survive runtime).
// The duplication is kept tiny (~30 lines) and the canonical version
// stays the one in lib/ — that's what production renders. Tests cover
// the canonical version; this script cross-checks against real data.
type Project = {
  soldDate: string;
  phase: string;
  repId?: string | null;
  setterId?: string | null;
  m1Amount?: number | null;
  m2Amount?: number | null;
  m3Amount?: number | null;
  setterM1Amount?: number | null;
  setterM2Amount?: number | null;
  setterM3Amount?: number | null;
  additionalClosers?: Array<{ userId: string; m1Amount: number; m2Amount: number; m3Amount?: number | null }>;
  additionalSetters?: Array<{ userId: string; m1Amount: number; m2Amount: number; m3Amount?: number | null }>;
};
function viewerFullCommission(p: Project, repId: string | null): number {
  if (!repId) return 0;
  if (p.repId === repId) return (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0);
  if (p.setterId === repId) return (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0);
  const cc = p.additionalClosers?.find((c) => c.userId === repId);
  if (cc) return (cc.m1Amount ?? 0) + (cc.m2Amount ?? 0) + (cc.m3Amount ?? 0);
  const cs = p.additionalSetters?.find((c) => c.userId === repId);
  if (cs) return (cs.m1Amount ?? 0) + (cs.m2Amount ?? 0) + (cs.m3Amount ?? 0);
  return 0;
}
function computeOnPace(i: { inPeriodCommissionEarned: number; paceRate: number; daysRemainingInPeriod: number }): number {
  const monthsRemaining = Math.max(0, i.daysRemainingInPeriod / 30.44);
  return Math.max(0, Math.round(i.inPeriodCommissionEarned + i.paceRate * monthsRemaining));
}

// ─── helpers ────────────────────────────────────────────────────────────

function monthsBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + 'T12:00:00Z').getTime();
  const b = new Date(toISO + 'T12:00:00Z').getTime();
  return (b - a) / 86_400_000 / 30.44;
}

function daysInPeriod(period: 'this-month' | 'this-quarter' | 'this-year' | 'all'): number {
  const now = new Date();
  let end: Date;
  if (period === 'this-month') {
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day of this month
  } else if (period === 'this-quarter') {
    const q = Math.floor(now.getMonth() / 3);
    end = new Date(now.getFullYear(), (q + 1) * 3, 0); // last day of quarter
  } else {
    end = new Date(now.getFullYear(), 11, 31);
  }
  const diff = (end.getTime() - now.getTime()) / 86_400_000;
  return Math.max(0, Math.round(diff));
}

function isInPeriodSold(soldDate: string, period: 'this-month' | 'this-quarter' | 'this-year' | 'all'): boolean {
  const now = new Date();
  const sold = new Date(soldDate + 'T12:00:00Z');
  if (period === 'all' || period === 'this-year') {
    return sold.getFullYear() === now.getFullYear();
  }
  if (period === 'this-quarter') {
    const q = Math.floor(now.getMonth() / 3);
    return sold.getFullYear() === now.getFullYear() && Math.floor(sold.getMonth() / 3) === q;
  }
  return sold.getFullYear() === now.getFullYear() && sold.getMonth() === now.getMonth();
}

const PERIODS = ['this-month', 'this-quarter', 'this-year', 'all'] as const;

// Convert Prisma's *Cents Int fields → number (dollars). The pipeline
// helpers expect PipelineProject shape with Amount (dollars), not Cents.
function toPipelineProject(row: Awaited<ReturnType<typeof getRepPipeline>>[number]): Project {
  return {
    soldDate: row.soldDate,
    phase: row.phase,
    repId: row.closerId,
    setterId: row.setterId,
    m1Amount: row.m1AmountCents / 100,
    m2Amount: row.m2AmountCents / 100,
    m3Amount: row.m3AmountCents != null ? row.m3AmountCents / 100 : null,
    setterM1Amount: row.setterM1AmountCents != null ? row.setterM1AmountCents / 100 : null,
    setterM2Amount: row.setterM2AmountCents != null ? row.setterM2AmountCents / 100 : null,
    setterM3Amount: row.setterM3AmountCents != null ? row.setterM3AmountCents / 100 : null,
    additionalClosers: (row.additionalClosers ?? []).map((c) => ({
      userId: c.userId,
      m1Amount: c.m1AmountCents / 100,
      m2Amount: c.m2AmountCents / 100,
      m3Amount: c.m3AmountCents != null ? c.m3AmountCents / 100 : null,
    })),
    additionalSetters: (row.additionalSetters ?? []).map((c) => ({
      userId: c.userId,
      m1Amount: c.m1AmountCents / 100,
      m2Amount: c.m2AmountCents / 100,
      m3Amount: c.m3AmountCents != null ? c.m3AmountCents / 100 : null,
    })),
  };
}

// ─── per-rep verification ───────────────────────────────────────────────

async function verifyRep(repId: string, repName: string) {
  const pipelineRows = await getRepPipeline(repId);
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const paidHistory = await getRepPaidHistory(repId, yearStart);

  const pipeline = pipelineRows.map(toPipelineProject);

  // dealsPerMonth: same formula as MobileDashboard
  const nonCancelled = pipeline.filter((p) => p.phase !== 'Cancelled');
  const totalDeals = nonCancelled.length;
  if (totalDeals === 0) {
    console.log(`\n=== ${repName} (${repId}) ===\n  no deals — skipping\n`);
    return;
  }
  const avgFullCommission = nonCancelled.reduce(
    (s, p) => s + viewerFullCommission(p, repId),
    0,
  ) / totalDeals;

  const sorted = [...nonCancelled].sort((a, b) => a.soldDate.localeCompare(b.soldDate));
  const today = new Date().toISOString().slice(0, 10);
  const daysSinceFirst = Math.max(monthsBetween(sorted[0].soldDate, today) * 30.44, 1);
  const effectiveDays = Math.max(daysSinceFirst, 30);
  const dealsPerMonth = (totalDeals / effectiveDays) * 30.44;
  const paceRate = dealsPerMonth * avgFullCommission;

  // print rep header
  console.log(`\n=== ${repName} (${repId.slice(0, 8)}…) ===`);
  console.log(`  pipeline deals: ${totalDeals}   first sold: ${sorted[0].soldDate}   days tenure: ${Math.round(daysSinceFirst)}`);
  console.log(`  avg full commission: $${avgFullCommission.toFixed(0)}   dealsPerMonth: ${dealsPerMonth.toFixed(2)}   paceRate/mo: $${paceRate.toFixed(0)}`);

  // phase breakdown
  const byPhase: Record<string, number> = {};
  for (const p of nonCancelled) byPhase[p.phase] = (byPhase[p.phase] ?? 0) + 1;
  console.log(`  by phase: ${Object.entries(byPhase).map(([k, v]) => `${k}:${v}`).join(' · ')}`);

  // paid YTD (for context)
  const paidYTDCents = paidHistory.reduce((s, p) => s + p.amountCents, 0);
  console.log(`  paid YTD: $${(paidYTDCents / 100).toFixed(0)}`);

  // per-period projection
  console.log(`  ${'Period'.padEnd(15)} ${'inPeriod earned'.padStart(18)} ${'pace × months'.padStart(18)} ${'OnPace'.padStart(12)}`);
  for (const period of PERIODS) {
    const earned = nonCancelled
      .filter((p) => isInPeriodSold(p.soldDate, period))
      .reduce((s, p) => s + viewerFullCommission(p, repId), 0);
    const days = daysInPeriod(period === 'all' ? 'this-year' : period);
    const onPace = computeOnPace({
      inPeriodCommissionEarned: earned,
      paceRate,
      daysRemainingInPeriod: days,
    });
    const pace = paceRate * (days / 30.44);
    console.log(`  ${period.padEnd(15)} ${('$' + earned.toFixed(0)).padStart(18)} ${('$' + pace.toFixed(0)).padStart(18)} ${('$' + onPace.toLocaleString()).padStart(12)}`);
  }
}

// ─── main ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`Verifying on-pace math against real Turso data.`);
  console.log(`Today: ${new Date().toISOString().slice(0, 10)}\n`);

  // Pull rep roster to find Josh + 2 cross-tier reps
  const reps = await getRepsOverview();
  const joshOptions = reps.filter((r) => r.firstName?.toLowerCase() === 'josh');
  if (joshOptions.length === 0) {
    console.error('Could not find Josh in rep roster. Pass repId explicitly.');
    process.exit(1);
  }
  const josh = joshOptions[0];

  // Pick 2 other active reps at different tenure tiers — sort by createdAt
  const others = reps
    .filter((r) => r.id !== josh.id && r.role === 'rep' && r.firstName)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const veteran = others[0];                                 // earliest joined
  const middle = others[Math.floor(others.length / 2)];      // mid-tenure

  writeSnapshot('verify-on-pace-rep-targets', { josh, veteran, middle });

  await verifyRep(josh.id, `${josh.firstName} ${josh.lastName} (Josh / target)`);
  if (veteran) await verifyRep(veteran.id, `${veteran.firstName} ${veteran.lastName} (veteran)`);
  if (middle && middle.id !== veteran?.id) await verifyRep(middle.id, `${middle.firstName} ${middle.lastName} (mid-tenure)`);

  console.log('\nDone. Cross-check the numbers against verification-plan.md §4.3 acceptable bands.');
  process.exit(0);
}

main().catch((err) => {
  console.error('verify-on-pace failed:', err);
  process.exit(1);
});
