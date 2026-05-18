/**
 * verify-pipeline-with-trainer.mts — confirms that after the trainer-override
 * bake-in, Dashboard "In Pipeline" and My Pay "Pipeline" produce IDENTICAL
 * numbers for reps with active trainer assignments.
 *
 * Runs the same math the helpers run, against real Turso data. Read-only.
 */

import { readDb, logQuery } from './index.mts';

const ACTIVE_PHASES = ['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install', 'Installed', 'PTO', 'Completed'];
const INSTALLER_PAY_CONFIGS: Record<string, { installPayPct: number }> = {
  'ESP': { installPayPct: 80 }, 'EXO': { installPayPct: 80 }, 'EXO (OLD)': { installPayPct: 80 },
  'SolarTech': { installPayPct: 100 }, 'GEG': { installPayPct: 80 }, 'SunPower': { installPayPct: 80 },
  'Complete Solar': { installPayPct: 80 }, 'Solrite': { installPayPct: 80 }, 'Solnova': { installPayPct: 80 },
  'Bryton': { installPayPct: 80 }, 'One Source': { installPayPct: 80 }, 'Pacific Coast': { installPayPct: 80 },
};
const DEFAULT_INSTALL_PAY_PCT = 80;

// Pick the rep to verify — defaults to Hunter (3 trainer assignments).
const REP_ID = process.argv[2] ?? 'cmo21br26000keowse73oe2ie';
const TODAY = new Date().toISOString().slice(0, 10);

type Project = {
  id: string; phase: string; soldDate: string;
  closerId: string | null; setterId: string | null; trainerId: string | null;
  kWSize: number; installer: string;
  m1AmountCents: number; m2AmountCents: number; m3AmountCents: number | null;
  setterM1AmountCents: number | null; setterM2AmountCents: number | null; setterM3AmountCents: number | null;
  m1Paid: boolean; m2Paid: boolean; m3Paid: boolean | null;
  additionalClosers: Array<{ userId: string; m1AmountCents: number; m2AmountCents: number; m3AmountCents: number | null }>;
  additionalSetters: Array<{ userId: string; m1AmountCents: number; m2AmountCents: number; m3AmountCents: number | null }>;
};

type Tier = { upToDeal: number | null; ratePerW: number };
type TrainerAssignment = { id: string; trainerId: string; traineeId: string; tiers: Tier[] };

function viewerMilestones(p: Project, repId: string) {
  if (p.closerId === repId) return { m1: p.m1AmountCents / 100, m2: p.m2AmountCents / 100, m3: (p.m3AmountCents ?? 0) / 100 };
  if (p.setterId === repId) return { m1: (p.setterM1AmountCents ?? 0) / 100, m2: (p.setterM2AmountCents ?? 0) / 100, m3: (p.setterM3AmountCents ?? 0) / 100 };
  const cc = p.additionalClosers.find(c => c.userId === repId);
  if (cc) return { m1: cc.m1AmountCents / 100, m2: cc.m2AmountCents / 100, m3: (cc.m3AmountCents ?? 0) / 100 };
  const cs = p.additionalSetters.find(c => c.userId === repId);
  if (cs) return { m1: cs.m1AmountCents / 100, m2: cs.m2AmountCents / 100, m3: (cs.m3AmountCents ?? 0) / 100 };
  return { m1: 0, m2: 0, m3: 0 };
}

function getRate(assignment: TrainerAssignment, completedDeals: number): number {
  for (const tier of assignment.tiers) {
    if (tier.upToDeal === null || completedDeals < tier.upToDeal) return tier.ratePerW;
  }
  return 0;
}

const dollar = (n: number) => '$' + Math.round(n).toLocaleString();

