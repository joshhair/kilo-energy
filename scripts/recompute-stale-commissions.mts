/**
 * recompute-stale-commissions.mts — corrects stale m1/m2/m3 amounts on
 * existing projects.
 *
 * Why this exists
 * ───────────────
 * Past versions of the commission split formula stored wrong M1/M2/M3
 * values on Project rows. Commit 4bdcb54 (2026-04-24) fixed the formula
 * for new edits, and the PATCH route now recomputes server-side on any
 * input change — but historical projects that haven't been re-edited
 * still hold the old buggy amounts. The "Total expected: $17,458"
 * inflation Josh saw on the Hunter Helton deal is one symptom.
 *
 * What this script does
 * ─────────────────────
 *   1. Loads every Project via Prisma
 *   2. Calls computeProjectCommission (the authoritative server-side
 *      formula in lib/commission-server.ts — same function the API
 *      uses on PATCH) with the project's current inputs
 *   3. Diffs the result against the stored m1/m2/m3/setterM*Amount
 *      values to the cent
 *   4. Categorizes every project (see CATEGORIES below)
 *   5. Writes a CSV report and a JSON of pending writes to state/
 *
 * What this script does NOT do (by design)
 * ────────────────────────────────────────
 *   • Touch PayrollEntries — never. Only Project amount columns.
 *   • Overwrite any milestone where a Paid PayrollEntry exists for that
 *     stage — that money has moved.
 *   • Touch sub-dealer projects — different formula, not handled here.
 *   • Touch Cancelled / On Hold projects — they're frozen.
 *   • Run without explicit --apply --commit double-flag.
 *
 * Categories
 * ──────────
 *   match            — stored values match the formula (within $0.01)
 *   safe-fix         — drift > $0.50, NO Paid entries, NO chargebacks,
 *                      NOT cancelled/onhold/sub-dealer. SAFE to overwrite.
 *   paid-drift       — drift > $0.50 but at least one milestone has a
 *                      Paid PayrollEntry. Skipped — admin must reconcile.
 *   chargeback-skip  — project has chargebacks. Skipped.
 *   cancelled-skip   — phase is Cancelled or On Hold. Skipped.
 *   subdealer-skip   — has subDealerId. Skipped (different formula).
 *
 * Usage
 * ─────
 *   set -a && . ./.env && set +a
 *
 *   tsx scripts/recompute-stale-commissions.mts                 # dry-run
 *   tsx scripts/recompute-stale-commissions.mts --apply         # show plan
 *   tsx scripts/recompute-stale-commissions.mts --apply --commit  # WRITES
 *
 * Optional flags:
 *   --exclude=id1,id2,...   Skip these project ids (manual override list)
 *
 * Pre-flight before --commit
 * ──────────────────────────
 *   1. npm run backup:now           ← Turso snapshot. Mandatory.
 *   2. tsx scripts/recompute-stale-commissions.mts        (dry-run)
 *   3. Review state/recompute-stale-commissions-*.csv row by row
 *   4. tsx scripts/recompute-stale-commissions.mts --apply   (still no writes)
 *   5. Review state/recompute-stale-commissions-pending-*.json
 *   6. tsx scripts/recompute-stale-commissions.mts --apply --commit
 *
 * Rollback
 * ────────
 *   • Primary: restore Turso from snapshot taken in step 1
 *   • Per-row: state/recompute-stale-commissions-log-*.json contains
 *     before-and-after for every write — replay with reverse SQL if needed
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaLibSql } from '@prisma/adapter-libsql';

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;
if (!tursoUrl || !tursoToken) {
  console.error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set.');
  console.error('Run: set -a && . ./.env && set +a');
  process.exit(1);
}

const { PrismaClient } = await import('../lib/generated/prisma/client.ts');
const { computeProjectCommission } = await import('../lib/commission-server.ts');
const { SOLARTECH_PRODUCTS } = await import('../lib/data.ts');

const adapter = new PrismaLibSql({ url: tursoUrl, authToken: tursoToken });
const prisma = new PrismaClient({ adapter });

// ── Flags ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const COMMIT = args.includes('--commit');
const excludeArg = args.find((a) => a.startsWith('--exclude='));
const excludeSet = new Set(
  excludeArg ? excludeArg.replace('--exclude=', '').split(',').map((s) => s.trim()).filter(Boolean) : [],
);

if (COMMIT && !APPLY) {
  console.error('--commit requires --apply. Did you mean --apply --commit?');
  process.exit(1);
}
const MODE = COMMIT ? 'COMMIT' : APPLY ? 'APPLY-PLAN' : 'DRY-RUN';
console.log(`Mode: ${MODE}`);
if (excludeSet.size) console.log(`Excluded project ids: ${excludeSet.size}`);

// ── Load all dependent data ────────────────────────────────────────────
console.log('Loading data from Turso…');

const [
  projects,
  installers,
  installerPricingVersionsRaw,
  productCatalogProductsRaw,
  productCatalogPricingVersionsRaw,
  trainerAssignmentsRaw,
  payrollEntriesRaw,
] = await Promise.all([
  prisma.project.findMany({
    include: {
      installer: { select: { name: true, installPayPct: true } },
      additionalClosers: true,
      additionalSetters: true,
    },
  }),
  prisma.installer.findMany({ select: { id: true, name: true, installPayPct: true } }),
  prisma.installerPricingVersion.findMany({ include: { tiers: true } }),
  prisma.product.findMany({ include: { pricingVersions: { include: { tiers: true } } } }),
  prisma.productPricingVersion.findMany({ include: { tiers: true } }),
  prisma.trainerAssignment.findMany({ include: { tiers: true } }),
  prisma.payrollEntry.findMany({ select: { id: true, projectId: true, repId: true, paymentStage: true, status: true, amountCents: true, isChargeback: true, date: true } }),
]);
// SolarTech products live as a constant in lib/data.ts (not a Prisma table).
const solarTechProducts = SOLARTECH_PRODUCTS;

console.log(`  ${projects.length} projects`);
console.log(`  ${installers.length} installers`);
console.log(`  ${payrollEntriesRaw.length} payroll entries`);
console.log(`  ${trainerAssignmentsRaw.length} trainer assignments`);

// ── Shape into the form computeProjectCommission expects ──────────────
// The lib types use dollars, not cents. Convert at the boundary.
const installerPricingVersions = installerPricingVersionsRaw.map((v: any) => ({
  id: v.id,
  installerId: v.installerId,
  effectiveFrom: v.effectiveFrom,
  tiers: v.tiers.map((t: any) => ({
    minKw: t.minKw, maxKw: t.maxKw, closerPerW: t.closerPerW, setterPerW: t.setterPerW, kiloPerW: t.kiloPerW,
  })),
}));

const productCatalogProducts = productCatalogProductsRaw.map((p: any) => ({
  id: p.id,
  installerId: p.installerId,
  name: p.name,
  family: p.family ?? '',
  active: p.active,
}));

const productCatalogPricingVersions = productCatalogPricingVersionsRaw.map((v: any) => ({
  id: v.id,
  productId: v.productId,
  effectiveFrom: v.effectiveFrom,
  tiers: v.tiers.map((t: any) => ({
    minKw: t.minKw, maxKw: t.maxKw, closerPerW: t.closerPerW, setterPerW: t.setterPerW, kiloPerW: t.kiloPerW, subDealerPerW: t.subDealerPerW,
  })),
}));

const trainerAssignments = trainerAssignmentsRaw.map((a: any) => ({
  id: a.id,
  trainerId: a.trainerId,
  traineeId: a.traineeId,
  isActiveTraining: a.isActiveTraining,
  tiers: a.tiers.map((t: any) => ({ upToDeal: t.upToDeal, ratePerW: t.ratePerW })),
}));

const payrollEntries = payrollEntriesRaw.map((e: any) => ({
  id: e.id,
  projectId: e.projectId,
  repId: e.repId,
  paymentStage: e.paymentStage,
  status: e.status,
  amount: e.amountCents / 100,
  isChargeback: e.isChargeback,
  date: e.date,
}));

const installerPayConfigs: Record<string, { installPayPct: number }> = {};
for (const i of installers) {
  installerPayConfigs[i.name] = { installPayPct: i.installPayPct ?? 80 };
}

// ── Diff ──────────────────────────────────────────────────────────────

interface Row {
  projectId: string;
  customer: string;
  soldDate: string;
  phase: string;
  category: 'match' | 'safe-fix' | 'paid-drift' | 'chargeback-skip' | 'cancelled-skip' | 'subdealer-skip' | 'excluded' | 'compute-error';
  // current (cents)
  currM1: number; currM2: number; currM3: number | null;
  currSM1: number; currSM2: number; currSM3: number | null;
  // expected (cents)
  expM1: number | null; expM2: number | null; expM3: number | null;
  expSM1: number | null; expSM2: number | null; expSM3: number | null;
  // delta cents (positive means stored is too high)
  deltaTotal: number;
  notes: string;
}

const rows: Row[] = [];
const CENT_EPSILON = 50; // $0.50 — absorbs harmless rounding

for (const p of projects) {
  const currM1 = p.m1AmountCents;
  const currM2 = p.m2AmountCents;
  const currM3 = p.m3AmountCents;
  const currSM1 = p.setterM1AmountCents;
  const currSM2 = p.setterM2AmountCents;
  const currSM3 = p.setterM3AmountCents;

  if (excludeSet.has(p.id)) {
    rows.push({
      projectId: p.id, customer: p.customerName, soldDate: p.soldDate, phase: p.phase,
      category: 'excluded',
      currM1, currM2, currM3, currSM1, currSM2, currSM3,
      expM1: null, expM2: null, expM3: null, expSM1: null, expSM2: null, expSM3: null,
      deltaTotal: 0, notes: 'in --exclude list',
    });
    continue;
  }

  if (p.subDealerId) {
    rows.push({
      projectId: p.id, customer: p.customerName, soldDate: p.soldDate, phase: p.phase,
      category: 'subdealer-skip',
      currM1, currM2, currM3, currSM1, currSM2, currSM3,
      expM1: null, expM2: null, expM3: null, expSM1: null, expSM2: null, expSM3: null,
      deltaTotal: 0, notes: 'sub-dealer formula not handled by computeProjectCommission',
    });
    continue;
  }

  if (p.phase === 'Cancelled' || p.phase === 'On Hold') {
    rows.push({
      projectId: p.id, customer: p.customerName, soldDate: p.soldDate, phase: p.phase,
      category: 'cancelled-skip',
      currM1, currM2, currM3, currSM1, currSM2, currSM3,
      expM1: null, expM2: null, expM3: null, expSM1: null, expSM2: null, expSM3: null,
      deltaTotal: 0, notes: `phase=${p.phase}`,
    });
    continue;
  }

  // Run the same compute the PATCH route uses
  let result;
  try {
    const baselineOverride = p.baselineOverrideJson ? JSON.parse(p.baselineOverrideJson) : null;
    result = computeProjectCommission(
      {
        soldDate: p.soldDate,
        netPPW: p.netPPW,
        kWSize: p.kWSize,
        installer: p.installer?.name ?? '',
        productType: p.productType,
        closerId: p.closerId,
        setterId: p.setterId,
        subDealerId: p.subDealerId,
        solarTechProductId: (p.installer?.name === 'SolarTech') ? (p.productId ?? null) : null,
        installerProductId: (p.installer?.name !== 'SolarTech') ? (p.productId ?? null) : null,
        baselineOverride,
        trainerId: p.trainerId,
        trainerRate: p.trainerRate,
        additionalClosers: p.additionalClosers.map((c: any) => ({ m1Amount: c.m1AmountCents / 100, m2Amount: c.m2AmountCents / 100, m3Amount: c.m3AmountCents == null ? null : c.m3AmountCents / 100 })),
        additionalSetters: p.additionalSetters.map((s: any) => ({ m1Amount: s.m1AmountCents / 100, m2Amount: s.m2AmountCents / 100, m3Amount: s.m3AmountCents == null ? null : s.m3AmountCents / 100 })),
      },
      {
        installerPricingVersions: installerPricingVersions as any,
        solarTechProducts: solarTechProducts as any,
        productCatalogProducts: productCatalogProducts as any,
        productCatalogPricingVersions: productCatalogPricingVersions as any,
        trainerAssignments: trainerAssignments as any,
        payrollEntries: payrollEntries as any,
        installerPayConfigs: installerPayConfigs as any,
        currentProjectId: p.id,
      },
    );
  } catch (err) {
    rows.push({
      projectId: p.id, customer: p.customerName, soldDate: p.soldDate, phase: p.phase,
      category: 'compute-error',
      currM1, currM2, currM3, currSM1, currSM2, currSM3,
      expM1: null, expM2: null, expM3: null, expSM1: null, expSM2: null, expSM3: null,
      deltaTotal: 0,
      notes: `compute failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    continue;
  }

  const expM1 = Math.round(result.m1Amount * 100);
  const expM2 = Math.round(result.m2Amount * 100);
  const expM3 = result.m3Amount == null ? null : Math.round(result.m3Amount * 100);
  const expSM1 = Math.round(result.setterM1Amount * 100);
  const expSM2 = Math.round(result.setterM2Amount * 100);
  const expSM3 = result.setterM3Amount == null ? null : Math.round(result.setterM3Amount * 100);

  const deltaM1 = expM1 - currM1;
  const deltaM2 = expM2 - currM2;
  const deltaM3 = (expM3 ?? 0) - (currM3 ?? 0);
  const deltaSM1 = expSM1 - currSM1;
  const deltaSM2 = expSM2 - currSM2;
  const deltaSM3 = (expSM3 ?? 0) - (currSM3 ?? 0);

  const totalAbsDelta = Math.abs(deltaM1) + Math.abs(deltaM2) + Math.abs(deltaM3)
    + Math.abs(deltaSM1) + Math.abs(deltaSM2) + Math.abs(deltaSM3);

  if (totalAbsDelta <= CENT_EPSILON) {
    rows.push({
      projectId: p.id, customer: p.customerName, soldDate: p.soldDate, phase: p.phase,
      category: 'match',
      currM1, currM2, currM3, currSM1, currSM2, currSM3,
      expM1, expM2, expM3, expSM1, expSM2, expSM3,
      deltaTotal: 0, notes: '',
    });
    continue;
  }

  // Drift exists. Now classify.
  const projectPayroll = payrollEntriesRaw.filter((e: any) => e.projectId === p.id);
  const hasPaid = projectPayroll.some((e: any) => e.status === 'Paid');
  const hasChargeback = projectPayroll.some((e: any) => e.isChargeback === true);

  if (hasChargeback) {
    rows.push({
      projectId: p.id, customer: p.customerName, soldDate: p.soldDate, phase: p.phase,
      category: 'chargeback-skip',
      currM1, currM2, currM3, currSM1, currSM2, currSM3,
      expM1, expM2, expM3, expSM1, expSM2, expSM3,
      deltaTotal: deltaM1 + deltaM2 + deltaM3 + deltaSM1 + deltaSM2 + deltaSM3,
      notes: 'has chargeback PayrollEntry',
    });
    continue;
  }

  if (hasPaid) {
    rows.push({
      projectId: p.id, customer: p.customerName, soldDate: p.soldDate, phase: p.phase,
      category: 'paid-drift',
      currM1, currM2, currM3, currSM1, currSM2, currSM3,
      expM1, expM2, expM3, expSM1, expSM2, expSM3,
      deltaTotal: deltaM1 + deltaM2 + deltaM3 + deltaSM1 + deltaSM2 + deltaSM3,
      notes: 'has Paid PayrollEntry — manual review required',
    });
    continue;
  }

  rows.push({
    projectId: p.id, customer: p.customerName, soldDate: p.soldDate, phase: p.phase,
    category: 'safe-fix',
    currM1, currM2, currM3, currSM1, currSM2, currSM3,
    expM1, expM2, expM3, expSM1, expSM2, expSM3,
    deltaTotal: deltaM1 + deltaM2 + deltaM3 + deltaSM1 + deltaSM2 + deltaSM3,
    notes: '',
  });
}

// ── Summary ──────────────────────────────────────────────────────────
const counts = rows.reduce((acc, r) => {
  acc[r.category] = (acc[r.category] ?? 0) + 1;
  return acc;
}, {} as Record<string, number>);

const safeFixRows = rows.filter((r) => r.category === 'safe-fix');
const safeFixDeltaCents = safeFixRows.reduce((s, r) => s + r.deltaTotal, 0);

console.log('\n────────────── Summary ──────────────');
for (const [cat, n] of Object.entries(counts).sort()) {
  console.log(`  ${cat.padEnd(20)} ${n}`);
}
console.log(`  ${'─'.repeat(20)}`);
console.log(`  total                ${rows.length}`);
console.log(`\n  safe-fix net $ delta: ${(safeFixDeltaCents / 100).toFixed(2)}`);

// ── Write CSV report ──────────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url));
const stateDir = join(here, '..', 'state');
if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const csvPath = join(stateDir, `recompute-stale-commissions-${ts}.csv`);
const csvHeader = 'projectId,customer,soldDate,phase,category,currM1,expM1,deltaM1,currM2,expM2,deltaM2,currM3,expM3,deltaM3,currSM1,expSM1,deltaSM1,currSM2,expSM2,deltaSM2,currSM3,expSM3,deltaSM3,deltaTotal,notes';
const csvLines = [csvHeader];
for (const r of rows) {
  const safe = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  csvLines.push([
    r.projectId, safe(r.customer), r.soldDate, r.phase, r.category,
    r.currM1, r.expM1 ?? '', (r.expM1 ?? r.currM1) - r.currM1,
    r.currM2, r.expM2 ?? '', (r.expM2 ?? r.currM2) - r.currM2,
    r.currM3 ?? '', r.expM3 ?? '', (r.expM3 ?? r.currM3 ?? 0) - (r.currM3 ?? 0),
    r.currSM1, r.expSM1 ?? '', (r.expSM1 ?? r.currSM1) - r.currSM1,
    r.currSM2, r.expSM2 ?? '', (r.expSM2 ?? r.currSM2) - r.currSM2,
    r.currSM3 ?? '', r.expSM3 ?? '', (r.expSM3 ?? r.currSM3 ?? 0) - (r.currSM3 ?? 0),
    r.deltaTotal,
    safe(r.notes),
  ].join(','));
}
writeFileSync(csvPath, csvLines.join('\n'), 'utf-8');
console.log(`\nCSV report: ${csvPath}`);

// ── Stop here unless --apply ──────────────────────────────────────────
if (!APPLY) {
  console.log('\nDry-run complete. Re-run with --apply to generate the pending-writes JSON.');
  console.log('Re-run with --apply --commit to actually write to the DB.');
  await prisma.$disconnect();
  process.exit(0);
}

// ── --apply: write pending-writes JSON ────────────────────────────────
const pendingPath = join(stateDir, `recompute-stale-commissions-pending-${ts}.json`);
const pendingWrites = safeFixRows.map((r) => ({
  projectId: r.projectId,
  customer: r.customer,
  before: {
    m1AmountCents: r.currM1, m2AmountCents: r.currM2, m3AmountCents: r.currM3,
    setterM1AmountCents: r.currSM1, setterM2AmountCents: r.currSM2, setterM3AmountCents: r.currSM3,
  },
  after: {
    m1AmountCents: r.expM1!, m2AmountCents: r.expM2!, m3AmountCents: r.expM3,
    setterM1AmountCents: r.expSM1!, setterM2AmountCents: r.expSM2!, setterM3AmountCents: r.expSM3,
  },
}));
writeFileSync(pendingPath, JSON.stringify(pendingWrites, null, 2), 'utf-8');
console.log(`Pending writes: ${pendingPath}  (${pendingWrites.length} projects)`);

if (!COMMIT) {
  console.log('\nReview the pending-writes JSON, then re-run with --apply --commit to write.');
  await prisma.$disconnect();
  process.exit(0);
}

// ── --apply --commit: WRITE TO DB ─────────────────────────────────────
console.log(`\nWriting ${pendingWrites.length} project amount corrections to Turso…`);
console.log('(PayrollEntries are NOT touched — only Project amount columns.)');

const logPath = join(stateDir, `recompute-stale-commissions-log-${ts}.json`);
const log: Array<{ projectId: string; before: any; after: any; ok: boolean; error?: string }> = [];

let written = 0;
let failed = 0;
for (const w of pendingWrites) {
  try {
    await prisma.project.update({
      where: { id: w.projectId },
      data: {
        m1AmountCents: w.after.m1AmountCents,
        m2AmountCents: w.after.m2AmountCents,
        m3AmountCents: w.after.m3AmountCents,
        setterM1AmountCents: w.after.setterM1AmountCents,
        setterM2AmountCents: w.after.setterM2AmountCents,
        setterM3AmountCents: w.after.setterM3AmountCents,
      },
    });
    log.push({ projectId: w.projectId, before: w.before, after: w.after, ok: true });
    written++;
  } catch (err) {
    log.push({ projectId: w.projectId, before: w.before, after: w.after, ok: false, error: err instanceof Error ? err.message : String(err) });
    failed++;
    console.error(`  FAIL ${w.projectId}: ${err instanceof Error ? err.message : err}`);
  }
}

writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf-8');
console.log(`\nWrote: ${written}  Failed: ${failed}`);
console.log(`Audit log: ${logPath}`);

await prisma.$disconnect();
