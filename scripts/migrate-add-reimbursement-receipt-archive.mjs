// One-shot migration: Reimbursement.receiptUrl + archivedAt
//
// Adds:
//   - receiptUrl TEXT — Vercel Blob public URL for the uploaded receipt
//   - archivedAt DATETIME — soft-archive timestamp (null = visible)
//   - index on archivedAt for fast "not archived" filtering
//
// Safe, additive, idempotent.
//
// Run:      set -a && . ./.env && set +a && node scripts/migrate-add-reimbursement-receipt-archive.mjs
// Rollback: add --down (drops both columns + index)

import { runMigration, columnExists, indexExists } from "./migrate-helpers.mjs";

async function up(client) {
  if (!(await columnExists(client, "Reimbursement", "receiptUrl"))) {
    console.log('Adding column "receiptUrl"...');
    await client.execute(`ALTER TABLE "Reimbursement" ADD COLUMN "receiptUrl" TEXT`);
    console.log(`✓ Added "receiptUrl".`);
  } else {
    console.log(`✓ Column "receiptUrl" already exists — skipping.`);
  }
  if (!(await columnExists(client, "Reimbursement", "archivedAt"))) {
    console.log('Adding column "archivedAt"...');
    await client.execute(`ALTER TABLE "Reimbursement" ADD COLUMN "archivedAt" DATETIME`);
    console.log(`✓ Added "archivedAt".`);
  } else {
    console.log(`✓ Column "archivedAt" already exists — skipping.`);
  }
  if (!(await indexExists(client, "Reimbursement_archivedAt_idx"))) {
    console.log('Creating index on archivedAt...');
    await client.execute(`CREATE INDEX IF NOT EXISTS "Reimbursement_archivedAt_idx" ON "Reimbursement"("archivedAt")`);
    console.log(`✓ Index created.`);
  } else {
    console.log(`✓ Index "Reimbursement_archivedAt_idx" already exists — skipping.`);
  }
}

async function down(client) {
  if (await indexExists(client, "Reimbursement_archivedAt_idx")) {
    await client.execute(`DROP INDEX IF EXISTS "Reimbursement_archivedAt_idx"`);
    console.log(`✓ Index dropped.`);
  }
  if (await columnExists(client, "Reimbursement", "archivedAt")) {
    await client.execute(`ALTER TABLE "Reimbursement" DROP COLUMN "archivedAt"`);
    console.log(`✓ Dropped "archivedAt".`);
  }
  if (await columnExists(client, "Reimbursement", "receiptUrl")) {
    await client.execute(`ALTER TABLE "Reimbursement" DROP COLUMN "receiptUrl"`);
    console.log(`✓ Dropped "receiptUrl".`);
  }
}

await runMigration({ up, down, name: "add-reimbursement-receipt-archive" });
process.exit(0);
