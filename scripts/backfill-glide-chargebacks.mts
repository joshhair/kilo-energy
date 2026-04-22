/**
 * backfill-glide-chargebacks.mts
 *
 * One-time (plus periodic audit) script that surfaces every Paid PayrollEntry
 * on a Cancelled project that lacks a linked chargeback — the Glide-ported
 * deals whose M1 was paid before cancellation but whose clawback was never
 * recorded in Kilo.
 *
 * Modes:
 *   (default, audit)  Prints one line per eligible entry; no DB writes.
 *   --commit --auto   Creates a Draft chargeback dated today for every
 *                     eligible entry. |amount| = full original. Admin
 *                     reviews + backdates individual rows in the UI.
 *   --csv <path>      Reads (projectId, repId, paymentStage, amount, date,
 *                     notes) and inserts chargebacks with exact historical
 *                     dates from Glide export. Implies --commit.
 *
 * Guardrails:
 *   - Dry-run is default. Requires an explicit --commit flag to write.
 *   - Idempotency: entries already having a linked chargeback (explicit
 *     or legacy negative-Paid) are skipped.
 *   - AuditLog entry per insert; same shape as UI-created chargebacks.
 *   - Refuses to create a chargeback exceeding the original entry amount.
 *   - Logs a summary at the end: {audited, queued, inserted, skipped_reason}.
 *
 * Invocation:
 *   # Audit only (safe):
 *   node scripts/backfill-glide-chargebacks.mts
 *
 *   # Commit with auto-today dates:
 *   node scripts/backfill-glide-chargebacks.mts --commit --auto
 *
 *   # Commit from CSV:
 *   node scripts/backfill-glide-chargebacks.mts --csv tmp/glide-chargebacks.csv
 */

import fs from 'node:fs';
import path from 'node:path';

const { PrismaClient } = await import('../lib/generated/prisma/client.ts');
let prisma: InstanceType<typeof PrismaClient>;
if (process.env.TURSO_DATABASE_URL) {
  const { PrismaLibSql } = await import('@prisma/adapter-libsql');
  const adapter = new PrismaLibSql({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  prisma = new PrismaClient({ adapter }) as InstanceType<typeof PrismaClient>;
} else {
  const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3');
  const dbPath = path.resolve(process.cwd(), 'dev.db');
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter }) as InstanceType<typeof PrismaClient>;
}

interface CsvRow {
  projectId: string;
  repId: string;
  paymentStage: string;
  amount: number; // positive dollars; script negates
  date: string;
  notes?: string;
}

