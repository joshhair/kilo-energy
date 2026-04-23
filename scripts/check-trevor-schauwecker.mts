// Read-only diagnostic: Trevor Schauwecker deal state. Josh submitted
// it, setter Tyson was dropped, manually re-added Tyson + trainer Paul,
// but Paul's trainer override isn't showing up.
//
// Run: set -a && . ./.env && set +a && npx tsx scripts/check-trevor-schauwecker.mts

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

const proj = await prisma.project.findFirst({
  where: { customerName: { contains: 'Schauwecker' } },
  include: {
    installer: true,
    financer: true,
    additionalClosers: true,
    additionalSetters: true,
  },
});

if (!proj) {
  console.log('No project found with Schauwecker in customerName');
  process.exit(0);
}

console.log(`── Project: ${proj.customerName} (id=${proj.id}) ──`);
console.log(`  Phase: ${proj.phase}`);
console.log(`  Installer: ${proj.installer?.name}  (installPayPct=${proj.installer?.installPayPct})`);
console.log(`  kW=${proj.kWSize}  netPPW=${proj.netPPW}  soldDate=${proj.soldDate}  productType=${proj.productType}`);
console.log(`  closerId=${proj.closerId}`);
console.log(`  setterId=${proj.setterId ?? '(none)'}`);
console.log(`  trainerId=${proj.trainerId ?? '(none)'}`);
console.log(`  trainerRate=${proj.trainerRate ?? '(null)'}`);
console.log(``);
console.log(`  Stored amounts:`);
console.log(`    Closer: M1=${c(proj.m1AmountCents)}  M2=${c(proj.m2AmountCents)}  M3=${c(proj.m3AmountCents)}`);
console.log(`    Setter: M1=${c(proj.setterM1AmountCents)}  M2=${c(proj.setterM2AmountCents)}  M3=${c(proj.setterM3AmountCents)}`);
console.log(``);

if (proj.setterId) {
  const s = await prisma.user.findUnique({
    where: { id: proj.setterId },
    select: { firstName: true, lastName: true },
  });
  console.log(`  Setter: ${s?.firstName} ${s?.lastName} (${proj.setterId})`);

  const asg = await prisma.trainerAssignment.findFirst({
    where: { traineeId: proj.setterId },
    include: {
      trainer: { select: { firstName: true, lastName: true } },
      tiers: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (asg) {
    console.log(`  Assignment-chain trainer for setter: ${asg.trainer?.firstName} ${asg.trainer?.lastName} (id=${asg.trainerId})`);
    console.log(`    isActiveTraining=${asg.isActiveTraining}`);
    console.log(`    tiers: ${asg.tiers.map((t) => `[upTo=${t.upToDeal} rate=${t.ratePerW}]`).join(' ')}`);
  } else {
    console.log(`  Assignment-chain trainer for setter: (none)`);
  }
}

if (proj.trainerId) {
  const t = await prisma.user.findUnique({
    where: { id: proj.trainerId },
    select: { firstName: true, lastName: true, email: true, repType: true, active: true },
  });
  console.log(``);
  console.log(`  Per-project trainer: ${t ? `${t.firstName} ${t.lastName}` : 'USER NOT FOUND'} (id=${proj.trainerId})`);
}

const entries = await prisma.payrollEntry.findMany({
  where: { projectId: proj.id },
  orderBy: [{ paymentStage: 'asc' }, { createdAt: 'asc' }],
  include: { rep: { select: { firstName: true, lastName: true } } },
});
console.log(``);
console.log(`  PayrollEntry rows: ${entries.length}`);
for (const e of entries) {
  console.log(`    ${e.rep?.firstName} ${e.rep?.lastName}  ${e.paymentStage.padEnd(7)} ${c(e.amountCents).padStart(10)}  [${e.status}] ${e.type} "${e.notes ?? ''}"`);
}

// All recent audit entries for this project (to reconstruct the sequence)
const logs = await prisma.auditLog.findMany({
  where: { entityType: 'Project', entityId: proj.id },
  orderBy: { createdAt: 'asc' },
});
console.log(``);
console.log(`  Full audit trail (${logs.length} entries):`);
for (const l of logs) {
  console.log(`    ${l.createdAt.toISOString()}  ${l.action}  by ${l.actorEmail ?? '(unknown)'}`);
  if (l.oldValue) console.log(`      old: ${l.oldValue}`);
  if (l.newValue) console.log(`      new: ${l.newValue}`);
}

await prisma.$disconnect();
