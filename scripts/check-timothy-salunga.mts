// Read-only spike: investigate Timothy Salunga's commission drift.
// Josh reports the setter was removed at deal-submit, then re-added later,
// and the math is off. Hypothesis (from code review of lib/context.tsx:505-527):
// the setter-re-add path has a `!closerHasPaidM1` guard that prevents creating
// a setter M1 PayrollEntry when the closer already had M1 Paid, leaving
// `setterM1AmountCents` orphan on the Project with no matching PayrollEntry.
//
// Run: set -a && . ./.env && set +a && npx tsx scripts/check-timothy-salunga.mts

import { PrismaLibSql } from '@prisma/adapter-libsql';

const tursoUrl = process.env.TURSO_DATABASE_URL!;
const tursoToken = process.env.TURSO_AUTH_TOKEN!;
const { PrismaClient } = await import('../lib/generated/prisma/client.ts');
const adapter = new PrismaLibSql({ url: tursoUrl, authToken: tursoToken });
const prisma = new PrismaClient({ adapter });

function c(cents: number | null | undefined) {
  if (cents == null) return '-';
  return `$${(cents / 100).toFixed(2)}`;
}

// Find Timothy — fuzzy on several spellings.
const candidates = await prisma.user.findMany({
  where: {
    OR: [
      { firstName: { contains: 'Tim' } },
      { lastName: { contains: 'Sal' } },
      { lastName: { contains: 'alunga' } },
      { email: { contains: 'tim' } },
      { email: { contains: 'alunga' } },
    ],
  },
  select: { id: true, firstName: true, lastName: true, email: true, role: true, repType: true, active: true },
  take: 30,
});
console.log('--- User search hits ---');
console.log(JSON.stringify(candidates, null, 2));
const tim = candidates.find((u) => u.firstName.toLowerCase().startsWith('tim')) ?? candidates[0];

if (!tim) {
  console.log('Timothy Salunga NOT FOUND in User table — searching Project.customerName instead.');
  const asCustomer = await prisma.project.findMany({
    where: {
      OR: [
        { customerName: { contains: 'Timothy' } },
        { customerName: { contains: 'Salunga' } },
      ],
    },
    take: 20,
  });
  console.log(`Project matches: ${asCustomer.length}`);
  for (const p of asCustomer) {
    const closer = p.closerId ? await prisma.user.findUnique({ where: { id: p.closerId }, select: { firstName: true, lastName: true, role: true, repType: true } }) : null;
    const setter = p.setterId ? await prisma.user.findUnique({ where: { id: p.setterId }, select: { firstName: true, lastName: true } }) : null;
    const installer = p.installerId ? await prisma.installer.findUnique({ where: { id: p.installerId }, select: { name: true, installPayPct: true } }) : null;
    const financer = p.financerId ? await prisma.financer.findUnique({ where: { id: p.financerId }, select: { name: true } }) : null;
    const payroll = await prisma.payrollEntry.findMany({ where: { projectId: p.id }, select: { id: true, repId: true, paymentStage: true, amountCents: true, status: true, type: true, notes: true } });
    console.log(`\n--- ${p.customerName} — phase ${p.phase}, id ${p.id} ---`);
    console.log(`  Closer: ${closer ? `${closer.firstName} ${closer.lastName} (${closer.role}, repType=${closer.repType})` : '-'}`);
    console.log(`  Setter: ${setter ? `${setter.firstName} ${setter.lastName}` : '-'}`);
    console.log(`  Installer: ${installer?.name ?? '-'} (installPayPct=${installer?.installPayPct ?? '-'})`);
    console.log(`  Financer: ${financer?.name ?? '-'}`);
    console.log(`  kW=${p.kWSize}, netPPW=${p.netPPW}, productType=${p.productType}`);
    console.log(`  Closer: M1=${c(p.m1AmountCents)} paid=${p.m1Paid} | M2=${c(p.m2AmountCents)} paid=${p.m2Paid} | M3=${c(p.m3AmountCents)} paid=${p.m3Paid}`);
    console.log(`  Setter: M1=${c(p.setterM1AmountCents)} | M2=${c(p.setterM2AmountCents)} | M3=${c(p.setterM3AmountCents)}`);
    console.log(`  PayrollEntry rows: ${payroll.length}`);
    for (const e of payroll) {
      const who = await prisma.user.findUnique({ where: { id: e.repId }, select: { firstName: true, lastName: true } });
      console.log(`    - ${who?.firstName ?? '?'} ${who?.lastName ?? '?'} ${e.paymentStage} ${c(e.amountCents)} [${e.status}] ${e.type}${e.notes ? ` "${e.notes}"` : ''}`);
    }
    const setterM1Any = payroll.filter((e) => e.repId === p.setterId && e.paymentStage === 'M1').reduce((a, e) => a + e.amountCents, 0);
    const expectedSetterM1 = p.setterM1AmountCents ?? 0;
    if (p.setterId && expectedSetterM1 > 0 && setterM1Any === 0 && p.phase !== 'New' && p.phase !== 'Acceptance') {
      console.log(`  🔴 ORPHAN: setterM1Amount=${c(expectedSetterM1)} but no PayrollEntry (phase past Acceptance)`);
    }
  }
  // Intentional fall-through — keep running the systemic orphan scan below.
}