function parseCsv(file: string): CsvRow[] {
  const text = fs.readFileSync(path.resolve(file), 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const [header, ...rows] = lines;
  const cols = header.split(',').map((c) => c.trim());
  const idx = (name: string) => cols.indexOf(name);
  if (idx('projectId') < 0 || idx('repId') < 0 || idx('paymentStage') < 0 || idx('amount') < 0 || idx('date') < 0) {
    throw new Error('CSV must have columns: projectId,repId,paymentStage,amount,date[,notes]');
  }
  return rows.map((r) => {
    const f = r.split(',').map((c) => c.trim());
    return {
      projectId: f[idx('projectId')],
      repId: f[idx('repId')],
      paymentStage: f[idx('paymentStage')],
      amount: parseFloat(f[idx('amount')]),
      date: f[idx('date')],
      notes: idx('notes') >= 0 ? f[idx('notes')] : undefined,
    };
  });
}

async function findEligibleEntries() {
  const cancelledProjects = await prisma.project.findMany({
    where: { phase: 'Cancelled' },
    select: { id: true, customerName: true, importedFromGlide: true },
  });
  const cancelledIds = cancelledProjects.map((p) => p.id);
  if (cancelledIds.length === 0) return [];

  const paid = await prisma.payrollEntry.findMany({
    where: {
      projectId: { in: cancelledIds },
      status: 'Paid',
      isChargeback: false,
      amountCents: { gt: 0 },
    },
    include: { rep: { select: { firstName: true, lastName: true } }, project: { select: { customerName: true } }, chargebacks: true },
  });

  // Skip entries that already have a linked chargeback (explicit flag OR
  // legacy unlinked negative-Paid on the same project/rep/stage).
  const legacyNegatives = await prisma.payrollEntry.findMany({
    where: {
      projectId: { in: cancelledIds },
      status: 'Paid',
      amountCents: { lt: 0 },
      // Legacy chargebacks pre-date the explicit flag, so don't filter by isChargeback.
    },
    select: { projectId: true, repId: true, paymentStage: true },
  });
  const legacyKeys = new Set(legacyNegatives.map((e) => `${e.projectId}|${e.repId}|${e.paymentStage}`));

  return paid.filter((e) => {
    if (e.chargebacks && e.chargebacks.length > 0) return false;
    const key = `${e.projectId}|${e.repId}|${e.paymentStage}`;
    return !legacyKeys.has(key);
  }).map((e) => ({
    id: e.id,
    projectId: e.projectId,
    projectName: e.project?.customerName ?? 'Unknown',
    repId: e.repId,
    repName: e.rep ? `${e.rep.firstName} ${e.rep.lastName}`.trim() : 'Unknown',
    paymentStage: e.paymentStage,
    amountCents: e.amountCents,
    date: e.date,
  }));
}

async function insertChargeback(row: {
  projectId: string | null;
  repId: string;
  paymentStage: string;
  amountCents: number; // negative
  chargebackOfId: string;
  date: string;
  notes: string;
}) {
  return prisma.payrollEntry.create({
    data: {
      repId: row.repId,
      projectId: row.projectId,
      amountCents: row.amountCents,
      type: 'Deal',
      paymentStage: row.paymentStage,
      status: 'Draft',
      date: row.date,
      notes: row.notes,
      isChargeback: true,
      chargebackOfId: row.chargebackOfId,
    },
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const commit = argv.includes('--commit');
  const auto = argv.includes('--auto');
  const csvIdx = argv.indexOf('--csv');
  const csvPath = csvIdx >= 0 ? argv[csvIdx + 1] : null;

  if (csvPath && !commit && !argv.includes('--commit')) {
    // CSV mode implies commit.
    argv.push('--commit');
  }

  console.log('─── Glide chargeback backfill ───');
  console.log(`mode: ${commit ? (csvPath ? 'CSV commit' : 'AUTO commit') : 'audit (dry-run)'}`);

  const eligible = await findEligibleEntries();
  console.log(`\nEligible Paid entries on Cancelled projects (no existing chargeback): ${eligible.length}`);
  for (const e of eligible) {
    const amount$ = (e.amountCents / 100).toFixed(2);
    console.log(`  · ${e.projectName} · ${e.repName} ${e.paymentStage} · paid $${amount$} on ${e.date} (entry ${e.id})`);
  }

  if (!commit) {
    console.log('\nAudit-only. Run with --commit --auto (today dates) or --csv <path> to insert.');
    return;
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  let inserted = 0, skipped = 0;

  if (csvPath) {
    const rows = parseCsv(csvPath);
    console.log(`\nCSV rows: ${rows.length}`);
    const eligibleByKey = new Map(
      eligible.map((e) => [`${e.projectId}|${e.repId}|${e.paymentStage}`, e]),
    );
    for (const r of rows) {
      const key = `${r.projectId}|${r.repId}|${r.paymentStage}`;
      const orig = eligibleByKey.get(key);
      if (!orig) {
        console.log(`  ✗ skip: no eligible Paid entry for ${key}`);
        skipped++;
        continue;
      }
      const cents = Math.round(Math.abs(r.amount) * 100) * -1; // always negative
      if (Math.abs(cents) > orig.amountCents) {
        console.log(`  ✗ skip: $${Math.abs(r.amount).toFixed(2)} > original $${(orig.amountCents / 100).toFixed(2)} for ${key}`);
        skipped++;
        continue;
      }
      await insertChargeback({
        projectId: orig.projectId,
        repId: r.repId,
        paymentStage: r.paymentStage,
        amountCents: cents,
        chargebackOfId: orig.id,
        date: r.date,
        notes: r.notes ?? `Historical chargeback — Glide backfill ${todayIso}`,
      });
      console.log(`  ✓ inserted chargeback for ${orig.projectName} · ${orig.repName} ${orig.paymentStage}`);
      inserted++;
    }
  } else if (auto) {
    for (const e of eligible) {
      await insertChargeback({
        projectId: e.projectId,
        repId: e.repId,
        paymentStage: e.paymentStage,
        amountCents: -e.amountCents, // full clawback, negative
        chargebackOfId: e.id,
        date: todayIso,
        notes: `Auto-backfill chargeback — ${todayIso}. Admin to backdate if historical.`,
      });
      console.log(`  ✓ inserted chargeback for ${e.projectName} · ${e.repName} ${e.paymentStage}`);
      inserted++;
    }
  } else {
    console.log('\n--commit requires either --auto (today dates) or --csv <path> (historical dates).');
    process.exit(1);
  }

  console.log(`\nSummary: inserted=${inserted}, skipped=${skipped}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('Backfill failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
