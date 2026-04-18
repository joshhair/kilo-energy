/**
 * Reconcile stored project commission amounts against the server-side
 * authoritative compute (lib/commission-server.ts).
 *
 * Why: before Batch 2b.4, PATCH /api/projects/[id] never recomputed
 * commission. Any deal whose netPPW / kWSize / installer / product /
 * closer / setter / trainer was edited after submission can carry stale
 * m1/m2/m3 amounts. Timothy Salunga's deal is the known case; there may
 * be many more. Going forward the server stays in sync — this script is
 * for the one-time cleanup and recurring audit.
 *
 * Behavior:
 *   - Dry run: diff stored vs computed for every non-cancelled project,
 *     print top-N worst drift, report counts.
 *   - `--commit`: write the recomputed amounts onto the Project rows
 *     (m1AmountCents, m2AmountCents, m3AmountCents, setter* equivalents).
 *     Does NOT touch PayrollEntry rows — admin reconciles those through
 *     the normal payroll review flow.
 *
 * Run (dry-run against prod Turso):
 *   set -a && . ./.env && set +a && npx tsx scripts/reconcile-project-commission.mts
 * Commit:
 *   add `--commit`
 */
import { PrismaLibSql } from '@prisma/adapter-libsql';
const { computeProjectCommission } = await import('../lib/commission-server.ts');
type CommissionInputs = import('../lib/commission-server.ts').CommissionInputs;
type CommissionDeps = import('../lib/commission-server.ts').CommissionDeps;
type InstallerBaseline = import('../lib/data.ts').InstallerBaseline;

const tursoUrl = process.env.TURSO_DATABASE_URL!;
const tursoToken = process.env.TURSO_AUTH_TOKEN!;
if (!tursoUrl || !tursoToken) {
  console.error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in env');
  process.exit(1);
}
const { PrismaClient } = await import('../lib/generated/prisma/client.ts');
const adapter = new PrismaLibSql({ url: tursoUrl, authToken: tursoToken });
const prisma = new PrismaClient({ adapter });

const COMMIT = process.argv.includes('--commit');
const TOP_N = 20;

console.log(COMMIT ? '── COMMIT MODE — will write drift fixes ──' : '── DRY RUN — no writes ──');

// Load all the pricing/trainer data once, upfront.
const [
  projects,
  installerPricingVersionsRaw,
  productCatalogProductsRaw,
  productCatalogPricingVersionsRaw,
  trainerAssignmentsRaw,
  payrollEntriesRaw,
  installers,
] = await Promise.all([
  // Skip Glide-imported deals — they carry pre-Kilo commission numbers
  // straight from the Glide CSV. Re-deriving them from the current
  // pricing-version tables produces drift against data we already
  // treated as authoritative at import. Same policy as Batch 4b
  // chargeback generation: imports are inviolable historical records.
  prisma.project.findMany({
    where: {
      phase: { notIn: ['Cancelled'] },
      importedFromGlide: false,
    },
    include: {
      installer: true,
      additionalClosers: true,
      additionalSetters: true,
    },
  }),
  prisma.installerPricingVersion.findMany({ include: { tiers: true } }),
  prisma.product.findMany({ where: { active: true }, include: { pricingVersions: { include: { tiers: true } } } }),
  prisma.productPricingVersion.findMany({ include: { tiers: true } }),
  prisma.trainerAssignment.findMany({ include: { tiers: { orderBy: { sortOrder: 'asc' } } } }),
  prisma.payrollEntry.findMany({ where: { paymentStage: 'Trainer' } }),
  prisma.installer.findMany({ select: { id: true, name: true, installPayPct: true, usesProductCatalog: true } }),
]);

console.log(`Loaded ${projects.length} active projects.`);

