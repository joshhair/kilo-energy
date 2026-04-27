// Migration: create the DataAccessLog table + its indexes on Turso.
//
// Why: read-side audit trail for the privacy-gated data plane. Records
// which user saw which model rows on which route, so a future leak can
// be diagnosed forensically (who saw what, when, for how long).
// Distinct from AuditLog (writes) because reads are high-volume and one
// row carries N record IDs as JSON.
//
// Safe: pure additive — creates a new table. No existing data touched.
// Idempotent: both up() and down() check existence before acting.
//
// Run with:
//   node scripts/migrate-add-data-access-log.mjs             # apply
//   node scripts/migrate-add-data-access-log.mjs --down      # rollback

import { runMigration, tableExists, indexExists } from "./migrate-helpers.mjs";

const INDEXES = [
  "DataAccessLog_actorUserId_createdAt_idx",
  "DataAccessLog_modelName_createdAt_idx",
  "DataAccessLog_createdAt_idx",
];

async function up(db) {
  if (await tableExists(db, "DataAccessLog")) {
    console.log('✓ Table "DataAccessLog" already exists — skipping CREATE.');
  } else {
    await db.execute(`
      CREATE TABLE "DataAccessLog" (
        "id"              TEXT     PRIMARY KEY,
        "actorUserId"     TEXT     NOT NULL,
        "effectiveUserId" TEXT,
        "route"           TEXT     NOT NULL,
        "modelName"       TEXT     NOT NULL,
        "recordIdsJson"   TEXT     NOT NULL,
        "recordCount"     INTEGER  NOT NULL,
        "createdAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Created table "DataAccessLog".');
  }

  for (const [name, sql] of [
    ["DataAccessLog_actorUserId_createdAt_idx", `CREATE INDEX "DataAccessLog_actorUserId_createdAt_idx" ON "DataAccessLog"("actorUserId", "createdAt")`],
    ["DataAccessLog_modelName_createdAt_idx", `CREATE INDEX "DataAccessLog_modelName_createdAt_idx" ON "DataAccessLog"("modelName", "createdAt")`],
    ["DataAccessLog_createdAt_idx", `CREATE INDEX "DataAccessLog_createdAt_idx" ON "DataAccessLog"("createdAt")`],
  ]) {
    if (await indexExists(db, name)) {
      console.log(`✓ Index "${name}" already exists — skipping.`);
    } else {
      await db.execute(sql);
      console.log(`✓ Created index "${name}".`);
    }
  }
}

async function down(db) {
  for (const name of INDEXES) {
    if (await indexExists(db, name)) {
      await db.execute(`DROP INDEX "${name}"`);
      console.log(`✓ Dropped index "${name}".`);
    } else {
      console.log(`– Index "${name}" not present.`);
    }
  }
  if (await tableExists(db, "DataAccessLog")) {
    await db.execute(`DROP TABLE "DataAccessLog"`);
    console.log('✓ Dropped table "DataAccessLog".');
  } else {
    console.log('– Table "DataAccessLog" not present.');
  }
}

runMigration({ up, down, name: "add-data-access-log" });