async function main() {
  // ─── Rep's projects (own attribution) for base pipeline ───
  const myProjects = (await readDb.project.findMany({
    where: {
      OR: [
        { closerId: REP_ID }, { setterId: REP_ID }, { trainerId: REP_ID },
        { additionalClosers: { some: { userId: REP_ID } } },
        { additionalSetters: { some: { userId: REP_ID } } },
      ],
      phase: { not: 'Cancelled' },
    },
    select: {
      id: true, phase: true, soldDate: true, closerId: true, setterId: true, trainerId: true,
      kWSize: true, installer: true,
      m1AmountCents: true, m2AmountCents: true, m3AmountCents: true,
      setterM1AmountCents: true, setterM2AmountCents: true, setterM3AmountCents: true,
      m1Paid: true, m2Paid: true, m3Paid: true,
      additionalClosers: { select: { userId: true, m1AmountCents: true, m2AmountCents: true, m3AmountCents: true } },
      additionalSetters: { select: { userId: true, m1AmountCents: true, m2AmountCents: true, m3AmountCents: true } },
    },
  })) as Project[];

  // ─── Trainer assignments + ALL projects (trainee attribution) ───
  const trainerAssignments = (await readDb.trainerAssignment.findMany({
    where: { trainerId: REP_ID },
    include: { tiers: { orderBy: { sortOrder: 'asc' } } },
  })).map((a) => ({
    id: a.id, trainerId: a.trainerId, traineeId: a.traineeId,
    tiers: a.tiers.map((t) => ({ upToDeal: t.upToDeal, ratePerW: t.ratePerW })),
  })) as TrainerAssignment[];

  // All projects involving any trainee (for trainer override compute)
  const traineeIds = trainerAssignments.map((a) => a.traineeId);
  const allProjects = traineeIds.length === 0 ? [] : (await readDb.project.findMany({
    where: {
      OR: [
        { closerId: { in: traineeIds } }, { setterId: { in: traineeIds } },
        { additionalClosers: { some: { userId: { in: traineeIds } } } },
        { additionalSetters: { some: { userId: { in: traineeIds } } } },
      ],
    },
    select: {
      id: true, phase: true, closerId: true, setterId: true, kWSize: true, installer: true,
      m1Paid: true, m2Paid: true, m3Paid: true,
      additionalClosers: { select: { userId: true } },
      additionalSetters: { select: { userId: true } },
    },
  })) as unknown as Project[];

  const payroll = await readDb.payrollEntry.findMany({
    where: { repId: REP_ID },
    select: { id: true, projectId: true, paymentStage: true, status: true, date: true, amountCents: true },
  });
  logQuery('inputs', { REP_ID, projects: myProjects.length, assignments: trainerAssignments.length, payroll: payroll.length }, 0);

  // ─── BASE pipeline ───
  const active = myProjects.filter((p) => ACTIVE_PHASES.includes(p.phase));
  const netByStage = new Map<string, number>();
  const paidByStage = new Map<string, number>();
  for (const e of payroll) {
    if (!e.projectId) continue;
    if (e.paymentStage !== 'M1' && e.paymentStage !== 'M2' && e.paymentStage !== 'M3') continue;
    const key = `${e.projectId}:${e.paymentStage}`;
    const amt = e.amountCents / 100;
    netByStage.set(key, (netByStage.get(key) ?? 0) + amt);
    if (e.status === 'Paid' && e.date <= TODAY) {
      paidByStage.set(key, (paidByStage.get(key) ?? 0) + amt);
    }
  }
  let m1 = 0, m2 = 0, m3 = 0;
  for (const p of active) {
    const expected = viewerMilestones(p, REP_ID);
    const m1Exp = netByStage.get(`${p.id}:M1`) ?? expected.m1;
    const m2Exp = netByStage.get(`${p.id}:M2`) ?? expected.m2;
    const m3Exp = netByStage.get(`${p.id}:M3`) ?? expected.m3;
    const m1Pd = paidByStage.get(`${p.id}:M1`) ?? 0;
    const m2Pd = paidByStage.get(`${p.id}:M2`) ?? 0;
    const m3Pd = paidByStage.get(`${p.id}:M3`) ?? 0;
    m1 += Math.max(0, m1Exp - m1Pd);
    m2 += Math.max(0, m2Exp - m2Pd);
    m3 += Math.max(0, m3Exp - m3Pd);
  }
  const base = m1 + m2 + m3;

  // ─── TRAINER OVERRIDE pipeline ───
  const paidTrainerByProject = new Map<string, number>();
  for (const e of payroll) {
    if (!e.projectId || e.paymentStage !== 'Trainer' || e.status !== 'Paid' || e.date > TODAY) continue;
    paidTrainerByProject.set(e.projectId, (paidTrainerByProject.get(e.projectId) ?? 0) + e.amountCents / 100);
  }

  let trainerOverride = 0;
  const overrideBreakdown: Array<{ trainee: string; rate: number; activeDeals: number; subtotal: number }> = [];
  for (const assignment of trainerAssignments) {
    const isTrainee = (p: Project) =>
      p.closerId === assignment.traineeId || p.setterId === assignment.traineeId ||
      p.additionalClosers.some(c => c.userId === assignment.traineeId) ||
      p.additionalSetters.some(s => s.userId === assignment.traineeId);
    const completed = allProjects.filter((p) => {
      if (!isTrainee(p)) return false;
      const pct = INSTALLER_PAY_CONFIGS[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
      return pct < 100 ? p.m3Paid === true : p.m2Paid === true;
    }).length;
    const rate = getRate(assignment, completed);
    if (rate <= 0) continue;
    const traineeActive = allProjects.filter((p) => ACTIVE_PHASES.includes(p.phase) && isTrainee(p));
    let subtotal = 0;
    for (const p of traineeActive) {
      const expected = Math.round(rate * p.kWSize * 1000 * 100) / 100;
      const alreadyPaid = paidTrainerByProject.get(p.id) ?? 0;
      subtotal += Math.max(0, expected - alreadyPaid);
    }
    overrideBreakdown.push({ trainee: assignment.traineeId.slice(-8), rate, activeDeals: traineeActive.length, subtotal });
    trainerOverride += subtotal;
  }

  const total = base + trainerOverride;

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  PIPELINE for ${REP_ID} (today ${TODAY})`);
  console.log('══════════════════════════════════════════════════════════════\n');
  console.log(`  base pipeline (M1+M2+M3, role-aware):`);
  console.log(`    M1: ${dollar(m1)}`);
  console.log(`    M2: ${dollar(m2)}`);
  console.log(`    M3: ${dollar(m3)}`);
  console.log(`    ─────────────────`);
  console.log(`    base: ${dollar(base)}`);
  console.log('');
  console.log(`  trainer override (${trainerAssignments.length} assignments):`);
  for (const b of overrideBreakdown) {
    console.log(`    trainee=${b.trainee} rate=$${b.rate}/W  active=${b.activeDeals}  subtotal=${dollar(b.subtotal)}`);
  }
  console.log(`    ─────────────────`);
  console.log(`    override total: ${dollar(trainerOverride)}`);
  console.log('');
  console.log(`  TOTAL PIPELINE (base + override): ${dollar(total)}`);
  console.log('');
  console.log(`  Both Dashboard "In Pipeline" and My Pay "Pipeline" should now show:`);
  console.log(`    ${dollar(total)}`);
  console.log('');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
