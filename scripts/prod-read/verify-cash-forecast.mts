/**
 * verify-cash-forecast.mts — Phase 5.5 sanity: real Josh data → cash forecast number.
 * Read-only via prod-read helper.
 */

import { writeSnapshot } from './index.mts';
import { getRepPipeline, getRepPaidHistory } from './queries.mts';

const JOSH_ID = 'admin_josh';
const TODAY = new Date();

type Project = {
  soldDate: string;
  phase: string;
  closerId?: string | null;
  setterId?: string | null;
  m1AmountCents: number;
  m2AmountCents: number;
  m3AmountCents?: number | null;
  setterM1AmountCents?: number | null;
  setterM2AmountCents?: number | null;
  setterM3AmountCents?: number | null;
  additionalClosers?: Array<{ userId: string; m1AmountCents: number; m2AmountCents: number; m3AmountCents?: number | null }>;
  additionalSetters?: Array<{ userId: string; m1AmountCents: number; m2AmountCents: number; m3AmountCents?: number | null }>;
};

const MILESTONE_LAG_DAYS = { m1: 14, m2: 45, m3: 80 };
const FIRED_BY_PHASE: Record<string, { m1: boolean; m2: boolean; m3: boolean }> = {
  'New':             { m1: false, m2: false, m3: false },
  'Acceptance':      { m1: true,  m2: false, m3: false },
  'Site Survey':     { m1: true,  m2: false, m3: false },
  'Design':          { m1: true,  m2: false, m3: false },
  'Permitting':      { m1: true,  m2: false, m3: false },
  'Pending Install': { m1: true,  m2: false, m3: false },
  'Installed':       { m1: true,  m2: true,  m3: false },
  'PTO':             { m1: true,  m2: true,  m3: false },
  'Completed':       { m1: true,  m2: true,  m3: true  },
};

function viewerMilestones(p: Project, repId: string): { m1: number; m2: number; m3: number } {
  if (p.closerId === repId) return { m1: p.m1AmountCents / 100, m2: p.m2AmountCents / 100, m3: (p.m3AmountCents ?? 0) / 100 };
  if (p.setterId === repId) return { m1: (p.setterM1AmountCents ?? 0) / 100, m2: (p.setterM2AmountCents ?? 0) / 100, m3: (p.setterM3AmountCents ?? 0) / 100 };
  const cc = p.additionalClosers?.find((c) => c.userId === repId);
  if (cc) return { m1: cc.m1AmountCents / 100, m2: cc.m2AmountCents / 100, m3: (cc.m3AmountCents ?? 0) / 100 };
  const cs = p.additionalSetters?.find((c) => c.userId === repId);
  if (cs) return { m1: cs.m1AmountCents / 100, m2: cs.m2AmountCents / 100, m3: (cs.m3AmountCents ?? 0) / 100 };
  return { m1: 0, m2: 0, m3: 0 };
}

