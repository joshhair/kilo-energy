// One-shot migration for Batch 4b:
//   - PayrollEntry.paidAt (DATETIME, nullable) — stamped on Paid
//     transition. Used by the Paid→Pending 24h grace-window rule.
//   - Project.importedFromGlide (BOOLEAN, default false) — marks rows
//     brought in by the 2026-04-16 Glide bulk import. Chargeback
//     generation skips these.
//
// Safe, additive, idempotent.
//
// Run:      set -a && . ./.env && set +a && node scripts/migrate-add-paid-at-and-imported-flag.mjs
// Rollback: add --down (drops both columns)

import { runMigration, columnExists } from "./migrate-helpers.mjs";

async function up(client) {
  if (!(await columnExists(client, "PayrollEntry", "paidAt"))) {
    console.log('Adding PayrollEntry.paidAt...');
    await client.execute(`ALTER TABLE "PayrollEntry" ADD COLUMN "paidAt" DATETIME`);
    console.log('✓ Added.');
  } else {
    console.log('✓ Column "paidAt" already exists — skipping.');
  }
  if (!(await columnExists(client, "Project", "importedFromGlide"))) {
    console.log('Adding Project.importedFromGlide...');
    // SQLite requires a non-expression default for ADD COLUMN, which is
    // fine because BOOLEAN false = 0 literal. Existing rows get 0.
    await client.execute(`ALTER TABLE "Project" ADD COLUMN "importedFromGlide" BOOLEAN NOT NULL DEFAULT 0`);
    console.log('✓ Added.');
  } else {
    console.log('✓ Column "importedFromGlide" already exists — skipping.');
  }
}

async function down(client) {
  if (await columnExists(client, "Project", "importedFromGlide")) {
    await client.execute(`ALTER TABLE "Project" DROP COLUMN "importedFromGlide"`);
    console.log('✓ Dropped "importedFromGlide".');
  }
  if (await columnExists(client, "PayrollEntry", "paidAt")) {
    await client.execute(`ALTER TABLE "PayrollEntry" DROP COLUMN "paidAt"`);
    console.log('✓ Dropped "paidAt".');
  }
}

await runMigration({ up, down, name: "add-paid-at-and-imported-flag" });
process.exit(0);
