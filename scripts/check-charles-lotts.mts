// Read-only probe: pull Charles Lotts's project row + every PayrollEntry
// attached, so we can reproduce the "breakdown vs overall" mismatch by hand
// rather than guessing at code paths.

import { PrismaLibSql } from '@prisma/adapter-libsql';

const { PrismaClient } = await import('../lib/generated/prisma/client.ts');
const adapter = new PrismaLibSql({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
const prisma = new PrismaClient({ adapter });

const projects = await prisma.project.findMany({
  where: {
    OR: [
      { customerName: { contains: 'Lotts' } },
      { customerName: { contains: 'Lott' } },
      { customerName: { contains: 'Charles' } },
    ],
  },
  include: {
    closer: { select: { id: true, firstName: true, lastName: true, repType: true } },
    setter: { select: { id: true, firstName: true, lastName: true, repType: true } },
    subDealer: { select: { id: true, firstName: true, lastName: true } },
    trainer: { select: { id: true, firstName: true, lastName: true } },
    installer: { select: { id: true, name: true, installPayPct: true } },
    financer: { select: { id: true, name: true } },
    additionalClosers: { include: { user: { select: { firstName: true, lastName: true } } }, orderBy: { position: 'asc' } },
    additionalSetters: { include: { user: { select: { firstName: true, lastName: true } } }, orderBy: { position: 'asc' } },
  },
});

if (projects.length === 0) {
  console.log('No Charles Lotts project found.');
  process.exit(0);
}

for (const p of projects) {
  console.log('─'.repeat(72));
  console.log(`Project: ${p.customerName} (${p.id})`);
  console.log(`  Phase: ${p.phase}  Installer: ${p.installer?.name} (installPayPct=${p.installer?.installPayPct ?? '?'})`);
  console.log(`  Financer: ${p.financer?.name}  ProductType: ${p.productType}  SoldDate: ${p.soldDate}`);
  console.log(`  kWSize: ${p.kWSize}  netPPW: ${p.netPPW}`);
  console.log(`  Closer:    ${p.closer ? `${p.closer.firstName} ${p.closer.lastName} (${p.closer.repType})` : '—'}`);
  console.log(`  Setter:    ${p.setter ? `${p.setter.firstName} ${p.setter.lastName} (${p.setter.repType})` : '—'}`);
  console.log(`  SubDealer: ${p.subDealer ? `${p.subDealer.firstName} ${p.subDealer.lastName}` : '—'}`);
  console.log(`  Trainer (project-override): ${p.trainer ? `${p.trainer.firstName} ${p.trainer.lastName} @ ${p.trainerRate}` : '—'}`);
  console.log(`  Additional closers: ${p.additionalClosers.map((c) => `${c.user.firstName} ${c.user.lastName} (M1=${c.m1AmountCents/100}, M2=${c.m2AmountCents/100}, M3=${(c.m3AmountCents ?? 0)/100})`).join('; ') || '—'}`);
  console.log(`  Additional setters: ${p.additionalSetters.map((s) => `${s.user.firstName} ${s.user.lastName} (M1=${s.m1AmountCents/100}, M2=${s.m2AmountCents/100}, M3=${(s.m3AmountCents ?? 0)/100})`).join('; ') || '—'}`);
  console.log('');
  console.log('  Stored amounts (closer):');
  console.log(`    M1=$${p.m1AmountCents/100}  M2=$${p.m2AmountCents/100}  M3=$${(p.m3AmountCents ?? 0)/100}  Total=$${(p.m1AmountCents + p.m2AmountCents + (p.m3AmountCents ?? 0))/100}`);
  console.log('  Stored amounts (setter):');
  console.log(`    M1=$${p.setterM1AmountCents/100}  M2=$${p.setterM2AmountCents/100}  M3=$${(p.setterM3AmountCents ?? 0)/100}  Total=$${(p.setterM1AmountCents + p.setterM2AmountCents + (p.setterM3AmountCents ?? 0))/100}`);
  console.log(`  baselineOverrideJson: ${p.baselineOverrideJson ?? '(null)'}`);
  console.log(`  pricingSource: ${(p as unknown as { pricingSource?: string }).pricingSource ?? '(null)'}`);

  const entries = await prisma.payrollEntry.findMany({
    where: { projectId: p.id },
    include: { rep: { select: { firstName: true, lastName: true } } },
    orderBy: [{ paymentStage: 'asc' }, { date: 'asc' }],
  });
  console.log('');
  console.log(`  PayrollEntries (${entries.length} total):`);
  for (const e of entries) {
    console.log(`    [${e.status.padEnd(7)}] ${e.paymentStage.padEnd(8)} ${(`${e.rep?.firstName ?? ''} ${e.rep?.lastName ?? ''}`).trim().padEnd(24)} $${(e.amountCents/100).toFixed(2).padStart(10)}  ${e.date}  notes="${e.notes ?? ''}"`);
  }
}

await prisma.$disconnect();