const installerPricingVersions = installerPricingVersionsRaw.map((v) => ({
  id: v.id,
  installer: installers.find((i) => i.id === v.installerId)?.name ?? '',
  label: v.label ?? '',
  effectiveFrom: v.effectiveFrom,
  effectiveTo: v.effectiveTo,
  rates: v.rateType === 'tiered'
    ? {
        type: 'tiered' as const,
        bands: v.tiers.map((t) => ({
          minKW: t.minKW,
          maxKW: t.maxKW,
          closerPerW: t.closerPerW,
          kiloPerW: t.kiloPerW,
          setterPerW: t.setterPerW ?? undefined,
          subDealerPerW: t.subDealerPerW ?? undefined,
        })),
      }
    : {
        type: 'flat' as const,
        closerPerW: v.tiers[0]?.closerPerW ?? 0,
        kiloPerW: v.tiers[0]?.kiloPerW ?? 0,
        setterPerW: v.tiers[0]?.setterPerW ?? undefined,
        subDealerPerW: v.tiers[0]?.subDealerPerW ?? undefined,
      },
}));

const productCatalogProducts = productCatalogProductsRaw.map((p) => ({
  id: p.id,
  installer: installers.find((i) => i.id === p.installerId)?.name ?? '',
  family: p.family,
  name: p.name,
  tiers: (p.pricingVersions.find((pv) => pv.effectiveTo === null)?.tiers ?? []).map((t) => ({
    minKW: t.minKW,
    maxKW: t.maxKW,
    closerPerW: t.closerPerW,
    setterPerW: t.setterPerW,
    kiloPerW: t.kiloPerW,
    subDealerPerW: t.subDealerPerW ?? undefined,
  })),
}));

const productCatalogPricingVersions = productCatalogPricingVersionsRaw.map((v) => ({
  id: v.id,
  productId: v.productId,
  label: v.label,
  effectiveFrom: v.effectiveFrom,
  effectiveTo: v.effectiveTo,
  tiers: v.tiers.map((t) => ({
    minKW: t.minKW,
    maxKW: t.maxKW,
    closerPerW: t.closerPerW,
    setterPerW: t.setterPerW,
    kiloPerW: t.kiloPerW,
    subDealerPerW: t.subDealerPerW ?? undefined,
  })),
}));

const trainerAssignments = trainerAssignmentsRaw.map((a) => ({
  id: a.id,
  trainerId: a.trainerId,
  traineeId: a.traineeId,
  isActiveTraining: a.isActiveTraining,
  tiers: a.tiers.map((t) => ({ upToDeal: t.upToDeal, ratePerW: t.ratePerW })),
}));

const payrollEntries = payrollEntriesRaw.map((e) => ({
  repId: e.repId,
  projectId: e.projectId,
  paymentStage: e.paymentStage,
}));

const installerPayConfigs: Record<string, { installPayPct: number; usesProductCatalog: boolean }> = {};
for (const i of installers) installerPayConfigs[i.name] = { installPayPct: i.installPayPct, usesProductCatalog: i.usesProductCatalog };

const sharedDeps: Omit<CommissionDeps, 'currentProjectId'> = {
  installerPricingVersions,
  solarTechProducts: [],
  productCatalogProducts,
  productCatalogPricingVersions,
  trainerAssignments,
  payrollEntries,
  installerPayConfigs,
};

interface Drift {
  projectId: string;
  customerName: string;
  installer: string;
  soldDate: string;
  netPPW: number;
  kWSize: number;
  storedCloserTotal: number;
  expectedCloserTotal: number;
  storedSetterTotal: number;
  expectedSetterTotal: number;
  totalAbsDelta: number;
  fields: string[]; // which specific cents fields differ
}

const drifts: Drift[] = [];
let unchanged = 0;
let skipped = 0;

const centsMatch = (a: number | null, b: number | null) => (a ?? 0) === (b ?? 0);

