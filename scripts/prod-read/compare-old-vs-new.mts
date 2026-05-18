/**
 * compare-old-vs-new.mts — Side-by-side: what Josh's projection was
 * BEFORE this session's work vs what it is NOW.
 *
 * Pre-session formula (commit 4cb0d09, "Path 1"):
 *   - monthlyRate (blended) = 0.6 × paceMonth + 0.4 × paidMonth  (if daysSinceFirst >= 60)
 *   - All Time hero  = monthlyRate × 12 + 0.15 × pipelineM1M2
 *   - This Year hero = paidYTD + monthlyRate × (daysRemaining/30.44)
 *                    + phaseWeightedBoost(365d horizon)
 *     where boost = 0.15 × Σ (m1 if New, else 0 + m2) × phaseMult[phase][365d]
 *     and at 365d every phaseMult = 1.0, so it collapses to:
 *                    = 0.15 × pipelineM1M2 (same as All Time's boost)
 *
 * Current formula (this session's final):
 *   OnPace(P) = commissionEarnedFromInPeriodDeals + paceRate × monthsRemainingInP
 *   where paceRate = dealsPerMonth × avgFullCommissionPerDeal (M1+M2+M3, NO blending)
 *
 * Read-only. Uses the audited prod-read helper.
 */

import { readDb } from './index.mts';
import { getRepPipeline, getRepPaidHistory } from './queries.mts';
import { logQuery } from './index.mts';

const JOSH_ID = 'admin_josh';
const YEAR_START = '2026-01-01';
const TODAY_ISO = new Date().toISOString().slice(0, 10);

// ─── viewer-aware milestone splits (mirror MobileDashboard) ─────────────

function viewerM1M2(p: any, repId: string): number {
  if (p.repId === repId) return (p.m1AmountCents ?? 0) / 100 + (p.m2AmountCents ?? 0) / 100;
  if (p.setterId === repId) return (p.setterM1AmountCents ?? 0) / 100 + (p.setterM2AmountCents ?? 0) / 100;
  const cc = p.additionalClosers?.find((c: any) => c.userId === repId);
  if (cc) return (cc.m1AmountCents ?? 0) / 100 + (cc.m2AmountCents ?? 0) / 100;
  const cs = p.additionalSetters?.find((c: any) => c.userId === repId);
  if (cs) return (cs.m1AmountCents ?? 0) / 100 + (cs.m2AmountCents ?? 0) / 100;
  return 0;
}

function viewerFullCommission(p: any, repId: string): number {
  if (p.repId === repId) return ((p.m1AmountCents ?? 0) + (p.m2AmountCents ?? 0) + (p.m3AmountCents ?? 0)) / 100;
  if (p.setterId === repId) return ((p.setterM1AmountCents ?? 0) + (p.setterM2AmountCents ?? 0) + (p.setterM3AmountCents ?? 0)) / 100;
  const cc = p.additionalClosers?.find((c: any) => c.userId === repId);
  if (cc) return ((cc.m1AmountCents ?? 0) + (cc.m2AmountCents ?? 0) + (cc.m3AmountCents ?? 0)) / 100;
  const cs = p.additionalSetters?.find((c: any) => c.userId === repId);
  if (cs) return ((cs.m1AmountCents ?? 0) + (cs.m2AmountCents ?? 0) + (cs.m3AmountCents ?? 0)) / 100;
  return 0;
}

// ─── main ───────────────────────────────────────────────────────────────

