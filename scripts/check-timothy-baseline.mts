// Read-only spike: where did Timothy Salunga's commission baselines come from?
//
// Stored amounts on the Project imply closerBaseline=1.95, setterBaseline=2.05,
// but Josh says the BVI installer's baseline tab shows closer=2.85, setter=2.95.
// The delta (~0.90/W) is systematic — same on both rows.
//
// Candidates to check:
//   1. Project.baselineOverrideJson — per-deal override, bypasses installer config
//   2. TrainerAssignment for Daniel (setter) — nonzero trainerRate can shift the math
//   3. Active InstallerPricingVersion for BVI — what's currently effective, and
//      does it have multiple tiers where the wrong one could be picked?
//   4. Financer-specific overrides (if any) for Wheelhouse+Loan
//   5. Admin-as-closer logic (anything in commission.ts that filters by role)
//
// Also: cross-check by resimulating splitCloserSetterPay with the current
// "canonical" baselines and compare to what's actually stored on the Project.

import { PrismaLibSql } from '@prisma/adapter-libsql';

const tursoUrl = process.env.TURSO_DATABASE_URL!;
const tursoToken = process.env.TURSO_AUTH_TOKEN!;
const { PrismaClient } = await import('../lib/generated/prisma/client.ts');
const { splitCloserSetterPay } = await import('../lib/commission.ts');
const adapter = new PrismaLibSql({ url: tursoUrl, authToken: tursoToken });
const prisma = new PrismaClient({ adapter });

function c(cents: number | null | undefined) {
  if (cents == null) return '-';
  return `$${(cents / 100).toFixed(2)}`;
}

const project = await prisma.project.findFirst({
  where: { customerName: { contains: 'Salunga' } },
});

if (!project) {
  console.log('No Salunga project found.');
  await prisma.$disconnect();
  process.exit(1);
}

console.log(`\n=== ${project.customerName} — phase ${project.phase}, id ${project.id} ===\n`);
console.log(`Closer: ${project.closerId}`);
console.log(`Setter: ${project.setterId}`);
console.log(`Installer: ${project.installerId}`);
console.log(`Financer: ${project.financerId}`);
console.log(`Product: ${project.productType}`);
console.log(`kW: ${project.kWSize}, netPPW: ${project.netPPW}`);
console.log(`Stored:`);
console.log(`  Closer: M1=${c(project.m1AmountCents)} M2=${c(project.m2AmountCents)} M3=${c(project.m3AmountCents)}`);
console.log(`  Setter: M1=${c(project.setterM1AmountCents)} M2=${c(project.setterM2AmountCents)} M3=${c(project.setterM3AmountCents)}`);
console.log(`  Closer total: ${c((project.m1AmountCents ?? 0) + (project.m2AmountCents ?? 0) + (project.m3AmountCents ?? 0))}`);
console.log(`  Setter total: ${c((project.setterM1AmountCents ?? 0) + (project.setterM2AmountCents ?? 0) + (project.setterM3AmountCents ?? 0))}`);
console.log(`  Trainer:     projectTrainerId=${project.trainerId ?? '-'}, projectTrainerRate=${project.trainerRate ?? '-'}`);

// 1. baselineOverride
console.log(`\n--- 1. baselineOverrideJson ---`);
console.log(`  ${project.baselineOverrideJson ?? '(null — no per-deal override)'}`);

// 2. TrainerAssignment for the setter
if (project.setterId) {
  const setterTrainer = await prisma.trainerAssignment.findMany({
    where: { traineeId: project.setterId },
    include: { tiers: true },
  });
  console.log(`\n--- 2. TrainerAssignment for setter (${project.setterId}) ---`);
  if (setterTrainer.length === 0) {
    console.log('  (none)');
  } else {
    for (const ta of setterTrainer) {
      const trainer = await prisma.user.findUnique({ where: { id: ta.trainerId }, select: { firstName: true, lastName: true } });
      console.log(`  Trainer: ${trainer?.firstName} ${trainer?.lastName} (${ta.trainerId})  isActive=${ta.isActiveTraining}`);
      for (const t of ta.tiers.sort((a, b) => a.sortOrder - b.sortOrder)) {
        console.log(`    tier ${t.sortOrder}: upToDeal=${t.upToDeal ?? '∞'}, ratePerW=${t.ratePerW}`);
      }
    }
  }
}
// Also for the closer
if (project.closerId) {
  const closerTrainer = await prisma.trainerAssignment.findMany({
    where: { traineeId: project.closerId },
    include: { tiers: true },
  });
  console.log(`--- 2b. TrainerAssignment for closer (${project.closerId}) ---`);
  if (closerTrainer.length === 0) {
    console.log('  (none)');
  } else {
    for (const ta of closerTrainer) {
      const trainer = await prisma.user.findUnique({ where: { id: ta.trainerId }, select: { firstName: true, lastName: true } });
      console.log(`  Trainer: ${trainer?.firstName} ${trainer?.lastName} (${ta.trainerId})  isActive=${ta.isActiveTraining}`);
      for (const t of ta.tiers.sort((a, b) => a.sortOrder - b.sortOrder)) {
        console.log(`    tier ${t.sortOrder}: upToDeal=${t.upToDeal ?? '∞'}, ratePerW=${t.ratePerW}`);
      }
    }
  }
}

