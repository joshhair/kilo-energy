// Migration: create the AuditLog table + its indexes on Turso.
//
// Why: immutable log of sensitive mutations (phase changes, financial edits,
// role/active flips, payroll publishes). Written by lib/audit.ts logChange(),
// read by the admin-only /dashboard/admin/audit viewer.
//
// Safe: pure additive — creates a new table. No existing data touched.
// Idempotent: both up() and down() check existence before acting.
//
// Run with:
//   node scripts/migrate-add-audit-log.mjs             # apply
//   node scripts/migrate-add-audit-log.mjs --down      # rollback

import { runMigration, tableExists, indexExists } from "./migrate-helpers.mjs";

const INDEXES = [
  "AuditLog_entityType_entityId_idx",
  "AuditLog_actorUserId_idx",
  "AuditLog_createdAt_idx",
];

async function up(db) {
  if (await tableExists(db, "AuditLog")) {
    console.log('✓ Table "AuditLog" already exists — skipping CREATE.');
  } else {
    await db.execute(`
      CREATE TABLE "AuditLog" (
        "id"          TEXT    PRIMARY KEY,
        "actorUserId" TEXT,
        "actorEmail"  TEXT,
        "action"      TEXT    NOT NULL,
        "entityType"  TEXT    NOT NULL,
        "entityId"    TEXT    NOT NULL,
        "oldValue"    TEXT,
        "newValue"    TEXT,
        "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Created table "AuditLog".');
  }

  for (const [name, sql] of [
    ["AuditLog_entityType_entityId_idx", `CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId")`],
    ["AuditLog_actorUserId_idx", `CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId")`],
    ["AuditLog_createdAt_idx", `CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt")`],
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
  // Drop indexes first, then the table. Each step is idempotent.
  for (const name of INDEXES) {
    if (await indexExists(db, name)) {
      await db.execute(`DROP INDEX "${name}"`);
      console.log(`✓ Dropped index "${name}".`);
    } else {
      console.log(`– Index "${name}" not present.`);
    }
  }
  if (await tableExists(db, "AuditLog")) {
    await db.execute(`DROP TABLE "AuditLog"`);
    console.log('✓ Dropped table "AuditLog".');
  } else {
    console.log('– Table "AuditLog" not present.');
  }
}

runMigration({ up, down, name: "add-audit-log" });
