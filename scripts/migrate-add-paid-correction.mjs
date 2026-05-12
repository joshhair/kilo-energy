// Turso production migration: paid-amount correction trail on PayrollEntry.
//
// Adds four nullable columns so admins can correct a Paid entry's recorded
// amount without losing the original value or triggering the negative-
// adjustment workflow (which implies real money flow). Use case: Glide-
// import cleanup, manual entry errors, kW changes after pay.
//
// Distinct from:
//   - chargebacks    → real money clawback (signed amount entry)
//   - 24h grace      → Paid→Pending reversal for uncommitted corrections
//   - this trail     → data correction; money already moved correctly
//
// Safe: pure additive — four nullable columns. Existing rows get NULL on
// all four. No data backfill needed.
//
// Idempotent: each column checked for existence before adding.
//
// Run:
//   set -a && . ./.env && set +a && node scripts/migrate-add-paid-correction.mjs          # apply
//   set -a && . ./.env && set +a && node scripts/migrate-add-paid-correction.mjs --down   # rollback

import { runMigration, columnExists } from './migrate-helpers.mjs';

async function up(db) {
  const adds = [
    { col: 'originalAmountCents', sql: `ALTER TABLE "PayrollEntry" ADD COLUMN "originalAmountCents" INTEGER` },
    { col: 'editedAfterPaidAt',   sql: `ALTER TABLE "PayrollEntry" ADD COLUMN "editedAfterPaidAt" DATETIME` },
    { col: 'editedBy',             sql: `ALTER TABLE "PayrollEntry" ADD COLUMN "editedBy" TEXT` },
    { col: 'editReason',           sql: `ALTER TABLE "PayrollEntry" ADD COLUMN "editReason" TEXT` },
  ];
  for (const { col, sql } of adds) {
    if (await columnExists(db, 'PayrollEntry', col)) {
      console.log(`✓ PayrollEntry.${col} already exists — skipping.`);
    } else {
      await db.execute(sql);
      console.log(`+ Added PayrollEntry.${col}.`);
    }
  }
}

async function down(db) {
  // SQLite < 3.35 cannot DROP COLUMN; libSQL/Turso supports it on
  // recent versions. The column drops are reversible (additive up),
  // but lose the audit trail if rerun. Operator must pass --down.
  const drops = ['editReason', 'editedBy', 'editedAfterPaidAt', 'originalAmountCents'];
  for (const col of drops) {
    if (!(await columnExists(db, 'PayrollEntry', col))) {
      console.log(`✓ PayrollEntry.${col} does not exist — skipping.`);
      continue;
    }
    await db.execute(`ALTER TABLE "PayrollEntry" DROP COLUMN "${col}"`);
    console.log(`- Dropped PayrollEntry.${col}.`);
  }
}

runMigration({ up, down, name: 'add-paid-correction' });