// 3. Active InstallerPricingVersion for BVI
if (project.installerId) {
  const installer = await prisma.installer.findUnique({ where: { id: project.installerId } });
  console.log(`\n--- 3. Installer ${installer?.name} (usesProductCatalog=${installer?.usesProductCatalog}, installPayPct=${installer?.installPayPct}) ---`);

  const versions = await prisma.installerPricingVersion.findMany({
    where: { installerId: project.installerId },
    include: { tiers: true },
    orderBy: { effectiveFrom: 'desc' },
  });
  console.log(`  Pricing versions: ${versions.length}`);
  for (const v of versions) {
    console.log(`  - ${v.label ?? '(unlabeled)'} effective ${v.effectiveFrom}${v.effectiveTo ? ' → ' + v.effectiveTo : ' (active)'} [${v.rateType}]`);
    for (const t of v.tiers) {
      console.log(`      minKW=${t.minKW}${t.maxKW ? ' - ' + t.maxKW : '+'}  closerPerW=${t.closerPerW}, kiloPerW=${t.kiloPerW}, setterPerW=${(t as { setterPerW?: number }).setterPerW ?? '-'}`);
    }
  }
}

// 4. Product catalog lookup — BVI uses product catalog, so baselines come
//    from Product → ProductPricingVersion → ProductPricingTier (by kW).
console.log(`\n--- 4. Product catalog resolution (usesProductCatalog=true) ---`);
console.log(`  Project.productId: ${project.productId ?? '(null — PC not resolved)'}`);
console.log(`  Project.productPricingVersionId: ${project.productPricingVersionId ?? '(null)'}`);
if (project.productId) {
  const prod = await prisma.product.findUnique({ where: { id: project.productId } });
  console.log(`  Product: ${prod?.name ?? '?'} (family=${prod?.family ?? '?'}, active=${prod?.active})`);
}
if (project.productPricingVersionId) {
  const ppv = await prisma.productPricingVersion.findUnique({
    where: { id: project.productPricingVersionId },
    include: { tiers: { orderBy: { minKW: 'asc' } } },
  });
  console.log(`  PricingVersion: ${ppv?.label ?? '?'} effective ${ppv?.effectiveFrom} → ${ppv?.effectiveTo ?? 'active'}`);
  for (const t of ppv?.tiers ?? []) {
    const match = (project.kWSize ?? 0) >= t.minKW && (t.maxKW == null || (project.kWSize ?? 0) < t.maxKW);
    console.log(`    ${match ? '> ' : '  '}minKW=${t.minKW} maxKW=${t.maxKW ?? '∞'}  closerPerW=${t.closerPerW}, setterPerW=${t.setterPerW}, kiloPerW=${t.kiloPerW}${t.subDealerPerW != null ? ', subDealerPerW=' + t.subDealerPerW : ''}`);
  }
}

// Also — what does the LIVE product catalog look like for BVI right now,
// in case Timothy's stored version is stale?
console.log(`\n  Current active catalog for BVI:`);
const liveProducts = await prisma.product.findMany({
  where: { installerId: project.installerId ?? '', active: true },
  include: {
    pricingVersions: {
      where: { effectiveTo: null },
      include: { tiers: { orderBy: { minKW: 'asc' } } },
    },
  },
});
for (const p of liveProducts) {
  console.log(`  - ${p.family}/${p.name}:`);
  for (const v of p.pricingVersions) {
    for (const t of v.tiers) {
      const match = (project.kWSize ?? 0) >= t.minKW && (t.maxKW == null || (project.kWSize ?? 0) < t.maxKW);
      console.log(`      ${match ? '>' : ' '} minKW=${t.minKW} maxKW=${t.maxKW ?? '∞'}  closerPerW=${t.closerPerW}, setterPerW=${t.setterPerW}, kiloPerW=${t.kiloPerW}`);
    }
  }
}

