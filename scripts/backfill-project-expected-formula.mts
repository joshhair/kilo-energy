/**
 * Second-pass backfill: compute Project expected-payment amounts using
 * Kilo's commission formula for deals where Glide's Commission CSV didn't
 * have per-milestone splits populated (in-flight deals: Site Survey /
 * Design / Permitting / etc.).
 *
 * For those deals, we have the Project's baseline, kW, sold PPW, and
 * installer — enough to call splitCloserSetterPay() and derive expected
 * M1/M2/M3 for closer and setter.
 *
 * RULES (preserve historical truth):
 *   - If any existing milestone field on the Project is > 0, leave ALL
 *     milestone fields alone for that rep side (closer vs. setter tracked
 *     independently). Paid historical amounts trump computed expectations.
 *   - Only compute for the side(s) that are entirely $0.
 *   - Use baselineOverrideJson.closerPerW (Glide's snapshot) as the closer
 *     baseline — not Kilo's current rate — so the imported deal reflects
 *     the rate locked in at sale.
 *   - setterBaselinePerW comes from baselineOverrideJson.setterPerW, else
 *     0 (self-gen).
 *   - Installer's installPayPct comes from Kilo's Installer config.
 */
import { PrismaLibSql } from '@prisma/adapter-libsql';
const { splitCloserSetterPay } = await import('../lib/commission.ts');

const tursoUrl = process.env.TURSO_DATABASE_URL!;
const tursoToken = process.env.TURSO_AUTH_TOKEN!;
if (!tursoUrl || !tursoToken) { console.error('TURSO env required'); process.exit(1); }
const { PrismaClient } = await import('../lib/generated/prisma/client.ts');
const adapter = new PrismaLibSql({ url: tursoUrl, authToken: tursoToken });
const prisma = new PrismaClient({ adapter });

const COMMIT = process.argv.includes('--commit');

// Installer → installPayPct lookup
const installers = await prisma.installer.findMany({ select: { id: true, name: true, installPayPct: true } });
const instById = new Map(installers.map((i) => [i.id, i]));
console.log(`Loaded ${installers.length} installers`);

// All imported projects — filter to those that need computation (any zero side)
const projects = await prisma.project.findMany({
  select: {
    id: true, customerName: true, phase: true,
    kWSize: true, netPPW: true, installerId: true,
    closerId: true, setterId: true,
    m1AmountCents: true, m2AmountCents: true, m3AmountCents: true,
    setterM1AmountCents: true, setterM2AmountCents: true, setterM3AmountCents: true,
    baselineOverrideJson: true,
  },
});
console.log(`Loaded ${projects.length} projects`);

interface Update {
  projectId: string;
  customer: string;
  side: 'closer' | 'setter' | 'both';
  m1?: number; m2?: number; m3?: number;
  sm1?: number; sm2?: number; sm3?: number;
  debug: string;
}
const updates: Update[] = [];
let skipped_noBaseline = 0;
let skipped_already = 0;
let skipped_installerMissing = 0;
let skipped_noKW = 0;

for (const p of projects) {
  const closerSide = p.m1AmountCents + p.m2AmountCents + (p.m3AmountCents ?? 0);
  const setterSide = p.setterM1AmountCents + p.setterM2AmountCents + (p.setterM3AmountCents ?? 0);
  const closerNeedsCompute = p.closerId && closerSide === 0;
  const setterNeedsCompute = p.setterId && setterSide === 0;
  if (!closerNeedsCompute && !setterNeedsCompute) { skipped_already++; continue; }
  if (p.kWSize === 0) { skipped_noKW++; continue; }

  const inst = instById.get(p.installerId);
  if (!inst) { skipped_installerMissing++; continue; }

  const baseline = p.baselineOverrideJson ? JSON.parse(p.baselineOverrideJson) : null;
  const closerPerW = baseline?.closerPerW ?? null;
  if (closerPerW == null || closerPerW <= 0) { skipped_noBaseline++; continue; }

  const setterPerW = p.setterId ? (baseline?.setterPerW ?? closerPerW + 0.10) : 0;
  const trainerRate = 0;
  const installPayPct = inst.installPayPct ?? 80;

  const split = splitCloserSetterPay(
    p.netPPW,
    closerPerW,
    setterPerW,
    trainerRate,
    p.kWSize,
    installPayPct,
  );

  const upd: Update = {
    projectId: p.id, customer: p.customerName,
    side: closerNeedsCompute && setterNeedsCompute ? 'both' : closerNeedsCompute ? 'closer' : 'setter',
    debug: `PPW=${p.netPPW} closer=${closerPerW} setter=${setterPerW} kW=${p.kWSize} pct=${installPayPct}`,
  };
  if (closerNeedsCompute) {
    upd.m1 = Math.round(split.closerM1 * 100);
    upd.m2 = Math.round(split.closerM2 * 100);
    upd.m3 = Math.round(split.closerM3 * 100);
  }
  if (setterNeedsCompute) {
    upd.sm1 = Math.round(split.setterM1 * 100);
    upd.sm2 = Math.round(split.setterM2 * 100);
    upd.sm3 = Math.round(split.setterM3 * 100);
  }
  updates.push(upd);
}

console.log(`\nSkipped: already populated=${skipped_already}, no kW=${skipped_noKW}, no baseline override=${skipped_noBaseline}, installer missing=${skipped_installerMissing}`);
console.log(`Updates planned: ${updates.length}`);
console.log(`  both sides: ${updates.filter((u) => u.side === 'both').length}`);
console.log(`  closer only: ${updates.filter((u) => u.side === 'closer').length}`);
console.log(`  setter only: ${updates.filter((u) => u.side === 'setter').length}`);

console.log(`\nSample:`);
for (const u of updates.slice(0, 5)) {
  console.log(`  ${u.customer} [${u.side}] ${u.debug}`);
  if (u.m1 !== undefined) console.log(`    closer: M1=$${(u.m1/100).toFixed(2)} M2=$${(u.m2!/100).toFixed(2)} M3=$${(u.m3!/100).toFixed(2)}`);
  if (u.sm1 !== undefined) console.log(`    setter: M1=$${(u.sm1/100).toFixed(2)} M2=$${(u.sm2!/100).toFixed(2)} M3=$${(u.sm3!/100).toFixed(2)}`);
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
  if (u.m1 !== undefined) { data.m1AmountCents = u.m1; data.m2AmountCents = u.m2; data.m3AmountCents = u.m3; }
  if (u.sm1 !== undefined) { data.setterM1AmountCents = u.sm1; data.setterM2AmountCents = u.sm2; data.setterM3AmountCents = u.sm3; }
  await prisma.project.update({ where: { id: u.projectId }, data });
  applied++;
  if (applied % 50 === 0) console.log(`  ${applied}/${updates.length}`);
}
console.log(`\n✓ Applied ${applied} updates.`);
await prisma.$disconnect();
