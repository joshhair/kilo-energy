// One-shot backfill: set Project.importedFromGlide = true on every
// project created by the 2026-04-16 Glide bulk import.
//
// Identification strategy: the import script writes an AuditLog entry
// with action='glide_import' at the end of its run. Every project
// created during the import has createdAt <= that audit entry's
// timestamp (plus a few minutes of slack). New deals submitted after
// the import naturally fall outside the window.
//
// Safe, idempotent — re-running only flips rows whose flag is still
// false, and rows outside the import window are never touched.
//
// Run dry:    set -a && . ./.env && set +a && npx tsx scripts/backfill-imported-from-glide.mts
// Commit:     add --commit

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
const SLACK_MS = 10 * 60 * 1000; // 10 minutes of safety buffer

console.log(COMMIT ? '── COMMIT MODE — writes will happen ──' : '── DRY RUN — no writes ──');

const importLog = await prisma.auditLog.findFirst({
  where: { action: 'glide_import' },
  orderBy: { createdAt: 'asc' },
});

if (!importLog) {
  console.log('No glide_import audit log entry found. Nothing to backfill.');
  await prisma.$disconnect();
  process.exit(0);
}

const cutoff = new Date(importLog.createdAt.getTime() + SLACK_MS);
console.log(`Import audit log: ${importLog.createdAt.toISOString()}`);
console.log(`Cutoff (import + 10min):  ${cutoff.toISOString()}`);

const candidates = await prisma.project.findMany({
  where: {
    createdAt: { lte: cutoff },
    importedFromGlide: false,
  },
  select: { id: true, customerName: true, createdAt: true },
});

console.log(`\nProjects with createdAt <= cutoff AND importedFromGlide=false: ${candidates.length}`);
if (candidates.length === 0) {
  console.log('Nothing to backfill.');
  await prisma.$disconnect();
  process.exit(0);
}
console.log('\nSample (first 10):');
for (const p of candidates.slice(0, 10)) {
  console.log(`  - ${p.customerName.padEnd(30)} ${p.createdAt.toISOString()}  ${p.id}`);
}

if (!COMMIT) {
  console.log('\nDry run complete. Re-run with --commit to flip the flag.');
  await prisma.$disconnect();
  process.exit(0);
}

const result = await prisma.project.updateMany({
  where: {
    createdAt: { lte: cutoff },
    importedFromGlide: false,
  },
  data: { importedFromGlide: true },
});
console.log(`\n✓ Flagged ${result.count} projects as importedFromGlide=true.`);

await prisma.$disconnect();