// 5. Re-simulate with the "canonical" baselines (closer 2.85 / setter 2.95 per Josh)
console.log(`\n--- 5. Resimulation ---`);
const sim = splitCloserSetterPay(project.netPPW ?? 0, 2.85, 2.95, 0, project.kWSize ?? 0, 80);
console.log(`  With closer=2.85, setter=2.95, trainerRate=0, installPayPct=80:`);
console.log(`    closer total=$${sim.closerTotal.toFixed(2)} (M1=$${sim.closerM1.toFixed(2)}, M2=$${sim.closerM2.toFixed(2)}, M3=$${sim.closerM3.toFixed(2)})`);
console.log(`    setter total=$${sim.setterTotal.toFixed(2)} (M1=$${sim.setterM1.toFixed(2)}, M2=$${sim.setterM2.toFixed(2)}, M3=$${sim.setterM3.toFixed(2)})`);

// Then back-solve: what setter baseline would produce the stored amounts?
const storedCloserTotal = ((project.m1AmountCents ?? 0) + (project.m2AmountCents ?? 0) + (project.m3AmountCents ?? 0)) / 100;
const storedSetterTotal = ((project.setterM1AmountCents ?? 0) + (project.setterM2AmountCents ?? 0) + (project.setterM3AmountCents ?? 0)) / 100;
const kw = project.kWSize ?? 0;
const sold = project.netPPW ?? 0;
// setterHalf*kw*1000 = storedSetterTotal  ⇒  setterHalf = storedSetterTotal / (kw * 1000)
const setterHalfPerW = storedSetterTotal / (kw * 1000);
const aboveSplitPerW = 2 * setterHalfPerW;
const splitPoint = sold - aboveSplitPerW;
const closerDiff = storedCloserTotal - storedSetterTotal; // closerDifferential
const diffPerW = closerDiff / (kw * 1000);
const closerBaselineInferred = splitPoint - diffPerW;
console.log(`\n  Back-solved from stored amounts:`);
console.log(`    implied setter baseline (splitPoint): ${splitPoint.toFixed(3)}`);
console.log(`    implied diff (setter - closer): ${diffPerW.toFixed(3)}`);
console.log(`    implied closer baseline: ${closerBaselineInferred.toFixed(3)}`);

// 6. What soldPPW would we need for CORRECT baselines (2.85/2.95) to match the stored amounts?
console.log(`\n--- 6. Back-solving soldPPW assuming baselines really are 2.85/2.95 ---`);
// aboveSplit = (soldPPW - 2.95) * kW * 1000. setterHalf = aboveSplit / 2 = storedSetterTotal
// So (soldPPW - 2.95) = (storedSetterTotal * 2) / (kW * 1000)
const impliedSoldPPW = 2.95 + (storedSetterTotal * 2) / (kw * 1000);
console.log(`  With baselines 2.85/2.95, the stored setter total $${storedSetterTotal.toFixed(2)} implies soldPPW=${impliedSoldPPW.toFixed(3)}`);
console.log(`  (actual netPPW on project is ${sold})`);
console.log(`  Delta: soldPPW used in compute was $${(impliedSoldPPW - sold).toFixed(3)}/W higher than stored netPPW.`);

// 7. Project timestamps
console.log(`\n--- 7. Timestamps ---`);
console.log(`  createdAt: ${project.createdAt}`);
console.log(`  updatedAt: ${project.updatedAt}`);
console.log(`  phaseChangedAt: ${project.phaseChangedAt ?? '(not set)'}`);

// 8. Audit log entries for this project
const auditEntries = await prisma.auditLog.findMany({
  where: { entityType: 'project', entityId: project.id },
  orderBy: { createdAt: 'asc' },
  take: 50,
});
console.log(`\n--- 8. AuditLog entries for project (${auditEntries.length}) ---`);
for (const a of auditEntries) {
  console.log(`  ${a.createdAt.toISOString()} ${a.action} by ${a.actorEmail ?? a.actorUserId ?? '-'}`);
  if (a.oldValue || a.newValue) {
    const summarize = (v: string | null) => {
      if (!v) return '';
      try {
        const o = JSON.parse(v);
        const picks: Record<string, unknown> = {};
        for (const k of ['netPPW', 'soldPPW', 'kWSize', 'closerId', 'setterId', 'm1AmountCents', 'm2AmountCents', 'setterM1AmountCents', 'installerId', 'productId']) {
          if (k in o) picks[k] = o[k];
        }
        return Object.keys(picks).length ? JSON.stringify(picks) : `(${Object.keys(o).length} keys)`;
      } catch {
        return v.slice(0, 120);
      }
    };
    if (a.oldValue) console.log(`    old: ${summarize(a.oldValue)}`);
    if (a.newValue) console.log(`    new: ${summarize(a.newValue)}`);
  }
}

await prisma.$disconnect();
