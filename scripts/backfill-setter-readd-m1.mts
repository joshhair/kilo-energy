/**
 * Backfill orphan setter M1 PayrollEntry rows.
 *
 * Context: lib/context.tsx:505 previously had a guard that skipped creating
 * the setter's Draft M1 entry whenever the closer had already been Paid M1
 * — the Timothy-Salunga-shape bug. The result was `Project.setterM1AmountCents`
 * set to a positive value on past-Acceptance projects with no matching
 * PayrollEntry, leaving setters silently unpaid.
 *
 * The logic fix (lib/commission.ts :: shouldCreateSetterM1OnSetterAdd) stops
 * the bug from producing new orphans, but ~36 historical projects in prod
 * (15 with the classic m1Paid=true shape) still have the gap. This script
 * creates a Draft M1 PayrollEntry for each, so admin can review and approve
 * them in the Payroll tab.
 *
 * Safe and idempotent — skips any project that already has a setter M1
 * PayrollEntry. Does NOT mark anything Paid; those stay Draft until admin
 * acts.
 *
 * Run (dry-run): set -a && . ./.env && set +a && npx tsx scripts/backfill-setter-readd-m1.mts
 * Commit:       add `--commit`
 */
import { PrismaLibSql } from '@prisma/adapter-libsql';

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

const PHASES_NEEDING_PAYROLL = [
  'Site Survey', 'Design', 'Permitting', 'Pending Install', 'Installed', 'PTO', 'Completed',
];

console.log(COMMIT ? '── COMMIT MODE — writes will happen ──' : '── DRY RUN — no writes ──');

// Glide-imported deals are inviolable historical records — their
// commission + payroll state was frozen at import and should never be
// mutated by later Kilo logic. Same policy enforced on chargeback auto-
// generation (lib/context/project-transitions.ts), admin manual
// chargeback (app/api/payroll/route.ts), and the reconcile script
// (scripts/reconcile-project-commission.mts). Adding the filter here
// protects against future re-runs: if a non-imported project ever
// develops a setter-re-add orphan, the script can fix it without
// touching the Glide-era rows.
const candidates = await prisma.project.findMany({
  where: {
    setterId: { not: null },
    setterM1AmountCents: { gt: 0 },
    phase: { in: PHASES_NEEDING_PAYROLL },
    importedFromGlide: false,
  },
  select: {
    id: true,
    customerName: true,
    phase: true,
    setterId: true,
    closerId: true,
    setterM1AmountCents: true,
    m1Paid: true,
  },
});

const orphans: Array<{
  projectId: string;
  customerName: string;
  setterId: string;
  amountCents: number;
  m1Paid: boolean;
}> = [];

for (const p of candidates) {
  const hasSetterM1 = await prisma.payrollEntry.count({
    where: { projectId: p.id, repId: p.setterId!, paymentStage: 'M1' },
  });
  if (hasSetterM1 === 0) {
    orphans.push({
      projectId: p.id,
      customerName: p.customerName,
      setterId: p.setterId!,
      amountCents: p.setterM1AmountCents ?? 0,
      m1Paid: !!p.m1Paid,
    });
  }
}

console.log(`Scanned: ${candidates.length} past-Acceptance projects with setterM1AmountCents>0`);
console.log(`Orphan (no setter M1 PayrollEntry): ${orphans.length}`);

if (orphans.length === 0) {
  console.log('Nothing to backfill. Exiting.');
  await prisma.$disconnect();
  process.exit(0);
}

console.log('\nSample:');
for (const o of orphans.slice(0, 10)) {
  console.log(`  - ${o.customerName.padEnd(30)} setter=${o.setterId} missingM1=$${(o.amountCents / 100).toFixed(2)} closer-m1Paid=${o.m1Paid}`);
}
if (orphans.length > 10) console.log(`  ...and ${orphans.length - 10} more`);

if (!COMMIT) {
  console.log('\nDry run complete. Re-run with --commit to write Draft M1 entries.');
  await prisma.$disconnect();
  process.exit(0);
}

// ── Commit mode ──
// Use today's local-date string for the `date` field so these show up in
// the current payroll period for admin review.
const today = new Date();
const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

let created = 0;
for (const o of orphans) {
  await prisma.payrollEntry.create({
    data: {
      projectId: o.projectId,
      repId: o.setterId,
      paymentStage: 'M1',
      type: 'Deal',
      status: 'Draft',
      amountCents: o.amountCents,
      date: dateStr,
      notes: 'Setter — backfilled from orphan setterM1Amount',
    },
  });
  created++;
}

console.log(`\n✓ Created ${created} Draft setter M1 PayrollEntry rows. Admin: review + mark Paid or Denied in the Payroll tab.`);

await prisma.$disconnect();
