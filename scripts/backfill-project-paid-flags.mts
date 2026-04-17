/**
 * Backfill Project.m1Paid / m2Paid / m3Paid based on existing Paid
 * PayrollEntries. The import wrote PayrollEntry rows with status='Paid'
 * but left the Project-level paid flags untouched, so the Milestone
 * Status strip showed "Pending" even when the per-rep card showed "Paid".
 *
 * Rule: a project's m{N}Paid flag = true if ANY PayrollEntry for that
 * project has paymentStage='M{N}' AND status='Paid'. Trainer and bonus
 * entries are ignored (they track separately).
 */
import { PrismaLibSql } from '@prisma/adapter-libsql';

const tursoUrl = process.env.TURSO_DATABASE_URL!;
const tursoToken = process.env.TURSO_AUTH_TOKEN!;
if (!tursoUrl || !tursoToken) { console.error('TURSO env required'); process.exit(1); }
const { PrismaClient } = await import('../lib/generated/prisma/client.ts');
const adapter = new PrismaLibSql({ url: tursoUrl, authToken: tursoToken });
const prisma = new PrismaClient({ adapter });

const COMMIT = process.argv.includes('--commit');

// All projects with their current flags
const projects = await prisma.project.findMany({
  select: { id: true, customerName: true, m1Paid: true, m2Paid: true, m3Paid: true },
});

// Aggregate Paid PayrollEntries by project + stage
const paidEntries = await prisma.payrollEntry.findMany({
  where: { status: 'Paid', paymentStage: { in: ['M1', 'M2', 'M3'] } },
  select: { projectId: true, paymentStage: true },
});

const paidByProject = new Map<string, Set<string>>();
for (const e of paidEntries) {
  if (!e.projectId) continue;
  if (!paidByProject.has(e.projectId)) paidByProject.set(e.projectId, new Set());
  paidByProject.get(e.projectId)!.add(e.paymentStage);
}

interface Update { id: string; customer: string; m1?: boolean; m2?: boolean; m3?: boolean; }
const updates: Update[] = [];
for (const p of projects) {
  const stages = paidByProject.get(p.id) ?? new Set<string>();
  const want = { m1: stages.has('M1'), m2: stages.has('M2'), m3: stages.has('M3') };
  const upd: Update = { id: p.id, customer: p.customerName };
  let changed = false;
  if (want.m1 && !p.m1Paid) { upd.m1 = true; changed = true; }
  if (want.m2 && !p.m2Paid) { upd.m2 = true; changed = true; }
  if (want.m3 && !p.m3Paid) { upd.m3 = true; changed = true; }
  if (changed) updates.push(upd);
}

console.log(`Projects total:       ${projects.length}`);
console.log(`Projects to update:   ${updates.length}`);
const m1Count = updates.filter((u) => u.m1).length;
const m2Count = updates.filter((u) => u.m2).length;
const m3Count = updates.filter((u) => u.m3).length;
console.log(`  M1 flag flips:      ${m1Count}`);
console.log(`  M2 flag flips:      ${m2Count}`);
console.log(`  M3 flag flips:      ${m3Count}`);
console.log(`Sample:`);
for (const u of updates.slice(0, 5)) {
  const tags = [u.m1 && 'M1', u.m2 && 'M2', u.m3 && 'M3'].filter(Boolean).join('+');
  console.log(`  ${u.customer}: ${tags} → Paid`);
}

if (!COMMIT) {
  console.log('\n(dry-run — rerun with --commit to apply.)');
  await prisma.$disconnect();
  process.exit(0);
}

console.log('\nApplying…');
let applied = 0;
for (const u of updates) {
  const data: Record<string, unknown> = {};
  if (u.m1) data.m1Paid = true;
  if (u.m2) data.m2Paid = true;
  if (u.m3) data.m3Paid = true;
  await prisma.project.update({ where: { id: u.id }, data });
  applied++;
  if (applied % 100 === 0) console.log(`  ${applied}/${updates.length}`);
}
console.log(`\n✓ Applied ${applied} updates.`);
await prisma.$disconnect();
