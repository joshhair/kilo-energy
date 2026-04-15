// Migration: ADD COLUMN "idempotencyKey" TEXT (nullable, unique)
// to the PayrollEntry table on the Turso production database.
//
// Why: prevents accidental double-pay when a client retries a POST /api/payroll
// request (double-click, network retry, etc). The route uses this key to
// dedupe — if a row with the same key already exists, return it instead of
// inserting a duplicate.
//
// Safe and additive — nullable column, no existing data is modified.
// Idempotent — up() and down() both check existence before acting.
//
// Note: down() drops the unique index and the column. SQLite DROP COLUMN
// support is modern-3.35+ only; Turso supports it. Existing rows with
// non-null idempotencyKey values will lose their keys — irreversible data
// loss. Operator must accept this when passing --down.
//
// Run with:
//   node scripts/migrate-add-payroll-idempotency.mjs           # apply
//   node scripts/migrate-add-payroll-idempotency.mjs --down    # rollback (lossy)

import { runMigration, columnExists, indexExists } from "./migrate-helpers.mjs";

const INDEX_NAME = "PayrollEntry_idempotencyKey_key";

async function up(db) {
  if (await columnExists(db, "PayrollEntry", "idempotencyKey")) {
    console.log('✓ Column "idempotencyKey" already exists — skipping ADD.');
  } else {
    await db.execute(`ALTER TABLE "PayrollEntry" ADD COLUMN "idempotencyKey" TEXT`);
    console.log('✓ Added column "idempotencyKey".');
  }

  if (await indexExists(db, INDEX_NAME)) {
    console.log(`✓ Unique index "${INDEX_NAME}" already exists — skipping.`);
  } else {
    await db.execute(`CREATE UNIQUE INDEX "${INDEX_NAME}" ON "PayrollEntry"("idempotencyKey")`);
    console.log(`✓ Created unique index "${INDEX_NAME}".`);
  }
}

async function down(db) {
  if (await indexExists(db, INDEX_NAME)) {
    await db.execute(`DROP INDEX "${INDEX_NAME}"`);
    console.log(`✓ Dropped unique index "${INDEX_NAME}".`);
  } else {
    console.log(`– Index "${INDEX_NAME}" not present.`);
  }
  if (await columnExists(db, "PayrollEntry", "idempotencyKey")) {
    await db.execute(`ALTER TABLE "PayrollEntry" DROP COLUMN "idempotencyKey"`);
    console.log('✓ Dropped column "idempotencyKey" (idempotency keys on existing rows are lost).');
  } else {
    console.log('– Column "idempotencyKey" not present.');
  }
}

runMigration({ up, down, name: "add-payroll-idempotency" });