for (const p of projects) {
  // Skip sub-dealer deals — their commission formula is different and
  // the server currently short-circuits to zeros.
  if (p.subDealerId) { skipped++; continue; }

  const installerName = installers.find((i) => i.id === p.installerId)?.name ?? '';

  let baselineOverride: InstallerBaseline | null = null;
  if (p.baselineOverrideJson) {
    try { baselineOverride = JSON.parse(p.baselineOverrideJson) as InstallerBaseline; } catch {}
  }

  const inputs: CommissionInputs = {
    soldDate: p.soldDate,
    netPPW: p.netPPW,
    kWSize: p.kWSize,
    installer: installerName,
    productType: p.productType,
    closerId: p.closerId,
    setterId: p.setterId,
    subDealerId: p.subDealerId,
    solarTechProductId: installerName === 'SolarTech' ? (p.productId ?? null) : null,
    installerProductId: installerName !== 'SolarTech' ? (p.productId ?? null) : null,
    baselineOverride,
    trainerId: p.trainerId,
    trainerRate: p.trainerRate,
    additionalClosers: p.additionalClosers.map((c) => ({
      m1Amount: c.m1AmountCents / 100,
      m2Amount: c.m2AmountCents / 100,
      m3Amount: c.m3AmountCents == null ? null : c.m3AmountCents / 100,
    })),
    additionalSetters: p.additionalSetters.map((s) => ({
      m1Amount: s.m1AmountCents / 100,
      m2Amount: s.m2AmountCents / 100,
      m3Amount: s.m3AmountCents == null ? null : s.m3AmountCents / 100,
    })),
  };

  const out = computeProjectCommission(inputs, { ...sharedDeps, currentProjectId: p.id });
  const toCents = (dollars: number) => Math.round(dollars * 100);

  const expected = {
    m1AmountCents: toCents(out.m1Amount),
    m2AmountCents: toCents(out.m2Amount),
    m3AmountCents: out.m3Amount == null ? null : toCents(out.m3Amount),
    setterM1AmountCents: toCents(out.setterM1Amount),
    setterM2AmountCents: toCents(out.setterM2Amount),
    setterM3AmountCents: out.setterM3Amount == null ? null : toCents(out.setterM3Amount),
  };

  const diffs: string[] = [];
  if (!centsMatch(p.m1AmountCents, expected.m1AmountCents)) diffs.push('m1');
  if (!centsMatch(p.m2AmountCents, expected.m2AmountCents)) diffs.push('m2');
  if (!centsMatch(p.m3AmountCents, expected.m3AmountCents)) diffs.push('m3');
  if (!centsMatch(p.setterM1AmountCents, expected.setterM1AmountCents)) diffs.push('setterM1');
  if (!centsMatch(p.setterM2AmountCents, expected.setterM2AmountCents)) diffs.push('setterM2');
  if (!centsMatch(p.setterM3AmountCents, expected.setterM3AmountCents)) diffs.push('setterM3');

  if (diffs.length === 0) { unchanged++; continue; }

  const storedCloserTotal = (p.m1AmountCents ?? 0) + (p.m2AmountCents ?? 0) + (p.m3AmountCents ?? 0);
  const expectedCloserTotal = (expected.m1AmountCents ?? 0) + (expected.m2AmountCents ?? 0) + (expected.m3AmountCents ?? 0);
  const storedSetterTotal = (p.setterM1AmountCents ?? 0) + (p.setterM2AmountCents ?? 0) + (p.setterM3AmountCents ?? 0);
  const expectedSetterTotal = (expected.setterM1AmountCents ?? 0) + (expected.setterM2AmountCents ?? 0) + (expected.setterM3AmountCents ?? 0);

  const totalAbsDelta = Math.abs(storedCloserTotal - expectedCloserTotal) + Math.abs(storedSetterTotal - expectedSetterTotal);

  drifts.push({
    projectId: p.id,
    customerName: p.customerName,
    installer: installerName,
    soldDate: p.soldDate,
    netPPW: p.netPPW,
    kWSize: p.kWSize,
    storedCloserTotal,
    expectedCloserTotal,
    storedSetterTotal,
    expectedSetterTotal,
    totalAbsDelta,
    fields: diffs,
  });
}

console.log(`\n── Scan complete ──`);
console.log(`  Projects scanned: ${projects.length}`);
console.log(`  Sub-dealer deals skipped: ${skipped}`);
console.log(`  Unchanged (stored matches expected): ${unchanged}`);
console.log(`  Drift detected: ${drifts.length}`);