async function main() {
  const pipeline = (await getRepPipeline(JOSH_ID)) as Project[];
  const paid = await getRepPaidHistory(JOSH_ID, `${TODAY.getFullYear()}-01-01`);
  const paidYTD = paid.reduce((s, e: { amountCents: number }) => s + e.amountCents, 0) / 100;

  // dealsPerMonth + avg milestones
  const nonCanc = pipeline.filter((p) => p.phase !== 'Cancelled');
  const sorted = [...nonCanc].sort((a, b) => a.soldDate.localeCompare(b.soldDate));
  const firstSold = new Date(sorted[0].soldDate + 'T12:00:00').getTime();
  const daysSinceFirst = Math.max((TODAY.getTime() - firstSold) / 86_400_000, 1);
  const effectiveDays = Math.max(daysSinceFirst, 30);
  const dealsPerMonth = (nonCanc.length / effectiveDays) * 30.44;

  let m1Sum = 0, m2Sum = 0, m3Sum = 0;
  for (const p of nonCanc) {
    const m = viewerMilestones(p, JOSH_ID);
    m1Sum += m.m1; m2Sum += m.m2; m3Sum += m.m3;
  }
  const avgM1 = m1Sum / nonCanc.length;
  const avgM2 = m2Sum / nonCanc.length;
  const avgM3 = m3Sum / nonCanc.length;

  // Pipeline cash: pending milestones with ETAs in 2026
  const yearEnd = new Date(TODAY.getFullYear(), 11, 31, 23, 59, 59).getTime();
  let pipelineCash = 0;
  let pipelineDetail: { phase: string; m1?: number; m2?: number; m3?: number }[] = [];
  for (const p of nonCanc) {
    if (p.phase === 'On Hold') continue;
    const fired = FIRED_BY_PHASE[p.phase] ?? FIRED_BY_PHASE['New'];
    const m = viewerMilestones(p, JOSH_ID);
    const soldMs = new Date(p.soldDate + 'T12:00:00').getTime();
    const detail: { phase: string; m1?: number; m2?: number; m3?: number } = { phase: p.phase };
    if (!fired.m1 && soldMs + MILESTONE_LAG_DAYS.m1 * 86_400_000 <= yearEnd) { pipelineCash += m.m1; detail.m1 = m.m1; }
    if (!fired.m2 && soldMs + MILESTONE_LAG_DAYS.m2 * 86_400_000 <= yearEnd) { pipelineCash += m.m2; detail.m2 = m.m2; }
    if (!fired.m3 && soldMs + MILESTONE_LAG_DAYS.m3 * 86_400_000 <= yearEnd) { pipelineCash += m.m3; detail.m3 = m.m3; }
    if (detail.m1 || detail.m2 || detail.m3) pipelineDetail.push(detail);
  }

  // Future cash
  let futureCash = 0;
  const currentMonth = TODAY.getMonth();
  for (let m = currentMonth; m <= 11; m++) {
    const saleDate = new Date(TODAY.getFullYear(), m, 15, 12).getTime();
    if (saleDate < TODAY.getTime()) continue;
    const fraction = m === currentMonth
      ? Math.max(0, (new Date(TODAY.getFullYear(), m + 1, 1).getTime() - TODAY.getTime()) / (30.44 * 86_400_000))
      : 1;
    const deals = dealsPerMonth * fraction;
    if (saleDate + MILESTONE_LAG_DAYS.m1 * 86_400_000 <= yearEnd) futureCash += avgM1 * deals;
    if (saleDate + MILESTONE_LAG_DAYS.m2 * 86_400_000 <= yearEnd) futureCash += avgM2 * deals;
    if (saleDate + MILESTONE_LAG_DAYS.m3 * 86_400_000 <= yearEnd) futureCash += avgM3 * deals;
  }

  const total = Math.round(pipelineCash + futureCash + paidYTD);
  const dollar = (n: number) => '$' + Math.round(n).toLocaleString();

  writeSnapshot('verify-cash-forecast-josh', { pipelineCash, futureCash, paidYTD, total, dealsPerMonth, avgM1, avgM2, avgM3 });

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  JOSH HAIR — 2026 Cash Forecast (today ${TODAY.toISOString().slice(0, 10)})`);
  console.log('══════════════════════════════════════════════════════════════\n');
  console.log(`  dealsPerMonth:           ${dealsPerMonth.toFixed(2)}`);
  console.log(`  avg M1/M2/M3 per deal:   ${dollar(avgM1)} / ${dollar(avgM2)} / ${dollar(avgM3)}`);
  console.log('');
  console.log(`  pipelineCash (existing in-flight milestones fire by Dec 31):  ${dollar(pipelineCash)}`);
  console.log(`  futureCash   (projected new-sale milestones in 2026):         ${dollar(futureCash)}`);
  console.log(`  paidYTD      (cash already received):                         ${dollar(paidYTD)}`);
  console.log(`  ─────────────────────────────────────────────────────────────`);
  console.log(`  TOTAL 2026 CASH FORECAST:                                     ${dollar(total)}`);
  console.log('');
  process.exit(0);
}

main().catch((err) => { console.error('verify-cash-forecast failed:', err); process.exit(1); });
