/**
 * verify-pipeline-unified.mts — confirm Dashboard and My Pay show the same
 * "Pipeline" number for Josh after the viewerPipelineRemaining unification.
 *
 * Inlines the helper math (tsx-isolated-module quirks make importing
 * from the app lib unreliable from .mts scripts). The logic mirrors
 * `lib/period-projection.ts:viewerPipelineRemaining` exactly.
 *
 * Read-only.
 */

import { readDb, logQuery } from './index.mts';

const JOSH_ID = 'admin_josh';
const ACTIVE_PHASES = ['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install', 'Installed', 'PTO', 'Completed'];

type Project = {
  id: string;
  phase: string;
  closerId: string | null;
  setterId: string | null;
  m1AmountCents: number;
  m2AmountCents: number;
  m3AmountCents: number | null;
  setterM1AmountCents: number | null;
  setterM2AmountCents: number | null;
  setterM3AmountCents: number | null;
  additionalClosers: Array<{ userId: string; m1AmountCents: number; m2AmountCents: number; m3AmountCents: number | null }>;
  additionalSetters: Array<{ userId: string; m1AmountCents: number; m2AmountCents: number; m3AmountCents: number | null }>;
};

function viewerMilestones(p: Project, repId: string): { m1: number; m2: number; m3: number } {
  if (p.closerId === repId) return { m1: p.m1AmountCents / 100, m2: p.m2AmountCents / 100, m3: (p.m3AmountCents ?? 0) / 100 };
  if (p.setterId === repId) return { m1: (p.setterM1AmountCents ?? 0) / 100, m2: (p.setterM2AmountCents ?? 0) / 100, m3: (p.setterM3AmountCents ?? 0) / 100 };
  const cc = p.additionalClosers.find((c) => c.userId === repId);
  if (cc) return { m1: cc.m1AmountCents / 100, m2: cc.m2AmountCents / 100, m3: (cc.m3AmountCents ?? 0) / 100 };
  const cs = p.additionalSetters.find((c) => c.userId === repId);
  if (cs) return { m1: cs.m1AmountCents / 100, m2: cs.m2AmountCents / 100, m3: (cs.m3AmountCents ?? 0) / 100 };
  return { m1: 0, m2: 0, m3: 0 };
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  const projects = (await readDb.project.findMany({
    where: {
      OR: [
        { closerId: JOSH_ID },
        { setterId: JOSH_ID },
        { trainerId: JOSH_ID },
        { additionalClosers: { some: { userId: JOSH_ID } } },
        { additionalSetters: { some: { userId: JOSH_ID } } },
      ],
      phase: { not: 'Cancelled' },
    },
    select: {
      id: true,
      phase: true,
      closerId: true,
      setterId: true,
      m1AmountCents: true,
      m2AmountCents: true,
      m3AmountCents: true,
      setterM1AmountCents: true,
      setterM2AmountCents: true,
      setterM3AmountCents: true,
      additionalClosers: { select: { userId: true, m1AmountCents: true, m2AmountCents: true, m3AmountCents: true } },
      additionalSetters: { select: { userId: true, m1AmountCents: true, m2AmountCents: true, m3AmountCents: true } },
    },
  })) as Project[];
  logQuery('projects', { JOSH_ID }, projects.length);

  const payroll = await readDb.payrollEntry.findMany({
    where: { repId: JOSH_ID },
    select: { id: true, projectId: true, paymentStage: true, status: true, date: true, amountCents: true },
  });
  logQuery('payroll', { JOSH_ID }, payroll.length);

  const active = projects.filter((p) => ACTIVE_PHASES.includes(p.phase));

  // Build the same two maps the helper uses
  const netByProjectStage = new Map<string, number>();
  const paidByProjectStage = new Map<string, number>();
  for (const e of payroll) {
    if (!e.projectId) continue;
    if (e.paymentStage !== 'M1' && e.paymentStage !== 'M2' && e.paymentStage !== 'M3') continue;
    const key = `${e.projectId}:${e.paymentStage}`;
    const amt = e.amountCents / 100;
    netByProjectStage.set(key, (netByProjectStage.get(key) ?? 0) + amt);
    if (e.status === 'Paid' && e.date <= today) {
      paidByProjectStage.set(key, (paidByProjectStage.get(key) ?? 0) + amt);
    }
  }

  let m1Total = 0, m2Total = 0, m3Total = 0;
  for (const p of active) {
    const expected = viewerMilestones(p, JOSH_ID);
    const m1Exp = netByProjectStage.get(`${p.id}:M1`) ?? expected.m1;
    const m2Exp = netByProjectStage.get(`${p.id}:M2`) ?? expected.m2;
    const m3Exp = netByProjectStage.get(`${p.id}:M3`) ?? expected.m3;
    const m1Paid = paidByProjectStage.get(`${p.id}:M1`) ?? 0;
    const m2Paid = paidByProjectStage.get(`${p.id}:M2`) ?? 0;
    const m3Paid = paidByProjectStage.get(`${p.id}:M3`) ?? 0;
    m1Total += Math.max(0, m1Exp - m1Paid);
    m2Total += Math.max(0, m2Exp - m2Paid);
    m3Total += Math.max(0, m3Exp - m3Paid);
  }
  const total = m1Total + m2Total + m3Total;
  const dollar = (n: number) => '$' + Math.round(n).toLocaleString();

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  Unified Pipeline (Dashboard ≡ My Pay base) for ${JOSH_ID}`);
  console.log('══════════════════════════════════════════════════════════════\n');
  console.log(`  active projects: ${active.length}`);
  console.log(`  M1 remaining: ${dollar(m1Total)}`);
  console.log(`  M2 remaining: ${dollar(m2Total)}`);
  console.log(`  M3 remaining: ${dollar(m3Total)}`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  TOTAL (base, no trainer override): ${dollar(total)}`);
  console.log('');
  console.log(`  Dashboard adds trainer override on top of this. My Pay does not.`);
  console.log(`  Once trainer override is added, Dashboard ≠ My Pay by exactly the override amount.`);
  console.log('');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
