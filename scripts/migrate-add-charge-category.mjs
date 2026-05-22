// Turso production migration: chargeCategory column on PayrollEntry.
//
// Adds one nullable TEXT column to classify standalone one-off charges
// (equipment damage, reimbursement clawback, customer dispute, misc).
// Existing rows get NULL — no backfill. The application code only
// branches on the new "Charge" path when chargeCategory IS NOT NULL,
// so a partially-migrated state is safe.
//
// Run:
//   set -a && . ./.env && set +a && node scripts/migrate-add-charge-category.mjs          # apply
//   set -a && . ./.env && set +a && node scripts/migrate-add-charge-category.mjs --down   # rollback

import { runMigration, columnExists } from './migrate-helpers.mjs';

async function up(db) {
  if (await columnExists(db, 'PayrollEntry', 'chargeCategory')) {
    console.log('✓ PayrollEntry.chargeCategory already exists — skipping.');
  } else {
    await db.execute(`ALTER TABLE "PayrollEntry" ADD COLUMN "chargeCategory" TEXT`);
    console.log('+ Added PayrollEntry.chargeCategory.');
  }
}

async function down(db) {
  if (!(await columnExists(db, 'PayrollEntry', 'chargeCategory'))) {
    console.log('✓ PayrollEntry.chargeCategory does not exist — skipping.');
    return;
  }
  await db.execute(`ALTER TABLE "PayrollEntry" DROP COLUMN "chargeCategory"`);
  console.log('- Dropped PayrollEntry.chargeCategory.');
}

runMigration({ up, down, name: 'add-charge-category' });