if (tim) {
  console.log(`\n=== Timothy: ${tim.firstName} ${tim.lastName} (${tim.role}, ${tim.repType ?? 'no repType'}) id=${tim.id} ===\n`);

// His projects (as closer, setter, or subDealer)
const projects = await prisma.project.findMany({
  where: {
    OR: [
      { closerId: tim.id },
      { setterId: tim.id },
      { subDealerId: tim.id },
    ],
  },
  orderBy: { updatedAt: 'desc' },
});

console.log(`Projects where Tim appears: ${projects.length}\n`);

for (const p of projects) {
  const closer = p.closerId ? await prisma.user.findUnique({ where: { id: p.closerId }, select: { firstName: true, lastName: true, role: true } }) : null;
  const setter = p.setterId ? await prisma.user.findUnique({ where: { id: p.setterId }, select: { firstName: true, lastName: true } }) : null;
  const payroll = await prisma.payrollEntry.findMany({ where: { projectId: p.id }, select: { id: true, repId: true, paymentStage: true, amountCents: true, status: true, type: true, date: true, notes: true } });

  // Role in this deal
  const role = p.closerId === tim.id ? 'CLOSER' : p.setterId === tim.id ? 'SETTER' : 'SUB-DEALER';

  console.log(`\n--- ${p.customerName} (${role}) — phase ${p.phase}, id ${p.id} ---`);
  console.log(`  Closer: ${closer ? `${closer.firstName} ${closer.lastName} (${closer.role})` : '-'}`);
  console.log(`  Setter: ${setter ? `${setter.firstName} ${setter.lastName}` : '-'}`);
  console.log(`  kW: ${p.kWSize}, netPPW: ${p.netPPW}`);
  console.log(`  Closer amounts: M1=${c(p.m1AmountCents)} paid=${p.m1Paid} | M2=${c(p.m2AmountCents)} paid=${p.m2Paid} | M3=${c(p.m3AmountCents)} paid=${p.m3Paid}`);
  console.log(`  Setter amounts: M1=${c(p.setterM1AmountCents)} | M2=${c(p.setterM2AmountCents)} | M3=${c(p.setterM3AmountCents)}`);
  console.log(`  PayrollEntry rows: ${payroll.length}`);
  for (const e of payroll) {
    const who = await prisma.user.findUnique({ where: { id: e.repId }, select: { firstName: true, lastName: true } });
    console.log(`    - ${who?.firstName ?? '?'} ${who?.lastName ?? '?'} ${e.paymentStage} ${c(e.amountCents)} [${e.status}] ${e.type}${e.notes ? ` "${e.notes}"` : ''}`);
  }

  // Drift checks
  const closerId = p.closerId;
  const setterId = p.setterId;
  const closerM1Paid = payroll.filter((e) => e.repId === closerId && e.paymentStage === 'M1' && e.status === 'Paid').reduce((a, e) => a + e.amountCents, 0);
  const setterM1Any = payroll.filter((e) => e.repId === setterId && e.paymentStage === 'M1').reduce((a, e) => a + e.amountCents, 0);
  const expectedCloserM1 = p.m1AmountCents ?? 0;
  const expectedSetterM1 = p.setterM1AmountCents ?? 0;

  if (setterId && expectedSetterM1 > 0 && setterM1Any === 0 && closerM1Paid >= expectedCloserM1 + expectedSetterM1) {
    console.log(`  🔴 DRIFT: closer M1 Paid = ${c(closerM1Paid)} looks like the FULL M1 (pre-setter), setter has NO M1 entry, but setterM1Amount = ${c(expectedSetterM1)}`);
  } else if (setterId && expectedSetterM1 > 0 && setterM1Any === 0) {
    console.log(`  ⚠️  Setter M1 expected ${c(expectedSetterM1)} but no PayrollEntry exists`);
  }
}
} // end if (tim)

// Also count how many projects site-wide have the same shape:
// setterM1AmountCents > 0 but no setter PayrollEntry exists.
console.log(`\n\n=== Systemic scan: orphan setterM1AmountCents across all projects ===\n`);

// Only projects past Acceptance (where PayrollEntries *should* exist).
const PHASES_NEEDING_PAYROLL = ['Site Survey', 'Design', 'Permitting', 'Pending Install', 'Installed', 'PTO', 'Completed'];
const orphanCandidates = await prisma.project.findMany({
  where: {
    setterId: { not: null },
    setterM1AmountCents: { gt: 0 },
    phase: { in: PHASES_NEEDING_PAYROLL },
  },
  select: { id: true, customerName: true, phase: true, setterId: true, closerId: true, m1AmountCents: true, setterM1AmountCents: true, m1Paid: true },
});

let orphanCount = 0;
let orphanWithCloserM1Paid = 0;
const orphanExamples: Array<{ name: string; phase: string; setterM1: number; closerM1Paid: boolean }> = [];
for (const p of orphanCandidates) {
  const setterM1 = await prisma.payrollEntry.count({
    where: { projectId: p.id, repId: p.setterId!, paymentStage: 'M1' },
  });
  if (setterM1 === 0) {
    orphanCount++;
    if (p.m1Paid) orphanWithCloserM1Paid++;
    if (orphanExamples.length < 15) {
      orphanExamples.push({ name: p.customerName, phase: p.phase, setterM1: p.setterM1AmountCents ?? 0, closerM1Paid: !!p.m1Paid });
    }
  }
}

console.log(`Past-Acceptance projects w/ setterM1AmountCents>0: ${orphanCandidates.length}`);
console.log(`Of those, ORPHAN (no setter M1 PayrollEntry): ${orphanCount}`);
console.log(`Of orphans, closer has m1Paid=true (the Timothy-shape): ${orphanWithCloserM1Paid}`);
console.log(`Sample orphans:`);
for (const o of orphanExamples) console.log(`  - ${o.name.padEnd(30)} phase=${o.phase.padEnd(18)} missingSetterM1=${c(o.setterM1).padStart(10)} m1Paid=${o.closerM1Paid}`);

await prisma.$disconnect();
