// Migration: Float dollars → Int cents for all 9 money-at-rest columns.
//
// Why: Float storage silently accumulates cent drift. Compute is already exact
// via lib/money.ts; this closes the storage side. Timing is deliberate —
// migrating 0 real financial rows (dummy data only) is trivial; migrating
// thousands of live rows post-launch would be a scary prod op.
//
// Columns migrated (paired old → new):
//   Project.m1Amount          → m1AmountCents
//   Project.m2Amount          → m2AmountCents
//   Project.m3Amount          → m3AmountCents      (nullable preserved)
//   Project.setterM1Amount    → setterM1AmountCents
//   Project.setterM2Amount    → setterM2AmountCents
//   Project.setterM3Amount    → setterM3AmountCents (nullable preserved)
//   PayrollEntry.amount       → amountCents
//   Reimbursement.amount      → amountCents
//   BlitzCost.amount          → amountCents
//
// Backfill: CAST(ROUND(old * 100) AS INTEGER). Half-up rounding at the cent.
//
// Reversibility: down() adds the Float columns back and backfills
// cents / 100.0. Pair with a git revert so code reads the Float names again.

import { runMigration, columnExists } from './migrate-helpers.mjs';

const MIGRATIONS = [
  { table: 'Project',       oldCol: 'm1Amount',       newCol: 'm1AmountCents',       notNull: true,  defaultInt: 0 },
  { table: 'Project',       oldCol: 'm2Amount',       newCol: 'm2AmountCents',       notNull: true,  defaultInt: 0 },
  { table: 'Project',       oldCol: 'm3Amount',       newCol: 'm3AmountCents',       notNull: false, defaultInt: null },
  { table: 'Project',       oldCol: 'setterM1Amount', newCol: 'setterM1AmountCents', notNull: true,  defaultInt: 0 },
  { table: 'Project',       oldCol: 'setterM2Amount', newCol: 'setterM2AmountCents', notNull: true,  defaultInt: 0 },
  { table: 'Project',       oldCol: 'setterM3Amount', newCol: 'setterM3AmountCents', notNull: false, defaultInt: null },
  { table: 'PayrollEntry',  oldCol: 'amount',         newCol: 'amountCents',         notNull: true,  defaultInt: 0 },
  { table: 'Reimbursement', oldCol: 'amount',         newCol: 'amountCents',         notNull: true,  defaultInt: 0 },
  { table: 'BlitzCost',     oldCol: 'amount',         newCol: 'amountCents',         notNull: true,  defaultInt: 0 },
];

async function up(client) {
  for (const m of MIGRATIONS) {
    const hasNew = await columnExists(client, m.table, m.newCol);
    const hasOld = await columnExists(client, m.table, m.oldCol);

    // 1. Add the new Int column if missing.
    if (!hasNew) {
      const nullability = m.notNull
        ? `NOT NULL DEFAULT ${m.defaultInt ?? 0}`
        : ``;
      const sql = `ALTER TABLE "${m.table}" ADD COLUMN "${m.newCol}" INTEGER ${nullability}`.trim();
      console.log(`  + ${m.table}.${m.newCol}`);
      await client.execute(sql);
    }

    // 2. Backfill from old (if old exists — otherwise the migration was
    //    already run and the new column is already populated).
    if (hasOld) {
      const backfill = m.notNull
        ? `UPDATE "${m.table}" SET "${m.newCol}" = CAST(ROUND("${m.oldCol}" * 100) AS INTEGER) WHERE "${m.oldCol}" IS NOT NULL`
        : `UPDATE "${m.table}" SET "${m.newCol}" = CASE WHEN "${m.oldCol}" IS NULL THEN NULL ELSE CAST(ROUND("${m.oldCol}" * 100) AS INTEGER) END`;
      console.log(`  ~ backfilling ${m.table}.${m.newCol}`);
      await client.execute(backfill);
    }

    // 3. Drop the old column. SQLite supports DROP COLUMN since 3.35.
    if (hasOld) {
      console.log(`  - DROP ${m.table}.${m.oldCol}`);
      await client.execute(`ALTER TABLE "${m.table}" DROP COLUMN "${m.oldCol}"`);
    }
  }
}

async function down(client) {
  // Reverse: add Float columns back, backfill cents/100, drop *Cents.
  // Must be paired with a git revert so Prisma + app code read the old names.
  for (const m of MIGRATIONS) {
    const hasOld = await columnExists(client, m.table, m.oldCol);
    const hasNew = await columnExists(client, m.table, m.newCol);

    if (!hasOld) {
      const nullability = m.notNull
        ? `NOT NULL DEFAULT ${(m.defaultInt ?? 0) / 100}`
        : ``;
      const sql = `ALTER TABLE "${m.table}" ADD COLUMN "${m.oldCol}" REAL ${nullability}`.trim();
      console.log(`  + ${m.table}.${m.oldCol}`);
      await client.execute(sql);
    }

    if (hasNew) {
      const backfill = m.notNull
        ? `UPDATE "${m.table}" SET "${m.oldCol}" = "${m.newCol}" / 100.0 WHERE "${m.newCol}" IS NOT NULL`
        : `UPDATE "${m.table}" SET "${m.oldCol}" = CASE WHEN "${m.newCol}" IS NULL THEN NULL ELSE "${m.newCol}" / 100.0 END`;
      console.log(`  ~ backfilling ${m.table}.${m.oldCol}`);
      await client.execute(backfill);
    }

    if (hasNew) {
      console.log(`  - DROP ${m.table}.${m.newCol}`);
      await client.execute(`ALTER TABLE "${m.table}" DROP COLUMN "${m.newCol}"`);
    }
  }
}

await runMigration({ up, down, name: 'money-to-cents' });