async function main() {
  // pipeline data — same query as the dashboard would use. Alias
  // closerId → repId so our viewer helpers work (dashboard does this in
  // toPipelineProject).
  const pipelineRowsRaw = await getRepPipeline(JOSH_ID);
  const pipelineRows = pipelineRowsRaw.map((r: any) => ({ ...r, repId: r.closerId }));

  // ──────────── compute shared inputs ────────────
  const nonCancelled = pipelineRows.filter((p: any) => p.phase !== 'Cancelled');
  const totalDeals = nonCancelled.length;

  // avg M1+M2 per deal (pre-session formula's avgCommissionPerDeal)
  const avgM1M2 = nonCancelled.reduce((s: number, p: any) => s + viewerM1M2(p, JOSH_ID), 0) / totalDeals;
  // avg M1+M2+M3 per deal (current session's avgFullCommissionPerDeal)
  const avgFull = nonCancelled.reduce((s: number, p: any) => s + viewerFullCommission(p, JOSH_ID), 0) / totalDeals;

  // dealsPerMonth (same formula both sessions)
  const sorted = [...nonCancelled].sort((a: any, b: any) => a.soldDate.localeCompare(b.soldDate));
  const now = new Date();
  const firstDealDate = new Date(sorted[0].soldDate + 'T12:00:00');
  const daysSinceFirst = Math.max((now.getTime() - firstDealDate.getTime()) / 86400000, 1);
  const effectiveDays = Math.max(daysSinceFirst, 30);
  const dealsPerMonth = (totalDeals / effectiveDays) * 30.44;

  // Lifetime gross paid (positive amounts only, no chargebacks). Used by
  // the pre-session blended monthlyRate.
  const lifetimePaidPositive = await readDb.payrollEntry.aggregate({
    where: { repId: JOSH_ID, status: 'Paid', amountCents: { gt: 0 } },
    _sum: { amountCents: true },
  });
  logQuery('payrollEntry.aggregate.lifetime', { repId: JOSH_ID }, 1);
  const totalPaidPositiveDollars = (lifetimePaidPositive._sum.amountCents ?? 0) / 100;

  // Paid YTD net (used by both versions of This Year)
  const paidEntries = await getRepPaidHistory(JOSH_ID, YEAR_START);
  const paidYTDNet = paidEntries.reduce((s: number, e: any) => s + e.amountCents, 0) / 100;
  // Paid YTD gross (no chargebacks) — pre-session used GROSS as input to blend
  const paidYTDGross = paidEntries.filter((e: any) => e.amountCents > 0).reduce((s: number, e: any) => s + e.amountCents, 0) / 100;

  // Pipeline M1+M2 (in-flight only, the pre-session boost basis)
  const preInstalled = new Set(['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install']);
  const preAcceptance = new Set(['New']);
  let pipelineM1AndM2 = 0;
  for (const p of nonCancelled as any[]) {
    if (preInstalled.has(p.phase)) {
      // M2 contribution
      pipelineM1AndM2 += viewerM2Only(p, JOSH_ID);
    }
    if (preAcceptance.has(p.phase)) {
      // M1 contribution
      pipelineM1AndM2 += viewerM1Only(p, JOSH_ID);
    }
  }

  // Pipeline M1+M2+M3 (this session's pace already incorporates M3 via
  // avgFullCommission so we don't add a separate boost; included for
  // comparison reference only)
  let pipelineM1M2M3 = 0;
  const excluded = new Set(['Cancelled', 'Completed']);
  for (const p of nonCancelled as any[]) {
    if (!excluded.has(p.phase)) pipelineM1M2M3 += viewerFullCommission(p, JOSH_ID);
  }

  // commissionEarnedFromYTDDeals (this session's primary input)
  const yearStartYr = new Date().getFullYear();
  const inPeriodEarned = nonCancelled
    .filter((p: any) => new Date(p.soldDate + 'T12:00:00').getFullYear() === yearStartYr)
    .reduce((s: number, p: any) => s + viewerFullCommission(p, JOSH_ID), 0);

  // ──────────── pre-session blended monthlyRate ────────────
  const paceBasedAnnual = dealsPerMonth * avgM1M2 * 12;
  // pre-session at 4cb0d09 used 60d threshold + 60/40 blend
  let preSessionMonthlyRate: number;
  if (daysSinceFirst >= 60 && totalPaidPositiveDollars > 0) {
    const paidMonthlyRate = (totalPaidPositiveDollars / daysSinceFirst) * 30.44;
    preSessionMonthlyRate = paceBasedAnnual / 12 * 0.6 + paidMonthlyRate * 0.4;
  } else {
    preSessionMonthlyRate = paceBasedAnnual / 12;
  }

  // ──────────── current paceRate ────────────
  const currentPaceRate = dealsPerMonth * avgFull;

  // ──────────── days remaining in year ────────────
  const yearEnd = new Date(yearStartYr, 11, 31);
  const daysRemainingYear = Math.max(0, Math.round((yearEnd.getTime() - now.getTime()) / 86400000));
  const monthsRemainingYear = daysRemainingYear / 30.44;

  // ──────────── pre-session AllTime + ThisYear ────────────
  const preSessionBoost = 0.15 * pipelineM1AndM2; // 365d-horizon collapses to flat 0.15
  const preSessionAllTime = Math.round(preSessionMonthlyRate * 12 + preSessionBoost);
  const preSessionThisYear = Math.round(
    paidYTDNet + preSessionMonthlyRate * monthsRemainingYear + preSessionBoost,
  );

  // ──────────── current AllTime/ThisYear (same formula) ────────────
  const currentAllTimeThisYear = Math.max(0, Math.round(inPeriodEarned + currentPaceRate * monthsRemainingYear));

  // ──────────── render ────────────
  const dollar = (n: number) => '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  JOSH HAIR — projection BEFORE vs AFTER this session');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log();
  console.log('  shared inputs (real Turso data, today ' + TODAY_ISO + '):');
  console.log(`    deals (non-Cancelled):           ${totalDeals}`);
  console.log(`    dealsPerMonth:                   ${dealsPerMonth.toFixed(2)}`);
  console.log(`    avg M1+M2 per deal:              ${dollar(avgM1M2)}`);
  console.log(`    avg M1+M2+M3 per deal (NEW):     ${dollar(avgFull)}`);
  console.log(`    pipeline M1+M2 (in-flight):      ${dollar(pipelineM1AndM2)}`);
  console.log(`    pipeline M1+M2+M3 (in-flight):   ${dollar(pipelineM1M2M3)}`);
  console.log(`    paid YTD net:                    ${dollar(paidYTDNet)}`);
  console.log(`    paid YTD gross:                  ${dollar(paidYTDGross)}`);
  console.log(`    lifetime paid (gross positive):  ${dollar(totalPaidPositiveDollars)}`);
  console.log(`    days since first deal:           ${Math.round(daysSinceFirst)}`);
  console.log(`    days remaining in 2026:          ${daysRemainingYear}`);
  console.log();
  console.log('  BEFORE — Path 1 formula (commit 4cb0d09, currently on main):');
  console.log(`    monthlyRate (60/40 blended, M1+M2 only): ${dollar(preSessionMonthlyRate)}/mo`);
  console.log(`    boost (0.15 × pipelineM1M2):              ${dollar(preSessionBoost)}`);
  console.log(`    All Time   = rate × 12 + boost          = ${dollar(preSessionAllTime)}`);
  console.log(`    This Year  = paidYTD + rate × monthsLeft + boost`);
  console.log(`               = ${dollar(paidYTDNet)} + ${dollar(preSessionMonthlyRate)} × ${monthsRemainingYear.toFixed(2)} + ${dollar(preSessionBoost)}`);
  console.log(`               = ${dollar(preSessionThisYear)}`);
  console.log();
  console.log('  AFTER — current session formula:');
  console.log(`    paceRate (pure pace, includes M3):  ${dollar(currentPaceRate)}/mo`);
  console.log(`    inPeriodEarned (2026 deals × full): ${dollar(inPeriodEarned)}`);
  console.log(`    All Time / This Year (same):        = inPeriodEarned + paceRate × ${monthsRemainingYear.toFixed(2)}mo`);
  console.log(`                                        = ${dollar(inPeriodEarned)} + ${dollar(currentPaceRate * monthsRemainingYear)}`);
  console.log(`                                        = ${dollar(currentAllTimeThisYear)}`);
  console.log();
  console.log('  ──────── DELTA ────────');
  console.log(`    All Time:   ${dollar(preSessionAllTime).padStart(10)}  →  ${dollar(currentAllTimeThisYear).padStart(10)}   (Δ ${dollar(currentAllTimeThisYear - preSessionAllTime)})`);
  console.log(`    This Year:  ${dollar(preSessionThisYear).padStart(10)}  →  ${dollar(currentAllTimeThisYear).padStart(10)}   (Δ ${dollar(currentAllTimeThisYear - preSessionThisYear)})`);
  console.log();
  process.exit(0);
}

// ─── tiny helpers (M1-only and M2-only viewer resolvers) ────────────────

function viewerM1Only(p: any, repId: string): number {
  if (p.repId === repId) return (p.m1AmountCents ?? 0) / 100;
  if (p.setterId === repId) return (p.setterM1AmountCents ?? 0) / 100;
  const cc = p.additionalClosers?.find((c: any) => c.userId === repId);
  if (cc) return (cc.m1AmountCents ?? 0) / 100;
  const cs = p.additionalSetters?.find((c: any) => c.userId === repId);
  if (cs) return (cs.m1AmountCents ?? 0) / 100;
  return 0;
}
function viewerM2Only(p: any, repId: string): number {
  if (p.repId === repId) return (p.m2AmountCents ?? 0) / 100;
  if (p.setterId === repId) return (p.setterM2AmountCents ?? 0) / 100;
  const cc = p.additionalClosers?.find((c: any) => c.userId === repId);
  if (cc) return (cc.m2AmountCents ?? 0) / 100;
  const cs = p.additionalSetters?.find((c: any) => c.userId === repId);
  if (cs) return (cs.m2AmountCents ?? 0) / 100;
  return 0;
}

main().catch((err) => { console.error('compare failed:', err); process.exit(1); });
