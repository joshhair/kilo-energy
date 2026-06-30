/**
 * Backfill PayrollEntry.paidAt for historical Paid entries that are missing it.
 *
 * Why: the iOS Earnings tab groups pay stubs by paidAt. Entries marked Paid
 * before paidAt-stamping existed have paidAt=null and fall back to their
 * milestone date on iOS, which can split one paycheck across two stubs.
 *
 * Source (per Josh): each entry's "marked Paid" AuditLog timestamp (the real pay
 * date) where one exists, else the milestone date (entry.date). Both the bulk
 * (payroll_bulk_pay) and single-entry (payroll_entry_update) Paid transitions
 * write newValue containing "status":"Paid", so that's the detector.
 *
 * SAFETY (2026-06-12 prod-wipe lesson):
 *   - dry-run by default; writes ONLY with --commit.
 *   - fully-specified where (status='Paid' AND paidAt=null) — never empty/undefined.
 *   - per-row guarded updateMany {id, status:'Paid', paidAt:null} → idempotent,
 *     can't clobber a concurrently-set paidAt, re-runnable.
 *   - never deletes.
 *
 * Run (dry-run):  set -a && . ./.env && set +a && npx tsx scripts/backfill-payroll-paidat.mts
 * Run (apply):    …same… scripts/backfill-payroll-paidat.mts --commit
 */
import { PrismaLibSql } from '@prisma/adapter-libsql';

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;
if (!tursoUrl || !tursoToken) {
  console.error('TURSO_DATABASE_URL + TURSO_AUTH_TOKEN required');
  process.exit(1);
}
const { PrismaClient } = await import('../lib/generated/prisma/client.ts');
const adapter = new PrismaLibSql({ url: tursoUrl, authToken: tursoToken });
const prisma = new PrismaClient({ adapter });

const COMMIT = process.argv.includes('--commit');

// Candidates: Paid entries missing paidAt. EXPLICIT, non-empty where.
const candidates = await prisma.payrollEntry.findMany({
  where: { status: 'Paid', paidAt: null },
  select: { id: true, date: true },
});
console.log(`Candidates (status='Paid' AND paidAt IS NULL): ${candidates.length}`);
if (candidates.length === 0) {
  console.log('Nothing to backfill.');
  await prisma.$disconnect();
  process.exit(0);
}

// Latest "marked Paid" audit timestamp per candidate. Chunk the id `in` filter.
const ids = candidates.map((c) => c.id);
const auditPaidAt = new Map<string, Date>();
const CHUNK = 300;
for (let i = 0; i < ids.length; i += CHUNK) {
  const slice = ids.slice(i, i + CHUNK);
  const rows = await prisma.auditLog.findMany({
    where: { entityType: 'PayrollEntry', entityId: { in: slice }, newValue: { contains: '"status":"Paid"' } },
    select: { entityId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const r of rows) auditPaidAt.set(r.entityId, r.createdAt); // asc → last wins = latest Paid
}

// Milestone fallback: entry.date (YYYY-MM-DD) → noon UTC (no timezone day-shift).
function milestoneDate(dateStr: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(dateStr);
  return m ? new Date(`${m[1]}T12:00:00.000Z`) : null;
}

interface Plan { id: string; paidAt: Date; source: 'audit' | 'milestone'; }
const plans: Plan[] = [];
let skippedNoDate = 0;
for (const c of candidates) {
  const fromAudit = auditPaidAt.get(c.id);
  if (fromAudit) { plans.push({ id: c.id, paidAt: fromAudit, source: 'audit' }); continue; }
  const ms = milestoneDate(c.date);
  if (ms) { plans.push({ id: c.id, paidAt: ms, source: 'milestone' }); continue; }
  skippedNoDate++; // no audit + unparseable date — leave null (date is required, so ~never)
}

const auditCount = plans.filter((p) => p.source === 'audit').length;
const milestoneCount = plans.filter((p) => p.source === 'milestone').length;
console.log(`Plans: ${plans.length}  (audit-date: ${auditCount}, milestone-date: ${milestoneCount}, skipped-no-date: ${skippedNoDate})`);
console.log('Sample (first 12):');
for (const p of plans.slice(0, 12)) console.log(`  ${p.id}  ←  ${p.paidAt.toISOString()}  [${p.source}]`);

if (!COMMIT) {
  console.log('\n(dry-run — no writes. Rerun with --commit to apply.)');
  await prisma.$disconnect();
  process.exit(0);
}

console.log('\nApplying…');
let applied = 0;
for (const p of plans) {
  // Guarded + idempotent: only sets paidAt where the row is STILL Paid + null.
  const r = await prisma.payrollEntry.updateMany({
    where: { id: p.id, status: 'Paid', paidAt: null },
    data: { paidAt: p.paidAt },
  });
  applied += r.count;
  if (applied % 100 === 0) console.log(`  ${applied}/${plans.length}`);
}
console.log(`\n✓ Backfilled paidAt on ${applied} entries.`);
await prisma.$disconnect();