if (drifts.length === 0) {
  console.log('\nClean. Nothing to reconcile.');
  await prisma.$disconnect();
  process.exit(0);
}

drifts.sort((a, b) => b.totalAbsDelta - a.totalAbsDelta);

console.log(`\n── Top ${Math.min(TOP_N, drifts.length)} worst drift ──`);
for (const d of drifts.slice(0, TOP_N)) {
  const closerDelta = ((d.expectedCloserTotal - d.storedCloserTotal) / 100).toFixed(2);
  const setterDelta = ((d.expectedSetterTotal - d.storedSetterTotal) / 100).toFixed(2);
  console.log(
    `  ${d.customerName.padEnd(28)} ` +
    `${d.installer.padEnd(10)} ` +
    `sold=${d.soldDate} kW=${d.kWSize.toFixed(2).padStart(6)} ppw=${d.netPPW.toFixed(2)} | ` +
    `closerΔ=${closerDelta.padStart(9)} setterΔ=${setterDelta.padStart(9)} | ` +
    `fields=${d.fields.join(',')}`,
  );
}

if (!COMMIT) {
  console.log(`\nDry run complete. Re-run with --commit to write ${drifts.length} recomputed rows.`);
  console.log('The --commit flag only overwrites the Project amount fields. PayrollEntry rows are left alone; admin reviews those in the Payroll tab after this runs.');
  await prisma.$disconnect();
  process.exit(0);
}

// ── Commit mode ──
console.log(`\nWriting recomputed amounts to ${drifts.length} projects...`);
let fixed = 0;
for (const d of drifts) {
  // Re-run compute so we have the fresh cents values to write.
  const p = projects.find((x) => x.id === d.projectId)!;
  const installerName = installers.find((i) => i.id === p.installerId)?.name ?? '';
  let baselineOverride: InstallerBaseline | null = null;
  if (p.baselineOverrideJson) {
    try { baselineOverride = JSON.parse(p.baselineOverrideJson) as InstallerBaseline; } catch {}
  }
  const out = computeProjectCommission(
    {
      soldDate: p.soldDate,
      netPPW: p.netPPW,
      kWSize: p.kWSize,
      installer: installerName,
      productType: p.productType,
      closerId: p.closerId,
      setterId: p.setterId,
      subDealerId: p.subDealerId,
      solarTechProductId: installerName === 'SolarTech' ? (p.productId ?? null) : null,
      installerProductId: installerName !== 'SolarTech' ? (p.productId ?? null) : null,
      baselineOverride,
      trainerId: p.trainerId,
      trainerRate: p.trainerRate,
      additionalClosers: p.additionalClosers.map((c) => ({
        m1Amount: c.m1AmountCents / 100,
        m2Amount: c.m2AmountCents / 100,
        m3Amount: c.m3AmountCents == null ? null : c.m3AmountCents / 100,
      })),
      additionalSetters: p.additionalSetters.map((s) => ({
        m1Amount: s.m1AmountCents / 100,
        m2Amount: s.m2AmountCents / 100,
        m3Amount: s.m3AmountCents == null ? null : s.m3AmountCents / 100,
      })),
    },
    { ...sharedDeps, currentProjectId: p.id },
  );

  await prisma.project.update({
    where: { id: p.id },
    data: {
      m1AmountCents: Math.round(out.m1Amount * 100),
      m2AmountCents: Math.round(out.m2Amount * 100),
      m3AmountCents: out.m3Amount == null ? null : Math.round(out.m3Amount * 100),
      setterM1AmountCents: Math.round(out.setterM1Amount * 100),
      setterM2AmountCents: Math.round(out.setterM2Amount * 100),
      setterM3AmountCents: out.setterM3Amount == null ? null : Math.round(out.setterM3Amount * 100),
    },
  });
  fixed++;
}

console.log(`\nFixed ${fixed} project rows. PayrollEntry rows untouched — admin: review pending/paid payroll against the new Project amounts in the Payroll tab.`);
await prisma.$disconnect();
